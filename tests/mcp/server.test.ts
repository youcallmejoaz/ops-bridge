import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';

const app = createApp();
const AUTH = { Authorization: `Bearer ${process.env.MCP_AUTH_SECRET}` };
const MCP_HEADERS = {
  Accept: 'application/json, text/event-stream',
  'Content-Type': 'application/json',
};

/** Extracts the JSON-RPC payload from either a plain JSON or SSE ("data: {...}") response body. */
function parseRpc(res: request.Response): any {
  if (res.headers['content-type']?.includes('text/event-stream')) {
    const text = res.text as string;
    const line = text.split('\n').find((l) => l.startsWith('data: '));
    if (!line) throw new Error(`No data: line in SSE body: ${text}`);
    return JSON.parse(line.slice('data: '.length));
  }
  return res.body;
}

describe('GET /health', () => {
  it('returns 200 with the expected shape, no secrets', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'opsbridge-mcp', version: '1.0.0' });
    expect(JSON.stringify(res.body)).not.toMatch(/key|secret|token/i);
  });
});

describe('GET /nonexistent', () => {
  it('returns a JSON 404, not an HTML error page', async () => {
    const res = await request(app).get('/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});

describe('POST /mcp — authentication', () => {
  it('rejects a request with no Authorization header (401)', async () => {
    const res = await request(app)
      .post('/mcp')
      .set(MCP_HEADERS)
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(res.status).toBe(401);
  });

  it('rejects a request with a wrong bearer token (401)', async () => {
    const res = await request(app)
      .post('/mcp')
      .set({ ...MCP_HEADERS, Authorization: 'Bearer wrong-token' })
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(res.status).toBe(401);
  });

  it('never sends a WWW-Authenticate challenge on 401 (this server is not an OAuth resource server, and that header sends some MCP clients into a discovery/DCR flow that has nothing to find here)', async () => {
    const noHeader = await request(app)
      .post('/mcp')
      .set(MCP_HEADERS)
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(noHeader.headers['www-authenticate']).toBeUndefined();

    const wrongToken = await request(app)
      .post('/mcp')
      .set({ ...MCP_HEADERS, Authorization: 'Bearer wrong-token' })
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(wrongToken.headers['www-authenticate']).toBeUndefined();
  });

  it('accepts a request with the correct bearer token', async () => {
    const res = await request(app)
      .post('/mcp')
      .set({ ...MCP_HEADERS, ...AUTH })
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(res.status).toBe(200);
    expect(parseRpc(res).result).toEqual({});
  });

  it('never echoes the configured secret back in any response body', async () => {
    const res = await request(app)
      .post('/mcp')
      .set({ ...MCP_HEADERS, Authorization: 'Bearer wrong-token' })
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(res.text).not.toContain(process.env.MCP_AUTH_SECRET);
  });
});

describe('POST /mcp — tool discovery and schemas', () => {
  it('lists every tool with a name, description, and a valid JSON Schema input', async () => {
    const res = await request(app)
      .post('/mcp')
      .set({ ...MCP_HEADERS, ...AUTH })
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

    const tools = parseRpc(res).result.tools as Array<{
      name: string;
      description: string;
      inputSchema: { type: string; properties?: Record<string, unknown> };
    }>;

    // 34 tools with all integrations enabled: 3 generic + 6 cross-system +
    // 9 GHL (includes ghl_get_pipelines, beyond the spec's 8 named tools,
    // to resolve stage ids) + 10 Brevo + 6 Stripe.
    expect(tools.length).toBe(34);

    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length); // no duplicate names
    for (const name of names) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/); // consistent snake_case
    }

    // Spot-check the flagship cross-system tools are present and well-described.
    for (const flagship of [
      'unified_customer_search',
      'customer_360',
      'find_customers_by_conditions',
      'sync_customer',
      'add_customer_to_marketing',
      'customer_note',
    ]) {
      const tool = tools.find((t) => t.name === flagship);
      expect(tool, `expected tool ${flagship} to be registered`).toBeDefined();
      expect(tool?.description.length).toBeGreaterThan(40);
      expect(tool?.inputSchema.type).toBe('object');
    }
  });
});

describe('POST /mcp — input validation', () => {
  it('rejects a tool call missing a required field, without invoking the handler', async () => {
    const res = await request(app)
      .post('/mcp')
      .set({ ...MCP_HEADERS, ...AUTH })
      .send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_customer', arguments: {} },
      });

    const rpc = parseRpc(res);
    expect(rpc.result.isError).toBe(true);
    expect(rpc.result.content[0].text).toMatch(/email/i);
  });

  it('rejects a malformed value for a typed field (e.g. not-an-email for an email field)', async () => {
    const res = await request(app)
      .post('/mcp')
      .set({ ...MCP_HEADERS, ...AUTH })
      .send({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'get_customer', arguments: { email: 'not-an-email' } },
      });
    const rpc = parseRpc(res);
    expect(rpc.result.isError).toBe(true);
  });

  it('accepts a valid tool call and surfaces a downstream error cleanly (never a crash, never a secret)', async () => {
    const res = await request(app)
      .post('/mcp')
      .set({ ...MCP_HEADERS, ...AUTH })
      .send({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'ghl_get_pipelines', arguments: {} },
      });
    expect(res.status).toBe(200);
    const rpc = parseRpc(res);
    expect(rpc.result.isError).toBe(true);
    expect(rpc.result.content[0].text).not.toContain(process.env.GHL_API_KEY);
  });

  it('rejects a call to an unknown tool name', async () => {
    const res = await request(app)
      .post('/mcp')
      .set({ ...MCP_HEADERS, ...AUTH })
      .send({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'not_a_real_tool', arguments: {} },
      });
    const rpc = parseRpc(res);
    expect(rpc.error ?? rpc.result?.isError).toBeTruthy();
  });
});
