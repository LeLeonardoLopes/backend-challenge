import { describe, expect, it } from "bun:test";
import { Wallet } from "../../src/domain/entities/wallet";
import { Money } from "../../src/domain/value-objects/money";
import { InsufficientFundsError, CurrencyMismatchError } from "../../src/domain/errors/domain-errors";
import { LedgerDirection } from "../../src/domain/entities/wallet-ledger-entry";

describe("Wallet & Ledger Aggregate", () => {
  it("should open wallet with initial balance and generate opening ledger entry", () => {
    const initial = Money.from({ amount: "100.00", currency: "BRL" });
    const { wallet, openingEntry } = Wallet.open({
      playerId: "player-123",
      initialBalance: initial,
    });

    expect(wallet.playerId).toBe("player-123");
    expect(wallet.currency).toBe("BRL");
    expect(wallet.balance.toString()).toBe("100.00");
    expect(wallet.version).toBe(1);

    expect(openingEntry).toBeDefined();
    expect(openingEntry?.direction).toBe(LedgerDirection.Credit);
    expect(openingEntry?.money.toString()).toBe("100.00");
    expect(openingEntry?.balanceBefore.toString()).toBe("0.00");
    expect(openingEntry?.balanceAfter.toString()).toBe("100.00");
    expect(openingEntry?.isBalanced()).toBe(true);
  });

  it("should debit balance and increment version", () => {
    const { wallet } = Wallet.open({
      playerId: "player-123",
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    const debitMoney = Money.from({ amount: "40.00", currency: "BRL" });
    const entry = wallet.debit(debitMoney, "tx-1");

    expect(wallet.balance.toString()).toBe("60.00");
    expect(wallet.version).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.balanceBefore.toString()).toBe("100.00");
    expect(entry.balanceAfter.toString()).toBe("60.00");
    expect(entry.isBalanced()).toBe(true);
  });

  it("should reject debit when funds are insufficient", () => {
    const { wallet } = Wallet.open({
      playerId: "player-123",
      initialBalance: Money.from({ amount: "50.00", currency: "BRL" }),
    });

    const tooMuch = Money.from({ amount: "80.00", currency: "BRL" });
    expect(() => wallet.debit(tooMuch, "tx-fail")).toThrow(InsufficientFundsError);
    // Balance and version must remain unchanged
    expect(wallet.balance.toString()).toBe("50.00");
    expect(wallet.version).toBe(1);
  });

  it("should reject debit or credit with different currency", () => {
    const { wallet } = Wallet.open({
      playerId: "player-123",
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    const usd = Money.from({ amount: "10.00", currency: "USD" });
    expect(() => wallet.debit(usd, "tx-usd")).toThrow(CurrencyMismatchError);
    expect(() => wallet.credit(usd, "tx-usd")).toThrow(CurrencyMismatchError);
  });

  it("should credit balance and increment version", () => {
    const { wallet } = Wallet.open({
      playerId: "player-123",
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    const winMoney = Money.from({ amount: "50.00", currency: "BRL" });
    const entry = wallet.credit(winMoney, "tx-win");

    expect(wallet.balance.toString()).toBe("150.00");
    expect(wallet.version).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.Credit);
    expect(entry.balanceBefore.toString()).toBe("100.00");
    expect(entry.balanceAfter.toString()).toBe("150.00");
    expect(entry.isBalanced()).toBe(true);
  });
});
