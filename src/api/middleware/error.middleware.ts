import { Request, Response, NextFunction } from 'express';

/**
 * API error response - used across all handlers and middleware
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    field?: string;
  };
}

/**
 * Global error handling middleware
 * Catches all errors and formats them consistently
 */
export function errorMiddleware(
  error: any,
  req: Request,
  res: Response<ErrorResponse>,
  _next: NextFunction
): void {
  // Log the error
  console.error(`Error handling ${req.method} ${req.path}:`, error);

  // Default error response
  let statusCode = 500;
  let errorResponse: ErrorResponse = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  };

  // Handle different error types
  if (error.name === 'ValidationError') {
    statusCode = 400;
    errorResponse = {
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
      },
    };
  } else if (error.name === 'UnauthorizedError') {
    statusCode = 401;
    errorResponse = {
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    };
  } else if (error.name === 'ForbiddenError') {
    statusCode = 403;
    errorResponse = {
      error: {
        code: 'FORBIDDEN',
        message: 'Access denied',
      },
    };
  } else if (error.name === 'NotFoundError') {
    statusCode = 404;
    errorResponse = {
      error: {
        code: 'NOT_FOUND',
        message: error.message || 'Resource not found',
      },
    };
  } else if (error.code === 'SQLITE_CONSTRAINT') {
    statusCode = 409;
    errorResponse = {
      error: {
        code: 'CONFLICT',
        message: 'Resource already exists',
      },
    };
  } else if (error.code === 'LIMIT_FILE_SIZE') {
    statusCode = 413;
    errorResponse = {
      error: {
        code: 'FILE_TOO_LARGE',
        message: error.message || 'File size exceeds limit',
        field: 'image',
      },
    };
  } else if (error.message) {
    // Use the error message if available
    errorResponse.error.message = error.message;
  }

  // Add more details in development mode
  if (process.env.NODE_ENV === 'development') {
    console.error('Stack trace:', error.stack);
    // You could add stack trace to response in dev mode if needed
  }

  // Send error response
  res.status(statusCode).json(errorResponse);
}