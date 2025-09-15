import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Check if table already exists (for existing SQLite databases)
  const exists = await knex.schema.hasTable('authenticity_records');

  if (!exists) {
    await knex.schema.createTable('authenticity_records', (table) => {
      table.string('sha256_hash').primary();
      table.string('token_owner_address').notNullable();
      table.string('token_owner_private_key').nullable();
      table.string('creator_public_key').notNullable();
      table.string('signature').notNullable();
      table.string('status').notNullable().checkIn(['pending', 'verified']);
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('verified_at').nullable();
      table.string('transaction_id').nullable();

      // Indexes for performance
      table.index('status');
      table.index('token_owner_address');
      table.index('created_at');
    });

    console.log('Created authenticity_records table');
  } else {
    console.log('authenticity_records table already exists');
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('authenticity_records');
}
