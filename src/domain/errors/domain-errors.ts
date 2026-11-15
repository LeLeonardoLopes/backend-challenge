export class DomainError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidMoneyError extends DomainError {
  constructor(message: string) {
    super(message, "INVALID_MONEY");
  }
}

export class CurrencyMismatchError extends DomainError {
  constructor(expected: string, received: string) {
    super(`Currency mismatch: expected ${expected}, got ${received}`, "CURRENCY_MISMATCH");
  }
}

export class InsufficientFundsError extends DomainError {
  constructor(currentBalance: string, requestedAmount: string) {
    super(
      `Insufficient funds: current balance is ${currentBalance}, requested amount is ${requestedAmount}`,
      "INSUFFICIENT_FUNDS"
    );
  }
}

export class InvalidTransactionStateError extends DomainError {
  constructor(currentStatus: string, attemptedTransition: string) {
    super(
      `Cannot transition transaction from terminal status ${currentStatus} to ${attemptedTransition}`,
      "INVALID_TRANSACTION_STATE"
    );
  }
}

export class IdempotencyConflictError extends DomainError {
  constructor(key: string) {
    super(
      `Idempotency key ${key} already exists with a different payload hash`,
      "IDEMPOTENCY_CONFLICT"
    );
  }
}

export class MissingReferenceError extends DomainError {
  constructor(referenceExternalId: string) {
    super(
      `Referenced transaction ${referenceExternalId} not found`,
      "REFERENCE_NOT_FOUND"
    );
  }
}
