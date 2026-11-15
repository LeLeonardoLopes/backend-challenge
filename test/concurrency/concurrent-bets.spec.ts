import { describe, expect, it } from "bun:test";
import {
  ProcessWagerTransactionUseCase,
  ProcessWagerTransactionDto,
} from "../../src/application/use-cases/process-wager-transaction.use-case";
import { WagerTransactionKind, WagerTransactionStatus } from "../../src/domain/entities/wager-transaction";
import { Wallet } from "../../src/domain/entities/wallet";
import { Money } from "../../src/domain/value-objects/money";

class SimpleMutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const run = () => {
        this.locked = true;
        resolve(() => {
          this.locked = false;
          const next = this.queue.shift();
          if (next) next();
        });
      };

      if (!this.locked) {
        run();
      } else {
        this.queue.push(run);
      }
    });
  }
}

describe("Concurrency & Invariants Test Suite (50 Parallel Requests)", () => {
  function createConcurrentHarness(initialAmount = "500.00") {
    const { wallet, openingEntry } = Wallet.open({
      id: "wallet-concurrent-1",
      playerId: "player-concurrent-1",
      initialBalance: Money.from({ amount: initialAmount, currency: "BRL" }),
    });

    const wallets = new Map<string, any>([[wallet.id, wallet]]);
    const ledgers: any[] = openingEntry ? [openingEntry] : [];
    const transactions = new Map<string, any>();
    const outbox: any[] = [];
    const mutex = new SimpleMutex();

    const fakeWalletRepo: any = {
      findById: async (_em: any, id: string) => wallets.get(id) ?? null,
      findByIdForUpdate: async (_em: any, id: string) => wallets.get(id) ?? null,
      save: async (_em: any, w: any) => wallets.set(w.id, w),
    };

    const fakeLedgerRepo: any = {
      append: async (_em: any, entry: any) => ledgers.push(entry),
      calculateBalanceFromLedger: async (_em: any, _wId: string, currency: string) => {
        let sum = Money.zero(currency);
        for (const item of ledgers) {
          if (item.direction === "CREDIT") sum = sum.add(item.money);
          else sum = sum.subtract(item.money);
        }
        return { calculatedBalance: sum, checkedEntries: ledgers.length };
      },
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

    // Simulating PostgreSQL row lock via serialized transaction acquisition
    const fakeEm: any = {
      transactional: async (fn: any) => {
        const release = await mutex.acquire();
        try {
          return await fn(fakeEm);
        } finally {
          release();
        }
      },
    };

    const useCase = new ProcessWagerTransactionUseCase(
      fakeWalletRepo,
      fakeLedgerRepo,
      fakeWagerRepo,
      fakeOutboxRepo
    );

    return { useCase, fakeEm, wallets, ledgers, transactions, fakeLedgerRepo };
  }

  it("Test 1: 50 identical bets sent simultaneously in parallel -> exactly 1 debit!", async () => {
    const { useCase, fakeEm, wallets, ledgers } = createConcurrentHarness("500.00");

    const betPayload: ProcessWagerTransactionDto = {
      providerId: "pragmatic",
      externalTransactionId: "parallel-bet-same-1",
      playerId: "player-concurrent-1",
      walletId: "wallet-concurrent-1",
      roundId: "round-1",
      gameId: "gates-of-olympus",
      kind: WagerTransactionKind.Bet,
      money: { amount: "50.00", currency: "BRL" },
    };

    const idempotencyKey = "pragmatic:parallel-bet-same-1";

    // Dispatch 50 promises simultaneously
    const promises = Array.from({ length: 50 }, () =>
      useCase.execute(fakeEm, betPayload, idempotencyKey)
    );

    const results = await Promise.all(promises);

    // Verify exactly 1 executed, and 49 were idempotent replays
    const processed = results.filter((r) => !r.idempotentReplay && r.status === WagerTransactionStatus.Processed);
    const replays = results.filter((r) => r.idempotentReplay && r.status === WagerTransactionStatus.Processed);

    expect(processed.length).toBe(1);
    expect(replays.length).toBe(49);

    // Wallet balance must be exactly 450.00 (500 - 50)
    const wallet = wallets.get("wallet-concurrent-1");
    expect(wallet.balance.toString()).toBe("450.00");

    // Ledger has opening entry (500) + exactly 1 debit (50) = 2 entries total
    expect(ledgers.length).toBe(2);
  });

  it("Test 2: Multiple concurrent bets draining wallet balance without going negative", async () => {
    // Initial balance: 100.00. Ten distinct parallel bets of 20.00 each = 200.00 total requested
    const { useCase, fakeEm, wallets, ledgers } = createConcurrentHarness("100.00");

    const promises = Array.from({ length: 10 }, (_, i) => {
      const dto: ProcessWagerTransactionDto = {
        providerId: "pragmatic",
        externalTransactionId: `drain-bet-${i}`,
        playerId: "player-concurrent-1",
        walletId: "wallet-concurrent-1",
        roundId: `round-${i}`,
        gameId: "sparrow-gold",
        kind: WagerTransactionKind.Bet,
        money: { amount: "20.00", currency: "BRL" },
      };
      return useCase.execute(fakeEm, dto, `key-drain-${i}`);
    });

    const results = await Promise.all(promises);

    const successful = results.filter((r) => r.status === WagerTransactionStatus.Processed);
    const rejected = results.filter((r) => r.status === WagerTransactionStatus.Rejected);

    // Exactly 5 bets of 20.00 can be satisfied (100.00 / 20.00 = 5)
    expect(successful.length).toBe(5);
    // The other 5 must be rejected
    expect(rejected.length).toBe(5);

    // Final balance must be exactly 0.00 (never negative!)
    const wallet = wallets.get("wallet-concurrent-1");
    expect(wallet.balance.toString()).toBe("0.00");
    expect(wallet.balance.isNegative()).toBe(false);

    // Final Invariant: wallet.balance == sum(ledger entries)
    let ledgerSum = Money.from({ amount: "100.00", currency: "BRL" }); // opening
    for (let i = 1; i < ledgers.length; i++) {
      ledgerSum = ledgerSum.subtract(ledgers[i].money);
    }
    expect(ledgerSum.equals(wallet.balance)).toBe(true);
  });

  it("Test 3: Final Invariant Audit — wallet.balance == sum(ledger) across credits & debits", async () => {
    const { useCase, fakeEm, wallets, fakeLedgerRepo } = createConcurrentHarness("200.00");

    // Sequence of mixed operations
    // 1. Bet 50.00 (balance -> 150.00)
    await useCase.execute(
      fakeEm,
      {
        providerId: "pragmatic",
        externalTransactionId: "mix-1",
        playerId: "player-concurrent-1",
        walletId: "wallet-concurrent-1",
        roundId: "r1",
        gameId: "g1",
        kind: WagerTransactionKind.Bet,
        money: { amount: "50.00", currency: "BRL" },
      },
      "k-mix-1"
    );

    // 2. Win 120.00 (balance -> 270.00)
    await useCase.execute(
      fakeEm,
      {
        providerId: "pragmatic",
        externalTransactionId: "mix-2",
        playerId: "player-concurrent-1",
        walletId: "wallet-concurrent-1",
        roundId: "r1",
        gameId: "g1",
        kind: WagerTransactionKind.Win,
        money: { amount: "120.00", currency: "BRL" },
      },
      "k-mix-2"
    );

    // 3. Loss (no balance change)
    await useCase.execute(
      fakeEm,
      {
        providerId: "pragmatic",
        externalTransactionId: "mix-3",
        playerId: "player-concurrent-1",
        walletId: "wallet-concurrent-1",
        roundId: "r2",
        gameId: "g1",
        kind: WagerTransactionKind.Loss,
        money: { amount: "0.00", currency: "BRL" },
      },
      "k-mix-3"
    );

    const wallet = wallets.get("wallet-concurrent-1");
    expect(wallet.balance.toString()).toBe("270.00");

    // Perform audit reconciliation
    const audit = await fakeLedgerRepo.calculateBalanceFromLedger(
      fakeEm,
      "wallet-concurrent-1",
      "BRL"
    );

    expect(audit.calculatedBalance.toString()).toBe("270.00");
    expect(audit.calculatedBalance.equals(wallet.balance)).toBe(true);
  });
});
