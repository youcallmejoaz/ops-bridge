import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  __resetBrevoClientForTests,
  getBrevoContact,
  getBrevoLists,
  searchBrevoContacts,
} from '../../src/integrations/brevo/client.js';
import { AuthenticationError, NotFoundError } from '../../src/errors/errors.js';

const BASE = 'https://api.brevo.com/v3';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  __resetBrevoClientForTests();
});
afterAll(() => server.close());

const contactFixture = {
  id: 1,
  email: 'a@b.com',
  emailBlacklisted: false,
  smsBlacklisted: false,
  listIds: [1],
  attributes: {},
  createdAt: '2026-01-01T00:00:00Z',
  modifiedAt: '2026-01-01T00:00:00Z',
};

describe('Brevo integration client (mocked HTTP)', () => {
  it('sends the api-key header and parses a successful contacts page', async () => {
    let capturedKey: string | null = null;
    server.use(
      http.get(`${BASE}/contacts`, ({ request }) => {
        capturedKey = request.headers.get('api-key');
        return HttpResponse.json({ contacts: [contactFixture], count: 1 });
      }),
    );

    const page = await searchBrevoContacts({ limit: 20, offset: 0 });
    expect(capturedKey).toBe('test-brevo-key');
    expect(page.contacts).toHaveLength(1);
    expect(page.contacts[0]?.email).toBe('a@b.com');
  });

  it('maps a 401 to AuthenticationError', async () => {
    server.use(
      http.get(`${BASE}/contacts`, () =>
        HttpResponse.json({ message: 'bad key' }, { status: 401 }),
      ),
    );
    await expect(searchBrevoContacts({ limit: 20, offset: 0 })).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it('maps a 404 on getContactInfo to NotFoundError', async () => {
    server.use(
      http.get(`${BASE}/contacts/:identifier`, () =>
        HttpResponse.json({ message: 'not found' }, { status: 404 }),
      ),
    );
    await expect(getBrevoContact('missing@example.com')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('paginates lists via limit/offset', async () => {
    server.use(
      http.get(`${BASE}/contacts/lists`, ({ request }) => {
        const url = new URL(request.url);
        const offset = url.searchParams.get('offset');
        return HttpResponse.json({
          lists: [{ id: offset === '0' ? 1 : 2, name: offset === '0' ? 'First' : 'Second' }],
          count: 2,
        });
      }),
    );

    const page1 = await getBrevoLists({ limit: 1, offset: 0 });
    expect(page1.lists.map((l) => l.name)).toEqual(['First']);
    const page2 = await getBrevoLists({ limit: 1, offset: 1 });
    expect(page2.lists.map((l) => l.name)).toEqual(['Second']);
  });
});
