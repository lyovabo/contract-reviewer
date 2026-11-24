import express, { type ErrorRequestHandler } from 'express';
import type { ReviewService } from './domain/review-service';
import { apiRouter } from './routes/api-router';
import type { Logger } from './domain/review-service';
import type { SessionService } from './domain/sessions';

export function buildHttpApp(service: ReviewService, sessions: SessionService, log: Logger) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use('/api', apiRouter(service, sessions));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint' } });
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = typeof err?.status === 'number' && err.status < 500 ? err.status : 500;
    if (status === 500) log.error('unhandled error', err);
    res.status(status).json({
      error: { code: status === 500 ? 'internal_error' : 'invalid_request', message: status === 500 ? 'Internal error' : err.message },
    });
  };
  app.use(onError);
  return app;
}
