import { createHash } from 'node:crypto';
import type { GhlContact, GhlOpportunity, GhlPipeline } from '../integrations/ghl/types.js';
import type { BrevoContact, BrevoList } from '../integrations/brevo/types.js';
import type { StripeCustomerRecord } from '../integrations/stripe/types.js';
import type { SourceRef } from '../models/common.js';
import type { CrmInfo, MarketingInfo, PaymentsInfo } from '../models/customer.js';

/**
 * Converts provider-shaped records into the unified model. Each function
 * here only ever reads from one provider's record — cross-system
 * correlation (deciding which records belong to the same person) lives in
 * services/customerService.ts, which composes these building blocks.
 *
 * Two rules hold throughout this file (spec §4):
 *  - Never fabricate: a field absent from the source becomes `null`, never
 *    a default value like `0`, `""`, or `false`.
 *  - Always attribute: every non-identity block carries the source system
 *    and its native id.
 */

export interface NormalizedIdentity {
  name: string | null;
  email: string | null;
  phone: string | null;
  source: SourceRef;
}

/**
 * Conservative email normalization: trim + lowercase only. We deliberately
 * do NOT strip `+tags` or dots — those are Gmail-specific conventions that
 * would incorrectly merge distinct people on other providers (spec §10).
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

/**
 * Best-effort phone normalization to a comparable digits-only form (kept
 * as a medium-confidence match key, never used alone to merge — spec §10).
 * Keeps a leading `+` when present; strips everything else non-numeric.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  return hasPlus ? `+${digits}` : digits;
}

/**
 * Deterministic ops_customer_* id derived from a stable match key (usually
 * the normalized email). Using a hash instead of a random id means the
 * same person yields the same id across calls without the stateless
 * server persisting anything.
 */
export function generateOpsCustomerId(matchKey: string): string {
  const hash = createHash('sha256').update(matchKey.toLowerCase()).digest('hex');
  return `ops_customer_${hash.slice(0, 20)}`;
}

function ghlContactName(contact: GhlContact): string | null {
  if (contact.name?.trim()) return contact.name.trim();
  const parts = [contact.firstName, contact.lastName].filter((p): p is string =>
    Boolean(p?.trim()),
  );
  return parts.length > 0 ? parts.join(' ') : null;
}

export function identityFromGhlContact(contact: GhlContact): NormalizedIdentity {
  return {
    name: ghlContactName(contact),
    email: normalizeEmail(contact.email),
    phone: normalizePhone(contact.phone),
    source: { system: 'ghl', id: contact.id },
  };
}

function brevoAttr(contact: BrevoContact, key: string): string | undefined {
  const value = contact.attributes[key];
  return typeof value === 'string' ? value : undefined;
}

export function identityFromBrevoContact(contact: BrevoContact): NormalizedIdentity {
  const first = brevoAttr(contact, 'FIRSTNAME') ?? brevoAttr(contact, 'FNAME');
  const last = brevoAttr(contact, 'LASTNAME') ?? brevoAttr(contact, 'LNAME');
  const name = [first, last].filter((p): p is string => Boolean(p?.trim())).join(' ') || null;
  const phone = brevoAttr(contact, 'SMS') ?? null;
  return {
    name,
    email: normalizeEmail(contact.email),
    phone: normalizePhone(phone),
    source: { system: 'brevo', id: String(contact.id) },
  };
}

export function identityFromStripeCustomer(customer: StripeCustomerRecord): NormalizedIdentity {
  return {
    name: customer.name?.trim() || null,
    email: normalizeEmail(customer.email),
    phone: normalizePhone(customer.phone),
    source: { system: 'stripe', id: customer.id },
  };
}

/**
 * Merges identity fields from multiple correlated sources. `priority`
 * lists identities in the order their fields should win — the first
 * non-null value for each field is used. Callers pass GHL first when a CRM
 * record exists (it is usually the most curated), falling back through the
 * other correlated sources.
 */
export function mergeIdentities(priority: NormalizedIdentity[]): {
  name: string | null;
  email: string | null;
  phone: string | null;
} {
  return {
    name: priority.find((i) => i.name)?.name ?? null,
    email: priority.find((i) => i.email)?.email ?? null,
    phone: priority.find((i) => i.phone)?.phone ?? null,
  };
}

/**
 * Builds the CRM block from a GHL opportunity. Requires a separate
 * opportunity lookup (a GHL contact alone carries no pipeline/stage), so
 * this is only ever called once that lookup has happened — see
 * services/ghlService.ts. Returns `null` fields for pipeline/stage names
 * when the pipeline isn't resolvable rather than guessing.
 */
export function crmInfoFromGhlOpportunity(
  opportunity: GhlOpportunity,
  pipelines: GhlPipeline[],
): CrmInfo {
  const pipeline = pipelines.find((p) => p.id === opportunity.pipelineId);
  const stage = pipeline?.stages.find((s) => s.id === opportunity.pipelineStageId);
  return {
    source: 'ghl',
    sourceId: opportunity.id,
    status: opportunity.status ?? null,
    pipeline: pipeline?.name ?? null,
    stage: stage?.name ?? null,
  };
}

/**
 * Builds the marketing block from a Brevo contact. `subscribed` reflects
 * the hard opt-out signal (`!emailBlacklisted`), not merely list
 * membership — a contact can be on a list yet blacklisted. `listNames`
 * resolves list ids to names when available (from a prior getLists call);
 * an unresolved id is surfaced with `name: null` rather than a guess.
 */
export function marketingInfoFromBrevoContact(
  contact: BrevoContact,
  listNames: ReadonlyMap<number, string>,
): MarketingInfo {
  return {
    source: 'brevo',
    sourceId: String(contact.id),
    subscribed: !contact.emailBlacklisted,
    lists: contact.listIds.map((id) => ({ id: String(id), name: listNames.get(id) ?? null })),
  };
}

export function brevoListNameMap(lists: BrevoList[]): Map<number, string> {
  return new Map(lists.map((l) => [l.id, l.name]));
}

export interface StripePaymentSummaryInput {
  totalPaid: number;
  currency: string | null;
  latestPaymentAt: number | null;
  subscriptionStatus: string | null;
}

/**
 * Currencies Stripe represents in the major unit already (no cents) — see
 * https://docs.stripe.com/currencies#zero-decimal. Dividing these by 100
 * like a normal currency would understate the amount by 100x.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'ugx',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
]);

/** Converts a Stripe minor-unit amount to its major-unit display value. */
export function stripeAmountToMajorUnits(
  amountMinorUnits: number,
  currency: string | null,
): number {
  if (currency && ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase())) {
    return amountMinorUnits;
  }
  return amountMinorUnits / 100;
}

/**
 * Builds the payments block. `totalSpent` is Stripe's minor-unit amount
 * converted to major units (e.g. cents -> dollars) using the summary's
 * currency; callers needing the raw minor-unit value should use the
 * payments/invoices tools directly.
 */
export function paymentsInfoFromStripeSummary(
  customerId: string,
  summary: StripePaymentSummaryInput,
): PaymentsInfo {
  return {
    source: 'stripe',
    sourceId: customerId,
    totalSpent: stripeAmountToMajorUnits(summary.totalPaid, summary.currency),
    currency: summary.currency,
    lastPaymentAt: summary.latestPaymentAt
      ? new Date(summary.latestPaymentAt * 1000).toISOString()
      : null,
    subscriptionStatus: summary.subscriptionStatus,
  };
}
