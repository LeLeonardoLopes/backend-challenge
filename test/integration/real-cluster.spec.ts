import { describe, expect, it } from "bun:test";
import { Client } from "pg";
import { SQSClient, SendMessageCommand, GetQueueUrlCommand } from "@aws-sdk/client-sqs";
import { randomUUID } from "node:crypto";

describe("Real Cluster Integration & Concurrency Suite (PostgreSQL + LocalStack + 3 Instances)", () => {
  const instances = [
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
  ];

  const pgClient = new Client({
    connectionString: "postgres://postgres:postgrespassword@localhost:5432/wagering_db",
  });

  const sqsClient = new SQSClient({
    region: "us-east-1",
    endpoint: "http://localhost:4566",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });

  it("Integration 1: Verify PostgreSQL native constraint (balance >= 0) directly in DB", async () => {
    await pgClient.connect();
    const badWalletId = randomUUID();
    const badPlayerId = randomUUID();

    // Attempting direct SQL insert with negative balance MUST fail at database level
    let dbRejected = false;
    try {
      await pgClient.query(
        `INSERT INTO wallets (id, player_id, currency, balance, version) VALUES ($1, $2, 'BRL', -50.00, 1)`,
        [badWalletId, badPlayerId]
      );
    } catch (err: any) {
      dbRejected = err.message.includes("check_wallet_balance_not_negative");
    }

    expect(dbRejected).toBe(true);
    await pgClient.end();
  });

  it("Integration 2: Multi-Instance Race Condition across app-1 and app-2 (R$ 80 vs R$ 80 against R$ 100)", async () => {
    const playerId = randomUUID();

    // 1. Create wallet via instance 1
    const createRes = await fetch(`${instances[0]}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "100.00", currency: "BRL" },
      }),
    });
    const wallet = await createRes.json();
    const walletId = wallet.id;

    // 2. Fire two bets simultaneously to DIFFERENT instances: app-1 (3001) and app-2 (3002)
    const req1 = fetch(`${instances[0]}/wagering/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `pragmatic:bet-inst-1-${Date.now()}` },
      body: JSON.stringify({
        providerId: "pragmatic",
        externalTransactionId: `tx-inst-1-${Date.now()}`,
        playerId,
        walletId,
        roundId: "r-race-1",
        gameId: "roulette",
        kind: "BET",
        money: { amount: "80.00", currency: "BRL" },
      }),
    }).then((r) => r.json());

    const req2 = fetch(`${instances[1]}/wagering/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `pragmatic:bet-inst-2-${Date.now()}` },
      body: JSON.stringify({
        providerId: "pragmatic",
        externalTransactionId: `tx-inst-2-${Date.now()}`,
        playerId,
        walletId,
        roundId: "r-race-2",
        gameId: "roulette",
        kind: "BET",
        money: { amount: "80.00", currency: "BRL" },
      }),
    }).then((r) => r.json());

    const [res1, res2] = await Promise.all([req1, req2]);

    // One must be PROCESSED and one must be REJECTED
    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual(["PROCESSED", "REJECTED"]);

    // Check balance on instance 3
    const checkRes = await fetch(`${instances[2]}/wallets/${walletId}`);
    const checkData = await checkRes.json();
    expect(checkData.balance.amount).toBe("20.00");

    // Reconciliation check on instance 1
    const recRes = await fetch(`${instances[0]}/wallets/${walletId}/reconciliation`, { method: "POST" });
    const recData = await recRes.json();
    expect(recData.consistent).toBe(true);
    expect(recData.storedBalance.amount).toBe("20.00");
    expect(recData.calculatedBalance.amount).toBe("20.00");
  });

  it("Integration 3: 50 concurrent requests distributed across 3 instances with identical idempotency key", async () => {
    const playerId = randomUUID();

    const createRes = await fetch(`${instances[0]}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "500.00", currency: "BRL" },
      }),
    });
    const wallet = await createRes.json();
    const walletId = wallet.id;

    const sharedKey = `shared-provider:tx-50-barrage-${Date.now()}`;
    const txId = `tx-50-${Date.now()}`;

    // Dispatch 50 requests round-robin across instances 3001, 3002, 3003
    const promises = Array.from({ length: 50 }, (_, idx) => {
      const targetInstance = instances[idx % instances.length];
      return fetch(`${targetInstance}/wagering/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": sharedKey },
        body: JSON.stringify({
          providerId: "shared-provider",
          externalTransactionId: txId,
          playerId,
          walletId,
          roundId: "round-50",
          gameId: "sweet-bonanza",
          kind: "BET",
          money: { amount: "50.00", currency: "BRL" },
        }),
      }).then((r) => r.json());
    });

    const results = await Promise.all(promises);

    const processed = results.filter((r) => !r.idempotentReplay && r.status === "PROCESSED");
    const replays = results.filter((r) => r.idempotentReplay && r.status === "PROCESSED");

    expect(processed.length).toBe(1);
    expect(replays.length).toBe(49);

    // Final balance check: 500.00 - 50.00 = 450.00
    const finalRes = await fetch(`${instances[0]}/wallets/${walletId}`);
    const finalData = await finalRes.json();
    expect(finalData.balance.amount).toBe("450.00");
  });

  it("Integration 4: SQS FIFO Queue consumption & Inbox Deduplication", async () => {
    const playerId = randomUUID();
    const createRes = await fetch(`${instances[0]}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "200.00", currency: "BRL" },
      }),
    });
    const wallet = await createRes.json();

    const sqsTxId = `sqs-tx-${Date.now()}`;
    const msgBody = {
      messageId: `msg-${sqsTxId}`,
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        providerId: "sqs-provider",
        externalTransactionId: sqsTxId,
        idempotencyKey: `sqs-provider:${sqsTxId}`,
        playerId,
        walletId: wallet.id,
        roundId: "sqs-round-1",
        gameId: "fortune-ox",
        kind: "BET",
        money: { amount: "40.00", currency: "BRL" },
      },
    };

    const queueRes = await sqsClient.send(
      new GetQueueUrlCommand({ QueueName: "wager-transactions.fifo" })
    );

    // Send directly into SQS FIFO queue in LocalStack
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueRes.QueueUrl!,
        MessageBody: JSON.stringify(msgBody),
        MessageGroupId: wallet.id,
        MessageDeduplicationId: `msg-${sqsTxId}`,
      })
    );

    // Give consumer 2 seconds to process
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // Verify balance was debited via SQS consumer: 200.00 - 40.00 = 160.00
    const updatedRes = await fetch(`${instances[0]}/wallets/${wallet.id}`);
    const updatedData = await updatedRes.json();
    expect(updatedData.balance.amount).toBe("160.00");
  });
});
