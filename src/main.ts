import './shared/observability/otel';

async function bootstrap() {
  const { NestFactory } = await import('@nestjs/core');
  const { Logger, ValidationPipe } = await import('@nestjs/common');
  const { SwaggerModule, DocumentBuilder } = await import('@nestjs/swagger');
  const { AppModule } = await import('./app.module');
  const { CorrelationIdInterceptor } = await import(
    './shared/observability/correlation-id.interceptor'
  );
  const { Logger: PinoLogger } = await import('nestjs-pino');

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(new CorrelationIdInterceptor());
  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type,X-Correlation-Id',
    exposedHeaders: 'X-Correlation-Id',
  });

  const config = new DocumentBuilder()
    .setTitle('Billing Service — Fase 4')
    .setDescription('Microsserviço de orçamentos e pagamentos. Consome eventos da Saga (os.saga.quote_requested), integra com Mercado Pago via Checkout Pro e devolve eventos billing.saga.*.')
    .setVersion('4.0')
    .addTag('Quotes', 'Orçamentos gerados a partir do OS Service via evento')
    .addTag('Webhooks', 'Endpoints públicos que recebem notificações do Mercado Pago')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3002;
  await app.listen(port);
  const logger = new Logger('Bootstrap');
  logger.log(`Billing Service v4.0 listening on port ${port}`);
  logger.log(`Swagger: http://localhost:${port}/api/docs`);
}

bootstrap().catch((err) => {
  console.error('Fatal during bootstrap:', err);
  process.exit(1);
});
