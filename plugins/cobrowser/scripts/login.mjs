#!/usr/bin/env node
process.argv.splice(2, 0, "login");
await import("./cobrowser.mjs");
