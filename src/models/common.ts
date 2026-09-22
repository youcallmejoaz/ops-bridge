/**
 * Types shared across the unified model and cross-system correlation logic.
 */

export type SourceSystem = 'ghl' | 'brevo' | 'stripe';

/** Points back to the native record a piece of unified data came from. */
export interface SourceRef {
  system: SourceSystem;
  id: string;
}

/**
 * How confident a cross-system match is (spec §10). Only `high` and
 * `medium` confidence matches are ever merged into a single unified
 * customer; `low` (name-only) matches are always returned as separate
 * candidates — see services/customerService.ts.
 */
export type MatchConfidence = 'high' | 'medium' | 'low';

export interface MatchCandidate<T> {
  record: T;
  confidence: MatchConfidence;
  reason: string;
}

/** A page of results bounded per spec §11 — never an unbounded full scan. */
export interface Page<T> {
  items: T[];
  hasMore: boolean;
  truncated?: boolean;
}
