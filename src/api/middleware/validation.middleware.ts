import { Request, Response, NextFunction } from 'express';

/**
 * Validate SHA256 hash parameter
 */
export function validateSHA256Hash(paramName: string = 'sha256Hash') {
  return (req: Request, res: Response, next: NextFunction) => {
    const hash = req.params[paramName];
    
    if (!hash) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: `${paramName} is required`,
          field: paramName,
        },
      });
    }

    // SHA256 hash should be 64 hexadecimal characters
    if (!/^[a-fA-F0-9]{64}$/.test(hash)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid SHA256 hash format',
          field: paramName,
        },
      });
    }

    next();
  };
}

/**
 * Validate Base58 encoded string (for public keys and signatures)
 */
export function validateBase58(fieldName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = req.body[fieldName];
    
    if (!value) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: `${fieldName} is required`,
          field: fieldName,
        },
      });
    }

    // Base58 check (simplified - Mina addresses/keys have specific format)
    // This is a basic check, the actual validation happens when parsing
    if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid ${fieldName} format`,
          field: fieldName,
        },
      });
    }

    next();
  };
}

/**
 * Rate limiting middleware (simple in-memory implementation)
 * For production, use redis-based rate limiting
 */
const requestCounts = new Map<string, { count: number; resetTime: number }>();

export function rateLimitMiddleware(
  maxRequests: number = 100,
  windowMs: number = 60000 // 1 minute
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    
    const record = requestCounts.get(ip);
    
    if (!record || record.resetTime < now) {
      // Create new record or reset expired one
      requestCounts.set(ip, {
        count: 1,
        resetTime: now + windowMs,
      });
      return next();
    }
    
    if (record.count >= maxRequests) {
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests, please try again later',
          retryable: true,
        },
      });
    }
    
    record.count++;
    next();
  };
}

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of requestCounts.entries()) {
    if (record.resetTime < now) {
      requestCounts.delete(ip);
    }
  }
}, 60000); // Clean up every minute