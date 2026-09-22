import type { McpServer } from '@modelcontextprotocol/server';
import { env } from '../config/env.js';

// Generic customer tools
import { searchCustomersTool } from '../tools/customers/searchCustomers.js';
import { getCustomerTool } from '../tools/customers/getCustomer.js';
import { getCustomerActivityTool } from '../tools/customers/getCustomerActivity.js';

// Cross-system tools
import { unifiedCustomerSearchTool } from '../tools/crossSystem/unifiedCustomerSearch.js';
import { customer360Tool } from '../tools/crossSystem/customer360.js';
import { findCustomersByConditionsTool } from '../tools/crossSystem/findCustomersByConditions.js';
import { syncCustomerTool } from '../tools/crossSystem/syncCustomer.js';
import { addCustomerToMarketingTool } from '../tools/crossSystem/addCustomerToMarketing.js';
import { customerNoteTool } from '../tools/crossSystem/customerNote.js';

// GHL tools
import { ghlSearchContactsTool } from '../tools/ghl/ghlSearchContacts.js';
import { ghlGetContactTool } from '../tools/ghl/ghlGetContact.js';
import { ghlCreateContactTool } from '../tools/ghl/ghlCreateContact.js';
import { ghlUpdateContactTool } from '../tools/ghl/ghlUpdateContact.js';
import { ghlAddContactNoteTool } from '../tools/ghl/ghlAddContactNote.js';
import { ghlSearchOpportunitiesTool } from '../tools/ghl/ghlSearchOpportunities.js';
import { ghlGetOpportunityTool } from '../tools/ghl/ghlGetOpportunity.js';
import { ghlUpdateOpportunityStageTool } from '../tools/ghl/ghlUpdateOpportunityStage.js';
import { ghlGetPipelinesTool } from '../tools/ghl/ghlGetPipelines.js';

// Brevo tools
import { brevoSearchContactsTool } from '../tools/brevo/brevoSearchContacts.js';
import { brevoGetContactTool } from '../tools/brevo/brevoGetContact.js';
import { brevoCreateContactTool } from '../tools/brevo/brevoCreateContact.js';
import { brevoUpdateContactTool } from '../tools/brevo/brevoUpdateContact.js';
import { brevoGetListsTool } from '../tools/brevo/brevoGetLists.js';
import { brevoAddContactToListTool } from '../tools/brevo/brevoAddContactToList.js';
import { brevoRemoveContactFromListTool } from '../tools/brevo/brevoRemoveContactFromList.js';
import { brevoGetContactListsTool } from '../tools/brevo/brevoGetContactLists.js';
import { brevoGetCampaignsTool } from '../tools/brevo/brevoGetCampaigns.js';
import { brevoGetCampaignActivityTool } from '../tools/brevo/brevoGetCampaignActivity.js';

// Stripe tools
import { stripeSearchCustomersTool } from '../tools/stripe/stripeSearchCustomers.js';
import { stripeGetCustomerTool } from '../tools/stripe/stripeGetCustomer.js';
import { stripeGetCustomerPaymentsTool } from '../tools/stripe/stripeGetCustomerPayments.js';
import { stripeGetCustomerInvoicesTool } from '../tools/stripe/stripeGetCustomerInvoices.js';
import { stripeGetCustomerSubscriptionsTool } from '../tools/stripe/stripeGetCustomerSubscriptions.js';
import { stripeGetPaymentSummaryTool } from '../tools/stripe/stripeGetPaymentSummary.js';

/**
 * Registers every tool whose integration is enabled (spec §22): a
 * disabled integration's tools are simply never registered, rather than
 * being present and failing at call time with a confusing error. Generic
 * and cross-system tools are registered whenever at least one integration
 * is enabled — each degrades gracefully (a clear ConfigurationError /
 * ValidationError) if a specific one of their calls needs an integration
 * that turns out not to be enabled — see services/customerService.ts.
 */
export function registerTools(server: McpServer): void {
  const anyEnabled = env.ENABLE_GHL || env.ENABLE_BREVO || env.ENABLE_STRIPE;

  if (anyEnabled) {
    for (const tool of [searchCustomersTool, getCustomerTool, getCustomerActivityTool]) {
      register(server, tool);
    }
    for (const tool of [
      unifiedCustomerSearchTool,
      customer360Tool,
      findCustomersByConditionsTool,
      syncCustomerTool,
      addCustomerToMarketingTool,
      customerNoteTool,
    ]) {
      register(server, tool);
    }
  }

  if (env.ENABLE_GHL) {
    for (const tool of [
      ghlSearchContactsTool,
      ghlGetContactTool,
      ghlCreateContactTool,
      ghlUpdateContactTool,
      ghlAddContactNoteTool,
      ghlSearchOpportunitiesTool,
      ghlGetOpportunityTool,
      ghlUpdateOpportunityStageTool,
      ghlGetPipelinesTool,
    ]) {
      register(server, tool);
    }
  }

  if (env.ENABLE_BREVO) {
    for (const tool of [
      brevoSearchContactsTool,
      brevoGetContactTool,
      brevoCreateContactTool,
      brevoUpdateContactTool,
      brevoGetListsTool,
      brevoAddContactToListTool,
      brevoRemoveContactFromListTool,
      brevoGetContactListsTool,
      brevoGetCampaignsTool,
      brevoGetCampaignActivityTool,
    ]) {
      register(server, tool);
    }
  }

  if (env.ENABLE_STRIPE) {
    for (const tool of [
      stripeSearchCustomersTool,
      stripeGetCustomerTool,
      stripeGetCustomerPaymentsTool,
      stripeGetCustomerInvoicesTool,
      stripeGetCustomerSubscriptionsTool,
      stripeGetPaymentSummaryTool,
    ]) {
      register(server, tool);
    }
  }
}

/**
 * Registers one tool definition. Each `RegisteredToolDefinition<Shape>` is
 * internally consistent (its `config.inputSchema` and `handler` share the
 * same `Shape`, enforced at its own definition site in tools/shared.ts),
 * but a heterogeneous array of tools — each with a different `Shape` —
 * can't keep that link in a single array's element type. We deliberately
 * erase it here rather than register 33 tools with 33 individual calls;
 * `server.registerTool` re-validates the config/handler pairing from the
 * object it's given, so nothing unsound reaches it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function register(server: McpServer, def: { name: string; config: any; handler: any }): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- see the erasure note above
  server.registerTool(def.name, def.config, def.handler);
}
