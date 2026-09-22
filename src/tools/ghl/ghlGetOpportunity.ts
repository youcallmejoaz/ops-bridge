import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as ghlService from '../../services/ghlService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  id: z.string().min(1).describe('The GHL opportunity id.'),
});

export const ghlGetOpportunityTool = defineTool({
  name: 'ghl_get_opportunity',
  title: 'Get GHL Opportunity',
  description:
    'Retrieve a single GoHighLevel opportunity by its id, including its pipeline, stage, and status.',
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  integration: 'ghl',
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const opportunity = await ghlService.getOpportunity(args.id);
    return {
      summary: `Retrieved GHL opportunity ${opportunity.id}${opportunity.name ? ` (${opportunity.name})` : ''}.`,
      data: opportunity,
    };
  },
});
