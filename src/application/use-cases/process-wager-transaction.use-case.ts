import { EntityManager } from "@mikro-orm/postgresql";
import { MetricsService } from "../../infrastructure/observability/metrics.service";
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../domain/entities/wager-transaction";
import { Money, MoneyProps } from "../../domain/value-objects/money";
import { computeCanonicalPayloadHash } from "../../domain/utils/canonical-hash";
import { WalletRepository } from "../../infrastructure/database/repositories/wallet.repository";
import { LedgerRepository } from "../../infrastructure/database/repositories/ledger.repository";
import { WagerTransactionRepository } from "../../infrastructure/database/repositories/wager-transaction.repository";
import { OutboxRepository } from "../../infrastructure/database/repositories/outbox.repository";
import { OutboxMessage } from "../../domain/entities/outbox-message";
import {
  WalletBalanceChanged,
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
} from "../../domain/events/integration-event";
import {
  DomainError,
  IdempotencyConflictError,
  CurrencyMismatchError,
} from "../../domain/errors/domain-errors";

export interface ProcessWagerTransactionDto {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

export interface ProcessWagerTransactionResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: MoneyProps;
  failureCode?: string;
  idempotentReplay: boolean;
}

export class ProcessWagerTransactionUseCase {
  constructor(
    private readonly walletRepo: WalletRepository,
    private readonly ledgerRepo: LedgerRepository,
    private readonly wagerRepo: WagerTransactionRepository,
    private readonly outboxRepo: OutboxRepository
  ) {}

  public async execute(
    em: EntityManager,
    dto: ProcessWagerTransactionDto,
    idempotencyKey: string,
    correlationId = idempotencyKey
  ): Promise<ProcessWagerTransactionResult> {
    // 1. Calculate canonical payload hash of business fields
    const payloadHash = computeCanonicalPayloadHash({
      providerId: dto.providerId,
      externalTransactionId: dto.externalTransactionId,
      playerId: dto.playerId,
      walletId: dto.walletId,
      roundId: dto.roundId,
      gameId: dto.gameId,
      kind: dto.kind,
      money: dto.money,
      referenceExternalTransactionId: dto.referenceExternalTransactionId ?? null,
    });

    const money = Money.from(dto.money);
    const startTime = performance.now();

    try {
      const result = await em.transactional(async (txEm) => {
        // 2. Check Idempotency Key
        const existingTx = await this.wagerRepo.findByIdempotencyKey(txEm, idempotencyKey);
        if (existingTx) {
          if (!existingTx.matchesPayload(payloadHash)) {
            throw new IdempotencyConflictError(idempotencyKey);
          }

          // Idempotent Replay: Fetch current wallet balance to return stable response
          const wallet = await this.walletRepo.findById(txEm, dto.walletId);
          MetricsService.get().recordDuplicate();
          MetricsService.get().recordTransaction(
            { status: "REPLAY", kind: dto.kind, provider: dto.providerId },
            performance.now() - startTime
          );
          return {
            transactionId: existingTx.id,
            status: existingTx.status,
            balance: wallet ? wallet.balance.toJSON() : dto.money,
            failureCode: existingTx.failureCode,
            idempotentReplay: true,
          };
        }

        // 3. Acquire Exclusive Pessimistic Lock on the Wallet (SELECT ... FOR UPDATE)
        const wallet = await this.walletRepo.findByIdForUpdate(txEm, dto.walletId);
        if (!wallet) {
          throw new DomainError(`Wallet ${dto.walletId} not found`, "WALLET_NOT_FOUND");
        }

        if (wallet.currency !== money.currency) {
          throw new CurrencyMismatchError(wallet.currency, money.currency);
        }

        if (wallet.playerId !== dto.playerId) {
          throw new DomainError("Player ID does not match wallet owner", "PLAYER_MISMATCH");
        }

        // 4. Create Transaction Aggregate
        const tx = WagerTransaction.create({
          providerId: dto.providerId,
          externalTransactionId: dto.externalTransactionId,
          idempotencyKey,
          payloadHash,
          walletId: dto.walletId,
          playerId: dto.playerId,
          roundId: dto.roundId,
          gameId: dto.gameId,
          kind: dto.kind,
          money,
          referenceExternalTransactionId: dto.referenceExternalTransactionId,
        });

        // 5. Execute Business Rules by Kind
        return this.applyTransaction(txEm, wallet, tx, correlationId);
      });

      MetricsService.get().recordTransaction(
        { status: result.status, kind: dto.kind, provider: dto.providerId },
        performance.now() - startTime
      );
      return result;
    } catch (err: any) {
      // Handle PostgreSQL unique constraint collision across concurrent instances
      if (err.message?.includes("unique_idempotency_key") || err.code === "23505") {
        MetricsService.get().recordLockConflict();
        MetricsService.get().recordDuplicate();
        const cleanEm = em.fork();
        const existingTx = await this.wagerRepo.findByIdempotencyKey(cleanEm, idempotencyKey);
        if (existingTx) {
          const wallet = await this.walletRepo.findById(cleanEm, dto.walletId);
          MetricsService.get().recordTransaction(
            { status: "REPLAY", kind: dto.kind, provider: dto.providerId },
            performance.now() - startTime
          );
          return {
            transactionId: existingTx.id,
            status: existingTx.status,
            balance: wallet ? wallet.balance.toJSON() : dto.money,
            failureCode: existingTx.failureCode,
            idempotentReplay: true,
          };
        }
      }
      throw err;
    }
  }

