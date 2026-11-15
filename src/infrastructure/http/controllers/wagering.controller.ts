import {
  Controller,
  Post,
  Get,
  Param,
  Headers,
  Body,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { ProcessWagerDto } from "../dto/process-wager.dto";
import { ProcessWagerTransactionUseCase } from "../../../application/use-cases/process-wager-transaction.use-case";
import { WagerTransactionRepository } from "../../database/repositories/wager-transaction.repository";

@Controller()
export class WageringController {
  constructor(
    private readonly em: EntityManager,
    private readonly processWagerUseCase: ProcessWagerTransactionUseCase,
    private readonly wagerRepo: WagerTransactionRepository
  ) {}

  @Post("wagering/transactions")
  async submitTransaction(
    @Headers("idempotency-key") idempotencyKeyHeader: string,
    @Body() dto: ProcessWagerDto
  ) {
    const em = this.em.fork();
    const idempotencyKey =
      idempotencyKeyHeader?.trim() || `${dto.providerId}:${dto.externalTransactionId}`;

    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency-Key header is required");
    }

    return this.processWagerUseCase.execute(em, dto, idempotencyKey);
  }

  @Get("wagering/transactions/:transactionId")
  async getTransactionById(@Param("transactionId") transactionId: string) {
    const em = this.em.fork();
    const tx = await this.wagerRepo.findById(em, transactionId);
    if (!tx) {
      throw new NotFoundException(`Transaction ${transactionId} not found`);
    }
    return this.serializeTransaction(tx);
  }

  @Get("providers/:providerId/wagering/transactions/:externalTransactionId")
  async getTransactionByExternalId(
    @Param("providerId") providerId: string,
    @Param("externalTransactionId") externalTransactionId: string
  ) {
    const em = this.em.fork();
    const tx = await this.wagerRepo.findByExternalId(
      em,
      providerId,
      externalTransactionId
    );
    if (!tx) {
      throw new NotFoundException(
        `Transaction ${externalTransactionId} for provider ${providerId} not found`
      );
    }
    return this.serializeTransaction(tx);
  }

  private serializeTransaction(tx: any) {
    return {
      id: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      idempotencyKey: tx.idempotencyKey,
      walletId: tx.walletId,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      money: tx.money.toJSON(),
      status: tx.status,
      referenceExternalTransactionId: tx.referenceExternalTransactionId,
      referenceTransactionId: tx.referenceTransactionId,
      failureCode: tx.failureCode,
      createdAt: tx.createdAt.toISOString(),
      processedAt: tx.processedAt?.toISOString(),
    };
  }
}
