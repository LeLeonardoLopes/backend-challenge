import { EntityManager } from "@mikro-orm/postgresql";
import { WalletRepository } from "../../infrastructure/database/repositories/wallet.repository";
import { LedgerRepository } from "../../infrastructure/database/repositories/ledger.repository";
import { DomainError } from "../../domain/errors/domain-errors";
import { MoneyProps } from "../../domain/value-objects/money";

export interface ReconciliationResult {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}

export class ReconcileWalletUseCase {
  constructor(
    private readonly walletRepo: WalletRepository,
    private readonly ledgerRepo: LedgerRepository
  ) {}

  public async execute(em: EntityManager, walletId: string): Promise<ReconciliationResult> {
    return em.transactional(async (txEm) => {
      const wallet = await this.walletRepo.findById(txEm, walletId);
      if (!wallet) {
        throw new DomainError(`Wallet ${walletId} not found`, "WALLET_NOT_FOUND");
      }

      const { calculatedBalance, checkedEntries } =
        await this.ledgerRepo.calculateBalanceFromLedger(txEm, walletId, wallet.currency);

      const diff = wallet.balance.subtract(calculatedBalance);
      const consistent = diff.isZero();

      if (!consistent) {
        console.warn(
          JSON.stringify({
            level: "WARN",
            message: "Reconciliation discrepancy detected",
            walletId,
            storedBalance: wallet.balance.toString(),
            calculatedBalance: calculatedBalance.toString(),
            difference: diff.toString(),
            checkedEntries,
          })
        );
      }

      return {
        walletId,
        storedBalance: wallet.balance.toJSON(),
        calculatedBalance: calculatedBalance.toJSON(),
        difference: diff.toJSON(),
        consistent,
        checkedEntries,
      };
    });
  }
}
