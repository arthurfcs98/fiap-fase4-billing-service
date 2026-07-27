import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { RabbitMQService } from '@/shared/messaging/rabbitmq.service';
import { ROUTING_KEYS } from '@/shared/messaging/messaging.constants';
import { QuoteRepository } from '../../infrastructure/repositories/quote.repository';
import { MercadoPagoGateway } from '@/modules/payment/infrastructure/gateways/mercado-pago.gateway';
import {
  Quote,
  QuoteItem,
  QuoteStatus,
} from '../../domain/entities/quote.entity';

export interface QuoteRequestedEvent {
  sagaId: string;
  serviceOrderId: string;
  customer: {
    id: string;
    name: string;
    document: string;
    email?: string;
  };
  vehicle: { id: string; plate: string; description: string };
  items: QuoteItem[];
  totalAmount: number;
}

@Injectable()
export class QuoteService {
  private readonly logger = new Logger(QuoteService.name);

  constructor(
    private readonly quoteRepository: QuoteRepository,
    private readonly mercadoPagoGateway: MercadoPagoGateway,
    private readonly rabbitmq: RabbitMQService,
    private readonly configService: ConfigService,
  ) {}

  async handleQuoteRequested(event: QuoteRequestedEvent): Promise<void> {
    const existing = await this.quoteRepository.findBySagaId(event.sagaId);
    if (existing) {
      this.logger.warn(
        `Duplicate quote_requested for saga ${event.sagaId} — skipping (idempotent)`,
      );
      return;
    }

    const externalReference = `quote-${event.sagaId}`;

    const quote = await this.quoteRepository.create({
      sagaId: event.sagaId,
      serviceOrderId: event.serviceOrderId,
      customerId: event.customer.id,
      customerName: event.customer.name,
      customerDocument: event.customer.document,
      customerEmail: event.customer.email,
      status: QuoteStatus.PENDING,
      items: event.items,
      totalAmount: event.totalAmount,
      externalReference,
    });

    try {
      const notificationUrl = this.configService.get<string>(
        'MP_NOTIFICATION_URL',
        'http://localhost:3002/api/webhooks/mercadopago',
      );
      const successUrl = this.configService.get<string>(
        'MP_SUCCESS_URL',
        'http://localhost:3002/api/quotes/callback/success',
      );
      const failureUrl = this.configService.get<string>(
        'MP_FAILURE_URL',
        'http://localhost:3002/api/quotes/callback/failure',
      );
      const pendingUrl = this.configService.get<string>(
        'MP_PENDING_URL',
        'http://localhost:3002/api/quotes/callback/pending',
      );

      const preference = await this.mercadoPagoGateway.createCheckoutPreference({
        externalReference,
        items: event.items,
        payerEmail: event.customer.email,
        payerName: event.customer.name,
        notificationUrl,
        successUrl,
        failureUrl,
        pendingUrl,
      });

      // Usa o init_point (URL de produção). Mesmo com creds test, esse URL
      // funciona e evita bugs de redirect que o sandbox_init_point apresenta.
      const checkoutUrl = preference.checkoutUrl;

      await this.quoteRepository.update(quote.id, {
        mpPreferenceId: preference.preferenceId,
        checkoutUrl,
      });

      await this.rabbitmq.publish(
        ROUTING_KEYS.QUOTE_GENERATED,
        {
          sagaId: event.sagaId,
          quoteId: quote.id,
          checkoutUrl,
          externalReference,
        },
        { correlationId: event.sagaId },
      );

      this.logger.log(
        `Quote ${quote.id} generated for saga ${event.sagaId} (checkout ${checkoutUrl})`,
      );
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `Failed to create MP preference for saga ${event.sagaId}: ${error.message}`,
        error.stack,
      );
      await this.quoteRepository.update(quote.id, {
        status: QuoteStatus.REJECTED,
        rejectionReason: `MP gateway error: ${error.message}`,
      });
      await this.rabbitmq.publish(
        ROUTING_KEYS.QUOTE_REJECTED,
        {
          sagaId: event.sagaId,
          quoteId: quote.id,
          reason: `Falha ao gerar checkout no Mercado Pago: ${error.message}`,
        },
        { correlationId: event.sagaId },
      );
    }
  }

  async handleCompensating(sagaId: string): Promise<void> {
    const quote = await this.quoteRepository.findBySagaId(sagaId);
    if (!quote) {
      this.logger.warn(`Compensating for unknown saga ${sagaId}`);
      return;
    }

    // If quote already had a payment, issue a refund
    // (In test/sandbox we may not have a paymentId yet.)
    if (quote.status === QuoteStatus.APPROVED) {
      const paymentId = (quote as any).mpPaymentId;
      if (paymentId) {
        try {
          await this.mercadoPagoGateway.refundPayment(paymentId);
        } catch (err) {
          this.logger.error(`Refund failed: ${(err as Error).message}`);
        }
      }
    }

    await this.quoteRepository.update(quote.id, {
      status: QuoteStatus.COMPENSATED,
    });

    await this.rabbitmq.publish(
      ROUTING_KEYS.BILLING_COMPENSATED,
      {
        sagaId,
        quoteId: quote.id,
        refunded: quote.status === QuoteStatus.APPROVED,
      },
      { correlationId: sagaId },
    );
  }

  async processPaymentNotification(paymentId: string, ipAddress?: string): Promise<void> {
    const payment = await this.mercadoPagoGateway.fetchPayment(paymentId);
    if (!payment.externalReference) {
      this.logger.warn(
        `MP notification for payment ${paymentId} has no external_reference — ignoring`,
      );
      return;
    }

    const quote = await this.quoteRepository.findByExternalReference(
      payment.externalReference,
    );
    if (!quote) {
      this.logger.warn(
        `No quote found for external_reference ${payment.externalReference}`,
      );
      return;
    }

    this.logger.log(
      `Payment ${paymentId} status=${payment.status} for quote ${quote.id} (src=${ipAddress ?? 'unknown'})`,
    );

    if (payment.status === 'approved') {
      await this.quoteRepository.update(quote.id, {
        status: QuoteStatus.APPROVED,
      });
      await this.rabbitmq.publish(
        ROUTING_KEYS.QUOTE_APPROVED,
        {
          sagaId: quote.sagaId,
          quoteId: quote.id,
          paymentId: payment.id,
          amount: payment.transactionAmount ?? Number(quote.totalAmount),
        },
        { correlationId: quote.sagaId },
      );
    } else if (payment.status === 'rejected' || payment.status === 'cancelled') {
      await this.quoteRepository.update(quote.id, {
        status: QuoteStatus.REJECTED,
        rejectionReason: `MP status=${payment.status} detail=${payment.statusDetail}`,
      });
      await this.rabbitmq.publish(
        ROUTING_KEYS.QUOTE_REJECTED,
        {
          sagaId: quote.sagaId,
          quoteId: quote.id,
          reason: `Pagamento rejeitado no Mercado Pago (${payment.statusDetail ?? payment.status})`,
        },
        { correlationId: quote.sagaId },
      );
    } else {
      // pending / in_process — just log
      this.logger.log(`Payment ${paymentId} still pending — waiting for next webhook`);
    }
  }

  // Manual test helper: pretends the customer clicked "Approve" without going to MP
  async manuallyApprove(quoteId: string): Promise<Quote> {
    const quote = await this.quoteRepository.findById(quoteId);
    if (!quote) throw new Error(`Quote ${quoteId} not found`);
    await this.quoteRepository.update(quote.id, { status: QuoteStatus.APPROVED });
    const fakePaymentId = `MANUAL-${randomUUID()}`;
    await this.rabbitmq.publish(
      ROUTING_KEYS.QUOTE_APPROVED,
      {
        sagaId: quote.sagaId,
        quoteId: quote.id,
        paymentId: fakePaymentId,
        amount: Number(quote.totalAmount),
      },
      { correlationId: quote.sagaId },
    );
    return (await this.quoteRepository.findById(quoteId))!;
  }

  async manuallyReject(quoteId: string, reason = 'Manual rejection'): Promise<Quote> {
    const quote = await this.quoteRepository.findById(quoteId);
    if (!quote) throw new Error(`Quote ${quoteId} not found`);
    await this.quoteRepository.update(quote.id, {
      status: QuoteStatus.REJECTED,
      rejectionReason: reason,
    });
    await this.rabbitmq.publish(
      ROUTING_KEYS.QUOTE_REJECTED,
      {
        sagaId: quote.sagaId,
        quoteId: quote.id,
        reason,
      },
      { correlationId: quote.sagaId },
    );
    return (await this.quoteRepository.findById(quoteId))!;
  }

  async listRecent(limit = 50): Promise<Quote[]> {
    return this.quoteRepository.findAll(limit);
  }

  async findById(id: string): Promise<Quote | null> {
    return this.quoteRepository.findById(id);
  }
}
