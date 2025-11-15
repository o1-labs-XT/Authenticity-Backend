import { Submission } from '../../db/types/touchgrass.types.js';

/**
 * Message Formatter Service, Telegram MarkdownV2
 */
export class MessageFormatterService {
  constructor(private frontendUrl: string) {}

  /**
   * Format notification for public channel broadcast
   */
  formatChannelNotification(
    submission: Submission,
    challengeTitle: string,
    chainName: string
  ): string {
    const walletTruncated = this.truncateWalletAddress(submission.wallet_address);
    const submissionUrl = this.generateSubmissionUrl(submission.id);

    const tagline = submission.tagline
      ? `💬 _"${this.escapeMarkdown(submission.tagline)}"_\n\n`
      : '';

    return `🆕 *New Submission*

*Challenge:* ${this.escapeMarkdown(challengeTitle)}
*Chain:* ${this.escapeMarkdown(chainName)}
*User:* \`${walletTruncated}\`

${tagline}🔗 [View Submission](${submissionUrl})`;
  }

  /**
   * Generate submission URL
   */
  private generateSubmissionUrl(submissionId: string): string {
    return `${this.frontendUrl}/submission/${submissionId}`;
  }

  /**
   * Truncate wallet address
   * B62qmWaDBM3y6VPaWgvE9ZxtRGxm4bKmDdG9aZtWNYd4bxXWvC6Skm1
   * becomes: B62q...Skm1
   */
  private truncateWalletAddress(address: string): string {
    if (address.length <= 12) return address;
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  }

  /**
   * Escape Telegram MarkdownV2 special characters
   * Characters to escape: _*[]()~`>#+-=|{}.!
   */
  private escapeMarkdown(text: string): string {
    const specialChars = [
      '_',
      '*',
      '[',
      ']',
      '(',
      ')',
      '~',
      '`',
      '>',
      '#',
      '+',
      '-',
      '=',
      '|',
      '{',
      '}',
      '.',
      '!',
    ];
    let escaped = text;

    for (const char of specialChars) {
      escaped = escaped.split(char).join(`\\${char}`);
    }

    // Truncate if too long (Telegram caption limit is 1024 chars)
    if (escaped.length > 200) {
      escaped = escaped.slice(0, 197) + '...';
    }

    return escaped;
  }
}
