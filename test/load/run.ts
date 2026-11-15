import { randomUUID } from "node:crypto";

/**
 * Load & Concurrency Benchmark Runner for Jungle Gaming Challenge
 * Measures: Throughput (RPS), p50/p95/p99 latencies, error rates, and final reconciliation invariant.
 */
async function runLoadBenchmark() {
  console.log("==================================================================");
  console.log("🦧 Jungle Gaming Distributed Wagering Processor — Load Benchmark");
  console.log("==================================================================");

  const baseUrl = process.env.BASE_URL || "http://localhost:3000";
  const numRequests = Number(process.env.NUM_REQUESTS) || 200;
  const concurrency = Number(process.env.CONCURRENCY) || 20;

  console.log(`Target: ${baseUrl}`);
  console.log(`Requests: ${numRequests} | Concurrency: ${concurrency}`);

  // Test setup: Create a wallet with initial balance
  const playerId = randomUUID();
  let walletId: string;

  try {
    const createRes = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "10000.00", currency: "BRL" },
      }),
    });

    if (!createRes.ok) {
      console.error(`Failed to create test wallet: HTTP ${createRes.status}`);
      process.exit(1);
    }

    const walletData = await createRes.json();
    walletId = walletData.id;
    console.log(`✓ Test wallet created: ${walletId} (Initial Balance: 10,000.00 BRL)`);
  } catch (err: any) {
    console.error(`Could not connect to ${baseUrl}. Is the application running?`, err.message);
    process.exit(1);
  }

  // Run benchmark requests concurrently
  const latencies: number[] = [];
  let successfulBets = 0;
  let rejectedBets = 0;
  let errors = 0;

  const startTime = Date.now();

  const worker = async (workerId: number) => {
    const perWorker = Math.floor(numRequests / concurrency);
    for (let i = 0; i < perWorker; i++) {
      const txId = `tx-w${workerId}-${i}-${Date.now()}`;
      const idempotencyKey = `bench-provider:${txId}`;

      const t0 = performance.now();
      try {
        const res = await fetch(`${baseUrl}/wagering/transactions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            providerId: "bench-provider",
            externalTransactionId: txId,
            playerId,
            walletId,
            roundId: `round-${workerId}-${i}`,
            gameId: "fortune-tiger",
            kind: "BET",
            money: { amount: "10.00", currency: "BRL" },
          }),
        });

        const t1 = performance.now();
        latencies.push(t1 - t0);

        if (res.ok) {
          const data = await res.json();
          if (data.status === "PROCESSED") {
            successfulBets++;
          } else {
            rejectedBets++;
          }
        } else {
          errors++;
        }
      } catch {
        errors++;
      }
    }
  };

  const pool = Array.from({ length: concurrency }, (_, idx) => worker(idx));
  await Promise.all(pool);

  const totalTimeSeconds = (Date.now() - startTime) / 1000;
  latencies.sort((a, b) => a - b);

  const p50 = latencies[Math.floor(latencies.length * 0.5)].toFixed(2);
  const p95 = latencies[Math.floor(latencies.length * 0.95)].toFixed(2);
  const p99 = latencies[Math.floor(latencies.length * 0.99)].toFixed(2);
  const throughput = (numRequests / totalTimeSeconds).toFixed(2);

  console.log("\n--- BENCHMARK RESULTS ---");
  console.log(`Total Time:     ${totalTimeSeconds.toFixed(2)}s`);
  console.log(`Throughput:     ${throughput} req/sec`);
  console.log(`Successful:     ${successfulBets}`);
  console.log(`Rejected:       ${rejectedBets}`);
  console.log(`Network Errors: ${errors}`);
  console.log(`Latency p50:    ${p50} ms`);
  console.log(`Latency p95:    ${p95} ms`);
  console.log(`Latency p99:    ${p99} ms`);

  // Final Reconciliation Audit
  const recRes = await fetch(`${baseUrl}/wallets/${walletId}/reconciliation`, {
    method: "POST",
  });
  const recData = await recRes.json();

  console.log("\n--- FINAL AUDIT & RECONCILIATION INVARIANT ---");
  console.log(`Stored Balance:     ${recData.storedBalance.amount} BRL`);
  console.log(`Calculated Balance: ${recData.calculatedBalance.amount} BRL`);
  console.log(`Difference:         ${recData.difference.amount} BRL`);
  console.log(`Audit Passed:       ${recData.consistent ? "✓ CONSISTENT (100% Exact)" : "✗ CORRUPTED"}`);
  console.log(`Ledger Entries:     ${recData.checkedEntries}`);
  console.log("==================================================================");
}

runLoadBenchmark().catch(console.error);
