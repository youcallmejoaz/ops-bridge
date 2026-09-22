/**
 * Global test setup: provides a complete, valid fake environment so any
 * module importing config/env.ts (which validates and throws on import if
 * misconfigured) can load safely in every test file. Values are
 * obviously-fake and never hit real APIs — every provider call in tests
 * is either mocked at the service-module level (unit tests) or via msw
 * (integration tests).
 */
process.env.NODE_ENV = 'test';
process.env.PORT = '3999';
process.env.LOG_LEVEL = 'silent';
process.env.MCP_AUTH_SECRET = 'test-only-secret-do-not-use-in-prod-0000';
process.env.ENABLE_GHL = 'true';
process.env.ENABLE_BREVO = 'true';
process.env.ENABLE_STRIPE = 'true';
process.env.GHL_API_KEY = 'test-ghl-key';
process.env.GHL_LOCATION_ID = 'test-location-id';
process.env.BREVO_API_KEY = 'test-brevo-key';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake_0000000000000000';