  private async applyTransaction(
    txEm: EntityManager,
    wallet: any,
    tx: WagerTransaction,
    correlationId: string
  ): Promise<ProcessWagerTransactionResult> {
    switch (tx.kind) {
      case WagerTransactionKind.Bet:
        return this.handleBet(txEm, wallet, tx, correlationId);
      case WagerTransactionKind.Win:
        return this.handleWin(txEm, wallet, tx, correlationId);
      case WagerTransactionKind.Loss:
        return this.handleLoss(txEm, wallet, tx, correlationId);
      case WagerTransactionKind.Refund:
        return this.handleRefund(txEm, wallet, tx, correlationId);
      case WagerTransactionKind.Rollback:
        return this.handleRollback(txEm, wallet, tx, correlationId);
      default:
        throw new DomainError(`Unsupported transaction kind: ${tx.kind}`, "UNSUPPORTED_KIND");
    }
  }

  private async handleBet(
    txEm: EntityManager,
    wallet: any,
    tx: WagerTransaction,
    correlationId: string
  ): Promise<ProcessWagerTransactionResult> {
    // Insufficient funds check
    if (wallet.balance.isLessThan(tx.money)) {
      tx.reject("INSUFFICIENT_FUNDS");
      await this.wagerRepo.save(txEm, tx);

      const event = WagerTransactionRejected.create(
        {
          transactionId: tx.id,
          providerId: tx.providerId,
          externalTransactionId: tx.externalTransactionId,
          walletId: tx.walletId,
          playerId: tx.playerId,
          roundId: tx.roundId,
          gameId: tx.gameId,
          kind: tx.kind,
          failureCode: "INSUFFICIENT_FUNDS",
        },
        correlationId
      );
      await this.outboxRepo.append(txEm, OutboxMessage.enqueue(event));

      return {
        transactionId: tx.id,
        status: WagerTransactionStatus.Rejected,
        failureCode: "INSUFFICIENT_FUNDS",
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
      };
    }

    // Debit wallet and append ledger entry
    const entry = wallet.debit(tx.money, tx.id);
    await this.walletRepo.save(txEm, wallet);
    await this.ledgerRepo.append(txEm, entry);

    tx.markProcessed(undefined);
    await this.wagerRepo.save(txEm, tx);

    // Enqueue Outbox Events
    const processedEvent = WagerTransactionProcessed.create(
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
      correlationId
    );
    const balanceEvent = WalletBalanceChanged.create(
      {
        walletId: wallet.id,
        transactionId: tx.id,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      },
      correlationId
    );

    await this.outboxRepo.append(txEm, OutboxMessage.enqueue(processedEvent));
    await this.outboxRepo.append(txEm, OutboxMessage.enqueue(balanceEvent));

    return {
      transactionId: tx.id,
      status: WagerTransactionStatus.Processed,
      balance: wallet.balance.toJSON(),
      idempotentReplay: false,
    };
  }

