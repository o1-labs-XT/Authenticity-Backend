import pino from 'pino';

const isDevelopment = process.env.NODE_ENV === 'development';

// Create the main logger with simple configuration
export const logger = pino({
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  
  // Pretty print in development, JSON in production
  ...(isDevelopment && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    },
  }),
});

export type { Logger } from 'pino';