import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as ghlService from '../../services/ghlService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  id: z.string().min(1).describe('The GHL opportunity id to move.'),
  pipelineStageId: z
    .string()
    .min(1)
    .describe('The target pipeline stage id — see ghl_get_pipelines.'),
});

export const ghlUpdateOpportunityStageTool = defineTool({
  name: 'ghl_update_opportunity_stage',
  title: 'Move GHL Opportunity to Stage',
  description:
    'Move a GoHighLevel opportunity to a different pipeline stage (e.g. "Proposal Sent" -> "Closed Won"). ' +
    'The target stage id must belong to a pipeline in this GHL location — call ghl_get_pipelines first if ' +
    "you only have stage names. This does not change the opportunity's won/lost status directly; a stage " +
    'move alone does not delete or archive the opportunity. This is a WRITE operation.',
  inputSchema,
  requiredScopes: [Scope.WRITE_CRM],
  integration: 'ghl',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  execute: async (args) => {
    const opportunity = await ghlService.updateOpportunityStage(args.id, args.pipelineStageId);
    return {
      summary: `Moved GHL opportunity ${args.id} to stage ${args.pipelineStageId}.`,
      data: opportunity,
    };
  },
});
