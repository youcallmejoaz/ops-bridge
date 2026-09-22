import { describe, expect, it } from 'vitest';
import {
  correlateIdentities,
  enabledSources,
  looksLikeEmail,
  resolveSources,
} from '../../src/services/customerService.js';
import type { NormalizedIdentity } from '../../src/services/normalizationService.js';

function identity(
  overrides: Partial<NormalizedIdentity> & { source: NormalizedIdentity['source'] },
): NormalizedIdentity {
  return { name: null, email: null, phone: null, ...overrides };
}

describe('correlateIdentities — the core of cross-system correlation (spec §10)', () => {
  it('merges identities sharing a normalized email at high confidence', () => {
    const ghl = identity({
      name: 'John Smith',
      email: 'john@example.com',
      source: { system: 'ghl', id: 'g1' },
    });
    const stripe = identity({
      name: null,
      email: 'john@example.com',
      source: { system: 'stripe', id: 's1' },
    });

    const groups = correlateIdentities([ghl, stripe]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.confidence).toBe('high');
    expect(groups[0]?.members).toEqual(expect.arrayContaining([ghl, stripe]));
  });

  it('NEVER merges two different people who happen to share a name — the single most important rule', () => {
    const johnA = identity({
      name: 'John Smith',
      email: 'john.smith.1987@example.com',
      source: { system: 'ghl', id: 'g1' },
    });
    const johnB = identity({
      name: 'John Smith',
      email: 'jsmith@othercompany.com',
      source: { system: 'stripe', id: 's1' },
    });

    const groups = correlateIdentities([johnA, johnB]);

    // Two distinct groups — same name is never, by itself, a merge signal.
    expect(groups).toHaveLength(2);
    const memberSets = groups.map((g) => g.members.map((m) => m.source.id));
    expect(memberSets).toEqual(expect.arrayContaining([['g1'], ['s1']]));
  });

  it('merges email-less identities sharing a normalized phone at medium confidence', () => {
    const ghl = identity({
      name: 'Jane Doe',
      phone: '+14155551234',
      source: { system: 'ghl', id: 'g2' },
    });
    const stripe = identity({
      name: null,
      phone: '+14155551234',
      source: { system: 'stripe', id: 's2' },
    });

    const groups = correlateIdentities([ghl, stripe]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.confidence).toBe('medium');
  });

  it('a phone match never overrides a conflicting email — different emails always stay separate', () => {
    const a = identity({
      email: 'a@example.com',
      phone: '+14155551234',
      source: { system: 'ghl', id: 'g3' },
    });
    const b = identity({
      email: 'b@example.com',
      phone: '+14155551234',
      source: { system: 'stripe', id: 's3' },
    });

    const groups = correlateIdentities([a, b]);

    // Both have emails, so both are grouped by email (into two separate
    // single-member high-confidence groups) — the shared phone is never
    // consulted because phone grouping only applies to email-less identities.
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.confidence === 'high')).toBe(true);
  });

  it('returns an unmatched identity as its own singleton group', () => {
    const lone = identity({ name: 'Solo Person', source: { system: 'ghl', id: 'g4' } });
    const groups = correlateIdentities([lone]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toEqual([lone]);
  });

  it('handles an empty input', () => {
    expect(correlateIdentities([])).toEqual([]);
  });

  it('merges three sources sharing one email into a single group', () => {
    const email = 'multi@example.com';
    const members = [
      identity({ email, source: { system: 'ghl', id: 'g5' } }),
      identity({ email, source: { system: 'brevo', id: 'b5' } }),
      identity({ email, source: { system: 'stripe', id: 's5' } }),
    ];
    const groups = correlateIdentities(members);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(3);
  });

  it('is case-insensitive on email because identities arrive pre-normalized', () => {
    // correlateIdentities trusts its input is already normalized (see
    // normalizationService.normalizeEmail) — this test documents that
    // contract rather than re-testing normalization itself.
    const a = identity({ email: 'same@example.com', source: { system: 'ghl', id: 'g6' } });
    const b = identity({ email: 'same@example.com', source: { system: 'stripe', id: 's6' } });
    expect(correlateIdentities([a, b])).toHaveLength(1);
  });
});

describe('looksLikeEmail', () => {
  it('recognizes an email-shaped query', () => {
    expect(looksLikeEmail('john@example.com')).toBe(true);
  });
  it('rejects a name query', () => {
    expect(looksLikeEmail('John Smith')).toBe(false);
  });
});

describe('enabledSources / resolveSources', () => {
  it('enabledSources reflects the test environment (all three enabled)', () => {
    expect(enabledSources().sort()).toEqual(['brevo', 'ghl', 'stripe']);
  });

  it('resolveSources returns all enabled sources when none are requested', () => {
    expect(resolveSources(undefined).sort()).toEqual(['brevo', 'ghl', 'stripe']);
  });

  it('resolveSources intersects requested sources with enabled ones', () => {
    expect(resolveSources(['ghl', 'brevo'])).toEqual(['ghl', 'brevo']);
  });
});
