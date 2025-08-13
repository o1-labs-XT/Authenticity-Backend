import { AuthenticityProgram } from 'authenticity-zkapp';

/**
 * Singleton class to manage zkProgram compilation
 * Ensures the AuthenticityProgram is only compiled once and shared across services
 */
class ZkProgramSingleton {
  private static instance: ZkProgramSingleton;
  private compiled = false;
  private compiling = false;
  private compilationPromise?: Promise<void>;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): ZkProgramSingleton {
    if (!ZkProgramSingleton.instance) {
      ZkProgramSingleton.instance = new ZkProgramSingleton();
    }
    return ZkProgramSingleton.instance;
  }

  /**
   * Compile the AuthenticityProgram if not already compiled
   * Multiple calls will return the same promise if compilation is in progress
   */
  async compile(): Promise<void> {
    if (this.compiled) {
      return;
    }

    if (this.compiling && this.compilationPromise) {
      // Return the existing compilation promise if already compiling
      return this.compilationPromise;
    }

    this.compiling = true;
    
    this.compilationPromise = (async () => {
      try {
        console.log('Compiling AuthenticityProgram (singleton)...');
        const startTime = Date.now();
        
        await AuthenticityProgram.compile();
        
        const compilationTime = Date.now() - startTime;
        console.log(`AuthenticityProgram compiled successfully in ${compilationTime}ms`);
        
        this.compiled = true;
      } finally {
        this.compiling = false;
      }
    })();

    return this.compilationPromise;
  }

  /**
   * Check if the program is compiled
   */
  isCompiled(): boolean {
    return this.compiled;
  }

  /**
   * Get the compiled AuthenticityProgram
   * Note: The program itself is a global module export, 
   * this singleton just manages its compilation state
   */
  getProgram() {
    if (!this.compiled) {
      throw new Error('AuthenticityProgram not compiled. Call compile() first.');
    }
    return AuthenticityProgram;
  }
}

export const zkProgramSingleton = ZkProgramSingleton.getInstance();