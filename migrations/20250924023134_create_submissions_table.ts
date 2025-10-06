import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('submissions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('sha256_hash', 64).notNullable().unique();
    table.string('wallet_address', 255).notNullable(); // User's wallet address (public key)
    table.string('signature', 500).notNullable();
    table.uuid('challenge_id').notNullable();
    table.uuid('chain_id').notNullable();
    table.string('storage_key', 255).notNullable();
    table.string('tagline', 255).nullable();
    table.integer('chain_position').notNullable();
    table
      .enum('status', [
        'uploading',
        'verifying',
        'awaiting_review',
        'rejected',
        'publishing',
        'confirming',
        'verified',
        'pending_position',
        'complete',
        'failed',
      ])
      .notNullable()
      .defaultTo('uploading');
    table.string('transaction_id', 255).nullable();
    table.text('failure_reason').nullable();
    table.integer('retry_count').notNullable().defaultTo(0);
    table.boolean('challenge_verified').notNullable().defaultTo(false);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    // Foreign keys
    table
      .foreign('wallet_address')
      .references('wallet_address')
      .inTable('users')
      .onDelete('CASCADE');
    table.foreign('challenge_id').references('id').inTable('challenges').onDelete('CASCADE');
    table.foreign('chain_id').references('id').inTable('chains').onDelete('CASCADE');

    // Indexes
    table.index('wallet_address');
    table.index('challenge_id');
    table.index('chain_id');
    table.index('sha256_hash');
    table.index('status');
    table.index('created_at'); // For ordering

    // Unique constraint: one submission per wallet per challenge
    table.unique(['wallet_address', 'challenge_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('submissions');
}
