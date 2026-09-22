import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as customerService from '../../services/customerService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  emails: z
    .array(z.string().email())
    .min(1)
    .describe(
      'One or more customer emails to add. A single email is added immediately; multiple is a bulk operation.',
    ),
  listId: z.number().int().positive().describe('The Brevo list id to add the customer(s) to.'),
  confirm: z
    .boolean()
    .optional()
    .describe(
      'Required to execute when emails has more than one entry — without it, a bulk call only returns a ' +
        'preview of what would happen. Not required for a single email, which executes immediately.',
    ),
});

export const addCustomerToMarketingTool = defineTool({
  name: 'add_customer_to_marketing',
  title: 'Add Customer(s) to Marketing List',
  description:
    'Add one or more customers to a Brevo marketing list by email, e.g. "add John to our newsletter" or ' +
    '"add these eligible customers to the newsletter." For each email this: confirms the customer exists in ' +
    'a connected system, confirms the list exists, checks existing membership (skipping duplicates), and — ' +
    'critically — respects marketing consent: a contact who has opted out (Brevo-blacklisted) is NEVER ' +
    'added, regardless of confirm. Consent is never assumed just because this tool was called. Adding 2+ ' +
    'emails without confirm: true returns a preview only (see `outcomes[].action === "would_add"`); a ' +
    'single email executes immediately. Every email gets its own result — one failure never blocks the rest.',
  inputSchema,
  requiredScopes: [Scope.WRITE_MARKETING],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  execute: async (args) => {
    const result = await customerService.addCustomerToMarketing({
      emails: args.emails,
      listId: args.listId,
      ...(args.confirm !== undefined ? { confirm: args.confirm } : {}),
    });
    const added = result.outcomes.filter((o) => o.action === 'added').length;
    const wouldAdd = result.outcomes.filter((o) => o.action === 'would_add').length;
    const summary = result.preview
      ? `Preview: would add ${wouldAdd} of ${result.outcomes.length} customer(s) to "${result.listName}". Pass confirm: true to execute.`
      : `Added ${added} of ${result.outcomes.length} customer(s) to "${result.listName}".`;
    return { summary, data: result };
  },
});
