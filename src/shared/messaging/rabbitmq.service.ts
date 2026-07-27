import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqp-connection-manager';
import { ChannelWrapper } from 'amqp-connection-manager';
import { Channel, ConsumeMessage } from 'amqplib';
import { randomUUID } from 'crypto';
import { OFICINA_DLX, OFICINA_EVENTS_EXCHANGE } from './messaging.constants';

export interface PublishOptions {
  correlationId?: string;
  messageId?: string;
}

export interface ConsumerHandler {
  queue: string;
  bindings: string[];
  handle: (payload: unknown, raw: ConsumeMessage) => Promise<void>;
}

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);
  private connection!: amqp.AmqpConnectionManager;
  private publishChannel!: ChannelWrapper;
  private consumerChannels: ChannelWrapper[] = [];

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const url = this.configService.get<string>(
      'RABBITMQ_URL',
      'amqp://guest:guest@localhost:5672',
    );

    this.connection = amqp.connect([url], {
      heartbeatIntervalInSeconds: 15,
      reconnectTimeInSeconds: 5,
    });

    this.connection.on('connect', () =>
      this.logger.log(`Connected to RabbitMQ at ${url.replace(/\/\/.*@/, '//***@')}`),
    );
    this.connection.on('disconnect', ({ err }) =>
      this.logger.warn(`RabbitMQ disconnected: ${err?.message ?? 'unknown'}`),
    );

    this.publishChannel = this.connection.createChannel({
      json: true,
      setup: async (ch: Channel) => {
        await ch.assertExchange(OFICINA_EVENTS_EXCHANGE, 'topic', {
          durable: true,
        });
        await ch.assertExchange(OFICINA_DLX, 'topic', { durable: true });
      },
    });

    await this.publishChannel.waitForConnect();
  }

  async onModuleDestroy() {
    for (const ch of this.consumerChannels) {
      await ch.close();
    }
    await this.publishChannel?.close();
    await this.connection?.close();
  }

  async publish<T>(
    routingKey: string,
    payload: T,
    options: PublishOptions = {},
  ): Promise<void> {
    const messageId = options.messageId ?? randomUUID();
    const correlationId = options.correlationId ?? randomUUID();

    await this.publishChannel.publish(
      OFICINA_EVENTS_EXCHANGE,
      routingKey,
      payload,
      {
        persistent: true,
        messageId,
        correlationId,
        contentType: 'application/json',
        headers: {
          'x-correlation-id': correlationId,
        },
      },
    );

    this.logger.debug(
      `Published ${routingKey} (msg=${messageId}, corr=${correlationId})`,
    );
  }

  registerConsumer(handler: ConsumerHandler): void {
    const channel = this.connection.createChannel({
      json: true,
      setup: async (ch: Channel) => {
        const dlqName = `dlq.${handler.queue}`;
        await ch.assertQueue(dlqName, {
          durable: true,
          arguments: { 'x-message-ttl': 7 * 24 * 60 * 60 * 1000 },
        });
        await ch.bindQueue(dlqName, OFICINA_DLX, handler.queue);

        await ch.assertQueue(handler.queue, {
          durable: true,
          arguments: {
            'x-dead-letter-exchange': OFICINA_DLX,
            'x-dead-letter-routing-key': handler.queue,
          },
        });

        for (const binding of handler.bindings) {
          await ch.bindQueue(handler.queue, OFICINA_EVENTS_EXCHANGE, binding);
        }

        await ch.prefetch(10);
        await ch.consume(handler.queue, async (msg) => {
          if (!msg) return;
          try {
            const payload = JSON.parse(msg.content.toString());
            await handler.handle(payload, msg);
            ch.ack(msg);
          } catch (err) {
            const attempts = (msg.properties.headers?.['x-attempts'] ?? 0) + 1;
            const error = err as Error;
            this.logger.error(
              `Consumer ${handler.queue} failed (attempt ${attempts}): ${error.message}`,
              error.stack,
            );
            // After 3 attempts, drop to DLQ
            const shouldRequeue = attempts < 3;
            ch.nack(msg, false, shouldRequeue);
          }
        });
      },
    });

    this.consumerChannels.push(channel);
  }
}
