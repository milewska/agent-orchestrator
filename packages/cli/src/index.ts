#!/usr/bin/env node

import { maybeShowUpdateNotice, scheduleBackgroundRefresh } from "./lib/update-check.js";

// Synchronous cache read — no network call on startup.
maybeShowUpdateNotice();

// Start background cache refresh early so it runs in parallel with the command.
// The unref'd timer lets the process exit without waiting if the command finishes first.
scheduleBackgroundRefresh();

import { ConfigNotFoundError } from "@aoagents/ao-core";
import { createProgram } from "./program.js";

createProgram()
  .parseAsync()
  .catch((err) => {
    if (err instanceof ConfigNotFoundError) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
      return;
    }
    throw err;
  });
