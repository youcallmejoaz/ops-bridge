import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as customerService from '../../services/customerService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe('A name, email, or phone number, e.g. "Find John Smith across all our systems."'),
  sources: z.array(z.enum(['ghl', 'brevo', 'stripe'])).optional(),
  limit: z.number().int().positive().max(50).optional(),
});

export const unifiedCustomerSearchTool = defineTool({
  name: 'unified_customer_search',
  title: 'Unified Customer Search',
  description:
    "Search GHL, Brevo, and Stripe together and correlate the results into distinct people (spec's " +
    'flagship cross-system tool). Each result carries a `confidence` ("high" when corroborated across ' +
    'multiple systems by email/phone, "medium"/"low" when found in only one) and a `reason` explaining the ' +
    'match — records are NEVER silently merged just because names look alike; two different people with the ' +
    'same name are always returned as separate candidates. Use this over search_customers when you ' +
    'specifically care about match confidence and provenance.',
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const candidates = await customerService.unifiedCustomerSearch(args);
    return {
      summary: `Found ${candidates.length} matching customer(s) for "${args.query}".`,
      data: { matches: candidates },
    };
  },
});
