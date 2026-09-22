import { describe, expect, it } from 'vitest';
import {
  brevoListNameMap,
  crmInfoFromGhlOpportunity,
  generateOpsCustomerId,
  identityFromBrevoContact,
  identityFromGhlContact,
  identityFromStripeCustomer,
  marketingInfoFromBrevoContact,
  mergeIdentities,
  normalizeEmail,
  normalizePhone,
  paymentsInfoFromStripeSummary,
  stripeAmountToMajorUnits,
} from '../../src/services/normalizationService.js';
import type { GhlContact, GhlOpportunity, GhlPipeline } from '../../src/integrations/ghl/types.js';
import type { BrevoContact } from '../../src/integrations/brevo/types.js';
import type { StripeCustomerRecord } from '../../src/integrations/stripe/types.js';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  John.Smith@Example.COM  ')).toBe('john.smith@example.com');
  });
  it('returns null for empty/nullish input', () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail('   ')).toBeNull();
  });
  it('does NOT strip +tags or dots (spec §10 — those are Gmail-specific and would over-merge)', () => {
    expect(normalizeEmail('john+newsletter@example.com')).toBe('john+newsletter@example.com');
    expect(normalizeEmail('j.o.h.n@example.com')).toBe('j.o.h.n@example.com');
  });
});

describe('normalizePhone', () => {
  it('strips formatting but keeps a leading +', () => {
    expect(normalizePhone('+1 (415) 555-1234')).toBe('+14155551234');
  });
  it('strips formatting without a + when none is present', () => {
    expect(normalizePhone('(415) 555-1234')).toBe('4155551234');
  });
  it('returns null for nullish/empty/non-numeric input', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
    expect(normalizePhone('n/a')).toBeNull();
  });
});

describe('generateOpsCustomerId', () => {
  it('is deterministic for the same key', () => {
    expect(generateOpsCustomerId('john@example.com')).toBe(
      generateOpsCustomerId('john@example.com'),
    );
  });
  it('is case-insensitive on the key', () => {
    expect(generateOpsCustomerId('John@Example.com')).toBe(
      generateOpsCustomerId('john@example.com'),
    );
  });
  it('differs for different keys', () => {
    expect(generateOpsCustomerId('john@example.com')).not.toBe(
      generateOpsCustomerId('jane@example.com'),
    );
  });
  it('is prefixed as documented', () => {
    expect(generateOpsCustomerId('x@y.com')).toMatch(/^ops_customer_[a-f0-9]{20}$/);
  });
});

describe('identityFromGhlContact — never fabricates missing fields', () => {
  const base: GhlContact = { id: 'ghl_1' };

  it('prefers `name`, falls back to firstName+lastName, then null', () => {
    expect(identityFromGhlContact({ ...base, name: 'John Smith' }).name).toBe('John Smith');
    expect(identityFromGhlContact({ ...base, firstName: 'John', lastName: 'Smith' }).name).toBe(
      'John Smith',
    );
    expect(identityFromGhlContact({ ...base }).name).toBeNull();
  });

  it('leaves email/phone as null rather than guessing when absent', () => {
    const identity = identityFromGhlContact(base);
    expect(identity.email).toBeNull();
    expect(identity.phone).toBeNull();
    expect(identity.source).toEqual({ system: 'ghl', id: 'ghl_1' });
  });
});

describe('identityFromBrevoContact', () => {
  const base: BrevoContact = {
    id: 42,
    email: 'jane@example.com',
    emailBlacklisted: false,
    smsBlacklisted: false,
    listIds: [],
    attributes: {},
    createdAt: '2026-01-01T00:00:00Z',
    modifiedAt: '2026-01-01T00:00:00Z',
  };

  it('reads FIRSTNAME/LASTNAME attributes for name', () => {
    const identity = identityFromBrevoContact({
      ...base,
      attributes: { FIRSTNAME: 'Jane', LASTNAME: 'Doe' },
    });
    expect(identity.name).toBe('Jane Doe');
  });

  it('falls back to null name when no name attributes are present', () => {
    expect(identityFromBrevoContact(base).name).toBeNull();
  });

  it('source id is stringified from the numeric Brevo id', () => {
    expect(identityFromBrevoContact(base).source).toEqual({ system: 'brevo', id: '42' });
  });
});

