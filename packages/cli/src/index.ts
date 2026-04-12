#!/usr/bin/env node

import { maybeShowUpdateNotice, scheduleBackgroundRefresh } from "./lib/update-check.js";

// Synchronous cache read — no network call on startup.
maybeShowUpdateNotice();

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
  })
  .finally(() => {
    // Background cache refresh so next run has fresh data.
    scheduleBackgroundRefresh();
  });
