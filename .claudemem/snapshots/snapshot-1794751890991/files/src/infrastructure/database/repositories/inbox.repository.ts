import { EntityManager } from "@mikro-orm/postgresql";
import { InboxMessage } from "../../../domain/entities/inbox-message";
import { InboxMessageEntity } from "../entities/inbox-message.entity";

export class InboxRepository {
  /**
   * Attempts to record an incoming message.
   * Returns true if newly recorded, or false if already processed (duplicate).
   */
  public async find(
    em: EntityManager,
    consumerName: string,
    messageId: string
  ): Promise<InboxMessage | null> {
    const entity = await em.findOne(InboxMessageEntity, { consumerName, messageId });
    if (!entity) return null;

    return InboxMessage.rehydrate({
      consumerName: entity.consumerName,
      messageId: entity.messageId,
      payloadHash: entity.payloadHash,
      receivedAt: entity.receivedAt,
      processedAt: entity.processedAt,
    });
  }

  public async record(em: EntityManager, inbox: InboxMessage): Promise<void> {
    const entity = em.create(InboxMessageEntity, {
      consumerName: inbox.consumerName,
      messageId: inbox.messageId,
      payloadHash: inbox.payloadHash,
      receivedAt: inbox.receivedAt,
      processedAt: inbox.processedAt,
    });
    em.persist(entity);
  }
}
