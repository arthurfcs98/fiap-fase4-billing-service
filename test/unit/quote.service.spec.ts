import { ConfigService } from '@nestjs/config';
import { QuoteService } from '@/modules/quote/application/services/quote.service';
import { QuoteStatus } from '@/modules/quote/domain/entities/quote.entity';

class InMemoryQuoteRepo {
  private store = new Map<string, any>();
  private counter = 0;

  async create(data: any) {
    const id = `q-${++this.counter}`;
    const q = { id, createdAt: new Date(), updatedAt: new Date(), ...data };
    this.store.set(id, q);
    return q;
  }

  async update(id: string, data: any) {
    const existing = this.store.get(id);
    if (existing) Object.assign(existing, data);
  }

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }

  async findBySagaId(sagaId: string) {
    for (const q of this.store.values()) if (q.sagaId === sagaId) return q;
    return null;
  }

  async findByExternalReference(ref: string) {
    for (const q of this.store.values()) if (q.externalReference === ref) return q;
    return null;
  }

  async findAll() {
    return Array.from(this.store.values());
  }
}

class InMemoryRabbitMQ {
  published: Array<{ routingKey: string; payload: any }> = [];
  async publish(routingKey: string, payload: any) {
    this.published.push({ routingKey, payload });
  }
}

class FakeMercadoPago {
  createCheckoutPreference = jest.fn().mockResolvedValue({
    preferenceId: 'pref-1',
    checkoutUrl: 'https://mp/checkout',
    sandboxCheckoutUrl: 'https://mp/sandbox',
  });
  fetchPayment = jest.fn();
  refundPayment = jest.fn().mockResolvedValue(undefined);
}

const config = new ConfigService({});

const baseEvent = {
  sagaId: 'saga-1',
  serviceOrderId: 'os-1',
  customer: { id: 'c-1', name: 'Arthur', document: '11144477735', email: 'a@a.com' },
  vehicle: { id: 'v-1', plate: 'ABC1234', description: 'Corolla' },
  items: [
    {
      kind: 'SERVICE' as const,
      referenceId: 'svc-1',
      description: 'Troca óleo',
      quantity: 1,
      unitPrice: 150,
      subtotal: 150,
    },
  ],
  totalAmount: 150,
};

describe('QuoteService', () => {
  let service: QuoteService;
  let repo: InMemoryQuoteRepo;
  let rabbit: InMemoryRabbitMQ;
  let mp: FakeMercadoPago;

  beforeEach(() => {
    repo = new InMemoryQuoteRepo();
    rabbit = new InMemoryRabbitMQ();
    mp = new FakeMercadoPago();
    service = new QuoteService(repo as any, mp as any, rabbit as any, config);
  });

  it('creates a quote on QUOTE_REQUESTED, calls MP, publishes QUOTE_GENERATED', async () => {
    await service.handleQuoteRequested(baseEvent);
    const q = await repo.findBySagaId('saga-1');
    expect(q).toBeTruthy();
    expect(q!.status).toBe(QuoteStatus.PENDING);
    expect(q!.checkoutUrl).toBe('https://mp/checkout');
    expect(mp.createCheckoutPreference).toHaveBeenCalledTimes(1);
    expect(rabbit.published[0].routingKey).toBe('billing.saga.quote_generated');
  });

  it('is idempotent — second QUOTE_REQUESTED for same saga is a no-op', async () => {
    await service.handleQuoteRequested(baseEvent);
    await service.handleQuoteRequested(baseEvent);
    const all = await repo.findAll();
    expect(all).toHaveLength(1);
    expect(mp.createCheckoutPreference).toHaveBeenCalledTimes(1);
  });

  it('publishes QUOTE_REJECTED when MP call fails', async () => {
    mp.createCheckoutPreference.mockRejectedValueOnce(new Error('MP timeout'));
    await service.handleQuoteRequested(baseEvent);
    const q = await repo.findBySagaId('saga-1');
    expect(q!.status).toBe(QuoteStatus.REJECTED);
    expect(rabbit.published.some((p) => p.routingKey === 'billing.saga.quote_rejected')).toBe(true);
  });

  it('manuallyApprove publishes QUOTE_APPROVED', async () => {
    await service.handleQuoteRequested(baseEvent);
    const q = await repo.findBySagaId('saga-1');
    rabbit.published = [];
    await service.manuallyApprove(q!.id);
    expect(rabbit.published[0].routingKey).toBe('billing.saga.quote_approved');
    const updated = await repo.findById(q!.id);
    expect(updated!.status).toBe(QuoteStatus.APPROVED);
  });

  it('manuallyReject publishes QUOTE_REJECTED', async () => {
    await service.handleQuoteRequested(baseEvent);
    const q = await repo.findBySagaId('saga-1');
    rabbit.published = [];
    await service.manuallyReject(q!.id, 'Motivo X');
    expect(rabbit.published[0].routingKey).toBe('billing.saga.quote_rejected');
    const updated = await repo.findById(q!.id);
    expect(updated!.status).toBe(QuoteStatus.REJECTED);
    expect(updated!.rejectionReason).toBe('Motivo X');
  });

  it('handleCompensating marks quote COMPENSATED and publishes BILLING_COMPENSATED', async () => {
    await service.handleQuoteRequested(baseEvent);
    rabbit.published = [];
    await service.handleCompensating('saga-1');
    const q = await repo.findBySagaId('saga-1');
    expect(q!.status).toBe(QuoteStatus.COMPENSATED);
    expect(rabbit.published[0].routingKey).toBe('billing.saga.compensated');
  });

  it('processPaymentNotification with approved status publishes QUOTE_APPROVED', async () => {
    await service.handleQuoteRequested(baseEvent);
    const q = await repo.findBySagaId('saga-1');
    mp.fetchPayment.mockResolvedValueOnce({
      id: 'mp-pay-1',
      status: 'approved',
      externalReference: q!.externalReference,
      transactionAmount: 150,
    });
    rabbit.published = [];
    await service.processPaymentNotification('mp-pay-1');
    expect(rabbit.published[0].routingKey).toBe('billing.saga.quote_approved');
  });

  it('processPaymentNotification with rejected status publishes QUOTE_REJECTED', async () => {
    await service.handleQuoteRequested(baseEvent);
    const q = await repo.findBySagaId('saga-1');
    mp.fetchPayment.mockResolvedValueOnce({
      id: 'mp-pay-1',
      status: 'rejected',
      statusDetail: 'cc_rejected',
      externalReference: q!.externalReference,
    });
    rabbit.published = [];
    await service.processPaymentNotification('mp-pay-1');
    expect(rabbit.published[0].routingKey).toBe('billing.saga.quote_rejected');
  });
});
