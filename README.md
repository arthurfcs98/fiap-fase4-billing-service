# Billing Service — Fase 4 Tech Challenge FIAP

Microsserviço de **orçamentos** e **pagamentos** com integração ao **Mercado Pago Checkout Pro**. Consome eventos da Saga (`os.saga.quote_requested`), gera preferência de pagamento no MP, retorna URL de checkout e reage aos webhooks do MP.

## Responsabilidades

- Escutar `os.saga.quote_requested` e criar `quote`
- Gerar preferência de pagamento no MP (Checkout Pro sandbox)
- Publicar `billing.saga.quote_generated` com a `checkoutUrl`
- Receber webhook do MP → consultar status do pagamento → publicar `quote_approved` ou `quote_rejected`
- Suportar rollback (`os.saga.compensating` → estorna se necessário → publica `billing.saga.compensated`)
- Endpoints manuais de aprovação/rejeição para teste (bypass do MP)

## Stack

- **NestJS 10** + TypeScript
- **PostgreSQL 16** via TypeORM (banco `billing_db`)
- **RabbitMQ** (consumer + publisher)
- **Mercado Pago SDK v2** (Preferences + Payments + Refunds via REST direto)

## Rodando localmente

Da raiz `~/dev/fiap-fase4`:
```bash
# Precisa das creds MP no .env raiz — copie de .env.example e preencha
docker compose up -d
open http://localhost:3012/api/docs
```

Endpoints:
| Método | Path | Descrição |
|---|---|---|
| GET | `/api/quotes` | Lista os 50 orçamentos mais recentes |
| GET | `/api/quotes/:id` | Detalha orçamento |
| POST | `/api/quotes/:id/approve` | Aprova manualmente (test only) |
| POST | `/api/quotes/:id/reject` | Rejeita manualmente (dispara rollback) |
| POST | `/api/webhooks/mercadopago` | Webhook MP (público) |

## Fluxo Saga

Quando OS Service publica `os.saga.quote_requested`:
1. Consumer salva `quote` com status `PENDING`
2. Chama MP → obtém `preferenceId` + `checkoutUrl` (sandbox)
3. Publica `billing.saga.quote_generated` com URL
4. Cliente paga no MP sandbox → MP chama webhook `/api/webhooks/mercadopago`
5. Consulta status do pagamento no MP → publica `quote_approved` OU `quote_rejected`

## Testes

```bash
npm run test           # 8 testes cobrindo QuoteService
npm run test:cov       # coverage 80%+ target
```

Cenários cobertos: idempotência do handler, MP falhando → rollback, aprovação manual, rejeição manual, webhook approved, webhook rejected.

## Mercado Pago — creds

Criar app em https://www.mercadopago.com.br/developers e pegar:
- `MERCADO_PAGO_ACCESS_TOKEN` (test / prod)
- `MERCADO_PAGO_PUBLIC_KEY`

Setar no `.env` local ou como Secret no K8s (`billing-service-secrets`).

Para webhook em dev: usar `ngrok http 3012` e apontar `MP_NOTIFICATION_URL` para o URL público.

## Deploy K8s

`k8s/deployment.yaml` — Deployment + Service + HPA + Ingress. Secrets injetados via CI (`billing-service-secrets`).

## Repositórios relacionados (Fase 4)

- [fiap-fase4-os-service](https://github.com/arthurfcs98/fiap-fase4-os-service)
- [fiap-fase4-execution-service](https://github.com/arthurfcs98/fiap-fase4-execution-service)
- [fiap-fase4-infra-k8s](https://github.com/arthurfcs98/fiap-fase4-infra-k8s)
- [fiap-fase4-infra-db](https://github.com/arthurfcs98/fiap-fase4-infra-db)
