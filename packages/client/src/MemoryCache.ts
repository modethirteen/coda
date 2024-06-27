import { Logger } from 'winston';
import { CacheInterface } from './CacheInterface';

export class MemoryCache implements CacheInterface {
  private readonly cache: Map<string, { response: Response; timestamp: number; }> = new Map();
  private readonly logger: Logger;
  private readonly ttl: number;

  public constructor(options: {
    logger: Logger;
    ttl: number;
  }) {
    const { logger, ttl } = options;
    this.logger = logger;
    this.ttl = ttl;   
  }

  public set(url: string, response: Response): void {
    this.cache.set(url, { response: response.clone(), timestamp: Date.now() });
    this.logger.debug(`Cached Coda API response from ${url} for ${this.ttl} ms. There are ${this.cache.size} response(s) in the cache`);
  }

  public get(url: string): Response | undefined {
    const result = this.cache.get(url);
    if (typeof result !== 'undefined') {
      const { response, timestamp } = result;
      if (Date.now() - timestamp < this.ttl) {
        this.logger.debug(`Using cached Coda API response from ${url}. There are ${this.cache.entries.length} response(s) in the cache`);
        return response;
      }
      this.cache.delete(url);
    }
    return undefined;
  }
}
