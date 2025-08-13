import crypto from 'crypto';
import { 
  ProofGenerationTask, 
  ProofPublishingTask, 
  QueueTask, 
  QueueMetrics 
} from '../../types';

export class ProofQueueService {
  private queue: QueueTask[] = [];
  private processing = false;
  private processedCount = 0;
  private failedCount = 0;
  private totalProcessingTime = 0;
  
  // Callbacks for processing tasks - will be set by main app
  private proofGenerationHandler?: (task: ProofGenerationTask) => Promise<void>;
  private proofPublishingHandler?: (task: ProofPublishingTask) => Promise<void>;

  constructor() {
    console.log('ProofQueueService initialized');
  }

  /**
   * Set handler for proof generation tasks
   */
  setProofGenerationHandler(handler: (task: ProofGenerationTask) => Promise<void>): void {
    this.proofGenerationHandler = handler;
  }

  /**
   * Set handler for proof publishing tasks
   */
  setProofPublishingHandler(handler: (task: ProofPublishingTask) => Promise<void>): void {
    this.proofPublishingHandler = handler;
  }

  /**
   * Enqueue a proof generation task
   */
  async enqueueProofGeneration(payload: ProofGenerationTask): Promise<string> {
    const task: QueueTask = {
      id: crypto.randomUUID(),
      type: 'generate_proof',
      payload,
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date(),
    };

    this.queue.push(task);
    console.log(`Enqueued proof generation task ${task.id} for hash ${payload.sha256Hash}`);
    
    // Start processing if not already running
    this.processQueue();
    
    return task.id;
  }

  /**
   * Enqueue a proof publishing task
   */
  async enqueueProofPublishing(payload: ProofPublishingTask): Promise<string> {
    const task: QueueTask = {
      id: crypto.randomUUID(),
      type: 'publish_proof',
      payload,
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date(),
    };

    this.queue.push(task);
    console.log(`Enqueued proof publishing task ${task.id} for hash ${payload.sha256Hash}`);
    
    this.processQueue();
    
    return task.id;
  }

  /**
   * Process the queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    console.log(`Starting queue processing with ${this.queue.length} tasks`);

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) continue;

      const startTime = Date.now();
      
      try {
        console.log(`Processing task ${task.id} (type: ${task.type}, attempt: ${task.attempts + 1})`);
        
        if (task.type === 'generate_proof') {
          await this.processProofGeneration(task);
        } else if (task.type === 'publish_proof') {
          await this.processProofPublishing(task);
        }
        
        const processingTime = Date.now() - startTime;
        this.totalProcessingTime += processingTime;
        this.processedCount++;
        
        console.log(`Task ${task.id} completed in ${processingTime}ms`);
        
      } catch (error) {
        console.error(`Task ${task.id} failed:`, error);
        
        task.attempts++;
        
        if (task.attempts < task.maxAttempts) {
          // Retry with exponential backoff
          const delay = Math.pow(2, task.attempts) * 1000;
          console.log(`Retrying task ${task.id} in ${delay}ms (attempt ${task.attempts}/${task.maxAttempts})`);
          
          setTimeout(() => {
            this.queue.push(task);
            this.processQueue();
          }, delay);
        } else {
          console.error(`Task ${task.id} failed after ${task.maxAttempts} attempts`);
          this.failedCount++;
        }
      }
    }

    this.processing = false;
    console.log('Queue processing completed');
  }

  /**
   * Process a proof generation task
   */
  private async processProofGeneration(task: QueueTask): Promise<void> {
    if (!this.proofGenerationHandler) {
      throw new Error('Proof generation handler not set');
    }

    const payload = task.payload as ProofGenerationTask;
    await this.proofGenerationHandler(payload);
  }

  /**
   * Process a proof publishing task
   */
  private async processProofPublishing(task: QueueTask): Promise<void> {
    if (!this.proofPublishingHandler) {
      throw new Error('Proof publishing handler not set');
    }

    const payload = task.payload as ProofPublishingTask;
    await this.proofPublishingHandler(payload);
  }

  /**
   * Get queue metrics
   */
  getMetrics(): QueueMetrics {
    const pending = this.queue.filter(t => !t.nextAttemptAt || t.nextAttemptAt <= new Date()).length;
    const processing = this.processing ? 1 : 0;
    
    return {
      pending,
      processing,
      completed: this.processedCount,
      failed: this.failedCount,
      avgProcessingTime: this.processedCount > 0 
        ? Math.round(this.totalProcessingTime / this.processedCount)
        : 0,
    };
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Clear the queue (for testing/emergency)
   */
  clearQueue(): void {
    const size = this.queue.length;
    this.queue = [];
    console.log(`Cleared ${size} tasks from queue`);
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): QueueTask | undefined {
    return this.queue.find(t => t.id === taskId);
  }
}