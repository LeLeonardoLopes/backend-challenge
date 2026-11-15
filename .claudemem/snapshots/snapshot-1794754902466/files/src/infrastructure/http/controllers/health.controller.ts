import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { SQSClient, ListQueuesCommand } from "@aws-sdk/client-sqs";

@Controller("health")
export class HealthController {
  private sqsClient: SQSClient;

  constructor(private readonly em: EntityManager) {
    this.sqsClient = new SQSClient({
      region: process.env.AWS_REGION || "us-east-1",
      endpoint: process.env.AWS_ENDPOINT || "http://localhost:4566",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
      },
    });
  }

  @Get("live")
  live() {
    return {
      status: "UP",
      timestamp: new Date().toISOString(),
      instance: process.env.INSTANCE_ID || "app",
    };
  }

  @Get("ready")
  async ready() {
    try {
      // 1. Check PostgreSQL
      await this.em.getConnection().execute("SELECT 1");

      // 2. Check SQS
      await this.sqsClient.send(new ListQueuesCommand({ MaxResults: 1 }));

      return {
        status: "UP",
        checks: {
          database: "UP",
          messaging: "UP",
        },
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      throw new ServiceUnavailableException({
        status: "DOWN",
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
