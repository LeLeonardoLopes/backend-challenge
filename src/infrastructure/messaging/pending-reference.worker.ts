import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { WagerTransactionRepository } from "../database/repositories/wager-transaction.repository";
import { WalletRepository } from "../database/repositories/wallet.repository";
import { LedgerRepository } from "../database/repositories/ledger.repository";
import { OutboxRepository } from "../database/repositories/outbox.repository";
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../domain/entities/wager-transaction";
import {
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from "../../domain/events/integration-event";
import { OutboxMessage } from "../../domain/entities/outbox-message";

@Injectable()
export class PendingReferenceWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private timer?: NodeJS.Timeout;
  private isProcessing = false;
  private readonly maxPendingAgeMs = 30000; // 30 seconds TTL before rejecting

  constructor(
    private readonly em: EntityManager,
    private readonly wagerRepo: WagerTransactionRepository,
    private readonly walletRepo: WalletRepository,
    private readonly ledgerRepo: LedgerRepository,
    private readonly outboxRepo: OutboxRepository
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => this.processPendingReferences(), 2000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async processPendingReferences() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const fork = this.em.fork();
      await fork.transactional(async (txEm) => {
        const pending = await this.wagerRepo.findPendingReferences(txEm, 20);
        if (pending.length === 0) return;

        const now = Date.now();
        for (const tx of pending) {
          const refExternalId = tx.referenceExternalTransactionId;
          if (!refExternalId) continue;

          // Check if referenced transaction has arrived now
          const ref = await this.wagerRepo.findByExternalId(txEm, tx.providerId, refExternalId);
          if (ref && ref.status === WagerTransactionStatus.Processed) {
            // Lock the wallet and apply the transaction!
            const wallet = await this.walletRepo.findByIdForUpdate(txEm, tx.walletId);
            if (!wallet) continue;

            if (tx.kind === WagerTransactionKind.Refund) {
              const entry = wallet.credit(tx.money, tx.id);
              await this.walletRepo.save(txEm, wallet);
              await this.ledgerRepo.append(txEm, entry);

              tx.markProcessed(ref.id);
              await this.wagerRepo.save(txEm, tx);

              const pEvent = WagerTransactionProcessed.create(
                {
                  transactionId: tx.id,
                  providerId: tx.providerId,
                  externalTransactionId: tx.externalTransactionId,
                  walletId: tx.walletId,
                  playerId: tx.playerId,
                  roundId: tx.roundId,
                  gameId: tx.gameId,
                  kind: tx.kind,
                  money: tx.money.toJSON(),
                },
                tx.idempotencyKey
              );
              const bEvent = WalletBalanceChanged.create(
                {
                  walletId: wallet.id,
                  transactionId: tx.id,
                  direction: entry.direction,
                  money: entry.money.toJSON(),
                  balanceBefore: entry.balanceBefore.toJSON(),
                  balanceAfter: entry.balanceAfter.toJSON(),
                  walletVersion: wallet.version,
                },
                tx.idempotencyKey
              );

              await this.outboxRepo.append(txEm, OutboxMessage.enqueue(pEvent));
              await this.outboxRepo.append(txEm, OutboxMessage.enqueue(bEvent));

              this.logger.log(`Successfully resolved pending reference for ${tx.id} (${tx.kind})`);
            }
          } else if (now - tx.createdAt.getTime() > this.maxPendingAgeMs) {
            // TTL exceeded -> Reject transaction
            tx.reject("REFERENCE_NOT_FOUND");
            await this.wagerRepo.save(txEm, tx);

            const rEvent = WagerTransactionRejected.create(
              {
                transactionId: tx.id,
                providerId: tx.providerId,
                externalTransactionId: tx.externalTransactionId,
                walletId: tx.walletId,
                playerId: tx.playerId,
                roundId: tx.roundId,
                gameId: tx.gameId,
                kind: tx.kind,
                failureCode: "REFERENCE_NOT_FOUND",
              },
              tx.idempotencyKey
            );
            await this.outboxRepo.append(txEm, OutboxMessage.enqueue(rEvent));

            this.logger.warn(`Pending reference ${tx.id} timed out. Marked as REJECTED.`);
          }
        }
      });
    } catch (err: any) {
      this.logger.debug(`Pending reference loop notice: ${err.message}`);
    } finally {
      this.isProcessing = false;
    }
  }
}
