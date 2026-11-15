import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  NotFoundException,
} from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { CreateWalletDto } from "../dto/create-wallet.dto";
import { CreateWalletUseCase } from "../../../application/use-cases/create-wallet.use-case";
import { ReconcileWalletUseCase } from "../../../application/use-cases/reconcile-wallet.use-case";
import { WalletRepository } from "../../database/repositories/wallet.repository";
import { LedgerRepository } from "../../database/repositories/ledger.repository";

@Controller("wallets")
export class WalletsController {
  constructor(
    private readonly em: EntityManager,
    private readonly createWalletUseCase: CreateWalletUseCase,
    private readonly reconcileUseCase: ReconcileWalletUseCase,
    private readonly walletRepo: WalletRepository,
    private readonly ledgerRepo: LedgerRepository
  ) {}

  @Post()
  async createWallet(@Body() dto: CreateWalletDto) {
    const em = this.em.fork();
    return this.createWalletUseCase.execute(em, dto);
  }

  @Get(":walletId")
  async getWallet(@Param("walletId") walletId: string) {
    const em = this.em.fork();
    const wallet = await this.walletRepo.findById(em, walletId);
    if (!wallet) {
      throw new NotFoundException(`Wallet ${walletId} not found`);
    }
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
    };
  }

  @Get(":walletId/ledger")
  async getLedger(
    @Param("walletId") walletId: string,
    @Query("limit") limit = 50,
    @Query("cursor") cursor?: string
  ) {
    const em = this.em.fork();
    const parsedLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    const result = await this.ledgerRepo.findByWalletWithCursor(
      em,
      walletId,
      parsedLimit,
      cursor
    );
    return {
      walletId,
      entries: result.entries.map((e) => ({
        id: e.id,
        transactionId: e.transactionId,
        direction: e.direction,
        money: e.money.toJSON(),
        balanceBefore: e.balanceBefore.toJSON(),
        balanceAfter: e.balanceAfter.toJSON(),
        createdAt: e.createdAt.toISOString(),
      })),
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    };
  }

  @Post(":walletId/reconciliation")
  async reconcile(@Param("walletId") walletId: string) {
    const em = this.em.fork();
    return this.reconcileUseCase.execute(em, walletId);
  }
}
