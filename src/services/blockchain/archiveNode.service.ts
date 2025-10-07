import { logger } from '../../utils/logger.js';

export interface ActionResult {
  blockInfo: {
    height: number;
    distanceFromMaxBlockHeight: number;
  };
  actionData: {
    transactionInfo: {
      status: string;
      hash: string;
    };
  }[];
}

export interface ArchiveNodeResponse {
  data?: {
    actions?: ActionResult[];
  };
  errors?: Array<{ message: string }>;
}

export class ArchiveNodeService {
  constructor(private archiveEndpoint: string) {}

  async fetchActionsWithBlockInfo(
    address: string,
    fromHeight: number,
    toHeight: number,
    logRequest = false
  ): Promise<ActionResult[]> {
    const query = `
      {
        actions(
          input: {address: "${address}", from: ${fromHeight}, to: ${toHeight}}
        ) {
          blockInfo {
            height
            distanceFromMaxBlockHeight
          }
          actionData {
            transactionInfo {
              status
              hash
            }
          }
        }
      }
    `;

    if (logRequest) {
      logger.debug({ query, address, fromHeight, toHeight }, 'Archive node GraphQL request');
    }

    try {
      const response = await fetch(this.archiveEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        throw new Error(`Archive node request failed: ${response.status} ${response.statusText}`);
      }

      const result = (await response.json()) as ArchiveNodeResponse;

      if (result.errors) {
        throw new Error(`Archive node GraphQL errors: ${JSON.stringify(result.errors)}`);
      }

      return result.data?.actions || [];
    } catch (error) {
      logger.error(
        {
          err: error,
          endpoint: this.archiveEndpoint,
          address,
          fromHeight,
          toHeight,
        },
        'Failed to fetch actions from archive node'
      );
      throw error;
    }
  }
}
