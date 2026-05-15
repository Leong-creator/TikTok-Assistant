#!/usr/bin/env node
process.argv.splice(2, 0, "smoke-test");
await import("./cobrowser.mjs");
