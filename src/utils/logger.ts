import pino from 'pino';
import { AsyncLocalStorage } from 'async_hooks';

const SERVICE_NAME =
  process.env.SERVICE_NAME || (process.argv[1]?.includes('worker') ? 'worker' : 'api');

const contextStorage = new AsyncLocalStorage<Record<string, unknown>>();

const transports = pino.transport({
  targets: [
    {
      target: 'pino/file',
      options: {
        destination: `./logs/${SERVICE_NAME}.log`,
        mkdir: true,
      },
    },
    // pretty print to terminal
    ...(process.stdout.isTTY
      ? [
          {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          },
        ]
      : []),
  ],
});

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'debug',
    base: { service: SERVICE_NAME },
    mixin: () => contextStorage.getStore() || {},
    timestamp: pino.stdTimeFunctions.unixTime,
  },
  transports
);

export function withContext<T>(context: Record<string, unknown>, fn: () => T): T {
  return contextStorage.run(context, fn);
}

export type { Logger } from 'pino';
