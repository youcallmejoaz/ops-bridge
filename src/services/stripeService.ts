import {
  computeStripePaymentSummary,
  getStripeCustomer,
  getStripeCustomerInvoices,
  getStripeCustomerPayments,
  getStripeCustomerSubscriptions,
  listStripeCustomersByEmail,
  scanSucceededPaymentIntents,
  searchStripeCustomers,
} from '../integrations/stripe/client.js';
import { NotFoundError } from '../errors/errors.js';
import { paymentsInfoFromStripeSummary, stripeAmountToMajorUnits } from './normalizationService.js';
import { MAX_SCAN, clampLimit } from '../utils/pagination.js';

/**
 * Business logic for Stripe tools. Stripe's own SDK types and pagination
 * are reliable (spec §31 — verified against the current `stripe` package),
 * so this layer mostly adds cursor-based pagination and the payment-summary
 * aggregation the spec's stripe_get_payment_summary tool needs.
 */

export async function searchCustomers(input: { query: string; limit?: number | undefined }) {
  const limit = clampLimit(input.limit);
  return searchStripeCustomers(input.query, limit);
}

/** Strongly-consistent alternative to searchCustomers for an exact email match — see integrations/stripe/client.ts. */
export async function findCustomersByEmail(email: string, limit?: number) {
  return listStripeCustomersByEmail(email, clampLimit(limit));
}

export async function getCustomer(customerId: string) {
  const customer = await getStripeCustomer(customerId);
  if (!customer) {
    throw new NotFoundError(`Stripe customer ${customerId} was not found (or has been deleted).`, {
      integration: 'stripe',
    });
  }
  return customer;
}

export async function getCustomerPayments(
  customerId: string,
  input: { limit?: number | undefined; cursor?: string | undefined },
) {
  const limit = clampLimit(input.limit);
  const page = await getStripeCustomerPayments(customerId, {
    limit,
    ...(input.cursor !== undefined ? { startingAfter: input.cursor } : {}),
  });
  const last = page.items.at(-1);
  return {
    items: page.items,
    hasMore: page.hasMore,
    ...(page.hasMore && last ? { nextCursor: last.id } : {}),
  };
}

export async function getCustomerInvoices(
  customerId: string,
  input: { limit?: number | undefined; cursor?: string | undefined },
) {
  const limit = clampLimit(input.limit);
  const page = await getStripeCustomerInvoices(customerId, {
    limit,
    ...(input.cursor !== undefined ? { startingAfter: input.cursor } : {}),
  });
  const last = page.items.at(-1);
  return {
    items: page.items,
    hasMore: page.hasMore,
    ...(page.hasMore && last ? { nextCursor: last.id } : {}),
  };
}

export async function getCustomerSubscriptions(
  customerId: string,
  input: { limit?: number | undefined; cursor?: string | undefined },
) {
  const limit = clampLimit(input.limit);
  const page = await getStripeCustomerSubscriptions(customerId, {
    limit,
    ...(input.cursor !== undefined ? { startingAfter: input.cursor } : {}),
  });
  const last = page.items.at(-1);
  return {
    items: page.items,
    hasMore: page.hasMore,
    ...(page.hasMore && last ? { nextCursor: last.id } : {}),
  };
}

export async function getPaymentSummary(customerId: string) {
  const summary = await computeStripePaymentSummary(customerId);
  const payments = paymentsInfoFromStripeSummary(customerId, {
    totalPaid: summary.totalPaid,
    currency: summary.currency,
    latestPaymentAt: summary.latestPaymentAt,
    subscriptionStatus: summary.subscriptionStatus,
  });
  return {
    ...payments,
    successfulPaymentCount: summary.successfulPaymentCount,
    truncated: summary.truncated,
  };
}

export interface PayingCustomerAggregate {
  customerId: string;
  totalSpent: number;
  currency: string | null;
  paymentCount: number;
  latestPaymentAt: string | null;
}

/**
 * Finds customers who have at least one succeeded payment, via a single
 * bounded account-wide scan of payment intents (see
 * integrations/stripe/client.ts.scanSucceededPaymentIntents) rather than
 * checking each customer individually. Used by
 * customerService.findCustomersByConditions for the `purchased` condition.
 */
export async function scanPayingCustomers(
  maxScan = MAX_SCAN,
): Promise<{ customers: PayingCustomerAggregate[]; truncated: boolean }> {
  const { byCustomer, truncated } = await scanSucceededPaymentIntents(maxScan);
  const customers = [...byCustomer.values()].map((agg) => ({
    customerId: agg.customerId,
    totalSpent: stripeAmountToMajorUnits(agg.totalPaidMinorUnits, agg.currency),
    currency: agg.currency,
    paymentCount: agg.paymentCount,
    latestPaymentAt: agg.latestPaymentAt
      ? new Date(agg.latestPaymentAt * 1000).toISOString()
      : null,
  }));
  return { customers, truncated };
}
