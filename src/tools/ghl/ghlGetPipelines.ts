import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as ghlService from '../../services/ghlService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({});

export const ghlGetPipelinesTool = defineTool({
  name: 'ghl_get_pipelines',
  title: 'List GHL Pipelines',
  description:
    "List all sales pipelines configured for this GHL location, including each pipeline's stages and " +
    'their ids. Use this before ghl_update_opportunity_stage to resolve a human-readable stage name to ' +
    'its id.',
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  integration: 'ghl',
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async () => {
    const pipelines = await ghlService.listPipelines();
    return {
      summary: `Found ${pipelines.length} GHL pipeline(s).`,
      data: { pipelines },
    };
  },
});
