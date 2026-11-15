import { describe, expect, it } from "bun:test";
import { Money } from "../../src/domain/value-objects/money";
import { CurrencyMismatchError, InvalidMoneyError } from "../../src/domain/errors/domain-errors";

describe("Money Value Object", () => {
  it("should create Money from valid string and currency", () => {
    const money = Money.from({ amount: "25.00", currency: "BRL" });
    expect(money.toString()).toBe("25.00");
    expect(money.currency).toBe("BRL");
  });

  it("should prevent floating point inaccuracies (0.10 + 0.20 === 0.30)", () => {
    const m1 = Money.from({ amount: "0.10", currency: "BRL" });
    const m2 = Money.from({ amount: "0.20", currency: "BRL" });
    const sum = m1.add(m2);

    expect(sum.toString()).toBe("0.30");
    expect(sum.equals(Money.from({ amount: "0.30", currency: "BRL" }))).toBe(true);
  });

  it("should reject invalid amount strings", () => {
    expect(() => Money.from({ amount: "abc", currency: "BRL" })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: "", currency: "BRL" })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: "10.123", currency: "BRL" })).toThrow(InvalidMoneyError); // > 2 decimal places
    expect(() => Money.from({ amount: "1e5", currency: "BRL" })).toThrow(InvalidMoneyError); // scientific notation
  });

  it("should reject negative amounts in contract inputs by default", () => {
    expect(() => Money.from({ amount: "-25.00", currency: "BRL" })).toThrow(InvalidMoneyError);
  });

  it("should reject operations between different currencies", () => {
    const brl = Money.from({ amount: "50.00", currency: "BRL" });
    const usd = Money.from({ amount: "20.00", currency: "USD" });

    expect(() => brl.add(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.subtract(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.isLessThan(usd)).toThrow(CurrencyMismatchError);
  });

  it("should correctly subtract amounts and handle zero", () => {
    const m1 = Money.from({ amount: "100.00", currency: "BRL" });
    const m2 = Money.from({ amount: "80.00", currency: "BRL" });
    const res = m1.subtract(m2);

    expect(res.toString()).toBe("20.00");
    expect(res.isPositive()).toBe(true);
    expect(res.isZero()).toBe(false);

    const zero = res.subtract(Money.from({ amount: "20.00", currency: "BRL" }));
    expect(zero.isZero()).toBe(true);
    expect(zero.toString()).toBe("0.00");
  });

  it("should check equality and order correctly", () => {
    const a = Money.from({ amount: "10.00", currency: "BRL" });
    const b = Money.from({ amount: "20.00", currency: "BRL" });
    const c = Money.from({ amount: "10.00", currency: "BRL" });

    expect(a.isLessThan(b)).toBe(true);
    expect(b.isGreaterThan(a)).toBe(true);
    expect(a.equals(c)).toBe(true);
  });
});
