import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add proof_json column to store serialized proofs between workers
  await knex.schema.alterTable('submissions', (table) => {
    table.jsonb('proof_json').nullable();
  });

  // Update existing 'processing' status to 'proof_generation' for in-flight jobs
  await knex('submissions').where('status', 'processing').update({ status: 'proof_generation' });

  // Update status check constraint with granular statuses
  await knex.raw(`
    ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_status_check;
    ALTER TABLE submissions ADD CONSTRAINT submissions_status_check
      CHECK (status IN ('awaiting_review', 'rejected', 'proof_generation', 'proof_publishing', 'complete'));
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Consolidate granular statuses back to 'processing'
  await knex('submissions')
    .whereIn('status', ['proof_generation', 'proof_publishing'])
    .update({ status: 'processing' });

  // Remove proof_json column
  await knex.schema.alterTable('submissions', (table) => {
    table.dropColumn('proof_json');
  });

  // Restore original status check constraint
  await knex.raw(`
    ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_status_check;
    ALTER TABLE submissions ADD CONSTRAINT submissions_status_check
      CHECK (status IN ('awaiting_review', 'rejected', 'processing', 'complete'));
  `);
}
