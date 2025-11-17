import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add transaction_json column to store serialized transaction JSON between proof generation and publishing
  await knex.schema.alterTable('submissions', (table) => {
    table.jsonb('transaction_json').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  // Remove transaction_json column
  await knex.schema.alterTable('submissions', (table) => {
    table.dropColumn('transaction_json');
  });
}
