import { Body, Controller, HttpCode, HttpStatus, Logger, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { QuoteService } from '@/modules/quote/application/services/quote.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly quoteService: QuoteService) {}

  @Post('mercadopago')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Webhook do Mercado Pago (IPN v2)',
    description:
      'Endpoint público chamado pelo MP quando o status do pagamento muda. Extrai o paymentId, consulta a API do MP, e publica evento na Saga.',
  })
  async handleMercadoPago(
    @Query() query: Record<string, string>,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    this.logger.log(
      `MP webhook received: type=${query.type ?? body.type} action=${body.action} data=${JSON.stringify(body.data)}`,
    );

    // MP envia paymentId de duas formas dependendo da versão do webhook.
    const paymentId =
      (body.data as { id?: string })?.id ??
      query['data.id'] ??
      query.id;

    if (!paymentId) {
      this.logger.warn('MP webhook without paymentId — ignoring');
      return { received: true };
    }

    const eventType = query.type ?? (body.type as string);
    if (eventType !== 'payment' && body.action !== 'payment.updated' && body.action !== 'payment.created') {
      this.logger.log(`MP webhook type=${eventType} action=${body.action} — ignoring (not a payment event)`);
      return { received: true };
    }

    const ip = req.headers['x-forwarded-for']?.toString() ?? req.socket.remoteAddress ?? 'unknown';
    await this.quoteService.processPaymentNotification(String(paymentId), ip);
    return { received: true };
  }
}
