import type { SourceRef } from './common.js';

/**
 * CRM standing, populated only from GHL. `pipeline`/`stage` reflect the
 * contact's most relevant open opportunity — see
 * normalizationService.crmInfoFromGhlOpportunity. `null` when the contact
 * has no GHL opportunity, not fabricated.
 */
export interface CrmInfo {
  source: 'ghl';
  sourceId: string;
  status: string | null;
  pipeline: string | null;
  stage: string | null;
}

export interface MarketingListMembership {
  id: string;
  name: string | null;
}

/**
 * Marketing standing, populated only from Brevo. `subscribed` reflects
 * `!emailBlacklisted` — Brevo's hard opt-out signal — not merely "is on a
 * list"; see spec §9 (never assume consent).
 */
export interface MarketingInfo {
  source: 'brevo';
  sourceId: string;
  subscribed: boolean;
  lists: MarketingListMembership[];
}

/**
 * Payment standing, populated only from Stripe. Always fetched fresh (no
 * caching — spec §16). `null` when no Stripe customer was found, not
 * zeroed.
 */
export interface PaymentsInfo {
  source: 'stripe';
  sourceId: string;
  totalSpent: number;
  currency: string | null;
  lastPaymentAt: string | null;
  subscriptionStatus: string | null;
}

/**
 * The unified customer/contact representation (spec §4). A field or block
 * is `null` when the owning system has no data for it — never a fabricated
 * default. `id` is deterministic: a hash of the customer's normalized match
 * key (see normalizationService.generateOpsCustomerId), so repeated calls
 * against a stateless server yield the same id for the same person without
 * server-side storage.
 */
export interface UnifiedCustomer {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  sources: SourceRef[];
  crm: CrmInfo | null;
  marketing: MarketingInfo | null;
  payments: PaymentsInfo | null;
}