  private async handleWin(
    txEm: EntityManager,
    wallet: any,
    tx: WagerTransaction,
    correlationId: string
  ): Promise<ProcessWagerTransactionResult> {
    const entry = wallet.credit(tx.money, tx.id);
    await this.walletRepo.save(txEm, wallet);
    await this.ledgerRepo.append(txEm, entry);

    tx.markProcessed(undefined);
    await this.wagerRepo.save(txEm, tx);

    const processedEvent = WagerTransactionProcessed.create(
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
      correlationId
    );
    const balanceEvent = WalletBalanceChanged.create(
      {
        walletId: wallet.id,
        transactionId: tx.id,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      },
      correlationId
    );

    await this.outboxRepo.append(txEm, OutboxMessage.enqueue(processedEvent));
    await this.outboxRepo.append(txEm, OutboxMessage.enqueue(balanceEvent));

    return {
      transactionId: tx.id,
      status: WagerTransactionStatus.Processed,
      balance: wallet.balance.toJSON(),
      idempotentReplay: false,
    };
  }

  private async handleLoss(
    txEm: EntityManager,
    wallet: any,
    tx: WagerTransaction,
    correlationId: string
  ): Promise<ProcessWagerTransactionResult> {
    tx.markProcessed(undefined);
    await this.wagerRepo.save(txEm, tx);

    const processedEvent = WagerTransactionProcessed.create(
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
      correlationId
    );
    await this.outboxRepo.append(txEm, OutboxMessage.enqueue(processedEvent));

    return {
      transactionId: tx.id,
      status: WagerTransactionStatus.Processed,
      balance: wallet.balance.toJSON(),
      idempotentReplay: false,
    };
  }

  private async handleRefund(
    txEm: EntityManager,
    wallet: any,
    tx: WagerTransaction,
    correlationId: string
  ): Promise<ProcessWagerTransactionResult> {
    const refExternalId = tx.referenceExternalTransactionId!;
    const ref = await this.wagerRepo.findByExternalId(txEm, tx.providerId, refExternalId);

    // If referenced transaction is not yet present, persist as PENDING_REFERENCE
    if (!ref) {
      tx.markPendingReference();
      await this.wagerRepo.save(txEm, tx);

      const pendingEvent = WagerTransactionPendingReference.create(
        {
          transactionId: tx.id,
          providerId: tx.providerId,
          externalTransactionId: tx.externalTransactionId,
          referenceExternalTransactionId: refExternalId,
          walletId: tx.walletId,
          playerId: tx.playerId,
          roundId: tx.roundId,
        },
        correlationId
      );
      await this.outboxRepo.append(txEm, OutboxMessage.enqueue(pendingEvent));

      return {
        transactionId: tx.id,
        status: WagerTransactionStatus.PendingReference,
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
      };
    }

    // Reference validation rules
    if (ref.kind !== WagerTransactionKind.Bet) {
      tx.reject("INVALID_REFERENCE_KIND");
      await this.wagerRepo.save(txEm, tx);
      return {
        transactionId: tx.id,
        status: WagerTransactionStatus.Rejected,
        failureCode: "INVALID_REFERENCE_KIND",
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
      };
    }

    if (!ref.money.equals(tx.money)) {
      tx.reject("REFERENCE_AMOUNT_MISMATCH");
      await this.wagerRepo.save(txEm, tx);
      return {
        transactionId: tx.id,
        status: WagerTransactionStatus.Rejected,
        failureCode: "REFERENCE_AMOUNT_MISMATCH",
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
      };
    }

    // Refund credits back the bet amount
    const entry = wallet.credit(tx.money, tx.id);
    await this.walletRepo.save(txEm, wallet);
    await this.ledgerRepo.append(txEm, entry);

    tx.markProcessed(ref.id);
    await this.wagerRepo.save(txEm, tx);

    const processedEvent = WagerTransactionProcessed.create(
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
      correlationId
    );
    const balanceEvent = WalletBalanceChanged.create(
      {
        walletId: wallet.id,
        transactionId: tx.id,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      },
      correlationId
    );

    await this.outboxRepo.append(txEm, OutboxMessage.enqueue(processedEvent));
    await this.outboxRepo.append(txEm, OutboxMessage.enqueue(balanceEvent));

    return {
      transactionId: tx.id,
      status: WagerTransactionStatus.Processed,
      balance: wallet.balance.toJSON(),
      idempotentReplay: false,
    };
  }

