import { Params } from 'nestjs-pino';

export const pinoConfig: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL || 'info',
    genReqId: (req) =>
      (req.headers['x-correlation-id'] as string) ||
      require('crypto').randomUUID(),
    customProps: (req) => ({
      correlationId: (req as any).id,
      service: 'fiap-fase4-billing-service',
    }),
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
      ],
      remove: true,
    },
    autoLogging: {
      ignore: (req) => req.url === '/api/health',
    },
  },
};
