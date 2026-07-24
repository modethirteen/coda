import { describe, expect, it } from 'vitest';
import * as index from '../src/index';

describe('index', () => {
  it('exports the public runtime API', () => {
    expect(index.MemoryCache).toBeDefined();
    expect(index.CodaFetchFactory).toBeDefined();
    expect(index.CodaError).toBeDefined();
  });
});
