import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Quote } from '../../domain/entities/quote.entity';
import { QuoteOrmEntity } from '../entities/quote.orm-entity';

@Injectable()
export class QuoteRepository {
  constructor(
    @InjectRepository(QuoteOrmEntity)
    private readonly repository: Repository<QuoteOrmEntity>,
  ) {}

  async create(data: Partial<Quote>): Promise<Quote> {
    const entity = this.repository.create(data);
    return this.repository.save(entity) as unknown as Promise<Quote>;
  }

  async update(id: string, data: Partial<Quote>): Promise<void> {
    await this.repository.update(id, data as any);
  }

  async findById(id: string): Promise<Quote | null> {
    return this.repository.findOne({ where: { id } }) as unknown as Promise<Quote | null>;
  }

  async findBySagaId(sagaId: string): Promise<Quote | null> {
    return this.repository.findOne({ where: { sagaId } }) as unknown as Promise<Quote | null>;
  }

  async findByExternalReference(externalReference: string): Promise<Quote | null> {
    return this.repository.findOne({
      where: { externalReference },
    }) as unknown as Promise<Quote | null>;
  }

  async findAll(limit = 50): Promise<Quote[]> {
    return this.repository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    }) as unknown as Promise<Quote[]>;
  }
}
