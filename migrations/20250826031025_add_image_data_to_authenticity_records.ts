import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('authenticity_records', (table) => {
    table.specificType('image_data', 'BYTEA').nullable();
    table.text('original_filename').nullable();
    table.integer('file_size').nullable();
  });
}


export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('authenticity_records', (table) => {
    table.dropColumn('image_data');
    table.dropColumn('original_filename');
    table.dropColumn('file_size');
  });
}

