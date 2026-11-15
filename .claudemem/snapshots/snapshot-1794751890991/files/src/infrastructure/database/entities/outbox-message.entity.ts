import { Entity, PrimaryKey, Property, Index } from "@mikro-orm/core";

@Entity({ tableName: "outbox_messages" })
@Index({ properties: ["publishedAt", "nextAttemptAt"] })
export class OutboxMessageEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "uuid" })
  aggregateId!: string;

  @Property({ length: 100 })
  eventType!: string;

  @Property({ type: "jsonb" })
  payload!: Record<string, unknown>;

  @Property({ columnType: "timestamptz" })
  occurredAt: Date = new Date();

  @Property({ type: "integer", default: 0 })
  attempts: number = 0;

  @Property({ columnType: "timestamptz", nullable: true })
  nextAttemptAt?: Date;

  @Property({ columnType: "timestamptz", nullable: true })
  publishedAt?: Date;
}
