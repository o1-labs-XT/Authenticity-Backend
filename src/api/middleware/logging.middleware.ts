import { Request, Response, NextFunction } from 'express';

/**
 * Request logging middleware
 * Logs incoming requests and response times
 */
export function loggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const startTime = Date.now();
  const { method, path, ip } = req;

  // Log request
  console.log(`[${new Date().toISOString()}] ${method} ${path} - IP: ${ip}`);

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const { statusCode } = res;
    
    const logLevel = statusCode >= 500 ? 'ERROR' : 
                     statusCode >= 400 ? 'WARN' : 
                     'INFO';
    
    console.log(
      `[${new Date().toISOString()}] ${logLevel}: ${method} ${path} - Status: ${statusCode} - Duration: ${duration}ms`
    );
  });

  next();
}