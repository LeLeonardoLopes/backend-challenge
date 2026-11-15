import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./infrastructure/http/filters/domain-exception.filter";
import { StructuredLogger } from "./infrastructure/observability/structured-logger.service";

async function bootstrap() {
  const logger = new StructuredLogger();
  const app = await NestFactory.create(AppModule, {
    logger,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    })
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  // Handle SIGTERM and SIGINT gracefully
  app.enableShutdownHooks();

  const port = process.env.PORT || 3000;
  const instance = process.env.INSTANCE_ID || "standalone";

  await app.listen(port);
  logger.log(
    `🦧 Jungle Gaming Distributed Wagering Processor running on port ${port} (Instance: ${instance})`
  );
}

bootstrap().catch((err) => {
  console.error("Fatal error during bootstrap:", err);
  process.exit(1);
});
