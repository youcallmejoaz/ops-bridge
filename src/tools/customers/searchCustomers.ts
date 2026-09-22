import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as customerService from '../../services/customerService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  query: z.string().min(1).describe('A name, email, or phone number to search for.'),
  sources: z
    .array(z.enum(['ghl', 'brevo', 'stripe']))
    .optional()
    .describe('Restrict the search to these systems. Omit to search every enabled integration.'),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .optional()
    .describe('Max unified customer records to return (default 20, max 50).'),
});

export const searchCustomersTool = defineTool({
  name: 'search_customers',
  title: 'Search Customers',
  description:
    'Search for customers across connected systems (GHL, Brevo, Stripe) by name, email, or phone, and ' +
    'return normalized, unified customer records. An email-shaped query is matched exactly across every ' +
    "system; a name/phone query is matched via each system's own search (Brevo has no free-text search, " +
    "so name matches there only surface once a candidate's email is known). Prefer this over calling " +
    'ghl_search_contacts / brevo_search_contacts / stripe_search_customers individually when you want one ' +
    "combined view of a person rather than a single system's raw record.",
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const result = await customerService.searchCustomers(args);
    return {
      summary: `Found ${result.customers.length} customer(s) matching "${args.query}"${result.truncated ? ' (more may exist)' : ''}.`,
      data: result,
    };
  },
});
