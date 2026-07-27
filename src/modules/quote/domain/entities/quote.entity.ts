export enum QuoteStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  COMPENSATED = 'COMPENSATED',
}

export interface QuoteItem {
  kind: 'SERVICE' | 'PART';
  referenceId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export class Quote {
  id!: string;
  sagaId!: string;
  serviceOrderId!: string;
  customerId!: string;
  customerName!: string;
  customerDocument!: string;
  customerEmail?: string;
  status!: QuoteStatus;
  items!: QuoteItem[];
  totalAmount!: number;
  mpPreferenceId?: string;
  checkoutUrl?: string;
  externalReference!: string;
  rejectionReason?: string;
  createdAt!: Date;
  updatedAt!: Date;
}
