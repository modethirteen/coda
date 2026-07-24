import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryCache } from '../src/MemoryCache';
import type { LoggerInterface } from '../src/LoggerInterface';

const makeLogger = (): LoggerInterface & { debug: ReturnType<typeof vi.fn> } => ({
  debug: vi.fn(),
});

describe('MemoryCache', () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns undefined for an unknown url', () => {
    const cache = new MemoryCache({ logger, ttl: 1000 });

    expect(cache.get('https://docs.superhuman.com/unknown')).toBeUndefined();
  });

  it('caches a response and returns it', async () => {
    const cache = new MemoryCache({ logger, ttl: 60_000 });

    cache.set('u', new Response(JSON.stringify({ a: 1 }), { status: 200 }));
    const cached = cache.get('u');

    expect(cached).toBeInstanceOf(Response);
    if (!cached) {
      throw new Error('expected a cache hit');
    }
    await expect(cached.json()).resolves.toEqual({ a: 1 });
  });

  it('returns a fresh clone on each hit so the body can be read repeatedly', async () => {
    const cache = new MemoryCache({ logger, ttl: 60_000 });
    cache.set(
      'u',
      new Response(JSON.stringify({ browserLink: 'x' }), { status: 200 }),
    );

    const first = cache.get('u');
    const second = cache.get('u');

    if (!first || !second) {
      throw new Error('expected cache hits');
    }
    // Both reads must succeed; the pre-fix bug returned the same consumed
    // Response and the second read threw "Body has already been read".
    await expect(first.json()).resolves.toEqual({ browserLink: 'x' });
    await expect(second.json()).resolves.toEqual({ browserLink: 'x' });
  });

  it('stores a clone so consuming the original does not disturb the cache', async () => {
    const cache = new MemoryCache({ logger, ttl: 60_000 });
    const original = new Response(JSON.stringify({ a: 1 }), { status: 200 });

    cache.set('u', original);
    await original.json(); // consume the caller's original response

    const cached = cache.get('u');
    if (!cached) {
      throw new Error('expected a cache hit');
    }
    await expect(cached.json()).resolves.toEqual({ a: 1 });
  });

  it('returns entries within the ttl', () => {
    vi.useFakeTimers();
    const cache = new MemoryCache({ logger, ttl: 1000 });
    cache.set('u', new Response('x'));

    vi.advanceTimersByTime(500);

    expect(cache.get('u')).toBeInstanceOf(Response);
  });

  it('evicts entries past the ttl', () => {
    vi.useFakeTimers();
    const cache = new MemoryCache({ logger, ttl: 1000 });
    cache.set('u', new Response('x'));

    vi.advanceTimersByTime(1001);

    expect(cache.get('u')).toBeUndefined();
  });

  it('logs cache size on set and get', () => {
    const cache = new MemoryCache({ logger, ttl: 60_000 });

    cache.set('u', new Response('x'));
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Cached Coda API response from u'),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('There are 1 response(s) in the cache'),
    );

    cache.get('u');
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Using cached Coda API response from u'),
    );
  });
});
