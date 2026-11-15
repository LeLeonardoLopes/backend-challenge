import { EntityManager, LockMode } from "@mikro-orm/postgresql";
import { Wallet } from "../../../domain/entities/wallet";
import { WalletEntity } from "../entities/wallet.entity";

export class WalletRepository {
  /**
   * Fetches the wallet row with a Pessimistic Exclusive Lock (SELECT ... FOR UPDATE).
   * This serializes concurrent requests for the exact same walletId across all instances.
   */
  public async findByIdForUpdate(em: EntityManager, walletId: string): Promise<Wallet | null> {
    const entity = await em.findOne(
      WalletEntity,
      { id: walletId },
      { lockMode: LockMode.PESSIMISTIC_WRITE }
    );

    if (!entity) return null;

    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balance: {
        amount: entity.balance,
        currency: entity.currency,
      },
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  public async findById(em: EntityManager, walletId: string): Promise<Wallet | null> {
    const entity = await em.findOne(WalletEntity, { id: walletId });
    if (!entity) return null;

    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balance: {
        amount: entity.balance,
        currency: entity.currency,
      },
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  public async findByPlayerAndCurrency(
    em: EntityManager,
    playerId: string,
    currency: string
  ): Promise<Wallet | null> {
    const entity = await em.findOne(WalletEntity, { playerId, currency });
    if (!entity) return null;

    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balance: {
        amount: entity.balance,
        currency: entity.currency,
      },
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  public async save(em: EntityManager, wallet: Wallet): Promise<void> {
    const existing = await em.findOne(WalletEntity, { id: wallet.id });
    if (existing) {
      existing.balance = wallet.balance.toString();
      existing.version = wallet.version;
      existing.updatedAt = wallet.updatedAt;
    } else {
      const entity = em.create(WalletEntity, {
        id: wallet.id,
        playerId: wallet.playerId,
        currency: wallet.currency,
        balance: wallet.balance.toString(),
        version: wallet.version,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt,
      });
      em.persist(entity);
    }
  }
}
