import type { SourceSystem } from './common.js';

/**
 * A normalized payment-related event, used to answer "what has this
 * customer purchased" (spec §5 get_customer_activity, §9
 * find_customers_by_conditions). V1 only sources these from Stripe
 * (payment intents, invoices); the `kind` field leaves room for GHL
 * payments or another provider to populate the same shape later without
 * changing consumers.
 */
export type OrderKind = 'payment' | 'invoice' | 'subscription';

export interface NormalizedOrder {
  id: string;
  source: SourceSystem;
  sourceId: string;
  /** The Stripe (or future provider) customer id this order belongs to. */
  customerSourceId: string;
  kind: OrderKind;
  amount: number;
  currency: string;
  status: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}
