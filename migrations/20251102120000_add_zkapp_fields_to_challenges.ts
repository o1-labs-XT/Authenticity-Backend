import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('challenges', (table) => {
    // zkApp deployment fields
    table.string('zkapp_address', 255).nullable();
    // Note: zkApp private key NOT stored - deployment is one-time operation
    table.string('deployment_transaction_hash', 100).nullable();
    table.string('deployment_job_id', 100).nullable();

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

    // Timestamps
    table.timestamp('deployment_started_at').nullable();
    table.timestamp('deployment_completed_at').nullable();
    table.timestamp('deployment_failed_at').nullable();

    // Error tracking
    table.text('deployment_failure_reason').nullable();
    table.integer('deployment_retry_count').notNullable().defaultTo(0);

    // Indexes
    table.index('deployment_status');
    table.index('zkapp_address');
    table.index('deployment_job_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('challenges', (table) => {
    table.dropColumn('zkapp_address');
    table.dropColumn('deployment_transaction_hash');
    table.dropColumn('deployment_job_id');
    table.dropColumn('deployment_status');
    table.dropColumn('deployment_started_at');
    table.dropColumn('deployment_completed_at');
    table.dropColumn('deployment_failed_at');
    table.dropColumn('deployment_failure_reason');
    table.dropColumn('deployment_retry_count');
  });
}
