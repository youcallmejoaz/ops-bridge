import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as brevoService from '../../services/brevoService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  status: z
    .enum(['suspended', 'archive', 'sent', 'queued', 'draft', 'inProcess'])
    .optional()
    .describe('Filter to campaigns in this status.'),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe('Max campaigns to return (default 20, max 100).'),
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor (offset) from a previous response's nextCursor."),
});

export const brevoGetCampaignsTool = defineTool({
  name: 'brevo_get_campaigns',
  title: 'List Brevo Email Campaigns',
  description:
    'List Brevo email campaigns with summary stats (sent, delivered, opens, clicks). Use ' +
    'brevo_get_campaign_activity for full activity detail on one campaign.',
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  integration: 'brevo',
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const cursorOffset = args.cursor !== undefined ? Number(args.cursor) : undefined;
    const result = await brevoService.getCampaigns({
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      ...(cursorOffset !== undefined ? { offset: cursorOffset } : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
    });
    return {
      summary: `Found ${result.items.length} of ${result.total} Brevo campaign(s)${result.hasMore ? ' (more available)' : ''}.`,
      data: result,
    };
  },
});
