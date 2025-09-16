import { logger } from './logger.js';

/**
 * Performance tracking utility that logs operation timing
 * todo: investigate timers that will integrate more easily with grafana or railway observability dashboards
 */
export class PerformanceTracker {
  private startTime: number;

  constructor(
    private operation: string,
    private metadata?: Record<string, unknown>
  ) {
    this.startTime = Date.now();
  }

  end(status: 'success' | 'error' = 'success', additionalMetadata?: Record<string, unknown>) {
    const duration = Date.now() - this.startTime;
    const logData = {
      operation: this.operation,
      duration,
      status,
      ...this.metadata,
      ...additionalMetadata,
    };

    if (status === 'error') {
      logger.error(logData, `${this.operation} failed after ${duration}ms`);
    } else if (duration > 5000) {
      logger.warn(logData, `${this.operation} completed slowly in ${duration}ms`);
    } else {
      logger.info(logData, `${this.operation} completed in ${duration}ms`);
    }

    return duration;
  }
}

/**
 * Tracks and logs the performance of async operations
 * Automatically logs duration and captures errors
 */
export async function trackAsync<T>(
  operation: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  const tracker = new PerformanceTracker(operation, metadata);
  try {
    const result = await fn();
    tracker.end('success');
    return result;
  } catch (error) {
    tracker.end('error', { error: (error as Error).message });
    throw error;
  }
}
