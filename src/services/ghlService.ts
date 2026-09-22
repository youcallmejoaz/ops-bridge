import {
  addGhlContactNote,
  createGhlContact,
  getGhlContact,
  getGhlContactNotes,
  getGhlOpportunity,
  getGhlPipelines,
  searchGhlContacts,
  searchGhlOpportunities,
  updateGhlContact,
  updateGhlOpportunityStage,
} from '../integrations/ghl/client.js';
import type { GhlContactCreateInput, GhlContactUpdateInput } from '../integrations/ghl/types.js';
import { NotFoundError, ValidationError } from '../errors/errors.js';
import { clampLimit, decodeCursor, encodeCursor, type PageResult } from '../utils/pagination.js';
import { ghlLocationId } from '../integrations/ghl/client.js';

/**
 * Business logic for GHL tools. Thin by design — GHL's own API already
 * does most of the shaping we need; this layer's job is pagination-cursor
 * translation, sensible defaults, and the one piece of real logic
 * (resolving a pipeline stage name to validate `ghl_update_opportunity_stage`
 * inputs before calling the API).
 */

interface GhlContactCursor {
  startAfter?: number;
  startAfterId?: string;
}

export async function searchContacts(input: {
  query?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}) {
  const limit = clampLimit(input.limit);
  const cursor = input.cursor ? decodeCursor<GhlContactCursor>(input.cursor) : undefined;
  const result = await searchGhlContacts({
    limit,
    ...(input.query !== undefined ? { query: input.query } : {}),
    ...(cursor?.startAfter !== undefined ? { startAfter: cursor.startAfter } : {}),
    ...(cursor?.startAfterId !== undefined ? { startAfterId: cursor.startAfterId } : {}),
  });

  const hasMore = result.contacts.length === limit;
  const last = result.contacts.at(-1);
  const nextCursor =
    hasMore && last?.dateAdded
      ? encodeCursor({ startAfter: Date.parse(last.dateAdded), startAfterId: last.id })
      : undefined;

  return {
    items: result.contacts,
    hasMore,
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  } satisfies PageResult<(typeof result.contacts)[number]>;
}

export async function getContact(contactId: string) {
  const contact = await getGhlContact(contactId);
  if (!contact)
    throw new NotFoundError(`GHL contact ${contactId} was not found.`, { integration: 'ghl' });
  return contact;
}

export async function createContact(input: Omit<GhlContactCreateInput, 'locationId'>) {
  if (!input.email && !input.phone) {
    throw new ValidationError(
      'GHL contact creation requires at least an email or a phone number.',
      {
        integration: 'ghl',
      },
    );
  }
  return createGhlContact({ ...input, locationId: ghlLocationId() });
}

export async function updateContact(contactId: string, input: GhlContactUpdateInput) {
  return updateGhlContact(contactId, input);
}

export async function addContactNote(contactId: string, body: string, userId?: string) {
  if (!body.trim()) {
    throw new ValidationError('Note body cannot be empty.', { integration: 'ghl' });
  }
  return addGhlContactNote(contactId, { body, ...(userId !== undefined ? { userId } : {}) });
}

export async function listContactNotes(contactId: string) {
  return getGhlContactNotes(contactId);
}

interface GhlOpportunityCursor {
  page: number;
}

export async function searchOpportunities(input: {
  query?: string | undefined;
  pipelineId?: string | undefined;
  pipelineStageId?: string | undefined;
  contactId?: string | undefined;
  status?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}) {
  const limit = clampLimit(input.limit);
  const cursor = input.cursor ? decodeCursor<GhlOpportunityCursor>(input.cursor) : undefined;
  const page = cursor?.page ?? 1;

  const result = await searchGhlOpportunities({
    limit,
    page,
    ...(input.query !== undefined ? { query: input.query } : {}),
    ...(input.pipelineId !== undefined ? { pipelineId: input.pipelineId } : {}),
    ...(input.pipelineStageId !== undefined ? { pipelineStageId: input.pipelineStageId } : {}),
    ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
  });

  const hasMore = result.opportunities.length === limit;
  const nextCursor = hasMore
    ? encodeCursor({ page: page + 1 } satisfies GhlOpportunityCursor)
    : undefined;

  return {
    items: result.opportunities,
    hasMore,
    total: result.meta?.total ?? null,
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
}

export async function getOpportunity(id: string) {
  const opportunity = await getGhlOpportunity(id);
  if (!opportunity) {
    throw new NotFoundError(`GHL opportunity ${id} was not found.`, { integration: 'ghl' });
  }
  return opportunity;
}

/**
 * Moves an opportunity to a different pipeline stage. Validates the target
 * stage belongs to a real pipeline before calling GHL, so a typo'd stage id
 * fails with a clear message rather than a confusing API error.
 */
export async function updateOpportunityStage(id: string, pipelineStageId: string) {
  const pipelines = await getGhlPipelines();
  const stageExists = pipelines.some((p) => p.stages.some((s) => s.id === pipelineStageId));
  if (!stageExists) {
    throw new ValidationError(
      `pipelineStageId "${pipelineStageId}" does not match any stage in any GHL pipeline for this location.`,
      { integration: 'ghl' },
    );
  }
  const opportunity = await updateGhlOpportunityStage(id, pipelineStageId);
  if (!opportunity) {
    throw new NotFoundError(`GHL opportunity ${id} was not found.`, { integration: 'ghl' });
  }
  return opportunity;
}

export async function listPipelines() {
  return getGhlPipelines();
}
