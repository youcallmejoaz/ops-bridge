import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import Stripe from 'stripe';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetStripeClientForTests,
  __setStripeClientForTests,
  getStripeCustomer,
  getStripeCustomerPayments,
  searchStripeCustomers,
} from '../../src/integrations/stripe/client.js';
import { AuthenticationError, NotFoundError } from '../../src/errors/errors.js';

const BASE = 'https://api.stripe.com';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  // Stripe's default Node http client waits for a real socket's connect
  // event before writing its request body, which deadlocks against msw's
  // interceptor (it resolves before a real socket exists) — see the note
  // on __setStripeClientForTests in src/integrations/stripe/client.ts.
  // Swap in Stripe's fetch-based client for these tests only; production
  // still uses the default Node http client.
  __setStripeClientForTests(
    new Stripe('sk_test_fake_0000000000000000', { httpClient: Stripe.createFetchHttpClient() }),
  );
});
afterEach(() => {
  server.resetHandlers();
  __resetStripeClientForTests();
});
afterAll(() => server.close());

const customerFixture = {
  id: 'cus_1',
  object: 'customer',
  email: 'a@b.com',
  name: 'A B',
  phone: null,
  currency: 'usd',
  balance: 0,
  created: 1735689600,
  metadata: {},
};

describe('Stripe integration client (mocked HTTP)', () => {
  it('sends a bearer Authorization header and parses a successful search response', async () => {
    let capturedAuth: string | null = null;
    server.use(
      http.get(`${BASE}/v1/customers/search`, ({ request }) => {
        capturedAuth = request.headers.get('authorization');
        return HttpResponse.json({
          object: 'search_result',
          data: [customerFixture],
          has_more: false,
        });
      }),
    );

    const customers = await searchStripeCustomers('email:"a@b.com"', 10);
    expect(capturedAuth).toBe('Bearer sk_test_fake_0000000000000000');
    expect(customers).toHaveLength(1);
    expect(customers[0]?.email).toBe('a@b.com');
  });

  it('maps a 401 to AuthenticationError', async () => {
    server.use(
      http.get(`${BASE}/v1/customers/:id`, () =>
        HttpResponse.json(
          { error: { type: 'authentication_error', message: 'Invalid API key' } },
          { status: 401 },
        ),
      ),
    );
    await expect(getStripeCustomer('cus_1')).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('maps a resource_missing 404 to NotFoundError', async () => {
    server.use(
      http.get(`${BASE}/v1/customers/:id`, () =>
        HttpResponse.json(
          {
            error: {
              type: 'invalid_request_error',
              code: 'resource_missing',
              message: 'No such customer',
            },
          },
          { status: 404 },
        ),
      ),
    );
    await expect(getStripeCustomer('cus_missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('paginates payment intents via starting_after', async () => {
    server.use(
      http.get(`${BASE}/v1/payment_intents`, ({ request }) => {
        const url = new URL(request.url);
        const startingAfter = url.searchParams.get('starting_after');
        const id = startingAfter ? 'pi_2' : 'pi_1';
        return HttpResponse.json({
          object: 'list',
          data: [
            {
              id,
              amount: 1000,
              currency: 'usd',
              status: 'succeeded',
              created: 1735689600,
              customer: 'cus_1',
            },
          ],
          has_more: !startingAfter,
        });
      }),
    );

    const page1 = await getStripeCustomerPayments('cus_1', { limit: 1 });
    expect(page1.items.map((i) => i.id)).toEqual(['pi_1']);
    expect(page1.hasMore).toBe(true);

    const page2 = await getStripeCustomerPayments('cus_1', { limit: 1, startingAfter: 'pi_1' });
    expect(page2.items.map((i) => i.id)).toEqual(['pi_2']);
    expect(page2.hasMore).toBe(false);
  });
});
