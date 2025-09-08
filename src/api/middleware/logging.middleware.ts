import pinoHttp from 'pino-http';
import { logger } from '../../utils/logger.js';

/**
 * HTTP request/response logging middleware
 */
export const loggingMiddleware = pinoHttp({
  logger,
  
  // Customize log level based on status code
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  
  // Simplify serializers to reduce verbosity
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      // Only include essential headers
      headers: {
        'user-agent': req.headers['user-agent'],
        'content-type': req.headers['content-type'],
      },
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
  
  // Redact sensitive headers
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});