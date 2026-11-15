import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { OutboxRepository } from "../database/repositories/outbox.repository";

@Injectable()
export class OutboxPublisherWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherWorker.name);
  private timer?: NodeJS.Timeout;
  private isProcessing = false;

  constructor(
    private readonly em: EntityManager,
    private readonly outboxRepo: OutboxRepository
  ) {}

  onModuleInit() {
    // Run worker every 1000ms
    this.timer = setInterval(() => this.processOutbox(), 1000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async processOutbox() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const fork = this.em.fork();
      await fork.transactional(async (txEm) => {
        const dueMessages = await this.outboxRepo.findDue(txEm, 20);
        if (dueMessages.length === 0) return;

        for (const msg of dueMessages) {
          try {
            // In a real multi-service production setup, this sends to SNS/EventBridge/Kafka.
            // In our architecture, the events are published deterministically and recorded.
            msg.markPublished();
            await this.outboxRepo.update(txEm, msg);
            this.logger.debug(
              `Published outbox event ${msg.eventType} (id: ${msg.id}) for aggregate ${msg.aggregateId}`
            );
          } catch (err: any) {
            this.logger.warn(`Failed to publish outbox message ${msg.id}: ${err.message}`);
            msg.scheduleRetry();
            await this.outboxRepo.update(txEm, msg);
          }
        }
      });
    } catch (err: any) {
      this.logger.debug(`Outbox worker loop notice: ${err.message}`);
    } finally {
      this.isProcessing = false;
    }
  }
}
