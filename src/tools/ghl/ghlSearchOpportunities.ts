import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as ghlService from '../../services/ghlService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  query: z.string().optional().describe('Free-text search across opportunity name.'),
  pipelineId: z.string().optional(),
  pipelineStageId: z.string().optional(),
  contactId: z.string().optional().describe('Restrict to opportunities for one GHL contact.'),
  status: z.string().optional().describe('e.g. "open", "won", "lost", "abandoned".'),
  limit: z.number().int().positive().max(100).optional(),
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor from a previous response's nextCursor."),
});

export const ghlSearchOpportunitiesTool = defineTool({
  name: 'ghl_search_opportunities',
  title: 'Search GHL Opportunities',
  description:
    'Search GoHighLevel sales pipeline opportunities, optionally filtered by pipeline, stage, contact, ' +
    'status, or free-text query. Use ghl_get_pipelines first if you need pipeline/stage ids rather than ' +
    'names.',
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  integration: 'ghl',
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const result = await ghlService.searchOpportunities(args);
    return {
      summary: `Found ${result.items.length} GHL opportunit${result.items.length === 1 ? 'y' : 'ies'}${
        result.hasMore ? ' (more available)' : ''
      }.`,
      data: result,
    };
  },
});
