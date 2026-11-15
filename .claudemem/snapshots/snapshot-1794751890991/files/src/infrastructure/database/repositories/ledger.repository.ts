import { EntityManager } from "@mikro-orm/postgresql";
import { WalletLedgerEntry } from "../../../domain/entities/wallet-ledger-entry";
import { WalletLedgerEntryEntity } from "../entities/wallet-ledger-entry.entity";
import { Money } from "../../../domain/value-objects/money";

export interface LedgerCursorResult {
  entries: WalletLedgerEntry[];
  nextCursor?: string;
  hasMore: boolean;
}

export class LedgerRepository {
  public async append(em: EntityManager, entry: WalletLedgerEntry): Promise<void> {
    const entity = em.create(WalletLedgerEntryEntity, {
      id: entry.id,
      walletId: entry.walletId,
      transactionId: entry.transactionId,
      direction: entry.direction,
      amount: entry.money.toString(),
      currency: entry.money.currency,
      balanceBefore: entry.balanceBefore.toString(),
      balanceAfter: entry.balanceAfter.toString(),
      createdAt: entry.createdAt,
    });
    em.persist(entity);
  }

  public async findByWalletWithCursor(
    em: EntityManager,
    walletId: string,
    limit = 50,
    cursor?: string
  ): Promise<LedgerCursorResult> {
    const qb = em.createQueryBuilder(WalletLedgerEntryEntity, "l")
      .where({ walletId })
      .orderBy({ createdAt: "DESC", id: "DESC" })
      .limit(limit + 1);

    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, "base64").toString("utf-8");
        const [cursorDate, cursorId] = decoded.split("#");
        if (cursorDate && cursorId) {
          qb.andWhere(
            '(l.created_at, l.id) < (?, ?)',
            [new Date(cursorDate), cursorId]
          );
        }
      } catch {
        // Invalid cursor treated as fresh query
      }
    }

    const entities = await qb.getResult();
    const hasMore = entities.length > limit;
    const slice = hasMore ? entities.slice(0, limit) : entities;

    const entries = slice.map((e) =>
      WalletLedgerEntry.rehydrate({
        id: e.id,
        walletId: e.walletId,
        transactionId: e.transactionId,
        direction: e.direction,
        money: { amount: e.amount, currency: e.currency },
        balanceBefore: { amount: e.balanceBefore, currency: e.currency },
        balanceAfter: { amount: e.balanceAfter, currency: e.currency },
        createdAt: e.createdAt,
      })
    );

    let nextCursor: string | undefined;
    if (hasMore && slice.length > 0) {
      const last = slice[slice.length - 1];
      const rawCursor = `${last.createdAt.toISOString()}#${last.id}`;
      nextCursor = Buffer.from(rawCursor, "utf-8").toString("base64");
    }

    return {
      entries,
      nextCursor,
      hasMore,
    };
  }

  /**
   * Sums all credits and debits from the ledger to calculate exact materialized balance.
   */
  public async calculateBalanceFromLedger(
    em: EntityManager,
    walletId: string,
    currency: string
  ): Promise<{ calculatedBalance: Money; checkedEntries: number }> {
    const entities = await em.find(
      WalletLedgerEntryEntity,
      { walletId },
      { orderBy: { createdAt: "ASC", id: "ASC" } }
    );

    let sum = Money.zero(currency);
    for (const item of entities) {
      const itemMoney = Money.from({ amount: item.amount, currency: item.currency });
      if (item.direction === "CREDIT") {
        sum = sum.add(itemMoney);
      } else {
        sum = sum.subtract(itemMoney);
      }
    }

    return {
      calculatedBalance: sum,
      checkedEntries: entities.length,
    };
  }
}
