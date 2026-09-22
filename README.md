# OpsBridge MCP

**Give Claude access to your business — not just three APIs.**

OpsBridge MCP is a production-ready, remote [Model Context Protocol](https://modelcontextprotocol.io)
server that gives an AI assistant a unified, secure interface over your GoHighLevel CRM, Brevo
marketing platform, and Stripe payments — correlating records across all three into one normalized
customer view, and executing safe, auditable actions across them.

The goal isn't to expose three APIs side by side. It's to let Claude answer questions like:

> "Find all customers who purchased through Stripe but aren't subscribed to our Brevo newsletter."

> "Add John to our newsletter, and add a note to his GHL contact saying he was added."

...by actually querying, correlating, and normalizing across systems — never fabricating data it
doesn't have, and never merging two different people just because their names match.

## Features

- **Unified customer model** — one normalized shape combining CRM status, marketing subscription,
  and payment history, with every field attributed to the system it came from.
- **Cross-system correlation** — matches records by email (high confidence) or phone (medium
  confidence); never merges on name alone. Ambiguous matches are returned as separate candidates,
  not silently merged.
- **34 focused MCP tools** — 3 generic customer tools, 6 cross-system tools, and one tool set per
  integration (9 GHL, 10 Brevo, 6 Stripe). No "do everything" mega-tool.
- **Safe writes by default** — bulk operations (adding several customers to a marketing list,
  syncing a customer between systems) preview what would happen and require `confirm: true` to
  execute. Marketing consent (Brevo opt-out) is a hard block, never inferred.
- **Scoped authorization** — `READ_CUSTOMERS` / `WRITE_CUSTOMERS` / `WRITE_MARKETING` / `WRITE_CRM`
  scopes, checked per tool call, ready for role-based permissions later.
- **Stateless & horizontally scalable** — no session affinity, no sticky routing; deploy behind any
  load balancer.
- **Bounded, paginated everything** — no tool can accidentally scan an entire account; truncated
  results say so explicitly.

## Supported integrations

| System                | What it provides                             |
| --------------------- | -------------------------------------------- |
| **GoHighLevel (GHL)** | Contacts, notes, opportunities, pipelines    |
| **Brevo**             | Contacts, lists, email campaigns             |
| **Stripe**            | Customers, payments, invoices, subscriptions |

Each integration can be enabled/disabled independently via environment variables — a disabled
integration's tools are simply not registered, rather than failing mysteriously at call time.

## Architecture

```
                     Claude / any MCP client
                              │
                     MCP · Streamable HTTP
                              ▼
                   ┌─────────────────────┐
                   │   OpsBridge MCP      │
                   │  ┌────────────────┐  │
                   │  │   Tool Layer    │  │   Zod-validated input/output,
                   │  │ (34 MCP tools)  │  │   scope checks, uniform errors
                   │  └───────┬────────┘  │
                   │          ▼            │
                   │  ┌────────────────┐  │
                   │  │  Service Layer  │  │   business logic: correlation,
                   │  │ (customer/ghl/  │  │   normalization, pagination,
                   │  │  brevo/stripe)  │  │   write-safety rules
                   │  └───────┬────────┘  │
                   │          ▼            │
                   │  ┌────────────────┐  │
                   │  │ Integration     │  │   one thin client per provider,
                   │  │ Clients         │  │   maps provider errors → our
                   │  │ (ghl/brevo/     │  │   typed error hierarchy
                   │  │  stripe)        │  │
                   │  └───┬────┬────┬──┘  │
                   └──────┼────┼────┼──────┘
                          ▼    ▼    ▼
                    ┌────────┐┌───────┐┌────────┐
                    │  GHL   ││ Brevo ││ Stripe │
                    │  API   ││  API  ││  API   │
                    └────────┘└───────┘└────────┘
```

`MCP Tool → Service → Integration Client → External API` — the MCP layer holds no business logic;
it validates input, checks scopes, and calls the service layer. All cross-system intelligence
(correlation, the unified model, write-safety rules) lives in `src/services/customerService.ts`.

## Installation

Requires Node.js 20+.

```bash
git clone <this-repo>
cd opsbridge-mcp
npm install
cp .env.example .env
# fill in .env — see "Environment variables" below
```

## Environment variables

See [`.env.example`](.env.example) for the full annotated list. Summary:

| Variable                                        | Required            | Description                                                                      |
| ----------------------------------------------- | ------------------- | -------------------------------------------------------------------------------- |
| `PORT`                                          | no (default 3000)   | HTTP port                                                                        |
| `NODE_ENV`                                      | no                  | `development` \| `production` \| `test`                                          |
| `LOG_LEVEL`                                     | no                  | pino log level                                                                   |
| `MCP_AUTH_SECRET`                               | **yes**             | Shared bearer secret clients must present. Generate with `openssl rand -hex 32`. |
| `MCP_AUTH_SCOPES`                               | no                  | Comma-separated scopes granted to that secret. Defaults to full access.          |
| `ENABLE_GHL` / `ENABLE_BREVO` / `ENABLE_STRIPE` | no (default `true`) | Toggle each integration                                                          |
| `GHL_API_KEY`, `GHL_LOCATION_ID`                | if GHL enabled      | GHL Private Integration Token + location                                         |
| `BREVO_API_KEY`                                 | if Brevo enabled    | Brevo API key                                                                    |
| `STRIPE_SECRET_KEY`                             | if Stripe enabled   | Stripe secret key (use a test-mode key where possible)                           |

The server validates configuration at startup and fails fast with a clear message if a required
value for an enabled integration is missing.

## Local development

```bash
npm run dev      # tsx watch — restarts on change
npm test         # vitest — unit, integration (msw-mocked), MCP (supertest)
npm run lint      # eslint
npm run typecheck # tsc --noEmit
npm run build     # compile to dist/
npm start         # run the compiled build
```

## Running the MCP server

```bash
npm run build && npm start
# or for development:
npm run dev
```

The server exposes:

- `POST/GET/DELETE /mcp` — the MCP Streamable HTTP endpoint (requires `Authorization: Bearer <MCP_AUTH_SECRET>`)
- `GET /health` — `{"status":"ok","service":"opsbridge-mcp","version":"1.0.0"}`, no auth required

## Connecting an MCP-compatible client

Point any MCP client that supports Streamable HTTP at `http://<host>:<port>/mcp` with the bearer
token set. Example client config (Claude Desktop / Claude Code style):

```json
{
  "mcpServers": {
    "opsbridge": {
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer <your MCP_AUTH_SECRET>" }
    }
  }
}
```

## Available tools

### Generic customer tools

`search_customers` · `get_customer` · `get_customer_activity`

### Cross-system tools — the reason this project exists

`unified_customer_search` · `customer_360` · `find_customers_by_conditions` · `sync_customer` ·
`add_customer_to_marketing` · `customer_note`

### GHL tools

`ghl_search_contacts` · `ghl_get_contact` · `ghl_create_contact` · `ghl_update_contact` ·
`ghl_add_contact_note` · `ghl_search_opportunities` · `ghl_get_opportunity` ·
`ghl_update_opportunity_stage` · `ghl_get_pipelines`

### Brevo tools

`brevo_search_contacts` · `brevo_get_contact` · `brevo_create_contact` · `brevo_update_contact` ·
`brevo_get_lists` · `brevo_add_contact_to_list` · `brevo_remove_contact_from_list` ·
`brevo_get_contact_lists` · `brevo_get_campaigns` · `brevo_get_campaign_activity`

### Stripe tools

`stripe_search_customers` · `stripe_get_customer` · `stripe_get_customer_payments` ·
`stripe_get_customer_invoices` · `stripe_get_customer_subscriptions` · `stripe_get_payment_summary`

Every tool has a description covering what it does, when to use it, what its inputs mean, and what
it should _not_ be used for (e.g. `brevo_search_contacts` explicitly says Brevo has no free-text
search). Run `tools/list` against a connected client to see full JSON Schemas.

### Example natural-language requests

- _"Find John Smith across all our systems."_ → `unified_customer_search`
- _"Give me everything we know about John."_ → `customer_360`
- _"Find customers who paid us but aren't subscribed to our newsletter."_ → `find_customers_by_conditions`
- _"Add John to our newsletter and add a note to his CRM record."_ → `add_customer_to_marketing` then `customer_note`
- _"Create John in Brevo if he's in GHL but not Brevo."_ → `sync_customer`
- _"Move this opportunity to Closed Won."_ → `ghl_get_pipelines` then `ghl_update_opportunity_stage`

## Authentication

Clients authenticate with a static bearer token (`MCP_AUTH_SECRET`) verified against a custom
`OAuthTokenVerifier` — chosen so swapping in real OAuth 2.0 later is a one-file change
(`src/auth/authentication.ts`) without touching tool code. The token grants a configurable scope
set (`MCP_AUTH_SCOPES`); tools declare and enforce the scopes they need
(`READ_CUSTOMERS` / `WRITE_CUSTOMERS` / `WRITE_MARKETING` / `WRITE_CRM`) before running.

## Security considerations

- **No secrets in code or logs.** API keys are read from environment variables only; structured
  logs (pino) redact `authorization`, `*apiKey`, `*token`, `*secret`, `*password` at any depth, and
  error messages returned to MCP clients never include raw provider credentials.
- **Every provider error is mapped** to a typed error (`AuthenticationError`, `ValidationError`,
  `NotFoundError`, `RateLimitError`, `ExternalAPIError`, `ConfigurationError`) with a message that
  names the integration and the fix, never the secret.
- **Write safety.** Bulk marketing adds and cross-system syncs preview by default and require
  `confirm: true`. A Brevo-blacklisted (opted-out) contact is never added to a list, confirm or not.
  Consent is never inferred from the fact that a tool was called.
- **No destructive operations in V1** — no deletes, no refunds, no bulk email sends. See Roadmap.
- **Deployment note:** binding to `0.0.0.0` (required by most cloud platforms) means the SDK's
  automatic DNS-rebinding host validation does not apply (it only auto-enables for localhost-class
  binds) — this server relies on the bearer token as its access control in that case. Operators
  fronting it with a known public hostname can further restrict `allowedHosts`/`allowedOrigins` in
  `src/app.ts`.

## Testing

```bash
npm test
```

110 tests across unit, integration, and MCP layers:

- **Unit** — env validation, normalization (never fabricates missing fields), the correlation
  engine (email/phone matching; **two different people sharing a name are never merged**),
  pagination bounds, error redaction, scope enforcement.
- **Integration** — GHL, Brevo, and Stripe clients against `msw`-mocked HTTP, covering success,
  401/404/429, and pagination.
- **MCP** — the real Express app via `supertest`: health check, 401/403 auth gating, tool discovery
  (schema validity), invalid-input rejection, and graceful error surfacing.
- **Workflow** — both headline demos end-to-end against mocked provider services: the "purchased
  but not subscribed" query, and "add to newsletter, then note it in GHL."

No test ever contacts a real GHL/Brevo/Stripe account.

## Deployment

The server is a stateless Express app — deployable to any platform that runs a Node.js container or
process, with no special session/affinity requirements. It reads its port from `PORT` and binds to
`0.0.0.0`.

**Docker:**

```bash
docker build -t opsbridge-mcp .
docker run -p 3000:3000 --env-file .env opsbridge-mcp
```

or `docker compose up` using the provided `docker-compose.yml`.

> The Dockerfile is a standard multi-stage build (compile → prod-deps-only runtime, non-root
> `node` user, `HEALTHCHECK` against `/health`, array-form `CMD` so Node runs as PID 1 and receives
> `SIGTERM`/`SIGINT` directly for a graceful shutdown). It could not be build-tested in this
> session's sandboxed environment — outbound access to Docker Hub's image CDN was blocked by the
> session's network policy — so build it once in your own environment before relying on it in
> production.

**Render:** a [`render.yaml`](render.yaml) blueprint is included — Render dashboard → **New →
Blueprint**, point it at this repo, and fill in the secret env vars it prompts for
(`MCP_AUTH_SECRET`, the enabled integrations' keys). For a service created by hand instead (**New →
Web Service**), set:

- **Build Command:** `npm ci --include=dev && npm run build`
- **Start Command:** `npm start`
- **Health Check Path:** `/health`

> **Do not set `NODE_ENV=production`** in Render's environment variables. Render applies
> dashboard env vars during the _build_ step too, and npm's default behavior is to skip
> `devDependencies` — including `typescript` and `@types/express` — whenever `NODE_ENV=production`
> is set, which breaks the TypeScript build with confusing "could not find a declaration file"
> errors. The explicit `--include=dev` above is a permanent guard against this regardless; the app
> itself doesn't need `NODE_ENV` set to run correctly (it only affects log pretty-printing, and
> `pino-pretty` ships as a regular dependency either way).

