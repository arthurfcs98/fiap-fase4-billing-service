import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import { QuoteItem } from '@/modules/quote/domain/entities/quote.entity';

export interface CreatePreferenceInput {
  externalReference: string;
  items: QuoteItem[];
  payerEmail?: string;
  payerName?: string;
  notificationUrl: string;
  successUrl: string;
  failureUrl: string;
  pendingUrl: string;
}

export interface CreatePreferenceOutput {
  preferenceId: string;
  checkoutUrl: string;
  sandboxCheckoutUrl?: string;
}

export interface PaymentDetails {
  id: string;
  status: 'approved' | 'pending' | 'rejected' | 'cancelled' | 'in_process' | string;
  statusDetail?: string;
  externalReference?: string;
  transactionAmount?: number;
  paidAt?: string;
}

@Injectable()
export class MercadoPagoGateway implements OnModuleInit {
  private readonly logger = new Logger(MercadoPagoGateway.name);
  private client!: MercadoPagoConfig;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const accessToken = this.configService.get<string>('MERCADO_PAGO_ACCESS_TOKEN');
    if (!accessToken) {
      this.logger.warn(
        'MERCADO_PAGO_ACCESS_TOKEN not set — MP gateway calls will fail. Set it in .env.',
      );
      return;
    }
    this.client = new MercadoPagoConfig({
      accessToken,
      options: { timeout: 10_000 },
    });
    this.logger.log('Mercado Pago client initialized (sandbox/test mode expected)');
  }

  async createCheckoutPreference(
    input: CreatePreferenceInput,
  ): Promise<CreatePreferenceOutput> {
    if (!this.client) {
      throw new Error('Mercado Pago client not initialized (missing access token)');
    }

    const preference = new Preference(this.client);

    const response = await preference.create({
      body: {
        external_reference: input.externalReference,
        items: input.items.map((it, idx) => ({
          id: `${input.externalReference}-${idx}`,
          title: it.description,
          quantity: it.quantity,
          unit_price: Number(it.unitPrice.toFixed(2)),
          currency_id: 'BRL',
          description: `${it.kind}: ${it.referenceId}`,
        })),
        payer: input.payerEmail
          ? { email: input.payerEmail, name: input.payerName }
          : undefined,
        back_urls: {
          success: input.successUrl,
          failure: input.failureUrl,
          pending: input.pendingUrl,
        },
        // auto_return exige back_urls públicas (não localhost). Só ativa quando
        // MP_AUTO_RETURN=true no env — deixe off em dev, ligue em prod atrás de ngrok/API GW.
        ...(process.env['MP_AUTO_RETURN'] === 'true'
          ? { auto_return: 'approved' as const }
          : {}),
        notification_url: input.notificationUrl,
        statement_descriptor: 'OFICINA-FIAP',
        metadata: { external_reference: input.externalReference },
      },
    });

    if (!response.id || !response.init_point) {
      throw new Error(
        `Mercado Pago response missing id/init_point: ${JSON.stringify(response)}`,
      );
    }

    this.logger.log(
      `MP preference created id=${response.id} external_ref=${input.externalReference}`,
    );

    return {
      preferenceId: response.id,
      checkoutUrl: response.init_point,
      sandboxCheckoutUrl: response.sandbox_init_point,
    };
  }

  async fetchPayment(paymentId: string): Promise<PaymentDetails> {
    if (!this.client) {
      throw new Error('Mercado Pago client not initialized (missing access token)');
    }
    const payment = new Payment(this.client);
    const response = await payment.get({ id: paymentId });

    return {
      id: String(response.id),
      status: response.status ?? 'pending',
      statusDetail: response.status_detail ?? undefined,
      externalReference: response.external_reference ?? undefined,
      transactionAmount: response.transaction_amount ?? undefined,
      paidAt: response.date_approved ?? undefined,
    };
  }

  async refundPayment(paymentId: string, amount?: number): Promise<void> {
    if (!this.client) {
      throw new Error('Mercado Pago client not initialized');
    }
    // Estorno é feito via API v1 — usamos fetch direto pois o SDK v2 ainda
    // não expõe wrapper. Endpoint: POST /v1/payments/{id}/refunds
    const accessToken = this.configService.get<string>('MERCADO_PAGO_ACCESS_TOKEN');
    const body = amount ? JSON.stringify({ amount }) : '{}';
    const res = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}/refunds`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': `refund-${paymentId}-${Date.now()}`,
        },
        body,
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`MP refund failed (${res.status}): ${text}`);
    }
    this.logger.log(`MP refund issued for payment ${paymentId}`);
  }
}
