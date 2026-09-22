import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  clampLimit,
  decodeCursor,
  encodeCursor,
  scanWithLimit,
} from '../../src/utils/pagination.js';

describe('clampLimit', () => {
  it('returns the default when undefined', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_LIMIT);
  });

  it('caps at MAX_LIMIT', () => {
    expect(clampLimit(10_000)).toBe(MAX_LIMIT);
  });

  it('floors at 1 for zero or negative input', () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
  });

  it('truncates fractional values', () => {
    expect(clampLimit(5.9)).toBe(5);
  });

  it('passes through a valid value unchanged', () => {
    expect(clampLimit(42)).toBe(42);
  });
});

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a payload', () => {
    const cursor = encodeCursor({ offset: 40, id: 'abc' });
    expect(decodeCursor<{ offset: number; id: string }>(cursor)).toEqual({ offset: 40, id: 'abc' });
  });

  it('is URL-safe (no +, /, or = characters)', () => {
    const cursor = encodeCursor({ note: '>>>???///+++===' });
    expect(cursor).not.toMatch(/[+/=]/);
  });

  it('throws a clear error on a malformed cursor', () => {
    expect(() => decodeCursor('not-valid-base64url-json')).toThrow(/Invalid pagination cursor/);
  });
});

describe('scanWithLimit', () => {
  it('stops once `take` matches are collected, without over-fetching', async () => {
    const pages = [
      { items: [1, 2, 3, 4, 5], hasMore: true },
      { items: [6, 7, 8, 9, 10], hasMore: true },
    ];
    let calls = 0;
    const result = await scanWithLimit({
      fetchPage: async () => {
        const page = pages[calls];
        calls += 1;
        return page ?? { items: [], hasMore: false };
      },
      predicate: (n: number) => n % 2 === 0,
      take: 3,
      pageSize: 5,
    });

    expect(result.items).toEqual([2, 4, 6]);
    expect(calls).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('reports truncated when maxScan is hit before `take` is satisfied', async () => {
    const result = await scanWithLimit({
      fetchPage: async (offset) => ({
        items: Array.from({ length: 10 }, (_, i) => offset + i),
        hasMore: true,
      }),
      predicate: () => false, // never matches, forcing the scan to its cap
      take: 5,
      pageSize: 10,
      maxScan: 25,
    });

    expect(result.items).toEqual([]);
    expect(result.truncated).toBe(true);
    expect(result.scanned).toBeLessThanOrEqual(25);
  });

  it('stops cleanly when a source page comes back empty', async () => {
    const result = await scanWithLimit({
      fetchPage: async () => ({ items: [], hasMore: true }),
      take: 5,
    });
    expect(result.items).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});
