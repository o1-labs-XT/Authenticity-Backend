import { config } from './config/index.js';
import { DatabaseConnection } from './db/database.js';
import { AuthenticityRepository } from './db/repositories/authenticity.repository.js';
import { ImageAuthenticityService } from './services/image/verification.service.js';
import { ProofGenerationService } from './services/zk/proofGeneration.service.js';
import { ProofPublishingService } from './services/zk/proofPublishing.service.js';
import { ProofGenerationWorker } from './workers/proofGenerationWorker.js';
import PgBoss from 'pg-boss';

async function startWorker() {
  console.log('🚀 Starting Authenticity Worker...');
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Network: ${config.minaNetwork}`);

  let boss: PgBoss | null = null;
  let dbConnection: DatabaseConnection | null = null;

  try {
    // Initialize database
    console.log('Initializing database connection...');
    dbConnection = new DatabaseConnection({ 
      connectionString: config.databaseUrl 
    });
    await dbConnection.initialize();
    const repository = new AuthenticityRepository(dbConnection.getAdapter());

    // Initialize pg-boss
    console.log('Initializing pg-boss...');
    boss = new PgBoss(config.databaseUrl);
    await boss.start();

    // Initialize services
    console.log('Initializing services...');
    const verificationService = new ImageAuthenticityService();
    
    console.log('Initializing proof generation service...');
    const proofGenerationService = new ProofGenerationService();
    
    console.log('Initializing proof publishing service...');
    const proofPublishingService = new ProofPublishingService(
      config.zkappAddress,
      config.feePayerPrivateKey,
      config.minaNetwork,
      repository
    );

    // Start worker
    const worker = new ProofGenerationWorker(
      boss,
      repository,
      verificationService,
      proofGenerationService,
      proofPublishingService
    );

    await worker.start();
    console.log('✅ Worker started successfully');

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received, starting graceful shutdown...`);
      
      if (worker) {
        await worker.stop();
      }
      
      if (boss) {
        await boss.stop();
        console.log('Job queue stopped');
      }
      
      if (dbConnection) {
        await dbConnection.close();
        console.log('Database connection closed');
      }
      
      console.log('✅ Worker shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    console.error('❌ Failed to start worker:', error);
    
    // Clean up on error
    if (boss) {
      await boss.stop();
    }
    if (dbConnection) {
      await dbConnection.close();
    }
    
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the worker
startWorker().catch(console.error);