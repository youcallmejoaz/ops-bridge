import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as stripeService from '../../services/stripeService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'Stripe search query language, e.g. \'email:"john@example.com"\' or \'name~"John"\'. ' +
        'See https://docs.stripe.com/search#query-fields-for-customers.',
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe('Max customers to return (default 20, max 100).'),
});

export const stripeSearchCustomersTool = defineTool({
  name: 'stripe_search_customers',
  title: 'Search Stripe Customers',
  description:
    "Search Stripe customers using Stripe's search query language. NOTE: Stripe search is eventually " +
    'consistent — a customer created or updated in the last ~1 minute may not appear yet. For an exact, ' +
    'strongly-consistent email lookup (e.g. right after a purchase), a plain email filter is more reliable; ' +
    'use stripe_get_customer if you already have the customer id.',
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  integration: 'stripe',
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const customers = await stripeService.searchCustomers(args);
    return {
      summary: `Found ${customers.length} Stripe customer(s).`,
      data: { customers },
    };
  },
});
