import { fetchLastBlock } from 'o1js';
import { logger } from '../../utils/logger.js';

/**
 * Queries Mina nodes using o1js to get the current blockchain height.
 * Used by the blockchain monitoring worker to determine how many blocks have passed
 * since a transaction was submitted, enabling confirmation and abandonment detection.
 */

export class MinaNodeService {
  constructor(private minaNodeEndpoint: string) {}

  async getCurrentBlockHeight(): Promise<number> {
    try {
      logger.debug(
        { endpoint: this.minaNodeEndpoint },
        'Fetching current block height from Mina node'
      );

      const response = await fetchLastBlock(this.minaNodeEndpoint);
      const blockHeight = Number(response.blockchainLength.toBigint());

      logger.debug({ blockHeight }, 'Retrieved current block height from Mina node');
      return blockHeight;
    } catch (error) {
      logger.error(
        {
          err: error,
          endpoint: this.minaNodeEndpoint,
        },
        'Failed to fetch current block height from Mina node'
      );
      throw error;
    }
  }
}
