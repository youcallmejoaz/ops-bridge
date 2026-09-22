import Stripe from 'stripe';
import { env } from '../../config/env.js';
import {
  AuthenticationError,
  AuthorizationError,
  ConfigurationError,
  ExternalAPIError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '../../errors/errors.js';
import {
  stripeCustomerSchema,
  stripeInvoiceSchema,
  stripePaymentIntentSchema,
  stripeSubscriptionSchema,
} from './types.js';

/** Maps a Stripe SDK error to our typed error hierarchy. */
function mapStripeError(err: unknown): Error {
  if (err instanceof Stripe.errors.StripeAuthenticationError) {
    return new AuthenticationError(
      'Stripe authentication failed. Check the configured STRIPE_SECRET_KEY.',
      { integration: 'stripe' },
    );
  }
  if (err instanceof Stripe.errors.StripePermissionError) {
    return new AuthorizationError(
      'Stripe rejected this request: the configured key lacks permission for this operation.',
      { integration: 'stripe' },
    );
  }
  if (err instanceof Stripe.errors.StripeInvalidRequestError) {
    if (err.code === 'resource_missing') {
      return new NotFoundError('The requested Stripe record was not found.', {
        integration: 'stripe',
      });
    }
    return new ValidationError(`Stripe rejected the request: ${err.message}`, {
      integration: 'stripe',
    });
  }
  if (err instanceof Stripe.errors.StripeRateLimitError) {
    return new RateLimitError('Stripe rate limit exceeded. Please retry shortly.', {
      integration: 'stripe',
    });
  }
  if (err instanceof Stripe.errors.StripeConnectionError) {
    return new ExternalAPIError('Could not connect to Stripe.', { integration: 'stripe' });
  }
  if (err instanceof Stripe.errors.StripeError) {
    return new ExternalAPIError(`Stripe request failed: ${err.message}`, {
      integration: 'stripe',
      ...(err.statusCode !== undefined ? { statusCode: err.statusCode } : {}),
    });
  }
  return new ExternalAPIError(
    `Unexpected error calling Stripe: ${err instanceof Error ? err.message : String(err)}`,
    { integration: 'stripe', cause: err },
  );
}

let cachedClient: Stripe | undefined;

function getClient(): Stripe {
  if (cachedClient) return cachedClient;
  if (!env.STRIPE_SECRET_KEY) {
    throw new ConfigurationError(
      'Stripe integration is enabled but STRIPE_SECRET_KEY is not configured.',
      {
        integration: 'stripe',
      },
    );
  }
  cachedClient = new Stripe(env.STRIPE_SECRET_KEY, {
    maxNetworkRetries: 2,
    timeout: 20000,
  });
  return cachedClient;
}

export interface StripePageParams {
  limit: number;
  startingAfter?: string;
}

/**
 * Stripe's `customers.search` uses Stripe's query language and is
 * eventually consistent — newly created/updated customers can take up to
 * ~1 minute to appear. Callers needing the freshest data for a known email
 * should prefer `listStripeCustomersByEmail` (a `list` call, strongly
 * consistent) when only an exact email match is needed.
 */
export async function searchStripeCustomers(query: string, limit: number) {
  try {
    const client = getClient();
    const result = await client.customers.search({ query, limit });
    return result.data.map((c) => stripeCustomerSchema.parse(c));
  } catch (err) {
    throw mapStripeError(err);
  }
}

export async function listStripeCustomersByEmail(email: string, limit: number) {
  try {
    const client = getClient();
    const result = await client.customers.list({ email, limit });
    return result.data.map((c) => stripeCustomerSchema.parse(c));
  } catch (err) {
    throw mapStripeError(err);
  }
}

export async function getStripeCustomer(customerId: string) {
  try {
    const client = getClient();
    const customer = await client.customers.retrieve(customerId);
    if (customer.deleted) return undefined;
    return stripeCustomerSchema.parse(customer);
  } catch (err) {
    throw mapStripeError(err);
  }
}

export async function getStripeCustomerPayments(customerId: string, params: StripePageParams) {
  try {
    const client = getClient();
    const result = await client.paymentIntents.list({
      customer: customerId,
      limit: params.limit,
      ...(params.startingAfter !== undefined ? { starting_after: params.startingAfter } : {}),
    });
    return {
      items: result.data.map((p) => stripePaymentIntentSchema.parse(p)),
      hasMore: result.has_more,
    };
  } catch (err) {
    throw mapStripeError(err);
  }
}

export async function getStripeCustomerInvoices(customerId: string, params: StripePageParams) {
  try {
    const client = getClient();
    const result = await client.invoices.list({
      customer: customerId,
      limit: params.limit,
      ...(params.startingAfter !== undefined ? { starting_after: params.startingAfter } : {}),
    });
    return {
      items: result.data.map((i) => stripeInvoiceSchema.parse(i)),
      hasMore: result.has_more,
    };
  } catch (err) {
    throw mapStripeError(err);
  }
}

export async function getStripeCustomerSubscriptions(customerId: string, params: StripePageParams) {
  try {
    const client = getClient();
    const result = await client.subscriptions.list({
      customer: customerId,
      limit: params.limit,
      ...(params.startingAfter !== undefined ? { starting_after: params.startingAfter } : {}),
    });
    return {
      items: result.data.map((s) => stripeSubscriptionSchema.parse(s)),
      hasMore: result.has_more,
    };
  } catch (err) {
    throw mapStripeError(err);
  }
}

export interface CustomerPaymentAggregate {
  customerId: string;
  totalPaidMinorUnits: number;
  currency: string | null;
  paymentCount: number;
  latestPaymentAt: number | null;
}

/**
 * Scans succeeded payment intents account-wide (not scoped to one
 * customer) and aggregates them per customer, up to `maxScan` intents
 * examined. Used by find_customers_by_conditions' `purchased` condition,
 * where asking "which customers paid" per-customer would mean one Stripe
 * call per customer — this is a single bounded scan instead. A
 * `truncated: true` result means more history exists beyond the scan
 * window; some paying customers may be missing from the result, not that
 * the ones present are wrong.
 */
export async function scanSucceededPaymentIntents(maxScan = 500): Promise<{
  byCustomer: Map<string, CustomerPaymentAggregate>;
  truncated: boolean;
  scanned: number;
}> {
  try {
    const client = getClient();
    const byCustomer = new Map<string, CustomerPaymentAggregate>();
    let scanned = 0;
    let truncated = false;

    for await (const intent of client.paymentIntents.list({ limit: 100 })) {
      scanned += 1;
      if (intent.status === 'succeeded' && intent.customer) {
        const customerId =
          typeof intent.customer === 'string' ? intent.customer : intent.customer.id;
        const existing = byCustomer.get(customerId);
        if (existing) {
          existing.totalPaidMinorUnits += intent.amount;
          existing.paymentCount += 1;
          existing.latestPaymentAt = Math.max(existing.latestPaymentAt ?? 0, intent.created);
        } else {
          byCustomer.set(customerId, {
            customerId,
            totalPaidMinorUnits: intent.amount,
            currency: intent.currency,
            paymentCount: 1,
            latestPaymentAt: intent.created,
          });
        }
      }
      if (scanned >= maxScan) {
        truncated = true;
        break;
      }
    }

    return { byCustomer, truncated, scanned };
  } catch (err) {
    throw mapStripeError(err);
  }
}

/**
 * Aggregates a customer's payment activity into the summary shape the
 * spec's `stripe_get_payment_summary` tool returns. Sums successful
 * payment intents (status === 'succeeded') up to a bounded scan window
 * rather than the customer's entire history, to keep the call fast and
 * predictable; a `truncated` flag reports if more history exists.
 */
export async function computeStripePaymentSummary(customerId: string, maxScan = 200) {
  try {
    const client = getClient();
    const succeeded: Stripe.PaymentIntent[] = [];
    let scanned = 0;
    let truncated = false;
    for await (const intent of client.paymentIntents.list({ customer: customerId, limit: 100 })) {
      scanned += 1;
      if (intent.status === 'succeeded') succeeded.push(intent);
      if (scanned >= maxScan) {
        truncated = true;
        break;
      }
    }

    const currency = succeeded[0]?.currency ?? null;
    const totalPaid = succeeded.reduce((sum, p) => sum + p.amount, 0);
    const latest = succeeded.reduce<Stripe.PaymentIntent | undefined>(
      (latestSoFar, p) => (!latestSoFar || p.created > latestSoFar.created ? p : latestSoFar),
      undefined,
    );

    const subsResult = await client.subscriptions.list({ customer: customerId, limit: 10 });
    const activeSubscription = subsResult.data.find(
      (s) => s.status === 'active' || s.status === 'trialing',
    );

    return {
      totalPaid,
      currency,
      successfulPaymentCount: succeeded.length,
      latestPaymentAt: latest ? latest.created : null,
      subscriptionStatus: activeSubscription?.status ?? null,
      truncated,
    };
  } catch (err) {
    throw mapStripeError(err);
  }
}

/** Reset the cached client — used only by tests to force re-initialization. */
export function __resetStripeClientForTests(): void {
  cachedClient = undefined;
}

/**
 * Injects a pre-built Stripe client for tests — used to swap in a
 * fetch-based client (`new Stripe(key, { httpClient: Stripe.createFetchHttpClient() })`)
 * for msw-mocked integration tests. Stripe's default Node http client
 * waits for a real socket's `connect`/`secureConnect` event before writing
 * its request body (see NodeHttpClient.makeRequest); msw's interceptor
 * resolves the mock before a real socket exists, so the two deadlock. The
 * fetch-based client sends the same requests over `fetch`, which msw
 * intercepts cleanly, without changing the production default (still
 * Stripe's own recommended Node http client — see getClient() above).
 */
export function __setStripeClientForTests(client: Stripe): void {
  cachedClient = client;
}
