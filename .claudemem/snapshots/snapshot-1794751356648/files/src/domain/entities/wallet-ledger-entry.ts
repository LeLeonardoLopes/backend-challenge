import { randomUUID } from "node:crypto";
import { Money, MoneyProps } from "../value-objects/money";
import { DomainError } from "../errors/domain-errors";

export enum LedgerDirection {
  Debit = "DEBIT",
  Credit = "CREDIT",
}

export interface CreateLedgerEntryProps {
  id?: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt?: Date;
}

export interface LedgerEntryState {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  createdAt: Date;
}

export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date
  ) {}

  public static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    const entry = new WalletLedgerEntry(
      props.id ?? randomUUID(),
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      props.createdAt ?? new Date()
    );

    if (!entry.isBalanced()) {
      throw new DomainError(
        `Ledger entry is not balanced: balanceBefore (${props.balanceBefore.toString()}) ` +
          `${props.direction === LedgerDirection.Credit ? "+" : "-"} ${props.money.toString()} ` +
          `!= balanceAfter (${props.balanceAfter.toString()})`,
        "UNBALANCED_LEDGER_ENTRY"
      );
    }

    return entry;
  }

  public static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      Money.from(state.money),
      Money.from(state.balanceBefore),
      Money.from(state.balanceAfter),
      new Date(state.createdAt)
    );
  }

  public isBalanced(): boolean {
    if (this.direction === LedgerDirection.Credit) {
      const calculated = this.balanceBefore.add(this.money);
      return calculated.equals(this.balanceAfter);
    } else {
      const calculated = this.balanceBefore.subtract(this.money);
      return calculated.equals(this.balanceAfter);
    }
  }
}
