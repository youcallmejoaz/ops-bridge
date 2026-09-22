import { z } from 'zod';

/**
 * Response shapes we depend on from GoHighLevel, defined as Zod schemas and
 * validated at the client boundary.
 *
 * Why we validate independently of `@gohighlevel/api-client`'s own types:
 * the official SDK types its advanced-search request as an empty interface
 * (`SearchBodyV2DTO = {}`) and its response as `Promise<any>` — there is no
 * compile-time or runtime guarantee about that endpoint's shape, and GHL's
 * docs site is unreachable from this environment to confirm it. Rather than
 * guess an unverified request body for the primary contact-search path, we
 * use the SDK's older `getContacts` method: it is marked `@deprecated` in
 * favor of advanced search, but is fully typed end-to-end and documented in
 * the SDK's own README, which we *can* verify. We validate its response
 * with the schemas below regardless, since a typed SDK signature is still
 * not a runtime guarantee. See README "Known limitations" for the upgrade
 * path once the advanced-search body can be confirmed against a live
 * account.
 */

export const ghlCustomFieldSchema = z.object({
  id: z.string().optional(),
  key: z.string().optional(),
  value: z.unknown().optional(),
});

export const ghlContactSchema = z.object({
  id: z.string(),
  locationId: z.string().optional(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  name: z.string().nullish(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  companyName: z.string().nullish(),
  address1: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  postalCode: z.string().nullish(),
  country: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
  source: z.string().nullish(),
  dateAdded: z.string().nullish(),
  dateUpdated: z.string().nullish(),
  customFields: z.array(ghlCustomFieldSchema).nullish(),
});
export type GhlContact = z.infer<typeof ghlContactSchema>;

export const ghlContactSearchResponseSchema = z.object({
  contacts: z.array(ghlContactSchema).default([]),
  count: z.number().nullish(),
});

export const ghlContactEnvelopeSchema = z.object({
  contact: ghlContactSchema,
});

export const ghlNoteSchema = z.object({
  id: z.string().optional(),
  contactId: z.string().optional(),
  body: z.string(),
  userId: z.string().nullish(),
  title: z.string().nullish(),
  dateAdded: z.string().nullish(),
});
export type GhlNote = z.infer<typeof ghlNoteSchema>;

export const ghlNoteEnvelopeSchema = z.object({
  note: ghlNoteSchema.optional(),
});

export const ghlNotesListSchema = z.object({
  notes: z.array(ghlNoteSchema).default([]),
});

export const ghlOpportunitySchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  monetaryValue: z.number().nullish(),
  pipelineId: z.string().nullish(),
  pipelineStageId: z.string().nullish(),
  assignedTo: z.string().nullish(),
  status: z.string().nullish(),
  source: z.string().nullish(),
  contactId: z.string().nullish(),
  locationId: z.string().nullish(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
  lastStatusChangeAt: z.string().nullish(),
});
export type GhlOpportunity = z.infer<typeof ghlOpportunitySchema>;

export const ghlOpportunitySearchResponseSchema = z.object({
  opportunities: z.array(ghlOpportunitySchema).default([]),
  meta: z
    .object({
      total: z.number().nullish(),
      startAfterId: z.string().nullish(),
      startAfter: z.number().nullish(),
      currentPage: z.number().nullish(),
      nextPage: z.number().nullish(),
    })
    .nullish(),
});

export const ghlOpportunityEnvelopeSchema = z.object({
  opportunity: ghlOpportunitySchema.optional(),
});

export const ghlPipelineStageSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  position: z.number().nullish(),
});

export const ghlPipelineSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  stages: z.array(ghlPipelineStageSchema).default([]),
});
export type GhlPipeline = z.infer<typeof ghlPipelineSchema>;

export const ghlPipelinesResponseSchema = z.object({
  pipelines: z.array(ghlPipelineSchema).default([]),
});

/**
 * Optional fields are typed `T | undefined` rather than plain `T` so that
 * objects produced by parsing a Zod `.optional()` schema — which may carry
 * the key with an explicit `undefined` value — satisfy this interface
 * directly under `exactOptionalPropertyTypes`.
 */
export interface GhlContactCreateInput {
  locationId: string;
  firstName?: string | undefined;
  lastName?: string | undefined;
  name?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  address1?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  postalCode?: string | undefined;
  country?: string | undefined;
  companyName?: string | undefined;
  tags?: string[] | undefined;
  source?: string | undefined;
  customFields?: Array<{ id: string; field_value?: unknown }> | undefined;
}

export type GhlContactUpdateInput = Omit<GhlContactCreateInput, 'locationId'>;
