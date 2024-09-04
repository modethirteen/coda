import { isError } from 'lodash';
import { Logger } from 'winston';
import { CacheInterface } from './CacheInterface';

const CODA_API_RATE_LIMIT = 60 * 1000;
const CODA_API_PREVENT_RATE_LIMIT = 1000;

let counter = 0;

export class CodaError extends Error {
  public static isCodaError(e: any): e is CodaError {
    if (!isError(e)) {
      return false;
    }
    const error = e as Error & {
      response?: unknown;
    };
    return error.name === 'CodaError' && error.hasOwnProperty('response') && error.response instanceof Response;
  }

  public readonly response: Response;

  constructor(response: Response) {
    const { status, statusText, url } = response;
    super(`Received unsuccessful status code response from Coda API for request to ${url}: HTTP ${status} ${statusText}`);
    this.name = 'CodaError';
    this.response = response;
  }
};

export interface CodaFetchFactoryInterface {
  newCodaFetch(options?: { useCache?: boolean; }): Promise<typeof fetch>;
}

export class CodaFetchFactory implements CodaFetchFactoryInterface {
  private readonly cache: CacheInterface;
  private readonly logger: Logger;
  private readonly token: string;

  public constructor(options: {
    cache: CacheInterface;
    logger: Logger;
    token: string;
  }) {
    const { cache, logger, token } = options;
    this.cache = cache;
    this.logger = logger;
    this.token = token;
  }

  public async newCodaFetch(options?: { useCache?: boolean }) {
    const { useCache = false } = options ?? {};
    const { cache, logger, token } = this;

    return async (input: any, init?: RequestInit | undefined) => {
      const { method = 'get' } = init ?? {};
      const isRequestCacheable = useCache && method.toLocaleLowerCase('en-US') === 'get';
      const url = input instanceof Request ? input.url : `${input}`;
      let r: Response | undefined;
      if (isRequestCacheable) {
        r = cache.get(url);
      }
      if (typeof r === 'undefined') {
        counter++;

        // back off slightly to avoid HTTP 429
        logger.debug(`Enqueing Coda API request to ${url}, executing in ${CODA_API_PREVENT_RATE_LIMIT} ms. There are ${counter} request(s) in the queue`);
        await new Promise(resolve => setTimeout(resolve, CODA_API_PREVENT_RATE_LIMIT));
        counter--;
        r = await fetch(input, {
          ...init,
          headers: {
            Authorization: `Bearer ${token}`,
            ...init?.headers,
          },
        });
        if (isRequestCacheable) {
          cache.set(url, r);
        }
      }
      const { status } = r;
      if (status >= 400 || status < 200) {
        if (status === 429) {
          logger.debug(`Requests exceeded Coda API rate limit, pausing Coda API request to ${url} for ${CODA_API_RATE_LIMIT} ms`);
          await new Promise(resolve => setTimeout(resolve, CODA_API_RATE_LIMIT));
          logger.debug(`Retrying Coda API request to ${url} after ${CODA_API_RATE_LIMIT} ms pause`);
          const client = await new CodaFetchFactory({ cache, logger, token }).newCodaFetch();
          return client(url, init);
        }
        throw new CodaError(r);
      }
      return r;
    }
  }
};
