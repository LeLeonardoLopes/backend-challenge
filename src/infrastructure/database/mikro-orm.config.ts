import { Options, PostgreSqlDriver } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";
import { WalletEntity } from "./entities/wallet.entity";
import { WalletLedgerEntryEntity } from "./entities/wallet-ledger-entry.entity";
import { WagerTransactionEntity } from "./entities/wager-transaction.entity";
import { InboxMessageEntity } from "./entities/inbox-message.entity";
import { OutboxMessageEntity } from "./entities/outbox-message.entity";

const config: Options = {
  driver: PostgreSqlDriver,
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgrespassword",
  dbName: process.env.DB_NAME || "wagering_db",
  entities: [
    WalletEntity,
    WalletLedgerEntryEntity,
    WagerTransactionEntity,
    InboxMessageEntity,
    OutboxMessageEntity,
  ],
  extensions: [Migrator],
  migrations: {
    path: "./dist/infrastructure/database/migrations",
    pathTs: "./src/infrastructure/database/migrations",
    tableName: "mikro_orm_migrations",
    transactional: true,
    allOrNothing: true,
    dropTables: false,
    safe: false,
    emit: "ts",
  },
  debug: process.env.NODE_ENV === "development",
};

export default config;
