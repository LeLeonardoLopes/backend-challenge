import { Entity, PrimaryKey, Property, Enum, Index } from "@mikro-orm/core";
import { LedgerDirection } from "../../../domain/entities/wallet-ledger-entry";

@Entity({ tableName: "wallet_ledger_entries" })
@Index({ properties: ["walletId", "createdAt", "id"] })
export class WalletLedgerEntryEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "uuid" })
  @Index()
  walletId!: string;

  @Property({ type: "uuid" })
  transactionId!: string;

  @Enum(() => LedgerDirection)
  direction!: LedgerDirection;

  @Property({ columnType: "numeric(18,2)" })
  amount!: string;

  @Property({ length: 3 })
  currency!: string;

  @Property({ columnType: "numeric(18,2)" })
  balanceBefore!: string;

  @Property({ columnType: "numeric(18,2)" })
  balanceAfter!: string;

  @Property({ columnType: "timestamptz" })
  createdAt: Date = new Date();
}
