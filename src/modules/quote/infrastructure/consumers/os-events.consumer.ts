import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { RabbitMQService } from '@/shared/messaging/rabbitmq.service';
import {
  BILLING_QUEUES,
  BINDINGS,
  ROUTING_KEYS,
} from '@/shared/messaging/messaging.constants';
import {
  QuoteRequestedEvent,
  QuoteService,
} from '../../application/services/quote.service';

@Injectable()
export class OsEventsConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(OsEventsConsumer.name);

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly quoteService: QuoteService,
  ) {}

  onApplicationBootstrap(): void {
    this.rabbitmq.registerConsumer({
      queue: BILLING_QUEUES.OS_EVENTS,
      bindings: [...BINDINGS.OS_EVENTS],
      handle: async (raw, msg) => {
        const routingKey = msg.fields.routingKey;
        const payload = raw as Record<string, unknown>;

        switch (routingKey) {
          case ROUTING_KEYS.QUOTE_REQUESTED:
            await this.quoteService.handleQuoteRequested(
              payload as unknown as QuoteRequestedEvent,
            );
            break;
          case ROUTING_KEYS.COMPENSATING: {
            const sagaId = (payload as { sagaId?: string }).sagaId;
            if (sagaId) await this.quoteService.handleCompensating(sagaId);
            break;
          }
          default:
            this.logger.warn(`Unhandled routing key ${routingKey}`);
        }
      },
    });

    this.logger.log('OsEventsConsumer registered');
  }
}
