import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as customerService from '../../services/customerService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe('A name or email, e.g. "Give me everything we know about John Smith."'),
  sources: z.array(z.enum(['ghl', 'brevo', 'stripe'])).optional(),
});

export const customer360Tool = defineTool({
  name: 'customer_360',
  title: 'Customer 360',
  description:
    'Build one combined profile for a single customer: GHL CRM status + pipeline/stage, Brevo subscription ' +
    '+ list membership, and Stripe payment/subscription summary. If the query matches more than one ' +
    'distinct person (e.g. two different "John Smith"s), no single profile is returned — `candidates` lists ' +
    'the possible matches instead so you can disambiguate with a more specific query (ideally an exact ' +
    'email). Use get_customer_activity alongside this for a fuller activity feed rather than a summary.',
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const result = await customerService.customer360(args);
    if (!result.customer) {
      const suffix =
        result.candidates.length > 0 ? `; ${result.candidates.length} possible match(es)` : '';
      return {
        summary: `No single customer matched "${args.query}"${suffix}.`,
        data: result,
      };
    }
    return {
      summary: `Built 360 profile for ${result.customer.name ?? result.customer.email}.`,
      data: result,
    };
  },
});
