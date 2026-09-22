import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as ghlService from '../../services/ghlService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  query: z
    .string()
    .optional()
    .describe('Free-text search across name, email, and phone. Omit to list contacts.'),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe('Max contacts to return (default 20, max 100).'),
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor from a previous response's nextCursor."),
});

export const ghlSearchContactsTool = defineTool({
  name: 'ghl_search_contacts',
  title: 'Search GHL Contacts',
  description:
    'Search GoHighLevel contacts by name, email, or phone. Use this to find a specific GHL contact or ' +
    'browse contacts for this location. Returns raw GHL contact records (not the unified customer model) ' +
    '— use search_customers or unified_customer_search instead when you need a cross-system view. ' +
    'Do NOT use this for Brevo or Stripe records.',
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  integration: 'ghl',
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const result = await ghlService.searchContacts(args);
    return {
      summary: `Found ${result.items.length} GHL contact(s)${result.hasMore ? ' (more available)' : ''}.`,
      data: result,
    };
  },
});
