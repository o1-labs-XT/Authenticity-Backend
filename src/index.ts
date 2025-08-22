import { config } from './config/index.js';
import { createServer } from './api/server.js';
import { DatabaseConnection } from './db/database.js';
import { AuthenticityRepository } from './db/repositories/authenticity.repository.js';
import { VerificationService } from './services/image/verification.service.js';
import { JobQueueService } from './services/queue/jobQueue.service.js';
import { ProofGenerationService } from './services/zk/proofGeneration.service.js';
import { ProofPublishingService } from './services/zk/proofPublishing.service.js';
import { UploadHandler } from './handlers/upload.handler.js';
import { StatusHandler } from './handlers/status.handler.js';
import { TokenOwnerHandler } from './handlers/tokenOwner.handler.js';

async function main() {
  console.log('🚀 Starting Authenticity Backend...');
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Network: ${config.minaNetwork}`);

  try {
    // Initialize database
    console.log('Initializing database...');
    const dbConnection = new DatabaseConnection({ 
      connectionString: config.databaseUrl 
    });
    await dbConnection.initialize();
    const repository = new AuthenticityRepository(dbConnection.getAdapter());

    // Initialize services
    console.log('Initializing services...');
    const verificationService = new VerificationService();
    
    // Initialize job queue
    console.log('Initializing job queue...');
    const jobQueue = new JobQueueService(config.databaseUrl);
    await jobQueue.start();
    
    // Initialize ZK services (will be used by workers, but keeping for backward compatibility)
    const proofGenerationService = new ProofGenerationService();
    const proofPublishingService = new ProofPublishingService(
      config.zkappAddress,
      config.feePayerPrivateKey,
      config.minaNetwork,
      repository
    );

    // Initialize handlers
    const uploadHandler = new UploadHandler(
      verificationService,
      repository,
      jobQueue
    );
    const statusHandler = new StatusHandler(repository);
    const tokenOwnerHandler = new TokenOwnerHandler(repository);

    // Create and start server
    const app = createServer({
      uploadHandler,
      statusHandler,
      tokenOwnerHandler,
    });

    const port = config.port;

    const server = app.listen(port, () => {
      console.log(`✅ Server running on port ${port}`);
      console.log(`📍 Health check: http://localhost:${port}/health`);
      console.log(`📍 API endpoints:`);
      console.log(`   POST /api/upload - Upload image for proof generation`);
      console.log(`   GET  /api/status/:sha256Hash - Check proof status`);
      console.log(`   GET  /api/token-owner/:sha256Hash - Get token owner address`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received, starting graceful shutdown...`);
      
      // Stop accepting new connections
      server.close(() => {
        console.log('HTTP server closed');
      });
      
      // Stop job queue
      await jobQueue.stop();
      
      // Close database
      await dbConnection.close();
      
      console.log('✅ Graceful shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
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
