// Vercel serverless entry point. Deliberately plain JS, not TypeScript —
// this just re-exports the app already compiled by `npm run build` (see
// src/vercel.ts), so Vercel's own function bundler never has to resolve
// this project's NodeNext-style `.js`-suffixed TypeScript imports itself.
// `vercel.json` builds with `npm run build` before packaging functions, so
// ../dist/vercel.js is guaranteed to exist by the time this runs.
export { default } from '../dist/vercel.js';
