import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const otlpEndpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];

if (otlpEndpoint) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SemanticResourceAttributes.SERVICE_NAME]:
        process.env['OTEL_SERVICE_NAME'] ?? 'fiap-fase4-billing-service',
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env['APP_VERSION'] ?? 'dev',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
        process.env['NODE_ENV'] ?? 'production',
    }),
    traceExporter: new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
  process.on('SIGTERM', () => {
    sdk.shutdown().catch((err) => console.error('OTel shutdown error', err));
  });
  // eslint-disable-next-line no-console
  console.log(`[otel] enabled, exporting to ${otlpEndpoint}`);
}
