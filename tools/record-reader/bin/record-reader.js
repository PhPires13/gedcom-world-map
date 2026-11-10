#!/usr/bin/env node
// Thin launcher so `npx record-reader` works after `npm install` (which builds dist/ via `prepare`).
import { main } from "../dist/cli.js";

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
