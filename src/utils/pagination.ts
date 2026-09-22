import { z } from 'zod';

/**
 * Shared pagination guardrails (spec §11). Every tool that can return an
 * unbounded set of records must run its requested limit through
 * `clampLimit`, and any full-set scan (e.g. cross-system correlation) must
 * respect `maxScan` and report truncation rather than silently returning a
 * partial result as if it were complete.
 */

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** Hard ceiling on records fetched during a single cross-system scan. */
export const MAX_SCAN = 500;

export const limitSchema = z
  .number()
  .int()
  .positive()
  .max(MAX_LIMIT, `limit cannot exceed ${MAX_LIMIT} — use pagination to fetch more`)
  .default(DEFAULT_LIMIT);

export function clampLimit(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.trunc(requested)), MAX_LIMIT);
}

export interface PageResult<T> {
  items: T[];
  /** Opaque cursor to pass back for the next page; absent when exhausted. */
  nextCursor?: string;
  /** True when more records exist beyond what was returned. */
  hasMore: boolean;
}

export interface ScanResult<T> extends PageResult<T> {
  /** True when the scan stopped at maxScan before covering the full dataset. */
  truncated: boolean;
  /** Number of source records examined before filtering/limiting. */
  scanned: number;
}

/**
 * Encodes an opaque, URL-safe pagination cursor. We never expose raw
 * provider offsets/tokens directly as a contract, so the internal paging
 * strategy (offset vs. cursor vs. startAfter) can change per-integration
 * without changing the tool's public shape.
 */
export function encodeCursor(payload: object): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor<T extends object>(cursor: string): T {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    throw new Error('Invalid pagination cursor');
  }
}

/**
 * Drives a paged provider API up to `maxScan` records, applying `predicate`
 * to each page's items and stopping early once `take` matches have been
 * collected. Used by cross-system tools that need to scan-and-filter rather
 * than fetch-and-return (e.g. find_customers_by_conditions).
 */
export async function scanWithLimit<TItem>(options: {
  fetchPage: (offset: number, limit: number) => Promise<{ items: TItem[]; hasMore: boolean }>;
  predicate?: (item: TItem) => boolean;
  take: number;
  pageSize?: number;
  maxScan?: number;
}): Promise<ScanResult<TItem>> {
  const { fetchPage, predicate, take, pageSize = 50, maxScan = MAX_SCAN } = options;
  const matched: TItem[] = [];
  let scanned = 0;
  let offset = 0;
  let hasMore = true;
  let truncated = false;

  while (matched.length < take && scanned < maxScan && hasMore) {
    const remainingScanBudget = maxScan - scanned;
    const requestedLimit = Math.min(pageSize, remainingScanBudget);
    const page = await fetchPage(offset, requestedLimit);
    // Trim defensively in case a provider (or a test double) returns more
    // items than requested — the scan budget is a hard cap regardless.
    const pageItems =
      page.items.length > requestedLimit ? page.items.slice(0, requestedLimit) : page.items;
    scanned += pageItems.length;
    offset += pageItems.length;
    hasMore = page.hasMore;

    for (const item of pageItems) {
      if (!predicate || predicate(item)) {
        matched.push(item);
        if (matched.length >= take) break;
      }
    }

    if (pageItems.length === 0) break;
  }

  if (scanned >= maxScan && hasMore) {
    truncated = true;
  }

  return {
    items: matched,
    hasMore: hasMore && matched.length >= take,
    truncated,
    scanned,
  };
}
