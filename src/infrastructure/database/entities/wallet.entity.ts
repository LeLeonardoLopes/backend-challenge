import { Entity, PrimaryKey, Property, Check, Unique, Index } from "@mikro-orm/core";

@Entity({ tableName: "wallets" })
@Check({ expression: "balance >= 0" })
@Unique({ properties: ["playerId", "currency"] })
export class WalletEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "uuid" })
  @Index()
  playerId!: string;

  @Property({ length: 3 })
  currency!: string;

  @Property({ columnType: "numeric(18,2)" })
  balance!: string;

  @Property({ type: "integer", default: 1 })
  version!: number;

  @Property({ columnType: "timestamptz" })
  createdAt: Date = new Date();

  @Property({ columnType: "timestamptz", onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
