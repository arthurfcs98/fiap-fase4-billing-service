import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { QuoteItem, QuoteStatus } from '../../domain/entities/quote.entity';

@Entity('quotes')
export class QuoteOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'saga_id', type: 'uuid' })
  sagaId!: string;

  @Index()
  @Column({ name: 'service_order_id', type: 'uuid' })
  serviceOrderId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'customer_name', type: 'varchar', length: 200 })
  customerName!: string;

  @Column({ name: 'customer_document', type: 'varchar', length: 20 })
  customerDocument!: string;

  @Column({ name: 'customer_email', type: 'varchar', length: 200, nullable: true })
  customerEmail?: string;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  status!: QuoteStatus;

  @Column({ type: 'jsonb' })
  items!: QuoteItem[];

  @Column({ name: 'total_amount', type: 'numeric', precision: 12, scale: 2 })
  totalAmount!: number;

  @Column({ name: 'mp_preference_id', type: 'varchar', length: 100, nullable: true })
  mpPreferenceId?: string;

  @Column({ name: 'checkout_url', type: 'text', nullable: true })
  checkoutUrl?: string;

  @Index({ unique: true })
  @Column({ name: 'external_reference', type: 'varchar', length: 100 })
  externalReference!: string;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
