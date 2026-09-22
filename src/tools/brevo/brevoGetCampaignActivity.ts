import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as brevoService from '../../services/brevoService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  campaignId: z.number().int().positive().describe('The Brevo campaign id.'),
});

export const brevoGetCampaignActivityTool = defineTool({
  name: 'brevo_get_campaign_activity',
  title: 'Get Brevo Campaign Activity',
  description:
    'Retrieve detailed activity/statistics for a single Brevo email campaign: sent, delivered, opens, ' +
    "clicks, bounces, and unsubscriptions. Statistics cover events from the last 6 months per Brevo's API.",
  inputSchema,
  requiredScopes: [Scope.READ_CUSTOMERS],
  integration: 'brevo',
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args) => {
    const campaign = await brevoService.getCampaignActivity(args.campaignId);
    return {
      summary: `Retrieved activity for Brevo campaign ${campaign.id} (${campaign.name}).`,
      data: campaign,
    };
  },
});
