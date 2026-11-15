import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
} from "@nestjs/common";
import { Response } from "express";
import {
  DomainError,
  IdempotencyConflictError,
  InsufficientFundsError,
  CurrencyMismatchError,
  InvalidMoneyError,
} from "../../../domain/errors/domain-errors";

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = "INTERNAL_SERVER_ERROR";
    let message = "An unexpected error occurred";

    if (exception instanceof IdempotencyConflictError) {
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
    } else if (
      exception instanceof InsufficientFundsError ||
      exception instanceof CurrencyMismatchError
    ) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof InvalidMoneyError) {
      status = HttpStatus.BAD_REQUEST;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof DomainError) {
      if (exception.code.includes("NOT_FOUND")) {
        status = HttpStatus.NOT_FOUND;
      } else if (exception.code.includes("ALREADY_EXISTS")) {
        status = HttpStatus.CONFLICT;
      } else {
        status = HttpStatus.BAD_REQUEST;
      }
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    response.status(status).json({
      statusCode: status,
      code,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
