import { Injectable } from "@nestjs/common";

export interface TransactionMetricLabels {
  status: string;
  kind?: string;
  provider?: string;
}

@Injectable()
export class MetricsService {
  private static instance: MetricsService;

  // Counters
  private transactionsTotal: Map<string, number> = new Map();
  private idempotencyDuplicates = 0;
  private lockConflicts = 0;
  private sqsRetries = 0;
  private dlqMessages = 0;

  // Gauges
  private outboxPending = 0;
  private outboxLagSeconds = 0;

  // Latency tracking (in-memory histogram/percentiles)
  private latenciesMs: number[] = [];
  private readonly maxLatenciesTracked = 1000;

  constructor() {
    MetricsService.instance = this;
  }

  public static get(): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService();
    }
    return MetricsService.instance;
  }

  public recordTransaction(labels: TransactionMetricLabels, durationMs?: number): void {
    const key = `status="${labels.status}",kind="${labels.kind || "UNKNOWN"}",provider="${labels.provider || "ALL"}"`;
    const current = this.transactionsTotal.get(key) || 0;
    this.transactionsTotal.set(key, current + 1);

    if (durationMs !== undefined) {
      this.latenciesMs.push(durationMs);
      if (this.latenciesMs.length > this.maxLatenciesTracked) {
        this.latenciesMs.shift();
      }
    }
  }

  public recordDuplicate(): void {
    this.idempotencyDuplicates++;
  }

  public recordLockConflict(): void {
    this.lockConflicts++;
  }

  public recordSqsRetry(): void {
    this.sqsRetries++;
  }

  public recordDlqMessage(): void {
    this.dlqMessages++;
  }

  public setOutboxGauge(pending: number, lagSeconds = 0): void {
    this.outboxPending = pending;
    this.outboxLagSeconds = lagSeconds;
  }

  public getSnapshot() {
    const sorted = [...this.latenciesMs].sort((a, b) => a - b);
    const count = sorted.length;
    const p50 = count ? sorted[Math.floor(count * 0.5)] : 0;
    const p95 = count ? sorted[Math.floor(count * 0.95)] : 0;
    const p99 = count ? sorted[Math.floor(count * 0.99)] : 0;
    const avg = count ? Number((sorted.reduce((a, b) => a + b, 0) / count).toFixed(2)) : 0;

    const transactionsByStatus: Record<string, number> = {};
    for (const [key, val] of this.transactionsTotal.entries()) {
      transactionsByStatus[key] = val;
    }

    return {
      transactions: transactionsByStatus,
      idempotencyDuplicates: this.idempotencyDuplicates,
      lockConflicts: this.lockConflicts,
      sqsRetries: this.sqsRetries,
      dlqMessages: this.dlqMessages,
      outbox: {
        pending: this.outboxPending,
        lagSeconds: this.outboxLagSeconds,
      },
      latencyMs: {
        count,
        avg,
        p50,
        p95,
        p99,
      },
    };
  }

  /**
   * Generates official Prometheus Exposition Text Format
   */
  public toPrometheus(): string {
    const snapshot = this.getSnapshot();
    const lines: string[] = [
      "# HELP wager_transactions_total Total number of wager transactions processed by status, kind, and provider",
      "# TYPE wager_transactions_total counter",
    ];

    if (this.transactionsTotal.size === 0) {
      lines.push('wager_transactions_total{status="NONE"} 0');
    } else {
      for (const [labels, val] of this.transactionsTotal.entries()) {
        lines.push(`wager_transactions_total{${labels}} ${val}`);
      }
    }

    lines.push(
      "",
      "# HELP wager_idempotency_duplicates_total Total count of duplicate requests intercepted via idempotency key",
      "# TYPE wager_idempotency_duplicates_total counter",
      `wager_idempotency_duplicates_total ${snapshot.idempotencyDuplicates}`,
      "",
      "# HELP wager_lock_conflicts_total Total database concurrency collisions / lock retries",
      "# TYPE wager_lock_conflicts_total counter",
      `wager_lock_conflicts_total ${snapshot.lockConflicts}`,
      "",
      "# HELP wager_sqs_retries_total Total message consumption retries on SQS FIFO",
      "# TYPE wager_sqs_retries_total counter",
      `wager_sqs_retries_total ${snapshot.sqsRetries}`,
      "",
      "# HELP wager_dlq_messages_total Total messages redirected to Dead Letter Queue (DLQ)",
      "# TYPE wager_dlq_messages_total counter",
      `wager_dlq_messages_total ${snapshot.dlqMessages}`,
      "",
      "# HELP wager_outbox_pending_messages Current number of uncommitted/due outbox events",
      "# TYPE wager_outbox_pending_messages gauge",
      `wager_outbox_pending_messages ${snapshot.outbox.pending}`,
      "",
      "# HELP wager_outbox_lag_seconds Current oldest uncommitted outbox event age in seconds",
      "# TYPE wager_outbox_lag_seconds gauge",
      `wager_outbox_lag_seconds ${snapshot.outbox.lagSeconds}`,
      "",
      "# HELP wager_processing_duration_ms Processing latency summary (p50, p95, p99, avg)",
      "# TYPE wager_processing_duration_ms summary",
      `wager_processing_duration_ms{quantile="0.5"} ${snapshot.latencyMs.p50}`,
      `wager_processing_duration_ms{quantile="0.95"} ${snapshot.latencyMs.p95}`,
      `wager_processing_duration_ms{quantile="0.99"} ${snapshot.latencyMs.p99}`,
      `wager_processing_duration_ms_avg ${snapshot.latencyMs.avg}`,
      `wager_processing_duration_ms_count ${snapshot.latencyMs.count}`
    );

    return lines.join("\n") + "\n";
  }
}
