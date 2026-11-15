import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueUrlCommand,
  Message,
} from "@aws-sdk/client-sqs";
import { EntityManager } from "@mikro-orm/postgresql";
import { ProcessWagerTransactionUseCase } from "../../application/use-cases/process-wager-transaction.use-case";
import { InboxRepository } from "../database/repositories/inbox.repository";
import { InboxMessage } from "../../domain/entities/inbox-message";
import { computeCanonicalPayloadHash } from "../../domain/utils/canonical-hash";

@Injectable()
export class SqsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsConsumerService.name);
  private sqsClient!: SQSClient;
  private queueUrl!: string;
  private isRunning = false;
  private isShuttingDown = false;
  private inFlightMessages = 0;
  private readonly consumerName = "wagering-processor-sqs";

  constructor(
    private readonly em: EntityManager,
    private readonly processWagerUseCase: ProcessWagerTransactionUseCase,
    private readonly inboxRepo: InboxRepository
  ) {}

  onModuleInit() {
    this.sqsClient = new SQSClient({
      region: process.env.AWS_REGION || "us-east-1",
      endpoint: process.env.AWS_ENDPOINT || "http://localhost:4566",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
      },
    });

    const endpoint = process.env.AWS_ENDPOINT || "http://localhost:4566";
    this.queueUrl = `${endpoint}/000000000000/wager-transactions.fifo`;

    this.isRunning = true;
    this.resolveQueueAndStart();
  }

  private async resolveQueueAndStart() {
    try {
      const res = await this.sqsClient.send(
        new GetQueueUrlCommand({ QueueName: "wager-transactions.fifo" })
      );
      if (res.QueueUrl) {
        this.queueUrl = res.QueueUrl;
      }
    } catch {
      // Fallback to default constructed URL
    }
    this.startPolling();
  }

  async onModuleDestroy() {
    this.logger.log("SIGTERM received, initiating graceful shutdown of SQS consumer...");
    this.isShuttingDown = true;
    this.isRunning = false;

    // Wait up to 5 seconds for in-flight messages to complete
    const start = Date.now();
    while (this.inFlightMessages > 0 && Date.now() - start < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    this.logger.log("SQS consumer shut down cleanly.");
  }

  private async startPolling() {
    while (this.isRunning && !this.isShuttingDown) {
      try {
        const cmd = new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: 5,
          WaitTimeSeconds: 5, // Long polling
          VisibilityTimeout: 15,
        });

        const res = await this.sqsClient.send(cmd);
        if (res.Messages && res.Messages.length > 0) {
          await Promise.all(res.Messages.map((msg) => this.handleMessage(msg)));
        }
      } catch (err: any) {
        if (!this.isShuttingDown) {
          // Avoid flooding logs when LocalStack is starting up
          this.logger.debug(`SQS poll error: ${err.message}`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    }
  }

  private async handleMessage(msg: Message) {
    if (!msg.Body || !msg.ReceiptHandle) return;

    this.inFlightMessages += 1;
    try {
      const payload = JSON.parse(msg.Body);
      const messageId = payload.messageId || msg.MessageId || "unknown";
      const wagerData = payload.data;

      if (!wagerData) {
        // Poison pill: Malformed message -> acknowledge to not block queue
        this.logger.warn(`Malformed SQS message without data payload. MessageId: ${messageId}`);
        await this.ack(msg.ReceiptHandle);
        return;
      }

      const payloadHash = computeCanonicalPayloadHash(wagerData);
      const idempotencyKey =
        wagerData.idempotencyKey || `${wagerData.providerId}:${wagerData.externalTransactionId}`;

      // Execute within database transaction
      const fork = this.em.fork();
      await fork.transactional(async (txEm) => {
        // 1. Deduplication via Persistent Inbox
        const existingInbox = await this.inboxRepo.find(txEm, this.consumerName, messageId);
        if (existingInbox && existingInbox.isProcessed()) {
          this.logger.log(`Message ${messageId} already processed in Inbox. Skipping re-execution.`);
          return;
        }

        // 2. Reuse the EXACT same use case as HTTP
        await this.processWagerUseCase.execute(txEm, wagerData, idempotencyKey, messageId);

        // 3. Mark Inbox as processed in same SQL transaction
        const inbox = InboxMessage.receive({
          messageId,
          consumerName: this.consumerName,
          payloadHash,
        });
        inbox.markProcessed();
        await this.inboxRepo.record(txEm, inbox);
      });

      // 4. Acknowledge message ONLY after SQL transaction commit succeeds!
      await this.ack(msg.ReceiptHandle);
    } catch (err: any) {
      this.logger.error(`Error processing SQS message: ${err.message}`, err.stack);
      // Let visibility timeout expire so SQS can retry (eventually routing to DLQ after maxReceiveCount)
    } finally {
      this.inFlightMessages -= 1;
    }
  }

  private async ack(receiptHandle: string) {
    try {
      await this.sqsClient.send(
        new DeleteMessageCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: receiptHandle,
        })
      );
    } catch (err: any) {
      this.logger.error(`Failed to acknowledge SQS message: ${err.message}`);
    }
  }
}
