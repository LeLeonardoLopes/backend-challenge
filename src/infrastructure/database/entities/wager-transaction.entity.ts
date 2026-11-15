import { Entity, PrimaryKey, Property, Enum, Unique, Index } from "@mikro-orm/core";
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../../domain/entities/wager-transaction";

@Entity({ tableName: "wager_transactions" })
@Unique({ properties: ["providerId", "externalTransactionId"] })
@Unique({ properties: ["idempotencyKey"] })
@Index({ properties: ["status", "createdAt"] })
export class WagerTransactionEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ length: 50 })
  providerId!: string;

  @Property({ length: 100 })
  externalTransactionId!: string;

  @Property({ length: 150 })
  idempotencyKey!: string;

  @Property({ length: 64 })
  payloadHash!: string;

  @Property({ type: "uuid" })
  @Index()
  walletId!: string;

  @Property({ type: "uuid" })
  @Index()
  playerId!: string;

  @Property({ length: 100 })
  roundId!: string;

  @Property({ length: 100 })
  gameId!: string;

  @Enum(() => WagerTransactionKind)
  kind!: WagerTransactionKind;

  @Property({ columnType: "numeric(18,2)" })
  amount!: string;

  @Property({ length: 3 })
  currency!: string;

  @Property({ length: 100, nullable: true })
  referenceExternalTransactionId?: string;

  @Property({ type: "uuid", nullable: true })
  referenceTransactionId?: string;

  @Enum(() => WagerTransactionStatus)
  status!: WagerTransactionStatus;

  @Property({ length: 50, nullable: true })
  failureCode?: string;

  @Property({ columnType: "timestamptz" })
  createdAt: Date = new Date();

  @Property({ columnType: "timestamptz", nullable: true })
  processedAt?: Date;
}
