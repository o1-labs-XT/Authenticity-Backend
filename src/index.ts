import dotenv from 'dotenv';
import { createServer } from './api/server';
import { DatabaseConnection } from './db/database';
import { AuthenticityRepository } from './db/repositories/authenticity.repository';
import { HashingService } from './services/image/hashing.service';
import { VerificationService } from './services/image/verification.service';
import { ProofGenerationService } from './services/zk/proofGeneration.service';
import { ProofPublishingService } from './services/zk/proofPublishing.service';
import { ZkCoordinatorService } from './services/zk/coordinator.service';
import { ProofQueueService } from './services/queue/proofQueue.service';
import { UploadHandler } from './handlers/upload.handler';
import { StatusHandler } from './handlers/status.handler';
import { TokenOwnerHandler } from './handlers/tokenOwner.handler';
import { Mina } from 'o1js';

// Load environment variables
dotenv.config();

async function main() {
  console.log('🚀 Starting Provenance Backend...');
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Network: ${process.env.MINA_NETWORK || 'local'}`);

  try {
    // Initialize local Mina network for tests
    if (process.env.MINA_NETWORK === '') {
      console.log('Initializing local Mina blockchain...');
      const Local = await Mina.LocalBlockchain({ proofsEnabled: true });
      Mina.setActiveInstance(Local);
      
      // For local development, use test accounts
      const testAccounts = Local.testAccounts;
      if (testAccounts && testAccounts.length >= 3) {
        // Use test accounts if no keys are configured
        if (!process.env.DEPLOYER_PRIVATE_KEY) {
          process.env.DEPLOYER_PRIVATE_KEY = testAccounts[0].key.toBase58();
        }
        if (!process.env.FEE_PAYER_PRIVATE_KEY) {
          process.env.FEE_PAYER_PRIVATE_KEY = testAccounts[1].key.toBase58();
        }
      }
    }

    // Initialize database
    console.log('Initializing database...');
    const dbConnection = new DatabaseConnection(
      process.env.DATABASE_PATH || './data/provenance.db'
    );
    const repository = new AuthenticityRepository(dbConnection.getDb());

    // Initialize services
    console.log('Initializing services...');
    const hashingService = new HashingService();
    const verificationService = new VerificationService();
    
    // Initialize ZK services
    const proofGenerationService = new ProofGenerationService();
    const proofPublishingService = new ProofPublishingService(
      process.env.ZKAPP_ADDRESS || '',
      process.env.DEPLOYER_PRIVATE_KEY || '',
      process.env.FEE_PAYER_PRIVATE_KEY || '',
      process.env.MINA_NETWORK || 'testnet'
    );

    // Initialize coordinator
    const zkCoordinatorService = new ZkCoordinatorService(
      proofGenerationService,
      proofPublishingService,
      repository
    );

    // Initialize queue service
    const queueService = new ProofQueueService();
    
    // Set queue handlers
    queueService.setProofGenerationHandler(
      async (task) => await zkCoordinatorService.handleProofGeneration(task)
    );
    queueService.setProofPublishingHandler(
      async (task) => await zkCoordinatorService.handleProofPublishing(task)
    );

    // Initialize handlers
    const uploadHandler = new UploadHandler(
      hashingService,
      verificationService,
      repository,
      queueService
    );
    const statusHandler = new StatusHandler(repository);
    const tokenOwnerHandler = new TokenOwnerHandler(repository);

    // Pre-compile circuits if enabled
    // todo: these should share a single compiled instance. o1js internal caching might mitigate this issue 
    if (process.env.PRECOMPILE === 'true') {
      console.log('Pre-compiling ZK circuits (this may take a few minutes)...');
      await zkCoordinatorService.precompile();
      console.log('✅ Circuits compiled and cached');
    }

    // Create and start server
    const app = createServer({
      uploadHandler,
      statusHandler,
      tokenOwnerHandler,
    });

    const port = process.env.PORT || 3000;

    const server = app.listen(port, () => {
      console.log(`✅ Server running on port ${port}`);
      console.log(`📍 Health check: http://localhost:${port}/health`);
      console.log(`📍 API endpoints:`);
      console.log(`   POST /api/upload - Upload image for proof generation`);
      console.log(`   GET  /api/status/:sha256Hash - Check proof status`);
      console.log(`   GET  /api/token-owner/:sha256Hash - Get token owner address`);
      console.log(`   GET  /api/statistics - View statistics`);
      
      if (!process.env.ZKAPP_ADDRESS) {
        console.warn('⚠️  Warning: ZKAPP_ADDRESS not configured. Publishing will fail.');
        console.warn('   Deploy the AuthenticityZkApp and set ZKAPP_ADDRESS in .env');
      }
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received, starting graceful shutdown...`);
      
      // Stop accepting new connections
      server.close(() => {
        console.log('HTTP server closed');
      });

      // Clear queue
      queueService.clearQueue();
      
      // Close database
      dbConnection.close();
      
      console.log('✅ Graceful shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Log startup statistics
    const stats = await repository.getStatistics();
    console.log(`📊 Database statistics:`, stats);

  } catch (error) {
    console.error('❌ Failed to start server:', error);
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

// Start the application
main().catch(console.error);
