import { ProofGenerationService } from './proofGeneration.service';
import { ProofPublishingService } from './proofPublishing.service';
import { AuthenticityRepository } from '../../db/repositories/authenticity.repository';
import { ProofGenerationTask, ProofPublishingTask } from '../../types';

/**
 * Coordinates proof generation and publishing
 * This service handles the complete flow from proof generation to on-chain publishing
 */
export class ZkCoordinatorService {
  constructor(
    private proofGenerationService: ProofGenerationService,
    private proofPublishingService: ProofPublishingService,
    private repository: AuthenticityRepository
  ) {
    console.log('ZkCoordinatorService initialized');
  }

  /**
   * Handle proof generation task from the queue
   */
  async handleProofGeneration(task: ProofGenerationTask): Promise<void> {
    console.log(`Starting proof generation for ${task.sha256Hash}`);
    
    try {
      // Generate the proof
      const { proof, publicInputs } = await this.proofGenerationService.generateProof(task);
      
      // Store proof data in database
      await this.repository.updateRecordStatus(task.sha256Hash, {
        status: 'verified', // Temporarily mark as verified (will be updated after publishing)
        proofData: {
          proof: JSON.stringify(proof),
          publicInputs: JSON.stringify(publicInputs),
        },
      });

      console.log(`Proof generated successfully for ${task.sha256Hash}`);
      
      // Create publishing task
      const publishingTask: ProofPublishingTask = {
        sha256Hash: task.sha256Hash,
        proof,
        publicInputs,
        tokenOwnerAddress: task.tokenOwnerAddress,
        creatorPublicKey: task.publicKey,
      };

      // Attempt to publish immediately
      await this.handleProofPublishing(publishingTask);
      
    } catch (error: any) {
      console.error(`Failed to generate proof for ${task.sha256Hash}:`, error);
      
      // Update record with error
      await this.repository.updateRecordStatus(task.sha256Hash, {
        status: 'failed',
        errorMessage: `Proof generation failed: ${error.message}`,
      });
      
      // Increment retry count
      await this.repository.incrementRetryCount(task.sha256Hash);
      
      throw error; // Re-throw to trigger queue retry logic
    }
  }

  /**
   * Handle proof publishing task from the queue
   */
  async handleProofPublishing(task: ProofPublishingTask): Promise<void> {
    console.log(`Starting proof publishing for ${task.sha256Hash}`);
    
    try {
      // Check if zkApp is deployed
      const isDeployed = await this.proofPublishingService.isDeployed();
      if (!isDeployed) {
        throw new Error('AuthenticityZkApp is not deployed. Please deploy the contract first.');
      }
      
      // Publish the proof to blockchain
      const transactionId = await this.proofPublishingService.publishProof(task);
      
      // Update record with transaction ID
      await this.repository.updateRecordStatus(task.sha256Hash, {
        status: 'verified',
        transactionId,
      });
      
      console.log(`Proof published successfully for ${task.sha256Hash}, tx: ${transactionId}`);
      
    } catch (error: any) {
      console.error(`Failed to publish proof for ${task.sha256Hash}:`, error);
      
      // Determine if error is retryable
      const isRetryable = this.isRetryableError(error.message);
      
      if (!isRetryable) {
        // Non-retryable error, mark as failed permanently
        await this.repository.updateRecordStatus(task.sha256Hash, {
          status: 'failed',
          errorMessage: `Publishing failed: ${error.message}`,
        });
      } else {
        // Update error message but keep status to allow retry
        const record = await this.repository.getRecordByHash(task.sha256Hash);
        if (record) {
          await this.repository.updateRecordStatus(task.sha256Hash, {
            status: record.status as 'verified' | 'failed',
            errorMessage: `Publishing attempt failed: ${error.message}`,
          });
        }
      }
      
      throw error; // Re-throw to trigger queue retry logic
    }
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(errorMessage: string): boolean {
    const nonRetryableErrors = [
      'zkApp not initialized',
      'Invalid proof',
      'Invalid public key',
      'Invalid signature',
      'not deployed',
    ];
    
    return !nonRetryableErrors.some(err => 
      errorMessage.toLowerCase().includes(err.toLowerCase())
    );
  }

  /**
   * Pre-compile both programs for faster processing
   */
  async precompile(): Promise<void> {
    console.log('Pre-compiling ZK programs...');
    
    await Promise.all([
      this.proofGenerationService.compile(),
      this.proofPublishingService.compile(),
    ]);
    
    console.log('ZK programs compiled and ready');
  }

  /**
   * Get compilation status
   */
  getCompilationStatus(): {
    proofGeneration: boolean;
    proofPublishing: boolean;
  } {
    return {
      proofGeneration: this.proofGenerationService.isCompiled(),
      proofPublishing: this.proofPublishingService.isCompiled(),
    };
  }
}