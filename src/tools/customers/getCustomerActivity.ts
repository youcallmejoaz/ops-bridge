import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as customerService from '../../services/customerService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  query: z.string().min(1).describe('A name or email identifying the customer.'),
  sources: z
    .array(z.enum(['ghl', 'brevo', 'stripe']))
    .optional()
    .describe(
      'Restrict activity retrieval to these systems. Omit to check every enabled integration.',
    ),
});

export const getCustomerActivityTool = defineTool({
  name: 'get_customer_activity',
  title: 'Get Customer Activity',
  description:
    "Retrieve a customer's recent activity, grouped by source: GHL opportunities and notes; Brevo " +
    'subscription status, list membership, and recent campaign engagement; Stripe payments, invoices, and ' +
    'subscriptions. Each group is bounded to the 20 most recent records — this is an activity feed, not a ' +
    'full export. If the query matches multiple distinct people, no activity is returned and `candidates` ' +
    'lists them instead — re-query with a more specific identifier (e.g. email).',
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const result = await customerService.getCustomerActivity(args);
    if (!result.customer) {
      const suffix =
        result.candidates.length > 0
          ? ` — ${result.candidates.length} distinct match(es) found`
          : '';
      return {
        summary: `No single customer matched "${args.query}"${suffix}.`,
        data: result,
      };
    }
    return {
      summary: `Retrieved activity for ${result.customer.name ?? result.customer.email}.`,
      data: result,
    };
  },
});
