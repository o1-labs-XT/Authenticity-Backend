import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // First, update the status check constraint to include new statuses
  // Note: PostgreSQL requires dropping and recreating the constraint
  if (knex.client.config.client === 'pg') {
    // Find the constraint name (usually authenticity_records_status_check)
    await knex.raw(`
      ALTER TABLE authenticity_records 
      DROP CONSTRAINT IF EXISTS authenticity_records_status_check
    `);
  }

  await knex.schema.alterTable('authenticity_records', (table) => {
    // Add new columns for job tracking
    table.string('job_id').nullable();
    table.timestamp('processing_started_at').nullable();
    table.timestamp('failed_at').nullable();
    table.text('failure_reason').nullable();
    table.integer('retry_count').defaultTo(0);
    
    // Add indexes for performance
    table.index('job_id');
    table.index(['status', 'created_at']);
  });

  // Re-add the constraint with new status values
  if (knex.client.config.client === 'pg') {
    await knex.raw(`
      ALTER TABLE authenticity_records 
      ADD CONSTRAINT authenticity_records_status_check 
      CHECK (status IN ('pending', 'processing', 'verified', 'failed'))
    `);
  }

  console.log('Added job tracking fields to authenticity_records');
}

export async function down(knex: Knex): Promise<void> {
  // Remove the updated constraint
  if (knex.client.config.client === 'pg') {
    await knex.raw(`
      ALTER TABLE authenticity_records 
      DROP CONSTRAINT IF EXISTS authenticity_records_status_check
    `);
  }

  await knex.schema.alterTable('authenticity_records', (table) => {
    // Remove the added columns
    table.dropColumn('job_id');
    table.dropColumn('processing_started_at');
    table.dropColumn('failed_at');
    table.dropColumn('failure_reason');
    table.dropColumn('retry_count');
  });

  // Restore original constraint
  if (knex.client.config.client === 'pg') {
    await knex.raw(`
      ALTER TABLE authenticity_records 
      ADD CONSTRAINT authenticity_records_status_check 
      CHECK (status IN ('pending', 'verified'))
    `);
  }
}

