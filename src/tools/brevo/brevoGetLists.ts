import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as brevoService from '../../services/brevoService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe('Max lists to return (default 20, max 100).'),
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor (offset) from a previous response's nextCursor."),
});

export const brevoGetListsTool = defineTool({
  name: 'brevo_get_lists',
  title: 'List Brevo Lists',
  description:
    'List the marketing lists (e.g. "Newsletter", "Product Updates") available in this Brevo account, ' +
    'with subscriber counts. Use this to find a list id before brevo_add_contact_to_list or ' +
    'add_customer_to_marketing.',
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  integration: 'brevo',
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const cursorOffset = args.cursor !== undefined ? Number(args.cursor) : undefined;
    const result = await brevoService.listLists({
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      ...(cursorOffset !== undefined ? { offset: cursorOffset } : {}),
    });
    return {
      summary: `Found ${result.items.length} of ${result.total} Brevo list(s)${result.hasMore ? ' (more available)' : ''}.`,
      data: result,
    };
  },
});
