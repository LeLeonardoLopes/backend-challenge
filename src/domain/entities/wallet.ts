import { randomUUID } from "node:crypto";
import { Money, MoneyProps } from "../value-objects/money";
import { CurrencyMismatchError, InsufficientFundsError } from "../errors/domain-errors";
import { LedgerDirection, WalletLedgerEntry } from "./wallet-ledger-entry";

export interface OpenWalletProps {
  id?: string;
  playerId: string;
  initialBalance: Money;
  createdAt?: Date;
}

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: MoneyProps;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date
  ) {}

  public static open(props: OpenWalletProps): { wallet: Wallet; openingEntry?: WalletLedgerEntry } {
    const id = props.id ?? randomUUID();
    const createdAt = props.createdAt ?? new Date();
    const wallet = new Wallet(
      id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      createdAt,
      createdAt
    );

    let openingEntry: WalletLedgerEntry | undefined;
    if (props.initialBalance.isPositive()) {
      openingEntry = WalletLedgerEntry.create({
        walletId: id,
        transactionId: id, // internal opening transaction
        direction: LedgerDirection.Credit,
        money: props.initialBalance,
        balanceBefore: Money.zero(wallet.currency),
        balanceAfter: props.initialBalance,
        createdAt,
      });
    }

    return { wallet, openingEntry };
  }

  public static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      Money.from(state.balance),
      state.version,
      new Date(state.createdAt),
      new Date(state.updatedAt)
    );
  }

  public get balance(): Money {
    return this._balance;
  }

  public get version(): number {
    return this._version;
  }

  public get updatedAt(): Date {
    return this._updatedAt;
  }

  public debit(money: Money, transactionId: string): WalletLedgerEntry {
    this.assertSameCurrency(money);

    if (this._balance.isLessThan(money)) {
      throw new InsufficientFundsError(this._balance.toString(), money.toString());
    }

    const balanceBefore = this._balance;
    const balanceAfter = this._balance.subtract(money);

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = new Date();

    return WalletLedgerEntry.create({
      walletId: this.id,
      transactionId,
      direction: LedgerDirection.Debit,
      money,
      balanceBefore,
      balanceAfter,
      createdAt: this._updatedAt,
    });
  }

  public credit(money: Money, transactionId: string): WalletLedgerEntry {
    this.assertSameCurrency(money);

    const balanceBefore = this._balance;
    const balanceAfter = this._balance.add(money);

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = new Date();

    return WalletLedgerEntry.create({
      walletId: this.id,
      transactionId,
      direction: LedgerDirection.Credit,
      money,
      balanceBefore,
      balanceAfter,
      createdAt: this._updatedAt,
    });
  }

  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }
}
