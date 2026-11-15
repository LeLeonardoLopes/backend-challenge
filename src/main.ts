import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./infrastructure/http/filters/domain-exception.filter";
import { StructuredLogger } from "./infrastructure/observability/structured-logger.service";

async function bootstrap() {
  const logger = new StructuredLogger();
  const app = await NestFactory.create(AppModule, {
    logger,
  });

  app.enableCors();

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    })
  );

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.enableShutdownHooks();

  // Configure Swagger Interactive Documentation UI
  const config = new DocumentBuilder()
    .setTitle("Jungle Gaming — Distributed Wagering Processor")
    .setDescription(
      "API Financeira Distribuída de Alta Concorrência para processamento de apostas iGaming"
    )
    .setVersion("1.0.0")
    .addTag("wallets", "Gerenciamento de Carteiras, Saldo e Extrato Contábil")
    .addTag("wagering", "Processamento de Apostas, Idempotência e Reversões")
    .addTag("health", "Health Checks de Liveness e Readiness")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document);

  const port = process.env.PORT || 3000;
  const instance = process.env.INSTANCE_ID || "standalone";

  await app.listen(port);
  console.log(`\n==================================================================`);
  console.log(`🦧 Jungle Gaming Distributed Wagering Processor`);
  console.log(`📡 Servidor Rodando em:  http://localhost:${port}`);
  console.log(`📖 Swagger Interativo:   http://localhost:${port}/docs`);
  console.log(`📊 Painel Visual:        http://localhost:${port}/dashboard`);
  console.log(`==================================================================\n`);
}

bootstrap().catch((err) => {
  console.error("Fatal error during bootstrap:", err);
  process.exit(1);
});
