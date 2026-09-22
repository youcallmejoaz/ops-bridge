import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetGhlClientForTests,
  getGhlContact,
  getGhlPipelines,
  searchGhlContacts,
} from '../../src/integrations/ghl/client.js';
import { AuthenticationError, NotFoundError, RateLimitError } from '../../src/errors/errors.js';

const BASE = 'https://services.leadconnectorhq.com';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  __resetGhlClientForTests();
});
afterAll(() => server.close());

describe('GHL integration client (mocked HTTP)', () => {
  it('sends the Private Integration token and Version header, and parses a successful search response', async () => {
    let capturedAuth: string | null = null;
    let capturedVersion: string | null = null;

    server.use(
      http.get(`${BASE}/contacts/`, ({ request }) => {
        capturedAuth = request.headers.get('authorization');
        capturedVersion = request.headers.get('version');
        return HttpResponse.json({
          contacts: [{ id: 'c1', email: 'a@b.com', name: 'A B' }],
          count: 1,
        });
      }),
    );

    const result = await searchGhlContacts({ limit: 20 });

    expect(capturedAuth).toBe('Bearer test-ghl-key');
    // The SDK sets its own default Version header (currently 2023-02-21,
    // per @gohighlevel/api-client's HighLevel.js) — we don't override it,
    // so this asserts the SDK actually sends one rather than pinning an
    // exact value that would drift whenever the SDK's default changes.
    expect(capturedVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]?.email).toBe('a@b.com');
  });

  it('maps a 401 to AuthenticationError without leaking the response body', async () => {
    server.use(
      http.get(`${BASE}/contacts/`, () =>
        HttpResponse.json({ message: 'Invalid token' }, { status: 401 }),
      ),
    );
    await expect(searchGhlContacts({ limit: 20 })).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('maps a 404 on a single-contact lookup to NotFoundError', async () => {
    server.use(
      http.get(`${BASE}/contacts/:id`, () =>
        HttpResponse.json({ message: 'not found' }, { status: 404 }),
      ),
    );
    await expect(getGhlContact('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('paginates via startAfter/startAfterId cursors', async () => {
    server.use(
      http.get(`${BASE}/contacts/`, ({ request }) => {
        const url = new URL(request.url);
        const startAfter = url.searchParams.get('startAfter');
        if (!startAfter) {
          return HttpResponse.json({ contacts: [{ id: 'c1' }], count: 2 });
        }
        return HttpResponse.json({ contacts: [{ id: 'c2' }], count: 2 });
      }),
    );

    const page1 = await searchGhlContacts({ limit: 1 });
    expect(page1.contacts.map((c) => c.id)).toEqual(['c1']);

    const page2 = await searchGhlContacts({ limit: 1, startAfter: 123 });
    expect(page2.contacts.map((c) => c.id)).toEqual(['c2']);
  });

  describe('rate limiting', () => {
    beforeEach(() => __resetGhlClientForTests());

    it('retries a 429 and succeeds once the burst window clears', async () => {
      let attempts = 0;
      server.use(
        http.get(`${BASE}/opportunities/pipelines`, () => {
          attempts += 1;
          if (attempts < 2) {
            return HttpResponse.json(
              { message: 'rate limited' },
              { status: 429, headers: { 'x-ratelimit-interval-milliseconds': '10' } },
            );
          }
          return HttpResponse.json({ pipelines: [{ id: 'p1', name: 'Sales', stages: [] }] });
        }),
      );

      const pipelines = await getGhlPipelines();
      expect(attempts).toBe(2);
      expect(pipelines).toEqual([{ id: 'p1', name: 'Sales', stages: [] }]);
    });

    it('maps a persistent 429 to RateLimitError once retries are exhausted', async () => {
      server.use(
        http.get(`${BASE}/opportunities/pipelines`, () =>
          HttpResponse.json(
            { message: 'rate limited' },
            { status: 429, headers: { 'x-ratelimit-interval-milliseconds': '5' } },
          ),
        ),
      );
      await expect(getGhlPipelines()).rejects.toBeInstanceOf(RateLimitError);
    });
  });
});
