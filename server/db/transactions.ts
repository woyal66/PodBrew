import { db } from '../db';
import { logger } from '../utils/logger';

/**
 * Execute a database operation within a transaction
 * Automatically handles commit/rollback and logging
 * 
 * @param callback - Function containing database operations
 * @returns Result of the callback
 * @throws Error if transaction fails
 * 
 * @example
 * const result = await withTransaction(async (tx) => {
 *   const user = await tx.select().from(users).where(eq(users.id, userId));
 *   await tx.update(users).set({ credits: user.credits - 10 });
 *   return user;
 * });
 */
export async function withTransaction<T>(
  callback: (tx: any) => Promise<T>
): Promise<T> {
  try {
    logger.debug('Starting database transaction');
    
    const result = await db.transaction(async (tx) => {
      return await callback(tx);
    });
    
    logger.debug('Transaction committed successfully');
    return result;
  } catch (error) {
    logger.error('Transaction failed and was rolled back', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Execute multiple database operations atomically
 * Useful for complex multi-step operations that must succeed or fail together
 * 
 * @example
 * await withAtomicOperation(async () => {
 *   await deductCredits(userId, 10);
 *   await createPodcast(podcastData);
 *   await updateUserStats(userId);
 * });
 */
export async function withAtomicOperation<T>(
  operationName: string,
  callback: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  
  try {
    logger.debug(`Starting atomic operation: ${operationName}`);
    
    const result = await db.transaction(async () => {
      return await callback();
    });
    
    const duration = Date.now() - startTime;
    logger.debug(`Atomic operation completed: ${operationName}`, { duration });
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`Atomic operation failed: ${operationName}`, {
      duration,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
