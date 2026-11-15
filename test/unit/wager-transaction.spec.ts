import { describe, expect, it } from "bun:test";
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/domain/entities/wager-transaction";
import { Money } from "../../src/domain/value-objects/money";
import { InvalidTransactionStateError } from "../../src/domain/errors/domain-errors";
import { LedgerDirection } from "../../src/domain/entities/wallet-ledger-entry";

describe("WagerTransaction Aggregate", () => {
  it("should create transaction in PENDING status", () => {
    const tx = WagerTransaction.create({
      providerId: "pragmatic",
      externalTransactionId: "ext-1",
      idempotencyKey: "pragmatic:ext-1",
      payloadHash: "hash-123",
      walletId: "wallet-1",
      playerId: "player-1",
      roundId: "round-1",
      gameId: "sweet-bonanza",
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: "20.00", currency: "BRL" }),
    });

    expect(tx.status).toBe(WagerTransactionStatus.Pending);
    expect(tx.isTerminal()).toBe(false);
    expect(tx.affectsBalance()).toBe(true);
    expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.Debit);
  });

  it("should enforce referenceExternalTransactionId for Refund and Rollback", () => {
    expect(() =>
      WagerTransaction.create({
        providerId: "pragmatic",
        externalTransactionId: "refund-1",
        idempotencyKey: "pragmatic:refund-1",
        payloadHash: "hash-ref",
        walletId: "wallet-1",
        playerId: "player-1",
        roundId: "round-1",
        gameId: "sweet-bonanza",
        kind: WagerTransactionKind.Refund,
        money: Money.from({ amount: "20.00", currency: "BRL" }),
      })
    ).toThrow();
  });

  it("should transition to PROCESSED and prevent further transitions", () => {
    const tx = WagerTransaction.create({
      providerId: "pragmatic",
      externalTransactionId: "bet-1",
      idempotencyKey: "pragmatic:bet-1",
      payloadHash: "hash-123",
      walletId: "wallet-1",
      playerId: "player-1",
      roundId: "round-1",
      gameId: "sweet-bonanza",
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: "20.00", currency: "BRL" }),
    });

    tx.markProcessed(undefined);
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.isTerminal()).toBe(true);

    expect(() => tx.reject("INSUFFICIENT_FUNDS")).toThrow(InvalidTransactionStateError);
    expect(() => tx.fail("INTERNAL_ERROR")).toThrow(InvalidTransactionStateError);
  });

  it("should correctly handle LOSS without balance effect", () => {
    const tx = WagerTransaction.create({
      providerId: "pragmatic",
      externalTransactionId: "loss-1",
      idempotencyKey: "pragmatic:loss-1",
      payloadHash: "hash-loss",
      walletId: "wallet-1",
      playerId: "player-1",
      roundId: "round-1",
      gameId: "sweet-bonanza",
      kind: WagerTransactionKind.Loss,
      money: Money.from({ amount: "0.00", currency: "BRL" }),
    });

    expect(tx.affectsBalance()).toBe(false);
    expect(() => tx.ledgerDirectionFor()).toThrow();
  });
});
