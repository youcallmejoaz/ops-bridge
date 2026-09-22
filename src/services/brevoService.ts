import {
  addBrevoContactToList,
  createBrevoContact,
  getBrevoCampaignActivity,
  getBrevoCampaigns,
  getBrevoContact,
  getBrevoList,
  getBrevoLists,
  removeBrevoContactFromList,
  searchBrevoContacts,
  updateBrevoContact,
  type BrevoContactUpsertInput,
} from '../integrations/brevo/client.js';
import type { BrevoListMembershipBody } from '../integrations/brevo/types.js';
import { NotFoundError, ValidationError } from '../errors/errors.js';
import { clampLimit } from '../utils/pagination.js';
import { brevoListNameMap } from './normalizationService.js';

/**
 * Business logic for Brevo tools. Brevo has no free-text contact search
 * (spec §7 note) — `searchContacts` exposes the closest equivalents Brevo
 * actually supports: paging all contacts, filtering to a list, or an
 * attribute-equality filter — and says so in the tool description rather
 * than pretending to support arbitrary search.
 */

export async function searchContacts(input: {
  limit?: number | undefined;
  offset?: number | undefined;
  listId?: number | undefined;
  filter?: string | undefined;
}) {
  const limit = clampLimit(input.limit);
  const offset = input.offset ?? 0;
  const page = await searchBrevoContacts({
    limit,
    offset,
    ...(input.listId !== undefined ? { listId: input.listId } : {}),
    ...(input.filter !== undefined ? { filter: input.filter } : {}),
  });
  const hasMore = offset + page.contacts.length < page.count;
  return {
    items: page.contacts,
    total: page.count,
    hasMore,
    ...(hasMore ? { nextCursor: String(offset + limit) } : {}),
  };
}

export async function getContact(identifier: string) {
  return getBrevoContact(identifier);
}

export async function createContact(input: {
  email: string;
  attributes?: Record<string, string | number | boolean | string[]> | undefined;
  listIds?: number[] | undefined;
}) {
  const payload: BrevoContactUpsertInput = { email: input.email };
  if (input.attributes !== undefined) payload.attributes = input.attributes;
  if (input.listIds !== undefined) payload.listIds = input.listIds;
  const id = await createBrevoContact(payload);
  return { id, email: input.email };
}

export async function updateContact(
  identifier: string,
  input: {
    attributes?: Record<string, string | number | boolean | string[]> | undefined;
    listIds?: number[] | undefined;
    unlinkListIds?: number[] | undefined;
    emailBlacklisted?: boolean | undefined;
  },
) {
  await updateBrevoContact(identifier, input);
  return getBrevoContact(identifier);
}

export async function listLists(input: {
  limit?: number | undefined;
  offset?: number | undefined;
}) {
  const limit = clampLimit(input.limit);
  const offset = input.offset ?? 0;
  const page = await getBrevoLists({ limit, offset });
  const total = page.count ?? page.lists.length;
  const hasMore = offset + page.lists.length < total;
  return {
    items: page.lists,
    total,
    hasMore,
    ...(hasMore ? { nextCursor: String(offset + limit) } : {}),
  };
}

function membershipBody(input: {
  emails?: string[] | undefined;
  ids?: number[] | undefined;
  extIds?: string[] | undefined;
}): BrevoListMembershipBody {
  if (input.emails?.length) return { emails: input.emails };
  if (input.ids?.length) return { ids: input.ids };
  if (input.extIds?.length) return { extIds: input.extIds };
  throw new ValidationError('Provide at least one of emails, ids, or extIds.', {
    integration: 'brevo',
  });
}

export async function addContactToList(
  listId: number,
  input: {
    emails?: string[] | undefined;
    ids?: number[] | undefined;
    extIds?: string[] | undefined;
  },
) {
  await addBrevoContactToList(listId, membershipBody(input));
  return { listId, added: input };
}

export async function removeContactFromList(
  listId: number,
  input: {
    emails?: string[] | undefined;
    ids?: number[] | undefined;
    extIds?: string[] | undefined;
  },
) {
  await removeBrevoContactFromList(listId, membershipBody(input));
  return { listId, removed: input };
}

/**
 * Resolves a contact's list memberships to list names, bounded to the
 * first 200 lists in the account. A membership whose list falls outside
 * that window is still reported (by id), just without a resolved name —
 * never fabricated.
 */
export async function getContactLists(identifier: string) {
  const contact = await getBrevoContact(identifier);
  if (contact.listIds.length === 0) return { contactId: contact.id, lists: [] };
  const listsPage = await getBrevoLists({ limit: 200, offset: 0 });
  const names = brevoListNameMap(listsPage.lists);
  return {
    contactId: contact.id,
    lists: contact.listIds.map((id) => ({ id, name: names.get(id) ?? null })),
  };
}

export async function getList(listId: number) {
  const list = await getBrevoList(listId);
  if (!list)
    throw new NotFoundError(`Brevo list ${listId} was not found.`, { integration: 'brevo' });
  return list;
}

export async function getCampaigns(input: {
  limit?: number | undefined;
  offset?: number | undefined;
  status?: 'suspended' | 'archive' | 'sent' | 'queued' | 'draft' | 'inProcess' | undefined;
}) {
  const limit = clampLimit(input.limit);
  const offset = input.offset ?? 0;
  const page = await getBrevoCampaigns({
    limit,
    offset,
    ...(input.status !== undefined ? { status: input.status } : {}),
  });
  const total = page.count ?? page.campaigns.length;
  const hasMore = offset + page.campaigns.length < total;
  return {
    items: page.campaigns,
    total,
    hasMore,
    ...(hasMore ? { nextCursor: String(offset + limit) } : {}),
  };
}

export async function getCampaignActivity(campaignId: number) {
  return getBrevoCampaignActivity(campaignId);
}