  private async handleRollback(
    txEm: EntityManager,
    wallet: any,
    tx: WagerTransaction,
    correlationId: string
  ): Promise<ProcessWagerTransactionResult> {
    const refExternalId = tx.referenceExternalTransactionId!;
    const ref = await this.wagerRepo.findByExternalId(txEm, tx.providerId, refExternalId);

    if (!ref) {
      tx.markPendingReference();
      await this.wagerRepo.save(txEm, tx);

      const pendingEvent = WagerTransactionPendingReference.create(
        {
          transactionId: tx.id,
          providerId: tx.providerId,
          externalTransactionId: tx.externalTransactionId,
          referenceExternalTransactionId: refExternalId,
          walletId: tx.walletId,
          playerId: tx.playerId,
          roundId: tx.roundId,
        },
        correlationId
      );
      await this.outboxRepo.append(txEm, OutboxMessage.enqueue(pendingEvent));

      return {
        transactionId: tx.id,
        status: WagerTransactionStatus.PendingReference,
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
      };
    }

    // Invert the reference operation
    let entry: any;
    if (ref.kind === WagerTransactionKind.Bet) {
      // Reverting a debit -> Credit wallet
      entry = wallet.credit(tx.money, tx.id);
    } else if (ref.kind === WagerTransactionKind.Win) {
      // Reverting a credit -> Debit wallet
      // Rule 9: Reversão que produziria saldo negativo é rejeitada explicitamente com failureCode distinto
      if (wallet.balance.isLessThan(tx.money)) {
        tx.reject("INSUFFICIENT_FUNDS_FOR_ROLLBACK");
        await this.wagerRepo.save(txEm, tx);
        return {
          transactionId: tx.id,
          status: WagerTransactionStatus.Rejected,
          failureCode: "INSUFFICIENT_FUNDS_FOR_ROLLBACK",
          balance: wallet.balance.toJSON(),
          idempotentReplay: false,
        };
      }
      entry = wallet.debit(tx.money, tx.id);
    } else {
      entry = wallet.debit(tx.money, tx.id);
    }

    await this.walletRepo.save(txEm, wallet);
    await this.ledgerRepo.append(txEm, entry);

    tx.markProcessed(ref.id);
    await this.wagerRepo.save(txEm, tx);

    const processedEvent = WagerTransactionProcessed.create(
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
      correlationId
    );
    const balanceEvent = WalletBalanceChanged.create(
      {
        walletId: wallet.id,
        transactionId: tx.id,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      },
      correlationId
    );

    await this.outboxRepo.append(txEm, OutboxMessage.enqueue(processedEvent));
    await this.outboxRepo.append(txEm, OutboxMessage.enqueue(balanceEvent));

    return {
      transactionId: tx.id,
      status: WagerTransactionStatus.Processed,
      balance: wallet.balance.toJSON(),
      idempotentReplay: false,
    };
  }
}