**Railway / Fly.io / a generic container platform:** point the platform at this repo (or the built
image), set the environment variables above, expose the port the platform assigns via `PORT`, and
use `npm run build && npm start` (or the Dockerfile) as the start command. The same `NODE_ENV`
caveat applies on any platform that reuses build-time env vars for `npm ci`.

## Adding a new integration

The integration layer is designed so GHL/Brevo/Stripe never need to change when a new provider is
added. To add one (e.g. HubSpot, Shopify, Slack):

1. `src/integrations/<name>/{client.ts,types.ts}` — a thin client wrapping the provider's SDK/API,
   mapping its errors to `src/errors/errors.ts`'s typed hierarchy, and Zod schemas for the response
   shapes you depend on (validate at the boundary — never trust an SDK's compile-time types alone).
2. `src/services/<name>Service.ts` — business logic: pagination-cursor translation, request shaping.
3. `src/tools/<name>/*.ts` — one focused MCP tool per operation, built with `defineTool` from
   `src/tools/shared.ts` (handles scope checks, logging, and error-to-`CallToolResult` mapping for
   you).
4. A normalization mapping in `src/services/normalizationService.ts` — `identityFrom<Name>X()` plus
   whichever of `crm`/`marketing`/`payments` the new provider's domain fits.
5. Register the tools in `src/mcp/registration.ts` behind an `ENABLE_<NAME>` env flag
   (`src/config/env.ts`).
6. Wire the new source into `src/services/customerService.ts`'s correlation and enrichment
   functions (`correlateIdentities` already works off normalized identities regardless of source).

## Roadmap

Deliberately out of scope for V1 (spec §29) — refunds, financial transfers, deleting customers,
arbitrary SQL/code execution, mass marketing campaigns, unrestricted email sending, complex
background synchronization. Candidates for later, once explicitly authorized and confirmed:

- Refunds and other write-guarded financial actions
- OAuth 2.0 authorization server support (the auth layer is already built for this — see
  `src/auth/authentication.ts`)
- Role-based permission profiles beyond the flat scope model
- Additional integrations: HubSpot, Salesforce, Shopify, Slack, Gmail, Google Calendar, Notion,
  Airtable, Supabase/Postgres, WhatsApp Business
- Optional, explicitly time-boxed caching for read-heavy, less-sensitive lookups (spec §16 keeps V1
  cache-free by design)

## License

MIT — see [LICENSE](LICENSE).
