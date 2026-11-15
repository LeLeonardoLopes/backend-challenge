import { describe, expect, it } from "bun:test";
import {
  ProcessWagerTransactionUseCase,
  ProcessWagerTransactionDto,
} from "../../src/application/use-cases/process-wager-transaction.use-case";
import { WagerTransactionKind, WagerTransactionStatus } from "../../src/domain/entities/wager-transaction";
import { Wallet } from "../../src/domain/entities/wallet";
import { Money } from "../../src/domain/value-objects/money";
import { IdempotencyConflictError } from "../../src/domain/errors/domain-errors";

describe("ProcessWagerTransactionUseCase (Isolated Simulation)", () => {
  // In-memory fake database simulating transaction isolation & locks
  function createTestHarness(initialBalance = "100.00") {
    const { wallet } = Wallet.open({
      id: "wallet-test-1",
      playerId: "player-test-1",
      initialBalance: Money.from({ amount: initialBalance, currency: "BRL" }),
    });

    const wallets = new Map<string, any>([[wallet.id, wallet]]);
    const ledgers: any[] = [];
    const transactions = new Map<string, any>();
    const outbox: any[] = [];

    const fakeWalletRepo: any = {
      findById: async (_em: any, id: string) => wallets.get(id) ?? null,
      findByIdForUpdate: async (_em: any, id: string) => wallets.get(id) ?? null,
      save: async (_em: any, w: any) => wallets.set(w.id, w),
    };

    const fakeLedgerRepo: any = {
      append: async (_em: any, entry: any) => ledgers.push(entry),
    };

    const fakeWagerRepo: any = {
      findByIdempotencyKey: async (_em: any, key: string) => transactions.get(key) ?? null,
      findByExternalId: async (_em: any, _pId: string, extId: string) => {
        for (const tx of transactions.values()) {
          if (tx.externalTransactionId === extId) return tx;
        }
        return null;
      },
      save: async (_em: any, tx: any) => transactions.set(tx.idempotencyKey, tx),
    };

    const fakeOutboxRepo: any = {
      append: async (_em: any, msg: any) => outbox.push(msg),
    };

    const fakeEm: any = {
      transactional: async (fn: any) => fn(fakeEm),
    };

    const useCase = new ProcessWagerTransactionUseCase(
      fakeWalletRepo,
      fakeLedgerRepo,
      fakeWagerRepo,
      fakeOutboxRepo
    );

    return { useCase, fakeEm, wallets, ledgers, transactions, outbox };
  }

  it("should process a valid BET, debit wallet and record ledger entry", async () => {
    const { useCase, fakeEm, wallets, ledgers } = createTestHarness("100.00");

    const dto: ProcessWagerTransactionDto = {
      providerId: "pragmatic",
      externalTransactionId: "bet-101",
      playerId: "player-test-1",
      walletId: "wallet-test-1",
      roundId: "round-1",
      gameId: "sweet-bonanza",
      kind: WagerTransactionKind.Bet,
      money: { amount: "25.00", currency: "BRL" },
    };

    const result = await useCase.execute(fakeEm, dto, "pragmatic:bet-101");

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance.amount).toBe("75.00");
    expect(result.idempotentReplay).toBe(false);

    const wallet = wallets.get("wallet-test-1");
    expect(wallet.balance.toString()).toBe("75.00");
    expect(wallet.version).toBe(2);
    expect(ledgers.length).toBe(1);
    expect(ledgers[0].money.toString()).toBe("25.00");
  });

  it("should enforce section 8 scenario: two consecutive R$ 80 bets against R$ 100", async () => {
    const { useCase, fakeEm, wallets, ledgers } = createTestHarness("100.00");

    const bet1Dto: ProcessWagerTransactionDto = {
      providerId: "pragmatic",
      externalTransactionId: "bet-1",
      playerId: "player-test-1",
      walletId: "wallet-test-1",
      roundId: "round-1",
      gameId: "sweet-bonanza",
      kind: WagerTransactionKind.Bet,
      money: { amount: "80.00", currency: "BRL" },
    };

    const bet2Dto: ProcessWagerTransactionDto = {
      providerId: "pragmatic",
      externalTransactionId: "bet-2",
      playerId: "player-test-1",
      walletId: "wallet-test-1",
      roundId: "round-2",
      gameId: "sweet-bonanza",
      kind: WagerTransactionKind.Bet,
      money: { amount: "80.00", currency: "BRL" },
    };

    // First bet succeeds
    const res1 = await useCase.execute(fakeEm, bet1Dto, "pragmatic:bet-1");
    expect(res1.status).toBe(WagerTransactionStatus.Processed);
    expect(res1.balance.amount).toBe("20.00");

    // Second bet is rejected for insufficient funds
    const res2 = await useCase.execute(fakeEm, bet2Dto, "pragmatic:bet-2");
    expect(res2.status).toBe(WagerTransactionStatus.Rejected);
    expect(res2.failureCode).toBe("INSUFFICIENT_FUNDS");
    expect(res2.balance.amount).toBe("20.00");

    // Final checks
    const wallet = wallets.get("wallet-test-1");
    expect(wallet.balance.toString()).toBe("20.00");
    expect(ledgers.length).toBe(1); // exactly one debit in ledger
  });

  it("should return idempotent replay when receiving exact same bet", async () => {
    const { useCase, fakeEm, ledgers } = createTestHarness("100.00");

    const dto: ProcessWagerTransactionDto = {
      providerId: "pragmatic",
      externalTransactionId: "bet-replay",
      playerId: "player-test-1",
      walletId: "wallet-test-1",
      roundId: "round-1",
      gameId: "sweet-bonanza",
      kind: WagerTransactionKind.Bet,
      money: { amount: "30.00", currency: "BRL" },
    };

    const res1 = await useCase.execute(fakeEm, dto, "key-replay-1");
    expect(res1.idempotentReplay).toBe(false);
    expect(res1.status).toBe(WagerTransactionStatus.Processed);

    // Second request with exact same payload
    const res2 = await useCase.execute(fakeEm, dto, "key-replay-1");
    expect(res2.idempotentReplay).toBe(true);
    expect(res2.status).toBe(WagerTransactionStatus.Processed);
    expect(res2.transactionId).toBe(res1.transactionId);

    // Ledger should still only have 1 entry
    expect(ledgers.length).toBe(1);
  });

  it("should throw IdempotencyConflictError when key matches but payload differs", async () => {
    const { useCase, fakeEm } = createTestHarness("100.00");

    const dtoA: ProcessWagerTransactionDto = {
      providerId: "pragmatic",
      externalTransactionId: "bet-diff",
      playerId: "player-test-1",
      walletId: "wallet-test-1",
      roundId: "round-1",
      gameId: "sweet-bonanza",
      kind: WagerTransactionKind.Bet,
      money: { amount: "10.00", currency: "BRL" },
    };

    await useCase.execute(fakeEm, dtoA, "key-conflict");

    const dtoB: ProcessWagerTransactionDto = {
      ...dtoA,
      money: { amount: "100.00", currency: "BRL" }, // altered payload!
    };

    expect(useCase.execute(fakeEm, dtoB, "key-conflict")).rejects.toThrow(IdempotencyConflictError);
  });

  it("should mark REFUND as PENDING_REFERENCE when bet has not yet arrived", async () => {
    const { useCase, fakeEm, wallets } = createTestHarness("100.00");

    const refundDto: ProcessWagerTransactionDto = {
      providerId: "pragmatic",
      externalTransactionId: "refund-early",
      playerId: "player-test-1",
      walletId: "wallet-test-1",
      roundId: "round-1",
      gameId: "sweet-bonanza",
      kind: WagerTransactionKind.Refund,
      money: { amount: "50.00", currency: "BRL" },
      referenceExternalTransactionId: "bet-that-arrives-late",
    };

    const res = await useCase.execute(fakeEm, refundDto, "key-refund-early");
    expect(res.status).toBe(WagerTransactionStatus.PendingReference);

    // Balance remains unchanged until bet arrives
    const wallet = wallets.get("wallet-test-1");
    expect(wallet.balance.toString()).toBe("100.00");
  });
});
