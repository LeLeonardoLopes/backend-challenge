import { EntityManager } from "@mikro-orm/postgresql";
import { OutboxMessage } from "../../../domain/entities/outbox-message";
import { OutboxMessageEntity } from "../entities/outbox-message.entity";

export class OutboxRepository {
  public async append(em: EntityManager, message: OutboxMessage): Promise<void> {
    const entity = em.create(OutboxMessageEntity, {
      id: message.id,
      aggregateId: message.aggregateId,
      eventType: message.eventType,
      payload: message.payload as Record<string, unknown>,
      occurredAt: message.occurredAt,
      attempts: message.attempts,
      nextAttemptAt: message.nextAttemptAt,
      publishedAt: message.publishedAt,
    });
    em.persist(entity);
  }

  public async findDue(em: EntityManager, limit = 50, now = new Date()): Promise<OutboxMessage[]> {
    const entities = await em.find(
      OutboxMessageEntity,
      {
        publishedAt: null,
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
      },
      { limit, orderBy: { occurredAt: "ASC" } }
    );

    return entities.map((e) =>
      OutboxMessage.rehydrate({
        id: e.id,
        aggregateId: e.aggregateId,
        eventType: e.eventType,
        payload: e.payload,
        occurredAt: e.occurredAt,
        attempts: e.attempts,
        nextAttemptAt: e.nextAttemptAt,
        publishedAt: e.publishedAt,
      })
    );
  }

  public async update(em: EntityManager, message: OutboxMessage): Promise<void> {
    const existing = await em.findOne(OutboxMessageEntity, { id: message.id });
    if (existing) {
      existing.attempts = message.attempts;
      existing.nextAttemptAt = message.nextAttemptAt;
      existing.publishedAt = message.publishedAt;
    }
  }
}
