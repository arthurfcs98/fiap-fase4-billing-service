import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MercadoPagoGateway } from './infrastructure/gateways/mercado-pago.gateway';
import { WebhookController } from './interfaces/controllers/webhook.controller';
import { QuoteModule } from '../quote/quote.module';

@Module({
  imports: [ConfigModule, forwardRef(() => QuoteModule)],
  controllers: [WebhookController],
  providers: [MercadoPagoGateway],
  exports: [MercadoPagoGateway],
})
export class PaymentModule {}
