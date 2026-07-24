import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodaError, CodaFetchFactory } from '../src/CodaFetchFactory';
import type { CacheInterface } from '../src/CacheInterface';
import type { LoggerInterface } from '../src/LoggerInterface';

const logger: LoggerInterface = { debug: vi.fn() };

const makeCache = (): CacheInterface & { store: Map<string, Response> } => {
  const store = new Map<string, Response>();
  return {
    store,
    set: vi.fn((url: string, response: Response) => {
      store.set(url, response.clone());
    }),
    get: vi.fn((url: string) => {
      const response = store.get(url);
      return response ? response.clone() : undefined;
    }),
  };
};

describe('CodaError', () => {
  it('builds a message from the response status', () => {
    const error = new CodaError(
      new Response('', { status: 500, statusText: 'Server Error' }),
    );

    expect(error.name).toBe('CodaError');
    expect(error.message).toContain('HTTP 500 Server Error');
    expect(error.response.status).toBe(500);
  });

  it('identifies CodaError instances', () => {
    const error = new CodaError(new Response('', { status: 400 }));

    expect(CodaError.isCodaError(error)).toBe(true);
  });

  it('rejects plain errors and non-errors', () => {
    expect(CodaError.isCodaError(new Error('nope'))).toBe(false);
    expect(CodaError.isCodaError({ response: new Response('') })).toBe(false);
    expect(CodaError.isCodaError(null)).toBe(false);
    expect(CodaError.isCodaError(undefined)).toBe(false);
  });
});

describe('CodaFetchFactory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const newCodaFetch = async (options?: { useCache?: boolean }) => {
    const cache = makeCache();
    const client = await new CodaFetchFactory({
      cache,
      logger,
      token: 'secret-token',
    }).newCodaFetch(options);
    return { cache, client };
  };

  it('sends a bearer token and merges request init', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { client } = await newCodaFetch();

    const promise = client('https://coda.io/apis/v1/x', {
      headers: { 'X-Test': '1' },
    });
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://coda.io/apis/v1/x',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer secret-token',
          'X-Test': '1',
        },
      }),
    );
  });

  it('caches GET responses when useCache is enabled', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ a: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { client } = await newCodaFetch({ useCache: true });

    const first = client('u');
    await vi.runAllTimersAsync();
    await first;

    const second = client('u');
    await vi.runAllTimersAsync();
    const response = await second;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({ a: 1 });
  });

  it('does not cache when useCache is disabled', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { client } = await newCodaFetch({ useCache: false });

    const first = client('u');
    await vi.runAllTimersAsync();
    await first;
    const second = client('u');
    await vi.runAllTimersAsync();
    await second;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache non-GET requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { client } = await newCodaFetch({ useCache: true });

    const first = client('u', { method: 'post' });
    await vi.runAllTimersAsync();
    await first;
    const second = client('u', { method: 'post' });
    await vi.runAllTimersAsync();
    await second;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a CodaError on an unsuccessful status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('nope', { status: 404, statusText: 'Not Found' }));
    vi.stubGlobal('fetch', fetchMock);
    const { client } = await newCodaFetch();

    const captured = client('https://coda.io/x').catch(e => e);
    await vi.runAllTimersAsync();
    const error = await captured;

    expect(error).toBeInstanceOf(CodaError);
    expect((error as CodaError).response.status).toBe(404);
  });

  it('retries once after a 429 rate-limit response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { client } = await newCodaFetch();

    const promise = client('u');
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
  });
});
