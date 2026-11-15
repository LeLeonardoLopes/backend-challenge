import { Entity, PrimaryKey, Property } from "@mikro-orm/core";

@Entity({ tableName: "inbox_messages" })
export class InboxMessageEntity {
  @PrimaryKey({ length: 100 })
  messageId!: string;

  @PrimaryKey({ length: 100 })
  consumerName!: string;

  @Property({ length: 64 })
  payloadHash!: string;

  @Property({ columnType: "timestamptz" })
  receivedAt: Date = new Date();

  @Property({ columnType: "timestamptz", nullable: true })
  processedAt?: Date;
}
