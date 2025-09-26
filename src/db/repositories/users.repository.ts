import { PostgresAdapter } from '../adapters/PostgresAdapter.js';
import { User } from '../types/touchgrass.types.js';

export class UsersRepository {
  constructor(private readonly db: PostgresAdapter) {}

  async findByWalletAddress(walletAddress: string): Promise<User | null> {
    const result = await this.db.getKnex()('users').where('wallet_address', walletAddress).first();

    return result || null;
  }

  async create(walletAddress: string): Promise<User> {
    const [user] = await this.db
      .getKnex()('users')
      .insert({
        wallet_address: walletAddress,
      })
      .returning('*');

    return user;
  }

  async findOrCreate(walletAddress: string): Promise<{ user: User; created: boolean }> {
    // Try to find existing user first
    const existing = await this.findByWalletAddress(walletAddress);
    if (existing) {
      return { user: existing, created: false };
    }

    // Create new user if not found
    const newUser = await this.create(walletAddress);
    return { user: newUser, created: true };
  }

  async delete(walletAddress: string): Promise<boolean> {
    const deleted = await this.db
      .getKnex()('users')
      .where('wallet_address', walletAddress)
      .delete();

    return deleted > 0;
  }
}
