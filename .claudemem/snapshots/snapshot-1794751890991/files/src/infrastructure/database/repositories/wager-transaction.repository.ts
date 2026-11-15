import { EntityManager } from "@mikro-orm/postgresql";
import { WagerTransaction, WagerTransactionStatus } from "../../../domain/entities/wager-transaction";
import { WagerTransactionEntity } from "../entities/wager-transaction.entity";

export class WagerTransactionRepository {
  public async findById(em: EntityManager, id: string): Promise<WagerTransaction | null> {
    const entity = await em.findOne(WagerTransactionEntity, { id });
    if (!entity) return null;
    return this.toDomain(entity);
  }

  public async findByIdempotencyKey(
    em: EntityManager,
    idempotencyKey: string
  ): Promise<WagerTransaction | null> {
    const entity = await em.findOne(WagerTransactionEntity, { idempotencyKey });
    if (!entity) return null;
    return this.toDomain(entity);
  }

  public async findByExternalId(
    em: EntityManager,
    providerId: string,
    externalTransactionId: string
  ): Promise<WagerTransaction | null> {
    const entity = await em.findOne(WagerTransactionEntity, {
      providerId,
      externalTransactionId,
    });
    if (!entity) return null;
    return this.toDomain(entity);
  }

  public async findPendingReferences(
    em: EntityManager,
    limit = 50
  ): Promise<WagerTransaction[]> {
    const entities = await em.find(
      WagerTransactionEntity,
      { status: WagerTransactionStatus.PendingReference },
      { limit, orderBy: { createdAt: "ASC" } }
    );
    return entities.map((e) => this.toDomain(e));
  }

  public async save(em: EntityManager, tx: WagerTransaction): Promise<void> {
    const existing = await em.findOne(WagerTransactionEntity, { id: tx.id });
    if (existing) {
      existing.status = tx.status;
      existing.referenceTransactionId = tx.referenceTransactionId;
      existing.failureCode = tx.failureCode;
      existing.processedAt = tx.processedAt;
    } else {
      const entity = em.create(WagerTransactionEntity, {
        id: tx.id,
        providerId: tx.providerId,
        externalTransactionId: tx.externalTransactionId,
        idempotencyKey: tx.idempotencyKey,
        payloadHash: tx.payloadHash,
        walletId: tx.walletId,
        playerId: tx.playerId,
        roundId: tx.roundId,
        gameId: tx.gameId,
        kind: tx.kind,
        amount: tx.money.toString(),
        currency: tx.money.currency,
        referenceExternalTransactionId: tx.referenceExternalTransactionId,
        referenceTransactionId: tx.referenceTransactionId,
        status: tx.status,
        failureCode: tx.failureCode,
        createdAt: tx.createdAt,
        processedAt: tx.processedAt,
      });
      em.persist(entity);
    }
  }

  private toDomain(entity: WagerTransactionEntity): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind,
      money: {
        amount: entity.amount,
        currency: entity.currency,
      },
      referenceExternalTransactionId: entity.referenceExternalTransactionId,
      status: entity.status,
      referenceTransactionId: entity.referenceTransactionId,
      failureCode: entity.failureCode,
      createdAt: entity.createdAt,
      processedAt: entity.processedAt,
    });
  }
}
