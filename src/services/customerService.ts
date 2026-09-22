import * as brevoServiceModule from './brevoService.js';
import * as ghlServiceModule from './ghlService.js';
import * as stripeServiceModule from './stripeService.js';
import { env } from '../config/env.js';
import { NotFoundError, ValidationError } from '../errors/errors.js';
import type { GhlContact } from '../integrations/ghl/types.js';
import type { StripeCustomerRecord } from '../integrations/stripe/types.js';
import type { MatchConfidence, MatchCandidate, SourceRef, SourceSystem } from '../models/common.js';
import type { MarketingListMembership, PaymentsInfo, UnifiedCustomer } from '../models/customer.js';
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
  type NormalizedIdentity,
} from './normalizationService.js';
import { MAX_SCAN, clampLimit } from '../utils/pagination.js';

/**
 * Cross-system correlation and the unified customer model (spec §9, §10).
 * This is the layer that makes OpsBridge a business-operations tool rather
 * than three API wrappers: it decides which GHL/Brevo/Stripe records
 * describe the same human, and builds one UnifiedCustomer from them.
 *
 * Re-exported as namespaces so this file can be unit-tested with the
 * underlying provider services swapped out, without touching every call
 * site — see tests/unit/customerService.test.ts.
 */
export const ghlService = ghlServiceModule;
export const brevoService = brevoServiceModule;
export const stripeService = stripeServiceModule;

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export function looksLikeEmail(query: string): boolean {
  return EMAIL_PATTERN.test(query.trim());
}

/** All integrations currently enabled by configuration. */
export function enabledSources(): SourceSystem[] {
  const sources: SourceSystem[] = [];
  if (env.ENABLE_GHL) sources.push('ghl');
  if (env.ENABLE_BREVO) sources.push('brevo');
  if (env.ENABLE_STRIPE) sources.push('stripe');
  return sources;
}

/**
 * Intersects a caller's requested sources with what's actually enabled.
 * A source the caller asked for but that is disabled is silently dropped
 * (not an error) — the tool description tells callers sources are optional
 * and scoped to what's configured.
 */
export function resolveSources(requested: SourceSystem[] | undefined): SourceSystem[] {
  const enabled = new Set(enabledSources());
  if (!requested || requested.length === 0) return [...enabled];
  return requested.filter((s) => enabled.has(s));
}

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

export interface MatchGroup {
  confidence: MatchConfidence;
  members: NormalizedIdentity[];
}

/**
 * Groups normalized identities that plausibly describe the same person.
 * Rules (spec §10), in order:
 *   1. Identities sharing a normalized email are merged at `high` confidence.
 *   2. Remaining (email-less) identities sharing a normalized phone are
 *      merged at `medium` confidence — but only among themselves; an
 *      identity already grouped by email never joins a phone group, so a
 *      phone match can never override a conflicting email.
 *   3. Anything left is its own single-member group — not a "low
 *      confidence match" (nothing contradicts it), just unmatched.
 * Name is deliberately never used as a grouping key: two same-named people
 * are never merged by this function.
 */
