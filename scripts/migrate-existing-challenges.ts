import { config } from '../src/config/index.js';
import { DatabaseConnection } from '../src/db/database.js';

async function migrateExistingChallenges() {
  const db = new DatabaseConnection({ connectionString: config.databaseUrl });
  await db.initialize();

  const knex = db.getAdapter().getKnex();

  try {
    // Update all existing challenges to use legacy zkApp address
    const updated = await knex('challenges').whereNull('zkapp_address').update({
      zkapp_address: config.zkappAddress, // Legacy env var
      deployment_status: 'active',
      deployment_completed_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });

    console.log(`✓ Migrated ${updated} existing challenges to use legacy zkApp address`);
    console.log(`  zkApp address: ${config.zkappAddress}`);
  } catch (error) {
    console.error('✗ Migration failed:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

migrateExistingChallenges();
