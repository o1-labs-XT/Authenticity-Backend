import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('likes', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('submission_id').notNullable();
    table.string('wallet_address', 255).notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    // Foreign keys with cascade delete
    table.foreign('submission_id').references('id').inTable('submissions').onDelete('CASCADE');
    table
      .foreign('wallet_address')
      .references('wallet_address')
      .inTable('users')
      .onDelete('CASCADE');

    // Indexes for performance
    table.index('submission_id');
    table.index('wallet_address');
    table.index('created_at');

    // Unique constraint: one like per user per submission
    table.unique(['submission_id', 'wallet_address']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('likes');
}
