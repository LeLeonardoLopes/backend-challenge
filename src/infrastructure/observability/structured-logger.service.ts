import { Injectable, LoggerService } from "@nestjs/common";

export interface LogContext {
  correlationId?: string;
  messageId?: string;
  transactionId?: string;
  walletId?: string;
  providerId?: string;
  [key: string]: unknown;
}

@Injectable()
export class StructuredLogger implements LoggerService {
  private formatLog(level: string, message: any, context?: LogContext | string) {
    const ctx = typeof context === "object" ? context : { context };
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message: typeof message === "string" ? message : JSON.stringify(message),
      correlationId: ctx.correlationId ?? null,
      messageId: ctx.messageId ?? null,
      transactionId: ctx.transactionId ?? null,
      walletId: ctx.walletId ?? null,
      providerId: ctx.providerId ?? null,
      instance: process.env.INSTANCE_ID || "app",
    };

    return JSON.stringify(entry);
  }

  log(message: any, context?: LogContext | string) {
    console.log(this.formatLog("INFO", message, context));
  }

  error(message: any, trace?: string, context?: LogContext | string) {
    const ctx = typeof context === "object" ? { ...context, trace } : { context, trace };
    const errText = message ? (typeof message === "string" ? message : JSON.stringify(message)) : (trace || "Unknown error");
    console.error(this.formatLog("ERROR", errText, ctx));
    if (trace) console.error(trace);
  }

  warn(message: any, context?: LogContext | string) {
    console.warn(this.formatLog("WARN", message, context));
  }

  debug(message: any, context?: LogContext | string) {
    if (process.env.NODE_ENV === "development") {
      console.debug(this.formatLog("DEBUG", message, context));
    }
  }

  verbose(message: any, context?: LogContext | string) {
    if (process.env.NODE_ENV === "development") {
      console.log(this.formatLog("VERBOSE", message, context));
    }
  }
}
