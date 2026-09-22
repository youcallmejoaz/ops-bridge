import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../src/errors/errors.js';

// Mock the three provider service layers customerService is built on top
// of. customerService.ts imports these as `* as xxxServiceModule` and
// re-exports them as `ghlService`/`brevoService`/`stripeService` — since
// ES module bindings are shared singletons, mocking the underlying module
// here reaches every internal call site inside customerService.ts too.
vi.mock('../../src/services/ghlService.js');
vi.mock('../../src/services/brevoService.js');
vi.mock('../../src/services/stripeService.js');

import * as ghlService from '../../src/services/ghlService.js';
import * as brevoService from '../../src/services/brevoService.js';
import * as stripeService from '../../src/services/stripeService.js';
import * as customerService from '../../src/services/customerService.js';

const emptyGhlSearch = { items: [], hasMore: false, total: null } as const;
const emptyGhlOpportunities = { items: [], hasMore: false, total: null } as const;

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Workflow 3 (spec §24): "Find customers who paid us but aren't subscribed
 * to our newsletter." — the project's first demonstration.
 */
describe('Workflow: find customers who purchased but are not Brevo-subscribed', () => {
  it('drives from the Stripe payer scan and filters out anyone Brevo reports as subscribed', async () => {
    vi.mocked(stripeService.scanPayingCustomers).mockResolvedValue({
      customers: [
        {
          customerId: 'cus_unsubscribed',
          totalSpent: 50,
          currency: 'usd',
          paymentCount: 1,
          latestPaymentAt: null,
        },
        {
          customerId: 'cus_subscribed',
          totalSpent: 30,
          currency: 'usd',
          paymentCount: 1,
          latestPaymentAt: null,
        },
      ],
      truncated: false,
    });

    const byId: Record<string, { id: string; email: string }> = {
      cus_unsubscribed: { id: 'cus_unsubscribed', email: 'not.subscribed@example.com' },
      cus_subscribed: { id: 'cus_subscribed', email: 'already.subscribed@example.com' },
    };
    vi.mocked(stripeService.getCustomer).mockImplementation(async (id: string) => byId[id] as any);
    // getUnifiedCustomerByEmail (used to build the final survivor records)
    // does its own independent by-email Stripe lookup.
    vi.mocked(stripeService.findCustomersByEmail).mockImplementation(async (email: string) => {
      const match = Object.values(byId).find((c) => c.email === email);
      return match ? [match as any] : [];
    });

    // Neither candidate has a GHL record in this scenario.
    vi.mocked(ghlService.searchContacts).mockResolvedValue(emptyGhlSearch as any);

    // Brevo: one candidate is not a contact at all, the other is a
    // subscribed contact — both must be excluded from a
    // marketing_subscribed: false result.
    vi.mocked(brevoService.getContact).mockImplementation(async (identifier: string) => {
      if (identifier === 'already.subscribed@example.com') {
        return {
          id: 2,
          email: identifier,
          emailBlacklisted: false,
          smsBlacklisted: false,
          listIds: [1],
          attributes: {},
          createdAt: '',
          modifiedAt: '',
        } as any;
      }
      throw new NotFoundError('not found');
    });
    vi.mocked(brevoService.listLists).mockResolvedValue({
      items: [{ id: 1, name: 'Newsletter' }],
      total: 1,
      hasMore: false,
    } as any);

    vi.mocked(stripeService.getPaymentSummary).mockImplementation(async (id: string) => ({
      source: 'stripe' as const,
      sourceId: id,
      totalSpent: id === 'cus_unsubscribed' ? 50 : 30,
      currency: 'usd',
      lastPaymentAt: null,
      subscriptionStatus: null,
      successfulPaymentCount: 1,
      truncated: false,
    }));

    const result = await customerService.findCustomersByConditions({
      purchased: true,
      marketingSubscribed: false,
    });

    expect(result.customers).toHaveLength(1);
    expect(result.customers[0]?.email).toBe('not.subscribed@example.com');
    expect(result.customers[0]?.payments?.totalSpent).toBe(50);
    // The subscribed payer must not appear anywhere in the result.
    expect(result.customers.some((c) => c.email === 'already.subscribed@example.com')).toBe(false);
  });

  it('rejects a query made only of unbounded negative conditions', async () => {
    await expect(
      customerService.findCustomersByConditions({ marketingSubscribed: false }),
    ).rejects.toThrow(/bounded condition/i);
  });
});

