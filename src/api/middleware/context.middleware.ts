import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { withContext } from '../../utils/logger.js';

/**
 * Middleware to add logging context to all requests
 * correlationId will be attached to jobs
 */
export const contextMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();

  // Store correlationId on request for passing to jobs
  (req as Request & { correlationId: string }).correlationId = correlationId;

  // Run the rest of the request with context
  withContext({ correlationId }, () => next());
};
