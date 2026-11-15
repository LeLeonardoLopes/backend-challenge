import { EntityManager } from "@mikro-orm/postgresql";
import { Wallet } from "../../domain/entities/wallet";
import { Money } from "../../domain/value-objects/money";
import { WalletRepository } from "../../infrastructure/database/repositories/wallet.repository";
import { LedgerRepository } from "../../infrastructure/database/repositories/ledger.repository";
import { OutboxRepository } from "../../infrastructure/database/repositories/outbox.repository";
import { OutboxMessage } from "../../domain/entities/outbox-message";
import { WalletBalanceChanged } from "../../domain/events/integration-event";
import { DomainError } from "../../domain/errors/domain-errors";

export interface CreateWalletDto {
  playerId: string;
  initialBalance: {
    amount: string;
    currency: string;
  };
}

export class CreateWalletUseCase {
  constructor(
    private readonly walletRepo: WalletRepository,
    private readonly ledgerRepo: LedgerRepository,
    private readonly outboxRepo: OutboxRepository
  ) {}

  public async execute(em: EntityManager, dto: CreateWalletDto) {
    return em.transactional(async (txEm) => {
      // 1. Check uniqueness constraint for (playerId, currency)
      const existing = await this.walletRepo.findByPlayerAndCurrency(
        txEm,
        dto.playerId,
        dto.initialBalance.currency
      );
      if (existing) {
        throw new DomainError(
          `Wallet already exists for player ${dto.playerId} in currency ${dto.initialBalance.currency}`,
          "WALLET_ALREADY_EXISTS"
        );
      }

      // 2. Open Wallet Aggregate
      const initialMoney = Money.from(dto.initialBalance);
      const { wallet, openingEntry } = Wallet.open({
        playerId: dto.playerId,
        initialBalance: initialMoney,
      });

      // 3. Persist Wallet
      await this.walletRepo.save(txEm, wallet);

      // 4. If initial balance > 0, record opening ledger entry and outbox event
      if (openingEntry) {
        await this.ledgerRepo.append(txEm, openingEntry);

        const event = WalletBalanceChanged.create(
          {
            walletId: wallet.id,
            transactionId: openingEntry.transactionId,
            direction: openingEntry.direction,
            money: openingEntry.money.toJSON(),
            balanceBefore: openingEntry.balanceBefore.toJSON(),
            balanceAfter: openingEntry.balanceAfter.toJSON(),
            walletVersion: wallet.version,
          },
          wallet.id
        );
        await this.outboxRepo.append(txEm, OutboxMessage.enqueue(event));
      }

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance.toJSON(),
        version: wallet.version,
      };
    });
  }
}
