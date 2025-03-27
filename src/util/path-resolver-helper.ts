import { PathResolver } from './path-resolver.js';

let resolverInstance: PathResolver | null = null;

/**
 * Get the singleton instance of PathResolver, ensuring it's initialized
 */
export async function getPathResolver(): Promise<PathResolver> {
  if (!resolverInstance) {
    resolverInstance = await PathResolver.getInstance();
  }
  return resolverInstance;
}

/**
 * Ensure we have an initialized PathResolver instance
 * This is useful when you need to chain multiple operations
 */
export async function withPathResolver<T>(
  callback: (resolver: PathResolver) => Promise<T>
): Promise<T> {
  const resolver = await getPathResolver();
  return callback(resolver);
}