/**
 * Workflow 4/5 (spec §24): "Add John to our newsletter" followed by
 * "add a note to his CRM record" documenting it.
 */
describe('Workflow: add a customer to a marketing list, then note it on their GHL record', () => {
  const email = 'john@example.com';

  beforeEach(() => {
    // John exists in GHL (this is how add_customer_to_marketing confirms
    // the customer exists) but is not yet a Brevo contact.
    vi.mocked(ghlService.searchContacts).mockResolvedValue({
      items: [{ id: 'ghl_john', email, name: 'John Smith' }],
      hasMore: false,
      total: null,
    } as any);
    vi.mocked(ghlService.searchOpportunities).mockResolvedValue(emptyGhlOpportunities as any);
    vi.mocked(brevoService.getContact).mockRejectedValue(new NotFoundError('not found'));
    vi.mocked(stripeService.findCustomersByEmail).mockResolvedValue([]);
  });

  it('adds a single customer to the list immediately (no confirm needed) and creates the Brevo contact', async () => {
    vi.mocked(brevoService.getList).mockResolvedValue({ id: 5, name: 'Newsletter' } as any);
    vi.mocked(brevoService.createContact).mockResolvedValue({ id: 999, email } as any);

    const result = await customerService.addCustomerToMarketing({ emails: [email], listId: 5 });

    expect(result.preview).toBe(false);
    expect(result.outcomes).toEqual([{ email, action: 'added' }]);
    expect(brevoService.createContact).toHaveBeenCalledWith(
      expect.objectContaining({ email, listIds: [5] }),
    );
  });

  it('then adds a note to the GHL contact, prefixed to identify it as OpsBridge-created', async () => {
    vi.mocked(ghlService.addContactNote).mockResolvedValue({
      id: 'note_1',
      body: '[OpsBridge] Added to the newsletter.',
    } as any);

    const result = await customerService.customerNote({
      email,
      note: 'Added to the newsletter.',
    });

    expect(result.ghlContactId).toBe('ghl_john');
    expect(ghlService.addContactNote).toHaveBeenCalledWith(
      'ghl_john',
      expect.stringContaining('[OpsBridge]'),
    );
  });

  it('a bulk (2+) add previews without confirm and respects consent on execute', async () => {
    const second = 'jane@example.com';
    vi.mocked(ghlService.searchContacts).mockImplementation(async ({ query }: any) => ({
      items: [{ id: query === email ? 'ghl_john' : 'ghl_jane', email: query, name: 'X' }],
      hasMore: false,
      total: null,
    }));
    vi.mocked(brevoService.getList).mockResolvedValue({ id: 5, name: 'Newsletter' } as any);
    // Jane has opted out — must never be added, confirm or not.
    vi.mocked(brevoService.getContact).mockImplementation(async (identifier: string) => {
      if (identifier === second) {
        return {
          id: 3,
          email: second,
          emailBlacklisted: true,
          smsBlacklisted: false,
          listIds: [],
          attributes: {},
          createdAt: '',
          modifiedAt: '',
        } as any;
      }
      throw new NotFoundError('not found');
    });

    const preview = await customerService.addCustomerToMarketing({
      emails: [email, second],
      listId: 5,
    });
    expect(preview.preview).toBe(true);
    expect(preview.outcomes).toEqual(
      expect.arrayContaining([
        { email, action: 'would_add' },
        expect.objectContaining({ email: second, action: 'skipped_consent' }),
      ]),
    );
    expect(brevoService.createContact).not.toHaveBeenCalled();
    expect(brevoService.addContactToList).not.toHaveBeenCalled();

    vi.mocked(brevoService.createContact).mockResolvedValue({ id: 1, email } as any);
    const executed = await customerService.addCustomerToMarketing({
      emails: [email, second],
      listId: 5,
      confirm: true,
    });
    expect(executed.preview).toBe(false);
    const janeOutcome = executed.outcomes.find((o) => o.email === second);
    expect(janeOutcome?.action).toBe('skipped_consent');
    const johnOutcome = executed.outcomes.find((o) => o.email === email);
    expect(johnOutcome?.action).toBe('added');
  });
});
