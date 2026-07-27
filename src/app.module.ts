import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { pinoConfig } from './shared/observability/pino.config';
import { MessagingModule } from './shared/messaging/messaging.module';
import { QuoteModule } from './modules/quote/quote.module';
import { PaymentModule } from './modules/payment/payment.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
    }),
    LoggerModule.forRoot(pinoConfig),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const env = configService.get('NODE_ENV');
        const isTest = env === 'test';
        const sslEnabled =
          String(configService.get('DB_SSL', 'false')).toLowerCase() === 'true';
        return {
          type: 'postgres' as const,
          host: configService.get<string>('DB_HOST', 'localhost'),
          port: configService.get<number>('DB_PORT', 5432),
          username: configService.get<string>('DB_USERNAME', 'postgres'),
          password: configService.get<string>('DB_PASSWORD', 'postgres'),
          database: configService.get<string>('DB_DATABASE', 'billing_db'),
          entities: [__dirname + '/**/*.orm-entity{.ts,.js}'],
          synchronize: isTest || env === 'development',
          migrationsRun: false,
          logging: !isTest && env === 'development',
          ssl: sslEnabled ? { rejectUnauthorized: false } : false,
        };
      },
      inject: [ConfigService],
    }),
    MessagingModule,
    QuoteModule,
    PaymentModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
