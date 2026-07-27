export const OFICINA_EVENTS_EXCHANGE = 'oficina.events';
export const OFICINA_DLX = 'oficina.dlx';

export const BILLING_QUEUES = {
  OS_EVENTS: 'billing.os-events',
} as const;

export const ROUTING_KEYS = {
  // OS publishes (Billing consumes)
  QUOTE_REQUESTED: 'os.saga.quote_requested',
  COMPENSATING: 'os.saga.compensating',
  EXECUTION_STARTED: 'os.saga.execution_started',

  // Billing publishes
  QUOTE_GENERATED: 'billing.saga.quote_generated',
  QUOTE_APPROVED: 'billing.saga.quote_approved',
  QUOTE_REJECTED: 'billing.saga.quote_rejected',
  BILLING_COMPENSATED: 'billing.saga.compensated',

  // Execution publishes
  EXECUTION_COMPLETED: 'execution.saga.completed',
  EXECUTION_COMPENSATED: 'execution.saga.compensated',
} as const;

export const BINDINGS = {
  OS_EVENTS: ['os.saga.quote_requested', 'os.saga.compensating'],
} as const;
