import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Redirect,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { QuoteService } from '../../application/services/quote.service';

@ApiTags('Quotes')
@Controller('quotes')
export class QuoteController {
  constructor(private readonly quoteService: QuoteService) {}

  @Get()
  @ApiOperation({ summary: 'Lista os 50 orçamentos mais recentes' })
  async list() {
    const items = await this.quoteService.listRecent();
    return { data: items, total: items.length };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha um orçamento' })
  async findById(@Param('id') id: string) {
    const quote = await this.quoteService.findById(id);
    if (!quote) throw new NotFoundException(`Quote ${id} not found`);
    return quote;
  }

  @Post(':id/approve')
  @ApiOperation({
    summary: 'Aprova orçamento manualmente (bypass do Mercado Pago — uso de teste)',
    description:
      'Simula a aprovação do cliente sem passar pelo checkout MP. Útil para testes e demo do fluxo happy path da Saga.',
  })
  async approve(@Param('id') id: string) {
    return this.quoteService.manuallyApprove(id);
  }

  @Post(':id/reject')
  @ApiOperation({
    summary: 'Rejeita orçamento manualmente (bypass do MP — dispara rollback da Saga)',
  })
  async reject(@Param('id') id: string, @Body() body?: { reason?: string }) {
    return this.quoteService.manuallyReject(id, body?.reason ?? 'Cliente rejeitou orçamento');
  }

  @Get('callback/success')
  @Redirect()
  callbackSuccess(@Query() query: Record<string, string>) {
    // Redirect the customer back somewhere friendly after payment success.
    // In production, this would be the customer portal URL.
    return {
      url: `/api/quotes/callback/message?status=success&${new URLSearchParams(query).toString()}`,
    };
  }

  @Get('callback/failure')
  @Redirect()
  callbackFailure(@Query() query: Record<string, string>) {
    return {
      url: `/api/quotes/callback/message?status=failure&${new URLSearchParams(query).toString()}`,
    };
  }

  @Get('callback/pending')
  @Redirect()
  callbackPending(@Query() query: Record<string, string>) {
    return {
      url: `/api/quotes/callback/message?status=pending&${new URLSearchParams(query).toString()}`,
    };
  }

  @Get('callback/message')
  callbackMessage(@Query() query: Record<string, string>) {
    return {
      status: query.status,
      params: query,
      message: 'Fechamento do checkout do Mercado Pago. O status final da OS será propagado via webhook + Saga.',
    };
  }
}
