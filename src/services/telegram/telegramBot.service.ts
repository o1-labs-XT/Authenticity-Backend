import { Telegraf } from 'telegraf';
import { logger } from '../../utils/logger.js';

export class TelegramBotService {
  private bot: Telegraf;

  constructor(botToken: string) {
    this.bot = new Telegraf(botToken);
  }

  /**
   * Send text message to Telegram channel
   * @param channelId - Channel username (@channel) or numeric ID
   * @param text - Message text, Telegram MarkdownV2
   * @param correlationId - Optional correlation ID for tracing
   */
  async sendMessageToChannel(
    channelId: string,
    text: string,
    correlationId?: string
  ): Promise<void> {
    try {
      logger.debug(
        { channelId, textLength: text.length, correlationId },
        'Sending message to Telegram channel'
      );

      await this.bot.telegram.sendMessage(channelId, text, {
        parse_mode: 'MarkdownV2',
      });

      logger.info({ channelId, correlationId }, 'Message sent to Telegram channel successfully');
    } catch (error: any) {
      this.handleTelegramError(error, channelId, correlationId);
    }
  }

  private handleTelegramError(error: any, channelId: string, correlationId?: string): void {
    const errorCode = error.response?.error_code;
    const errorDescription = error.response?.description;

    // Rate limited - throw to trigger retry with backoff
    if (errorCode === 429) {
      const retryAfter = error.response?.parameters?.retry_after;
      logger.warn(
        { channelId, retryAfter, correlationId },
        'Telegram rate limited, will retry with backoff'
      );
      throw new Error(`Telegram rate limited. Retry after ${retryAfter}s`);
    }

    // Invalid channel ID or permissions
    if (errorCode === 400 || errorCode === 403) {
      logger.error(
        { channelId, errorCode, errorDescription, correlationId },
        'Invalid Telegram channel or insufficient permissions'
      );
      throw new Error(`Invalid Telegram channel: ${errorDescription}`);
    }

    // Unknown error, log and throw for retry
    logger.error(
      { channelId, error: error.message, errorCode, errorDescription, correlationId },
      'Telegram API error'
    );
    throw error;
  }
}
