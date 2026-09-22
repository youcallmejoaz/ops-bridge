import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as brevoService from '../../services/brevoService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  listId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Restrict results to contacts on this Brevo list id.'),
  filter: z
    .string()
    .optional()
    .describe(
      'Brevo attribute-equality filter, e.g. equals(FIRSTNAME,"John") or equals(EMAIL,"john@example.com"). ' +
        'This is the closest Brevo comes to name search — Brevo has no free-text search endpoint.',
    ),
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
    .describe("Pagination cursor (offset) from a previous response's nextCursor."),
});

export const brevoSearchContactsTool = defineTool({
  name: 'brevo_search_contacts',
  title: 'Search Brevo Contacts',
  description:
    "List or filter Brevo contacts. IMPORTANT: Brevo's API has no free-text search — use `filter` with an " +
    'attribute-equality expression (e.g. finding by exact email or first name), or `listId` to scope to one ' +
    'list, or omit both to page through all contacts. For an exact-match lookup by email/id/ext_id, prefer ' +
    'brevo_get_contact instead — it is more direct.',
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  integration: 'brevo',
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const cursorOffset = args.cursor !== undefined ? Number(args.cursor) : undefined;
    const result = await brevoService.searchContacts({
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      ...(cursorOffset !== undefined ? { offset: cursorOffset } : {}),
      ...(args.listId !== undefined ? { listId: args.listId } : {}),
      ...(args.filter !== undefined ? { filter: args.filter } : {}),
    });
    return {
      summary: `Found ${result.items.length} of ${result.total} Brevo contact(s)${result.hasMore ? ' (more available)' : ''}.`,
      data: result,
    };
  },
});
