import { z } from 'zod';
import { Scope } from '../../auth/authentication.js';
import * as ghlService from '../../services/ghlService.js';
import { defineTool } from '../shared.js';

const inputSchema = z.object({
  contactId: z.string().min(1).describe('The GHL contact id to add the note to.'),
  body: z.string().min(1).describe('The note text.'),
  userId: z.string().optional().describe('GHL user id to attribute the note to, if known.'),
});

export const ghlAddContactNoteTool = defineTool({
  name: 'ghl_add_contact_note',
  title: 'Add GHL Contact Note',
  description:
    "Add a note to a GoHighLevel contact's timeline. Use this to record context directly on the GHL " +
    'record, e.g. after an action taken through another system (see also the cross-system customer_note ' +
    'tool, which does this plus finds the right contact for you). This is a WRITE operation; notes ' +
    'cannot be un-added through this tool.',
  inputSchema,
  requiredScopes: [Scope.WRITE_CRM],
  integration: 'ghl',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  execute: async (args) => {
    const note = await ghlService.addContactNote(args.contactId, args.body, args.userId);
    return {
      summary: `Added note to GHL contact ${args.contactId}.`,
      data: note,
    };
  },
});