describe('identityFromStripeCustomer', () => {
  const base: StripeCustomerRecord = {
    id: 'cus_1',
    object: 'customer',
    email: null,
    name: null,
    phone: null,
    currency: null,
    balance: 0,
    created: 0,
    metadata: {},
  };

  it('treats an empty/whitespace name as null, not an empty string', () => {
    expect(identityFromStripeCustomer({ ...base, name: '   ' }).name).toBeNull();
  });
});

describe('mergeIdentities', () => {
  it('takes the first non-null value per field, in priority order', () => {
    const merged = mergeIdentities([
      { name: null, email: 'a@x.com', phone: null, source: { system: 'ghl', id: '1' } },
      {
        name: 'Backup Name',
        email: 'b@x.com',
        phone: '+1000',
        source: { system: 'stripe', id: '2' },
      },
    ]);
    expect(merged).toEqual({ name: 'Backup Name', email: 'a@x.com', phone: '+1000' });
  });

  it('returns all-null when nothing is known', () => {
    expect(mergeIdentities([])).toEqual({ name: null, email: null, phone: null });
  });
});

describe('crmInfoFromGhlOpportunity', () => {
  const pipelines: GhlPipeline[] = [
    { id: 'pipe_1', name: 'Sales', stages: [{ id: 'stage_1', name: 'Proposal' }] },
  ];
  const opportunity: GhlOpportunity = {
    id: 'opp_1',
    status: 'open',
    pipelineId: 'pipe_1',
    pipelineStageId: 'stage_1',
  };

  it('resolves pipeline and stage names when found', () => {
    const crm = crmInfoFromGhlOpportunity(opportunity, pipelines);
    expect(crm).toEqual({
      source: 'ghl',
      sourceId: 'opp_1',
      status: 'open',
      pipeline: 'Sales',
      stage: 'Proposal',
    });
  });

  it('leaves pipeline/stage null (not fabricated) when unresolvable', () => {
    const crm = crmInfoFromGhlOpportunity({ ...opportunity, pipelineId: 'unknown' }, pipelines);
    expect(crm.pipeline).toBeNull();
    expect(crm.stage).toBeNull();
  });
});

describe('marketingInfoFromBrevoContact', () => {
  it('subscribed reflects !emailBlacklisted, not mere list presence', () => {
    const contact: BrevoContact = {
      id: 1,
      email: 'x@y.com',
      emailBlacklisted: true,
      smsBlacklisted: false,
      listIds: [10],
      attributes: {},
      createdAt: '',
      modifiedAt: '',
    };
    const info = marketingInfoFromBrevoContact(
      contact,
      brevoListNameMap([{ id: 10, name: 'Newsletter' }]),
    );
    expect(info.subscribed).toBe(false);
    expect(info.lists).toEqual([{ id: '10', name: 'Newsletter' }]);
  });

  it('reports an unresolved list id with a null name rather than a guess', () => {
    const contact: BrevoContact = {
      id: 1,
      email: 'x@y.com',
      emailBlacklisted: false,
      smsBlacklisted: false,
      listIds: [999],
      attributes: {},
      createdAt: '',
      modifiedAt: '',
    };
    const info = marketingInfoFromBrevoContact(contact, new Map());
    expect(info.lists).toEqual([{ id: '999', name: null }]);
  });
});

describe('stripeAmountToMajorUnits', () => {
  it('divides by 100 for standard currencies', () => {
    expect(stripeAmountToMajorUnits(2599, 'usd')).toBe(25.99);
  });
  it('does NOT divide zero-decimal currencies (e.g. JPY)', () => {
    expect(stripeAmountToMajorUnits(2599, 'jpy')).toBe(2599);
  });
  it('is case-insensitive on the currency code', () => {
    expect(stripeAmountToMajorUnits(2599, 'JPY')).toBe(2599);
  });
  it('divides by 100 when currency is unknown/null', () => {
    expect(stripeAmountToMajorUnits(2599, null)).toBe(25.99);
  });
});

describe('paymentsInfoFromStripeSummary', () => {
  it('converts a Unix timestamp to an ISO string, or null when absent', () => {
    const info = paymentsInfoFromStripeSummary('cus_1', {
      totalPaid: 5000,
      currency: 'usd',
      latestPaymentAt: 1735689600,
      subscriptionStatus: 'active',
    });
    expect(info.lastPaymentAt).toBe(new Date(1735689600 * 1000).toISOString());

    const noPayment = paymentsInfoFromStripeSummary('cus_1', {
      totalPaid: 0,
      currency: null,
      latestPaymentAt: null,
      subscriptionStatus: null,
    });
    expect(noPayment.lastPaymentAt).toBeNull();
  });
});
