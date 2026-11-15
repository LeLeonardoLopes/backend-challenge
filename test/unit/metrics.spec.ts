import { describe, it, expect } from "bun:test";
import { MetricsService } from "../../src/infrastructure/observability/metrics.service";

describe("MetricsService & Observability", () => {
  it("should record transactions, duplicates, lock conflicts, and latencies", () => {
    const metrics = new MetricsService();

    metrics.recordTransaction({ status: "PROCESSED", kind: "BET", provider: "jungle-game" }, 15);
    metrics.recordTransaction({ status: "PROCESSED", kind: "BET", provider: "jungle-game" }, 25);
    metrics.recordTransaction({ status: "REJECTED", kind: "BET", provider: "jungle-game" }, 5);
    metrics.recordDuplicate();
    metrics.recordLockConflict();
    metrics.recordSqsRetry();
    metrics.recordDlqMessage();
    metrics.setOutboxGauge(3, 2);

    const snapshot = metrics.getSnapshot();
    expect(snapshot.idempotencyDuplicates).toBe(1);
    expect(snapshot.lockConflicts).toBe(1);
    expect(snapshot.sqsRetries).toBe(1);
    expect(snapshot.dlqMessages).toBe(1);
    expect(snapshot.outbox.pending).toBe(3);
    expect(snapshot.outbox.lagSeconds).toBe(2);
    expect(snapshot.latencyMs.count).toBe(3);
    expect(snapshot.latencyMs.p50).toBeGreaterThan(0);

    const prometheus = metrics.toPrometheus();
    expect(prometheus).toContain("wager_transactions_total");
    expect(prometheus).toContain("wager_idempotency_duplicates_total 1");
    expect(prometheus).toContain("wager_lock_conflicts_total 1");
    expect(prometheus).toContain("wager_sqs_retries_total 1");
    expect(prometheus).toContain("wager_dlq_messages_total 1");
    expect(prometheus).toContain("wager_outbox_pending_messages 3");
    expect(prometheus).toContain("wager_processing_duration_ms");
  });
});
