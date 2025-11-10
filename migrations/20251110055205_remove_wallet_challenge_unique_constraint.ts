import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Drop the unique constraint that prevents multiple submissions per wallet per challenge
  await knex.schema.alterTable('submissions', (table) => {
    table.dropUnique(['wallet_address', 'challenge_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  // Restore the unique constraint if rolling back
  await knex.schema.alterTable('submissions', (table) => {
    table.unique(['wallet_address', 'challenge_id']);
  });
}
