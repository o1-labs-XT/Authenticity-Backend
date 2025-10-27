import pino from 'pino';
import { AsyncLocalStorage } from 'async_hooks';
import { config } from '../config/index.js';

const contextStorage = new AsyncLocalStorage<Record<string, unknown>>();

const transports = pino.transport({
  targets: [
    {
      target: 'pino/file',
      options: {
        destination: `./logs/${config.serviceName}.log`,
        mkdir: true,
      },
    },
    // Always output to stdout with pretty formatting
    {
      target: 'pino-pretty',
      options: {
        destination: 1, // stdout
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    },
  ],
});

export const logger = pino(
  {
    level: config.logLevel,
    base: { service: config.serviceName },
    mixin: () => contextStorage.getStore() || {},
    timestamp: pino.stdTimeFunctions.unixTime,
  },
  transports
);

export function withContext<T>(context: Record<string, unknown>, fn: () => T): T {
  return contextStorage.run(context, fn);
}

export type { Logger } from 'pino';
