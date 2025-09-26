import { Request, Response, NextFunction } from 'express';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { ApiError } from '../../utils/errors.js';

/**
 * REST API Error Response Format
 */
export interface ErrorResponse {
  error: {
    message: string;
    field?: string;
  };
}

/**
 * Generic Error Handling Middleware
 *
 * This middleware ONLY knows about ApiError.
 * All library-specific errors should be converted to ApiError at their source.
 */
export function errorMiddleware(
  error: unknown,
  req: Request,
  res: Response<ErrorResponse>,
  _next: NextFunction
): void {
  // Log all errors
  logger.error(
    {
      err: error,
      method: req.method,
      path: req.path,
      query: req.query,
      body: req.body,
    },
    'Request error'
  );

  // user facing errors
  if (error instanceof ApiError) {
    res.status(error.statusCode).json({
      error: {
        message: error.message,
        field: error.field,
      },
    });
    return;
  }

  // For any other error, return 500
  // In production, hide error details
  const message =
    config.nodeEnv === 'production'
      ? 'Internal server error'
      : error instanceof Error
        ? error.message
        : 'Unknown error';

  res.status(500).json({
    error: {
      message,
    },
  });
}
