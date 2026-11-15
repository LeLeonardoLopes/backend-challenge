import Decimal from "decimal.js";
import { CurrencyMismatchError, InvalidMoneyError } from "../errors/domain-errors";

export interface MoneyProps {
  amount: string;   // decimal string, e.g. "25.00"
  currency: string; // ISO-4217, e.g. "BRL"
}

export class Money {
  private static readonly DECIMAL_REGEX = /^\d+(\.\d{1,2})?$/;

  private constructor(
    private readonly value: Decimal,
    public readonly currency: string
  ) {}

  public static from(props: MoneyProps, allowNegative = false): Money {
    if (!props || typeof props.amount !== "string" || !props.currency) {
      throw new InvalidMoneyError("Amount string and currency are required");
    }

    const trimmedCurrency = props.currency.trim().toUpperCase();
    if (!trimmedCurrency || trimmedCurrency.length !== 3) {
      throw new InvalidMoneyError(`Invalid currency code: ${props.currency}`);
    }

    const trimmedAmount = props.amount.trim();
    if (!trimmedAmount) {
      throw new InvalidMoneyError("Amount cannot be empty");
    }

    // Check for negative input unless explicitly allowed
    if (trimmedAmount.startsWith("-")) {
      if (!allowNegative) {
        throw new InvalidMoneyError("Amount cannot be negative in contract input");
      }
      const positivePart = trimmedAmount.slice(1);
      if (!Money.DECIMAL_REGEX.test(positivePart)) {
        throw new InvalidMoneyError(`Invalid amount format: ${trimmedAmount}`);
      }
    } else {
      if (!Money.DECIMAL_REGEX.test(trimmedAmount)) {
        throw new InvalidMoneyError(`Invalid amount format: ${trimmedAmount}`);
      }
    }

    try {
      const dec = new Decimal(trimmedAmount);
      if (!dec.isFinite()) {
        throw new InvalidMoneyError("Amount must be a finite number");
      }
      return new Money(dec, trimmedCurrency);
    } catch (err) {
      if (err instanceof InvalidMoneyError) throw err;
      throw new InvalidMoneyError(`Failed to parse amount: ${trimmedAmount}`);
    }
  }

  public static zero(currency: string): Money {
    return Money.from({ amount: "0.00", currency });
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  public negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  public isZero(): boolean {
    return this.value.isZero();
  }

  public isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  public isNegative(): boolean {
    return this.value.isNegative() && !this.value.isZero();
  }

  public isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  public isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.greaterThan(other.value);
  }

  public isGreaterThanOrEqualTo(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.greaterThanOrEqualTo(other.value);
  }

  public equals(other: Money): boolean {
    if (this.currency !== other.currency) {
      return false;
    }
    return this.value.equals(other.value);
  }

  public toJSON(): MoneyProps {
    return {
      amount: this.toString(),
      currency: this.currency,
    };
  }

  public toString(): string {
    return this.value.toFixed(2);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
