/**
 * Simple logger interface - no manual cleanup needed
 */
export interface LoggerLike {
  info(message: string, metadata?: Record<string, any>): Promise<void>;
  error(message: string, metadata?: Record<string, any>): Promise<void>;
  debug(message: string, metadata?: Record<string, any>): Promise<void>;
  warn(message: string, metadata?: Record<string, any>): Promise<void>;
}
