import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuoteOrmEntity } from './infrastructure/entities/quote.orm-entity';
import { QuoteRepository } from './infrastructure/repositories/quote.repository';
import { QuoteService } from './application/services/quote.service';
import { OsEventsConsumer } from './infrastructure/consumers/os-events.consumer';
import { QuoteController } from './interfaces/controllers/quote.controller';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([QuoteOrmEntity]),
    forwardRef(() => PaymentModule),
  ],
  providers: [QuoteRepository, QuoteService, OsEventsConsumer],
  controllers: [QuoteController],
  exports: [QuoteService, QuoteRepository],
})
export class QuoteModule {}
