#!/usr/bin/env node
process.argv.splice(2, 0, "doctor");
await import("./cobrowser.mjs");
