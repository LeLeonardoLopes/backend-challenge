import { describe, expect, it } from "bun:test";
import {
  ProcessWagerTransactionUseCase,
  ProcessWagerTransactionDto,
} from "../../src/application/use-cases/process-wager-transaction.use-case";
import { WagerTransactionKind, WagerTransactionStatus } from "../../src/domain/entities/wager-transaction";
import { Wallet } from "../../src/domain/entities/wallet";
import { Money } from "../../src/domain/value-objects/money";
import { InboxMessage } from "../../src/domain/entities/inbox-message";
import { OutboxMessage } from "../../src/domain/entities/outbox-message";
import { WalletBalanceChanged } from "../../src/domain/events/integration-event";
import { LedgerDirection } from "../../src/domain/entities/wallet-ledger-entry";

describe("Advanced Concurrency & Resilience Suite (Section 13 Scenarios)", () => {
  // --------------------------------------------------------------------------
  // Scenario 5: Worker morto DEPOIS do commit e ANTES do ACK
  // --------------------------------------------------------------------------
  it("Scenario 5: Worker dies after DB commit but before SQS ACK -> SQS redelivers -> Inbox dedups -> Zero duplicate debit", async () => {
    const { wallet, openingEntry } = Wallet.open({
      id: "wallet-worker-crash",
      playerId: "player-crash-test",
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    const wallets = new Map<string, any>([[wallet.id, wallet]]);
    const ledgers: any[] = [openingEntry];
    const transactions = new Map<string, any>();
    const outbox: any[] = [];
    const inboxes = new Map<string, InboxMessage>();

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
      save: async (_em: any, tx: any) => transactions.set(tx.idempotencyKey, tx),
    };
    const fakeOutboxRepo: any = {
      append: async (_em: any, msg: any) => outbox.push(msg),
    };
    const fakeEm: any = {
      transactional: async (fn: any) => fn(fakeEm),
      fork: () => fakeEm,
    };

    const useCase = new ProcessWagerTransactionUseCase(
      fakeWalletRepo,
      fakeLedgerRepo,
      fakeWagerRepo,
      fakeOutboxRepo
    );

    // Simulated SQS Worker Logic
    const messageId = "sqs-msg-uuid-9999";
    const consumerName = "wagering-processor-sqs";
    let sqsAcknowledged = false;

    async function handleSqsMessage(shouldCrashBeforeAck = false) {
      // 1. Transactional DB processing
      await fakeEm.transactional(async (txEm: any) => {
        // Inbox Deduplication Check
        const existingInbox = inboxes.get(`${consumerName}:${messageId}`);
        if (existingInbox && existingInbox.isProcessed()) {
          // Message already committed previously! Skip execution.
          return;
        }

        // Process Wager
        const dto: ProcessWagerTransactionDto = {
          providerId: "provider-crash-test",
          externalTransactionId: "ext-crash-1",
          playerId: "player-crash-test",
          walletId: "wallet-worker-crash",
          roundId: "round-1",
          gameId: "game-1",
          kind: WagerTransactionKind.Bet,
          money: { amount: "25.00", currency: "BRL" },
        };
        await useCase.execute(txEm, dto, "crash-idempotency-key", messageId);

        // Record Inbox
        const inbox = InboxMessage.receive({
          messageId,
          consumerName,
          payloadHash: "hash-crash-test",
        });
        inbox.markProcessed();
        inboxes.set(`${consumerName}:${messageId}`, inbox);
      });

      // 2. SQS ACK step
      if (shouldCrashBeforeAck) {
        // SIMULATE CRASH: Process died / killed before calling SQS DeleteMessage!
        throw new Error("FATAL: Container terminated by OOM / SIGKILL before SQS ACK!");
      }

      sqsAcknowledged = true;
    }

    // First attempt: Commits in DB but CRASHES right before SQS ACK
    let crashed = false;
    try {
      await handleSqsMessage(true);
    } catch (err: any) {
      crashed = true;
    }
    expect(crashed).toBe(true);
    expect(sqsAcknowledged).toBe(false);

    // Balance after first commit: 100 - 25 = 75
    expect(wallets.get("wallet-worker-crash").balance.toString()).toBe("75.00");
    // Exactly 2 ledger entries: Opening (100.00) + 1 Bet (-25.00)
    expect(ledgers.length).toBe(2);

    // Second attempt: SQS visibility timeout expires -> SQS redelivers the EXACT same message
    await handleSqsMessage(false);
    expect(sqsAcknowledged).toBe(true);

    // VERIFICATION: Inbox skipped execution -> ZERO DUPLICATE DEBIT!
    const finalWallet = wallets.get("wallet-worker-crash");
    expect(finalWallet.balance.toString()).toBe("75.00"); // NOT 50.00!
    expect(ledgers.length).toBe(2); // Still exactly 2 entries

    // Invariant holds
    const totalReconstructed = ledgers.reduce((acc, entry) => {
      const amt = Number(entry.money.toString());
      return entry.direction === LedgerDirection.Credit ? acc + amt : acc - amt;
    }, 0);
    expect(totalReconstructed.toFixed(2)).toBe(finalWallet.balance.toString());
  });

  // --------------------------------------------------------------------------
  // Scenario 6: Dois publishers sobre a mesma outbox
  // --------------------------------------------------------------------------
  it("Scenario 6: Two publishers concurrently polling the same outbox -> SKIP LOCKED guarantees disjoint batches and zero duplicate publishing", async () => {
    // Setup 10 pending outbox events
    const outboxMessages: OutboxMessage[] = [];
    for (let i = 1; i <= 10; i++) {
      const event = WalletBalanceChanged.create(
        {
          walletId: "wallet-test",
          transactionId: `tx-${i}`,
          direction: LedgerDirection.Debit,
          money: { amount: "10.00", currency: "BRL" },
          balanceBefore: { amount: "100.00", currency: "BRL" },
          balanceAfter: { amount: "90.00", currency: "BRL" },
          walletVersion: i,
        },
        `corr-${i}`
      );
      outboxMessages.push(OutboxMessage.enqueue(event));
    }

    // Simulated PostgreSQL SKIP LOCKED table
    const lockedRows = new Set<string>();
    const publishedByWorkerA: string[] = [];
    const publishedByWorkerB: string[] = [];

    async function pollAndPublish(workerId: "A" | "B", batchSize = 5) {
      // Simulate FOR UPDATE SKIP LOCKED
      const available = outboxMessages.filter(
        (m) => m.isPending() && !lockedRows.has(m.id)
      ).slice(0, batchSize);

      // Lock rows
      for (const msg of available) {
        lockedRows.add(msg.id);
      }

      // Simulate network / message bus publishing delay
      await new Promise((resolve) => setTimeout(resolve, 15));

      // Mark published
      for (const msg of available) {
        msg.markPublished();
        if (workerId === "A") publishedByWorkerA.push(msg.id);
        if (workerId === "B") publishedByWorkerB.push(msg.id);
        lockedRows.delete(msg.id);
      }
    }

    // Run Worker A and Worker B concurrently
    await Promise.all([
      pollAndPublish("A", 5),
      pollAndPublish("B", 5),
    ]);

    // Check results
    expect(publishedByWorkerA.length).toBe(5);
    expect(publishedByWorkerB.length).toBe(5);

    // Verify completely disjoint sets (Zero overlap / duplicate publish!)
    const intersection = publishedByWorkerA.filter((id) => publishedByWorkerB.includes(id));
    expect(intersection.length).toBe(0);

    // All 10 published
    expect(outboxMessages.every((m) => !m.isPending())).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Scenario 8: Reinício do serviço com comprovação da consistência final
  // --------------------------------------------------------------------------
  it("Scenario 8: Service crash & restart -> Reconstruct state from ledger and verify invariant wallet.balance == sum(ledger)", async () => {
    // 1. Initial State
    const { wallet, openingEntry } = Wallet.open({
      id: "wallet-restart-test",
      playerId: "player-restart",
      initialBalance: Money.from({ amount: "200.00", currency: "BRL" }),
    });

    const persistentLedger: any[] = [openingEntry];

    // Simulate operations before crash
    for (let i = 1; i <= 5; i++) {
      // Bet R$ 20.00
      const betMoney = Money.from({ amount: "20.00", currency: "BRL" });
      const entry = wallet.debit(betMoney, `tx-bet-${i}`);
      persistentLedger.push(entry);
    }
    for (let i = 1; i <= 3; i++) {
      // Win R$ 50.00
      const winMoney = Money.from({ amount: "50.00", currency: "BRL" });
      const entry = wallet.credit(winMoney, `tx-win-${i}`);
      persistentLedger.push(entry);
    }

    // 2. CRASH: Service restarts, memory is completely lost, all state is reloaded from DB
    const persistedWalletRow = {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      currency: wallet.currency,
      version: wallet.version,
      createdAt: wallet.updatedAt,
      updatedAt: wallet.updatedAt,
    };

    // 3. Post-Restart Audit: Reconstitute wallet from database and audit ledger
    const rehydratedWallet = Wallet.rehydrate({
      id: persistedWalletRow.id,
      playerId: persistedWalletRow.playerId,
      balance: persistedWalletRow.balance,
      currency: persistedWalletRow.currency,
      version: persistedWalletRow.version,
      createdAt: persistedWalletRow.createdAt,
      updatedAt: persistedWalletRow.updatedAt,
    });

    // Reconstruct balance directly from ledger sum
    let reconstructedSum = 0;
    for (const entry of persistentLedger) {
      const amt = Number(entry.money.toString());
      if (entry.direction === LedgerDirection.Credit) {
        reconstructedSum += amt;
      } else {
        reconstructedSum -= amt;
      }
    }

    // Invariant must be identical: 200 - (5 * 20) + (3 * 50) = 200 - 100 + 150 = 250.00
    expect(reconstructedSum.toFixed(2)).toBe("250.00");
    expect(rehydratedWallet.balance.toString()).toBe("250.00");
    expect(rehydratedWallet.balance.toString()).toBe(reconstructedSum.toFixed(2));
  });
});
