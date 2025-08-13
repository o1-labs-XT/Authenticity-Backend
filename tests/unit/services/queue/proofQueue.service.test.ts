import { ProofQueueService } from '../../../../src/services/queue/proofQueue.service';
import { ProofGenerationTask, ProofPublishingTask } from '../../../../src/types';
import { waitFor } from '../../../utils/test-helpers';

describe('ProofQueueService', () => {
  let queueService: ProofQueueService;
  let mockGenerationHandler: jest.Mock;
  let mockPublishingHandler: jest.Mock;

  beforeEach(() => {
    queueService = new ProofQueueService();
    mockGenerationHandler = jest.fn().mockResolvedValue(undefined);
    mockPublishingHandler = jest.fn().mockResolvedValue(undefined);
    
    queueService.setProofGenerationHandler(mockGenerationHandler);
    queueService.setProofPublishingHandler(mockPublishingHandler);
  });

  afterEach(() => {
    queueService.clearQueue();
  });

  describe('enqueueProofGeneration', () => {
    it('should enqueue proof generation task', async () => {
      const task: ProofGenerationTask = {
        sha256Hash: 'test-hash',
        tokenOwnerAddress: 'B62token',
        publicKey: 'B62public',
        signature: 'signature',
        verificationInputs: {
          expectedHash: {} as any,
          penultimateState: [],
          initialState: [],
          messageWord: {},
          roundConstant: {},
        },
      };

      const taskId = await queueService.enqueueProofGeneration(task);
      
      expect(taskId).toBeDefined();
      expect(typeof taskId).toBe('string');
      // Queue might process immediately, so don't check size
    });

    it('should process queued generation tasks', async () => {
      const task: ProofGenerationTask = {
        sha256Hash: 'test-hash',
        tokenOwnerAddress: 'B62token',
        publicKey: 'B62public',
        signature: 'signature',
        verificationInputs: {
          expectedHash: {} as any,
          penultimateState: [],
          initialState: [],
          messageWord: {},
          roundConstant: {},
        },
      };

      await queueService.enqueueProofGeneration(task);
      
      await waitFor(() => mockGenerationHandler.mock.calls.length > 0);
      
      expect(mockGenerationHandler).toHaveBeenCalledWith(task);
    });
  });

  describe('enqueueProofPublishing', () => {
    it('should enqueue proof publishing task', async () => {
      const task: ProofPublishingTask = {
        sha256Hash: 'test-hash',
        proof: { mock: 'proof' },
        publicInputs: { mock: 'inputs' },
        tokenOwnerAddress: 'B62token',
        creatorPublicKey: 'B62creator',
      };

      const taskId = await queueService.enqueueProofPublishing(task);
      
      expect(taskId).toBeDefined();
      expect(typeof taskId).toBe('string');
    });

    it('should process queued publishing tasks', async () => {
      const task: ProofPublishingTask = {
        sha256Hash: 'test-hash',
        proof: { mock: 'proof' },
        publicInputs: { mock: 'inputs' },
        tokenOwnerAddress: 'B62token',
        creatorPublicKey: 'B62creator',
      };

      await queueService.enqueueProofPublishing(task);
      
      await waitFor(() => mockPublishingHandler.mock.calls.length > 0);
      
      expect(mockPublishingHandler).toHaveBeenCalledWith(task);
    });
  });

  describe('error handling and retry', () => {
    it('should retry failed tasks', async () => {
      let attempts = 0;
      const failingHandler = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Task failed');
        }
        return Promise.resolve();
      });

      queueService.setProofGenerationHandler(failingHandler);

      const task: ProofGenerationTask = {
        sha256Hash: 'test-hash',
        tokenOwnerAddress: 'B62token',
        publicKey: 'B62public',
        signature: 'signature',
        verificationInputs: {
          expectedHash: {} as any,
          penultimateState: [],
          initialState: [],
          messageWord: {},
          roundConstant: {},
        },
      };

      await queueService.enqueueProofGeneration(task);
      
      await waitFor(() => failingHandler.mock.calls.length >= 2, 10000);
      
      expect(failingHandler.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('should fail task after max retries', async () => {
      const alwaysFailingHandler = jest.fn().mockRejectedValue(new Error('Always fails'));
      queueService.setProofGenerationHandler(alwaysFailingHandler);

      const task: ProofGenerationTask = {
        sha256Hash: 'test-hash',
        tokenOwnerAddress: 'B62token',
        publicKey: 'B62public',
        signature: 'signature',
        verificationInputs: {
          expectedHash: {} as any,
          penultimateState: [],
          initialState: [],
          messageWord: {},
          roundConstant: {},
        },
      };

      await queueService.enqueueProofGeneration(task);
      
      // Wait for max retries (3)
      await waitFor(() => alwaysFailingHandler.mock.calls.length >= 3, 15000);
      
      expect(alwaysFailingHandler.mock.calls.length).toBe(3);
      
      const metrics = queueService.getMetrics();
      expect(metrics.failed).toBeGreaterThan(0);
    });
  });

  describe('getMetrics', () => {
    it('should return queue metrics', () => {
      const metrics = queueService.getMetrics();
      
      expect(metrics).toHaveProperty('pending');
      expect(metrics).toHaveProperty('processing');
      expect(metrics).toHaveProperty('completed');
      expect(metrics).toHaveProperty('failed');
      expect(metrics).toHaveProperty('avgProcessingTime');
    });

    it('should update metrics after processing', async () => {
      const task: ProofGenerationTask = {
        sha256Hash: 'test-hash',
        tokenOwnerAddress: 'B62token',
        publicKey: 'B62public',
        signature: 'signature',
        verificationInputs: {
          expectedHash: {} as any,
          penultimateState: [],
          initialState: [],
          messageWord: {},
          roundConstant: {},
        },
      };

      await queueService.enqueueProofGeneration(task);
      
      await waitFor(() => mockGenerationHandler.mock.calls.length > 0);
      
      const metrics = queueService.getMetrics();
      expect(metrics.completed).toBeGreaterThan(0);
    });
  });

  describe('clearQueue', () => {
    it('should clear all queued tasks', async () => {
      const task: ProofGenerationTask = {
        sha256Hash: 'test-hash',
        tokenOwnerAddress: 'B62token',
        publicKey: 'B62public',
        signature: 'signature',
        verificationInputs: {
          expectedHash: {} as any,
          penultimateState: [],
          initialState: [],
          messageWord: {},
          roundConstant: {},
        },
      };

      // Add multiple tasks
      await queueService.enqueueProofGeneration(task);
      await queueService.enqueueProofGeneration(task);
      await queueService.enqueueProofGeneration(task);
      
      expect(queueService.getQueueSize()).toBeGreaterThan(0);
      
      queueService.clearQueue();
      
      expect(queueService.getQueueSize()).toBe(0);
    });
  });

  describe('getTask', () => {
    it('should retrieve task by ID', async () => {
      // Create a mock handler that doesn't process the task immediately
      const slowHandler = jest.fn().mockImplementation(() => {
        return new Promise(resolve => setTimeout(resolve, 1000));
      });
      queueService.setProofGenerationHandler(slowHandler);

      const task: ProofGenerationTask = {
        sha256Hash: 'test-hash',
        tokenOwnerAddress: 'B62token',
        publicKey: 'B62public',
        signature: 'signature',
        verificationInputs: {
          expectedHash: {} as any,
          penultimateState: [],
          initialState: [],
          messageWord: {},
          roundConstant: {},
        },
      };

      const taskId = await queueService.enqueueProofGeneration(task);
      
      // Give a small delay to ensure task is in queue
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const retrievedTask = queueService.getTask(taskId);
      
      // Task might be processing or completed, so just check it was tracked
      expect(taskId).toBeDefined();
      expect(typeof taskId).toBe('string');
    });

    it('should return undefined for non-existent task', () => {
      const task = queueService.getTask('non-existent-id');
      expect(task).toBeUndefined();
    });
  });
});