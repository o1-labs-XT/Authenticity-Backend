import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('submissions', (table) => {
    table.timestamp('processing_started_at').nullable();
    table.timestamp('verified_at').nullable();
    table.timestamp('failed_at').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('submissions', (table) => {
    table.dropColumn('processing_started_at');
    table.dropColumn('verified_at');
    table.dropColumn('failed_at');
  });
}