export function correlateIdentities(identities: NormalizedIdentity[]): MatchGroup[] {
  const byEmail = new Map<string, NormalizedIdentity[]>();
  const withoutEmail: NormalizedIdentity[] = [];

  for (const identity of identities) {
    if (identity.email) {
      const group = byEmail.get(identity.email) ?? [];
      group.push(identity);
      byEmail.set(identity.email, group);
    } else {
      withoutEmail.push(identity);
    }
  }

  const groups: MatchGroup[] = [...byEmail.values()].map((members) => ({
    confidence: 'high' as const,
    members,
  }));

  const byPhone = new Map<string, NormalizedIdentity[]>();
  const unmatched: NormalizedIdentity[] = [];
  for (const identity of withoutEmail) {
    if (identity.phone) {
      const group = byPhone.get(identity.phone) ?? [];
      group.push(identity);
      byPhone.set(identity.phone, group);
    } else {
      unmatched.push(identity);
    }
  }
  for (const members of byPhone.values()) {
    groups.push({ confidence: 'medium', members });
  }
  for (const identity of unmatched) {
    groups.push({ confidence: 'high', members: [identity] });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Per-domain enrichment (crm / marketing / payments)
// ---------------------------------------------------------------------------

/**
 * Resolves the CRM block for a GHL contact by finding its most relevant
 * opportunity: the most recently status-changed open opportunity if one
 * exists, otherwise the most recently created opportunity of any status.
 * Returns `null` when the contact has no opportunities — never fabricated.
 */
async function resolveGhlCrmInfo(contactId: string) {
  const result = await ghlServiceModule.searchOpportunities({ contactId, limit: 20 });
  if (result.items.length === 0) return null;

  const open = result.items.filter((o) => (o.status ?? '').toLowerCase() === 'open');
  const pool = open.length > 0 ? open : result.items;
  const best = pool.reduce((latest, current) => {
    const latestTime = Date.parse(latest.lastStatusChangeAt ?? latest.createdAt ?? '') || 0;
    const currentTime = Date.parse(current.lastStatusChangeAt ?? current.createdAt ?? '') || 0;
    return currentTime > latestTime ? current : latest;
  });

  const pipelines = await ghlServiceModule.listPipelines();
  return crmInfoFromGhlOpportunity(best, pipelines);
}

/** Resolves the marketing block for an email via an exact Brevo lookup. `null` if not a Brevo contact. */
async function resolveBrevoMarketingInfo(email: string) {
  let contact;
  try {
    contact = await brevoServiceModule.getContact(email);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
  const listsPage = await brevoServiceModule.listLists({ limit: 200, offset: 0 });
  const names = brevoListNameMap(listsPage.items);
  return marketingInfoFromBrevoContact(contact, names);
}

/** Resolves the payments block for an email via an exact (strongly-consistent) Stripe lookup. */
async function resolveStripePaymentsInfo(
  email: string,
  known?: StripeCustomerRecord,
): Promise<PaymentsInfo | null> {
  const customer = known ?? (await stripeServiceModule.findCustomersByEmail(email, 1))[0];
  if (!customer) return null;
  // getPaymentSummary already returns a fully-built PaymentsInfo (source,
  // sourceId, totalSpent in major units, currency, lastPaymentAt,
  // subscriptionStatus) plus successfulPaymentCount/truncated extras we
  // don't need here — pick out just the PaymentsInfo fields.
  const { source, sourceId, totalSpent, currency, lastPaymentAt, subscriptionStatus } =
    await stripeServiceModule.getPaymentSummary(customer.id);
  return { source, sourceId, totalSpent, currency, lastPaymentAt, subscriptionStatus };
}

// ---------------------------------------------------------------------------
// Building a UnifiedCustomer from a correlated group
// ---------------------------------------------------------------------------

interface BuildContext {
  requestedSources: SourceSystem[];
  ghlContactsById?: Map<string, GhlContact>;
  stripeCustomersById?: Map<string, StripeCustomerRecord>;
}

export async function buildUnifiedCustomer(
  group: MatchGroup,
  ctx: BuildContext,
): Promise<UnifiedCustomer> {
  const { name, email, phone } = mergeIdentities(group.members);
  const sources: SourceRef[] = group.members.map((m) => m.source);

  const ghlMember = group.members.find((m) => m.source.system === 'ghl');
  const stripeMember = group.members.find((m) => m.source.system === 'stripe');

  const [crm, marketing, payments] = await Promise.all([
    ghlMember && ctx.requestedSources.includes('ghl')
      ? resolveGhlCrmInfo(ghlMember.source.id)
      : Promise.resolve(null),
    email && ctx.requestedSources.includes('brevo')
      ? resolveBrevoMarketingInfo(email)
      : Promise.resolve(null),
    email && ctx.requestedSources.includes('stripe')
      ? resolveStripePaymentsInfo(
          email,
          stripeMember ? ctx.stripeCustomersById?.get(stripeMember.source.id) : undefined,
        )
      : Promise.resolve(null),
  ]);

  const idSeed =
    email ?? phone ?? `${sources[0]?.system ?? 'unknown'}:${sources[0]?.id ?? name ?? 'unknown'}`;

  return {
    id: generateOpsCustomerId(idSeed),
    name,
    email,
    phone,
    sources,
    crm,
    marketing,
    payments,
  };
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export interface UnifiedSearchResult {
  customers: UnifiedCustomer[];
  truncated: boolean;
}

/**
 * Builds a UnifiedCustomer for one confirmed email by looking it up exactly
 * in each requested, enabled source. Used whenever we already know the
 * email (customer_360 by email, sync_customer, add_customer_to_marketing,
 * customer_note) — deterministic, no ambiguity, no free-text fan-out.
 */
export async function getUnifiedCustomerByEmail(
  email: string,
  requestedSources?: SourceSystem[],
): Promise<UnifiedCustomer | null> {
  const sources = resolveSources(requestedSources);
  const normalized = normalizeEmail(email);
  if (!normalized) throw new ValidationError('A valid email is required.');

  const identities: NormalizedIdentity[] = [];
  const ghlContactsById = new Map<string, GhlContact>();
  const stripeCustomersById = new Map<string, StripeCustomerRecord>();

  if (sources.includes('ghl')) {
    const result = await ghlServiceModule.searchContacts({ query: normalized, limit: 10 });
    for (const c of result.items) {
      if (normalizeEmail(c.email) === normalized) {
        identities.push(identityFromGhlContact(c));
        ghlContactsById.set(c.id, c);
      }
    }
  }
  if (sources.includes('brevo')) {
    try {
      const contact = await brevoServiceModule.getContact(normalized);
      identities.push(identityFromBrevoContact(contact));
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
  }
  if (sources.includes('stripe')) {
    const customers = await stripeServiceModule.findCustomersByEmail(normalized, 5);
    for (const c of customers) {
      identities.push(identityFromStripeCustomer(c));
      stripeCustomersById.set(c.id, c);
    }
  }

  if (identities.length === 0) return null;

  // All identities here share the same normalized email by construction,
  // so correlateIdentities always yields exactly one high-confidence group.
  const [group] = correlateIdentities(identities);
  if (!group) return null;
  return buildUnifiedCustomer(group, {
    requestedSources: sources,
    ghlContactsById,
    stripeCustomersById,
  });
}

/**
 * Free-text / email cross-system search (spec §5 search_customers, §9
 * unified_customer_search). An email-shaped query goes straight to the
 * deterministic exact-match path. A name/phone query fans out to the
 * sources that actually support search (GHL, Stripe — see spec §7 note:
 * Brevo has no free-text search) and correlates the results; each
 * candidate is then enriched with a Brevo lookup by its resolved email,
 * regardless of whether Brevo itself surfaced it.
 */
export async function searchCustomers(options: {
  query: string;
  sources?: SourceSystem[] | undefined;
  limit?: number | undefined;
}): Promise<UnifiedSearchResult> {
  const query = options.query.trim();
  if (!query) throw new ValidationError('query cannot be empty.');
  const limit = clampLimit(options.limit);
  const sources = resolveSources(options.sources);

  if (looksLikeEmail(query)) {
    const customer = await getUnifiedCustomerByEmail(query, sources);
    return { customers: customer ? [customer] : [], truncated: false };
  }

  const identities: NormalizedIdentity[] = [];
  const ghlContactsById = new Map<string, GhlContact>();
  const stripeCustomersById = new Map<string, StripeCustomerRecord>();

  if (sources.includes('ghl')) {
    const result = await ghlServiceModule.searchContacts({
      query,
      limit: Math.min(limit * 2, MAX_SCAN),
    });
    for (const c of result.items) {
      identities.push(identityFromGhlContact(c));
      ghlContactsById.set(c.id, c);
    }
  }
  if (sources.includes('stripe')) {
    try {
      const customers = await stripeServiceModule.searchCustomers({
        query: `name~"${escapeStripeQueryValue(query)}"`,
        limit: Math.min(limit * 2, MAX_SCAN),
      });
      for (const c of customers) {
        identities.push(identityFromStripeCustomer(c));
        stripeCustomersById.set(c.id, c);
      }
    } catch {
      // Stripe's search query language may reject an unusual query string
      // (e.g. containing quotes); free-text customer search degrades to
      // GHL-only results rather than failing the whole tool call.
    }
  }

  const groups = correlateIdentities(identities);
  const limited = groups.slice(0, limit);
  const customers = await Promise.all(
    limited.map((g) =>
      buildUnifiedCustomer(g, { requestedSources: sources, ghlContactsById, stripeCustomersById }),
    ),
  );

  return { customers, truncated: groups.length > limited.length };
}

function escapeStripeQueryValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/** Distinct match candidates for a query, annotated with confidence — used by unified_customer_search. */
export async function unifiedCustomerSearch(options: {
  query: string;
  sources?: SourceSystem[] | undefined;
  limit?: number | undefined;
}): Promise<MatchCandidate<UnifiedCustomer>[]> {
  const { customers } = await searchCustomers(options);
  return customers.map((customer) => ({
    record: customer,
    confidence: customer.sources.length > 1 ? 'high' : 'medium',
    reason:
      customer.sources.length > 1
        ? `Matched across ${customer.sources.map((s) => s.system).join(', ')} by email/phone.`
        : `Found only in ${customer.sources[0]?.system ?? 'one system'}; no corroborating match in other sources.`,
  }));
}

// ---------------------------------------------------------------------------
// customer_360 / get_customer_activity
// ---------------------------------------------------------------------------

export interface Customer360Result {
  customer: UnifiedCustomer | null;
  /** Populated instead of `customer` when the query matched multiple distinct people. */
  candidates: MatchCandidate<UnifiedCustomer>[];
}

/**
 * Resolves a query to exactly one UnifiedCustomer ("everything we know
 * about John Smith" — spec §9 customer_360). If the query matches more
 * than one distinct person (correlation never merges by name alone, so two
 * real "John Smith"s stay separate — spec §10), no single customer is
 * chosen; the candidates are returned instead so the caller can
 * disambiguate rather than silently picking one.
 */
export async function customer360(options: {
  query: string;
  sources?: SourceSystem[] | undefined;
}): Promise<Customer360Result> {
  const { customers } = await searchCustomers({ ...options, limit: 5 });
  if (customers.length === 0) return { customer: null, candidates: [] };
  const [single] = customers;
  if (customers.length === 1 && single) return { customer: single, candidates: [] };

  const candidates: MatchCandidate<UnifiedCustomer>[] = customers.map((customer) => ({
    record: customer,
    confidence: customer.sources.length > 1 ? 'high' : 'low',
    reason: `One of ${customers.length} distinct people matching "${options.query}" — disambiguate by email or a source id.`,
  }));
  return { customer: null, candidates };
}

export interface CustomerActivity {
  ghl: { opportunities: unknown[]; notes: unknown[] } | null;
  brevo: {
    subscribed: boolean;
    lists: MarketingListMembership[];
    recentCampaignActivity: unknown;
  } | null;
  stripe: { payments: unknown[]; invoices: unknown[]; subscriptions: unknown[] } | null;
}

export interface CustomerActivityResult {
  customer: UnifiedCustomer | null;
  candidates: MatchCandidate<UnifiedCustomer>[];
  activity: CustomerActivity | null;
}

/**
 * Retrieves a customer's activity grouped by source (spec §5
 * get_customer_activity): GHL opportunities/notes, Brevo subscription +
 * list membership + recent campaign engagement, and Stripe
 * payments/invoices/subscriptions. Each group is bounded (20 records) —
 * this is an activity feed, not a full export.
 */
export async function getCustomerActivity(options: {
  query: string;
  sources?: SourceSystem[] | undefined;
}): Promise<CustomerActivityResult> {
  const { customer, candidates } = await customer360(options);
  if (!customer) return { customer: null, candidates, activity: null };

  const sources = resolveSources(options.sources);
  const ghlRef = customer.sources.find((s) => s.system === 'ghl');
  const stripeRef = customer.sources.find((s) => s.system === 'stripe');

  const [ghlActivity, brevoActivity, stripeActivity] = await Promise.all([
    ghlRef && sources.includes('ghl')
      ? Promise.all([
          ghlServiceModule.searchOpportunities({ contactId: ghlRef.id, limit: 20 }),
          ghlServiceModule.listContactNotes(ghlRef.id),
        ]).then(([opportunities, notes]) => ({ opportunities: opportunities.items, notes }))
      : Promise.resolve(null),
    customer.email && sources.includes('brevo')
      ? brevoServiceModule
          .getContact(customer.email)
          .then((contact) => ({
            subscribed: !contact.emailBlacklisted,
            lists: customer.marketing?.lists ?? [],
            recentCampaignActivity: contact.statistics ?? null,
          }))
          .catch((err: unknown) => {
            if (err instanceof NotFoundError) return null;
            throw err;
          })
      : Promise.resolve(null),
    stripeRef && sources.includes('stripe')
      ? Promise.all([
          stripeServiceModule.getCustomerPayments(stripeRef.id, { limit: 20 }),
          stripeServiceModule.getCustomerInvoices(stripeRef.id, { limit: 20 }),
          stripeServiceModule.getCustomerSubscriptions(stripeRef.id, { limit: 20 }),
        ]).then(([payments, invoices, subscriptions]) => ({
          payments: payments.items,
          invoices: invoices.items,
          subscriptions: subscriptions.items,
        }))
      : Promise.resolve(null),
  ]);

  return {
    customer,
    candidates: [],
    activity: {
      ghl: ghlActivity,
      brevo: brevoActivity as CustomerActivity['brevo'],
      stripe: stripeActivity,
    },
  };
}

// ---------------------------------------------------------------------------
// find_customers_by_conditions — controlled cross-system query (spec §9)
// ---------------------------------------------------------------------------

export interface CustomerConditions {
  purchased?: boolean;
  marketingSubscribed?: boolean;
  crmStatus?: string;
  minTotalSpent?: number;
  currency?: string;
  listId?: number;
  limit?: number | undefined;
}

export interface FindCustomersResult {
  customers: UnifiedCustomer[];
  truncated: boolean;
  scanned: number;
}

interface CandidateHint {
  stripeCustomerId?: string;
}

/**
 * Cross-system filtering with a closed, ANDed condition set — not
 * arbitrary SQL (spec §9). Every condition here can be answered with a
 * bounded scan (spec §11): a "positive"/bounded condition
 * (`purchased: true`, `marketingSubscribed: true`, `listId`, or
 * `crmStatus`) drives an initial candidate scan, and any other condition
 * — including a negative one like `purchased: false` — is then checked
 * per candidate. A query made only of negative/unbounded conditions (e.g.
 * `marketingSubscribed: false` alone, which would mean "scan everyone not
 * on this list") is rejected rather than silently scanning without bound.
 */
export async function findCustomersByConditions(
  conditions: CustomerConditions,
): Promise<FindCustomersResult> {
  const limit = clampLimit(conditions.limit);
  const sources = enabledSources();

  const driveFromStripe = conditions.purchased === true || conditions.minTotalSpent !== undefined;
  const driveFromBrevo =
    !driveFromStripe &&
    (conditions.marketingSubscribed === true || conditions.listId !== undefined);
  const driveFromGhl = !driveFromStripe && !driveFromBrevo && conditions.crmStatus !== undefined;

  if (!driveFromStripe && !driveFromBrevo && !driveFromGhl) {
    throw new ValidationError(
      'At least one bounded condition is required to drive this search: purchased: true, ' +
        'marketing_subscribed: true, list_id, or crm_status. A negative condition alone ' +
        '(e.g. purchased: false or marketing_subscribed: false) cannot drive a search — combine ' +
        'it with a bounded condition instead.',
    );
  }

  const candidates = new Map<string, CandidateHint>();
  let truncated = false;
  let scanned = 0;

  if (driveFromStripe) {
    if (!sources.includes('stripe')) {
      throw new ValidationError('This query needs Stripe, which is not enabled on this server.');
    }
    const { customers: payers, truncated: t } = await stripeServiceModule.scanPayingCustomers();
    truncated = truncated || t;
    scanned += payers.length;
    for (const payer of payers) {
      if (conditions.minTotalSpent !== undefined && payer.totalSpent < conditions.minTotalSpent)
        continue;
      if (
        conditions.currency &&
        payer.currency?.toLowerCase() !== conditions.currency.toLowerCase()
      )
        continue;
      const customer = await stripeServiceModule.getCustomer(payer.customerId).catch(() => null);
      const email = normalizeEmail(customer?.email);
      if (email) candidates.set(email, { stripeCustomerId: payer.customerId });
    }
  } else if (driveFromBrevo) {
    if (!sources.includes('brevo')) {
      throw new ValidationError('This query needs Brevo, which is not enabled on this server.');
    }
    let offset = 0;
    let hasMore = true;
    while (hasMore && scanned < MAX_SCAN) {
      const page = await brevoServiceModule.searchContacts({
        limit: 100,
        offset,
        ...(conditions.listId !== undefined ? { listId: conditions.listId } : {}),
      });
      scanned += page.items.length;
      offset += page.items.length;
      hasMore = page.hasMore;
      for (const contact of page.items) {
        if (contact.emailBlacklisted) continue; // marketing_subscribed: true implies not opted out
        const email = normalizeEmail(contact.email);
        if (email) candidates.set(email, {});
      }
    }
    if (hasMore) truncated = true;
  } else {
    if (!sources.includes('ghl')) {
      throw new ValidationError('This query needs GHL, which is not enabled on this server.');
    }
    const result = await ghlServiceModule.searchOpportunities({
      status: conditions.crmStatus,
      limit: Math.min(100, MAX_SCAN),
    });
    scanned += result.items.length;
    if (result.hasMore) truncated = true;
    for (const opportunity of result.items) {
      if (!opportunity.contactId) continue;
      const contact = await ghlServiceModule.getContact(opportunity.contactId).catch(() => null);
      const email = normalizeEmail(contact?.email);
      if (email) candidates.set(email, {});
    }
  }

  const survivors: string[] = [];
  for (const [email] of candidates) {
    if (survivors.length >= limit) break;

    // marketing_subscribed / list_id: skip re-checking when Brevo already
    // drove the scan (its query already enforced these).
    if (!driveFromBrevo && conditions.marketingSubscribed !== undefined) {
      const marketing = await resolveBrevoMarketingInfo(email);
      const isSubscribed = marketing?.subscribed ?? false;
      if (isSubscribed !== conditions.marketingSubscribed) continue;
      if (
        conditions.listId !== undefined &&
        !(marketing?.lists.some((l) => l.id === String(conditions.listId)) ?? false)
      ) {
        continue;
      }
    }

    // purchased / min_total_spent: skip re-checking when Stripe already
    // drove the scan (its query already enforced these).
    if (
      !driveFromStripe &&
      (conditions.purchased !== undefined || conditions.minTotalSpent !== undefined)
    ) {
      const payments = await resolveStripePaymentsInfo(email);
      const hasPurchased = (payments?.totalSpent ?? 0) > 0;
      if (conditions.purchased !== undefined && hasPurchased !== conditions.purchased) continue;
      if (
        conditions.minTotalSpent !== undefined &&
        (payments?.totalSpent ?? 0) < conditions.minTotalSpent
      )
        continue;
    }

    // crm_status: skip re-checking when GHL already drove the scan.
    if (!driveFromGhl && conditions.crmStatus !== undefined) {
      const ghlMatches = await ghlServiceModule.searchContacts({ query: email, limit: 5 });
      const exact = ghlMatches.items.find((c) => normalizeEmail(c.email) === email);
      const crm = exact ? await resolveGhlCrmInfo(exact.id) : null;
      if ((crm?.status ?? '').toLowerCase() !== conditions.crmStatus.toLowerCase()) continue;
    }

    survivors.push(email);
  }

  const customers = await Promise.all(survivors.map((email) => getUnifiedCustomerByEmail(email)));
  return {
    customers: customers.filter((c): c is UnifiedCustomer => c !== null),
    truncated,
    scanned,
  };
}

// ---------------------------------------------------------------------------
// sync_customer
// ---------------------------------------------------------------------------

const SYNCABLE_SYSTEMS: SourceSystem[] = ['ghl', 'brevo'];

export interface SyncCustomerInput {
  email: string;
  from: SourceSystem;
  to: SourceSystem;
  /** Execute the sync. Without this, the planned change is returned but not applied. */
  confirm?: boolean | undefined;
}

export interface SyncCustomerResult {
  changed: boolean;
  preview: boolean;
  reason: string;
  plan?: { name: string | null; email: string; phone: string | null };
  created?: { system: SourceSystem; id: string | undefined };
}

/**
 * Synchronizes a customer's existence between two systems (spec §9): e.g.
 * "create John in Brevo if he exists in GHL but not Brevo." Follows the
 * spec's required sequence — check existence in both systems, avoid
 * duplicates, validate required fields, only then act — and, per the
 * project's write-safety policy, previews the planned change rather than
 * applying it unless `confirm: true` is passed.
 *
 * V1 only supports GHL <-> Brevo. Stripe customers are never
 * auto-created from CRM/marketing data — that has billing implications
 * out of scope for this tool (spec §29).
 */
export async function syncCustomer(input: SyncCustomerInput): Promise<SyncCustomerResult> {
  if (!SYNCABLE_SYSTEMS.includes(input.from) || !SYNCABLE_SYSTEMS.includes(input.to)) {
    throw new ValidationError(
      'sync_customer supports only "ghl" and "brevo" as from/to (not "stripe").',
    );
  }
  if (input.from === input.to) {
    throw new ValidationError('from and to must be different systems.');
  }
  const sources = enabledSources();
  if (!sources.includes(input.from) || !sources.includes(input.to)) {
    throw new ValidationError(`Both ${input.from} and ${input.to} must be enabled on this server.`);
  }

  const email = normalizeEmail(input.email);
  if (!email) throw new ValidationError('A valid email is required.');

  const unified = await getUnifiedCustomerByEmail(email, [input.from, input.to]);
  const existsInSource = unified?.sources.some((s) => s.system === input.from) ?? false;
  if (!existsInSource) {
    return {
      changed: false,
      preview: false,
      reason: `No ${input.from} record found for ${email}; nothing to sync.`,
    };
  }
  const existsInTarget = unified?.sources.some((s) => s.system === input.to) ?? false;
  if (existsInTarget) {
    return {
      changed: false,
      preview: false,
      reason: `${email} already exists in ${input.to}; nothing to do.`,
    };
  }

  const plan = { name: unified?.name ?? null, email, phone: unified?.phone ?? null };

  if (!input.confirm) {
    return {
      changed: false,
      preview: true,
      reason: `Would create ${email} in ${input.to}, copied from ${input.from}. Pass confirm: true to apply.`,
      plan,
    };
  }

  if (input.to === 'brevo') {
    const id = await brevoServiceModule.createContact({
      email,
      ...(plan.name ? { attributes: { FIRSTNAME: plan.name.split(' ')[0] ?? plan.name } } : {}),
    });
    return {
      changed: true,
      preview: false,
      reason: `Created ${email} in Brevo, copied from GHL.`,
      plan,
      created: { system: 'brevo', id: id.id !== undefined ? String(id.id) : undefined },
    };
  }

  // to === 'ghl'
  if (!plan.email) {
    throw new ValidationError('Cannot create a GHL contact without an email.');
  }
  const created = await ghlServiceModule.createContact({
    email: plan.email,
    ...(plan.name ? { name: plan.name } : {}),
    ...(plan.phone ? { phone: plan.phone } : {}),
  });
  return {
    changed: true,
    preview: false,
    reason: `Created ${email} in GHL, copied from Brevo.`,
    plan,
    created: { system: 'ghl', id: created?.id },
  };
}

// ---------------------------------------------------------------------------
// add_customer_to_marketing
// ---------------------------------------------------------------------------

export interface AddToMarketingInput {
  /** One email for a single, immediate add; more than one is treated as a bulk operation. */
  emails: string[];
  listId: number;
  /** Required to execute a bulk (2+) add; a single-email add executes without it. */
  confirm?: boolean | undefined;
}

export type AddToMarketingAction =
  'added' | 'already_member' | 'would_add' | 'skipped_not_found' | 'skipped_consent' | 'error';

export interface AddToMarketingOutcome {
  email: string;
  action: AddToMarketingAction;
  detail?: string;
}

export interface AddToMarketingResult {
  listId: number;
  listName: string;
  /** True when this was a bulk call previewed rather than executed — see `outcomes` for the plan. */
  preview: boolean;
  outcomes: AddToMarketingOutcome[];
}

/**
 * Adds customers to a Brevo marketing list, following the spec §9
 * sequence: confirm the customer exists, confirm the list exists, check
 * existing membership, skip duplicates, and respect marketing consent —
 * a Brevo-blacklisted (opted-out) contact is never added, `confirm` or
 * not. Consent is never inferred from the fact that this tool was called.
 * A single email executes immediately; 2+ emails (a bulk add) are
 * previewed unless `confirm: true` is passed, per the project's write-
 * safety policy. Every email gets its own outcome — a failure on one
 * never stops the others.
 */
export async function addCustomerToMarketing(
  input: AddToMarketingInput,
): Promise<AddToMarketingResult> {
  if (!enabledSources().includes('brevo')) {
    throw new ValidationError(
      'add_customer_to_marketing requires Brevo, which is not enabled on this server.',
    );
  }
  if (input.emails.length === 0) {
    throw new ValidationError('At least one email is required.');
  }

  const list = await brevoServiceModule.getList(input.listId);
  const isBulk = input.emails.length > 1;
  const preview = isBulk && input.confirm !== true;

  const outcomes: AddToMarketingOutcome[] = [];

  for (const rawEmail of input.emails) {
    const email = normalizeEmail(rawEmail);
    if (!email) {
      outcomes.push({ email: rawEmail, action: 'error', detail: 'Not a valid email address.' });
      continue;
    }

    const unified = await getUnifiedCustomerByEmail(email, ['ghl', 'brevo', 'stripe']);
    if (!unified) {
      outcomes.push({
        email,
        action: 'skipped_not_found',
        detail: 'No matching customer found in any connected system.',
      });
      continue;
    }

    let brevoContact;
    try {
      brevoContact = await brevoServiceModule.getContact(email);
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }

    if (brevoContact?.emailBlacklisted) {
      outcomes.push({
        email,
        action: 'skipped_consent',
        detail: 'Contact has opted out of email (blacklisted) in Brevo; not added.',
      });
      continue;
    }
    if (brevoContact?.listIds.includes(input.listId)) {
      outcomes.push({ email, action: 'already_member' });
      continue;
    }

    if (preview) {
      outcomes.push({ email, action: 'would_add' });
      continue;
    }

    try {
      if (brevoContact) {
        await brevoServiceModule.addContactToList(input.listId, { emails: [email] });
      } else {
        await brevoServiceModule.createContact({ email, listIds: [input.listId] });
      }
      outcomes.push({ email, action: 'added' });
    } catch (err) {
      outcomes.push({
        email,
        action: 'error',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { listId: input.listId, listName: list.name, preview, outcomes };
}

// ---------------------------------------------------------------------------
// customer_note
// ---------------------------------------------------------------------------

export interface CustomerNoteInput {
  email: string;
  note: string;
}

export interface CustomerNoteResult {
  ghlContactId: string;
  noteId: string | undefined;
}

/**
 * Adds a note to a customer's GHL contact record, prefixed to clearly
 * identify it as OpsBridge-created (spec §9) — e.g. documenting that a
 * Brevo or Stripe action was taken elsewhere. Finds the contact by exact
 * email; throws NotFoundError if the person has no GHL record, rather
 * than creating one implicitly (use sync_customer for that, explicitly).
 */
export async function customerNote(input: CustomerNoteInput): Promise<CustomerNoteResult> {
  if (!enabledSources().includes('ghl')) {
    throw new ValidationError('customer_note requires GHL, which is not enabled on this server.');
  }
  const email = normalizeEmail(input.email);
  if (!email) throw new ValidationError('A valid email is required.');

  const matches = await ghlServiceModule.searchContacts({ query: email, limit: 5 });
  const exact = matches.items.find((c) => normalizeEmail(c.email) === email);
  if (!exact) {
    throw new NotFoundError(
      `No GHL contact found for ${email}; cannot add a note. Use sync_customer to create one first if appropriate.`,
      { integration: 'ghl' },
    );
  }

  const body = `[OpsBridge] ${input.note}`;
  const note = await ghlServiceModule.addContactNote(exact.id, body);
  return { ghlContactId: exact.id, noteId: note?.id };
}
