import { Module, Global } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/core";
import { EntityManager } from "@mikro-orm/postgresql";
import mikroOrmConfig from "./infrastructure/database/mikro-orm.config";
import { WalletsController } from "./infrastructure/http/controllers/wallets.controller";
import { WageringController } from "./infrastructure/http/controllers/wagering.controller";
import { HealthController } from "./infrastructure/http/controllers/health.controller";
import { DashboardController } from "./infrastructure/http/controllers/dashboard.controller";
import { WalletRepository } from "./infrastructure/database/repositories/wallet.repository";
import { LedgerRepository } from "./infrastructure/database/repositories/ledger.repository";
import { WagerTransactionRepository } from "./infrastructure/database/repositories/wager-transaction.repository";
import { InboxRepository } from "./infrastructure/database/repositories/inbox.repository";
import { OutboxRepository } from "./infrastructure/database/repositories/outbox.repository";
import { CreateWalletUseCase } from "./application/use-cases/create-wallet.use-case";
import { ProcessWagerTransactionUseCase } from "./application/use-cases/process-wager-transaction.use-case";
import { ReconcileWalletUseCase } from "./application/use-cases/reconcile-wallet.use-case";
import { SqsConsumerService } from "./infrastructure/messaging/sqs-consumer.service";
import { OutboxPublisherWorker } from "./infrastructure/messaging/outbox-publisher.worker";
import { PendingReferenceWorker } from "./infrastructure/messaging/pending-reference.worker";

@Global()
@Module({
  controllers: [
    WalletsController,
    WageringController,
    HealthController,
    DashboardController,
  ],
  providers: [
    // Direct MikroORM & EntityManager Provider (clean, resilient, native Bun support)
    {
      provide: MikroORM,
      useFactory: async () => {
        return await MikroORM.init(mikroOrmConfig);
      },
    },
    {
      provide: EntityManager,
      useFactory: (orm: MikroORM) => orm.em as EntityManager,
      inject: [MikroORM],
    },

    // Repositories
    WalletRepository,
    LedgerRepository,
    WagerTransactionRepository,
    InboxRepository,
    OutboxRepository,

    // Use Cases (Domain Application Services)
    {
      provide: CreateWalletUseCase,
      useFactory: (w: WalletRepository, l: LedgerRepository, o: OutboxRepository) =>
        new CreateWalletUseCase(w, l, o),
      inject: [WalletRepository, LedgerRepository, OutboxRepository],
    },
    {
      provide: ProcessWagerTransactionUseCase,
      useFactory: (
        w: WalletRepository,
        l: LedgerRepository,
        tx: WagerTransactionRepository,
        o: OutboxRepository
      ) => new ProcessWagerTransactionUseCase(w, l, tx, o),
      inject: [
        WalletRepository,
        LedgerRepository,
        WagerTransactionRepository,
        OutboxRepository,
      ],
    },
    {
      provide: ReconcileWalletUseCase,
      useFactory: (w: WalletRepository, l: LedgerRepository) =>
        new ReconcileWalletUseCase(w, l),
      inject: [WalletRepository, LedgerRepository],
    },

    // Background workers & SQS consumer
    SqsConsumerService,
    OutboxPublisherWorker,
    PendingReferenceWorker,
  ],
  exports: [MikroORM, EntityManager],
})
export class AppModule {}
