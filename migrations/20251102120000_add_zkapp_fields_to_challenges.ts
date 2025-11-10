import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('challenges', (table) => {
    // zkApp deployment fields
    table.string('zkapp_address', 255).nullable();
    // Note: zkApp private key NOT stored - deployment is one-time operation
    table.string('transaction_id', 100).nullable();

    // Status tracking
    table
      .enum('deployment_status', [
        'pending_deployment', // Initial state after challenge creation
        'deploying', // Contract deployment in progress
        'active', // Contract successfully deployed
        'deployment_failed', // Contract deployment failed (terminal state)
      ])
      .notNullable()
      .defaultTo('pending_deployment');

    // Error tracking
    table.text('failure_reason').nullable();

    // Indexes
    table.index('deployment_status');
    table.index('zkapp_address');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('challenges', (table) => {
    table.dropColumn('zkapp_address');
    table.dropColumn('transaction_id');
    table.dropColumn('deployment_status');
    table.dropColumn('failure_reason');
  });
}
