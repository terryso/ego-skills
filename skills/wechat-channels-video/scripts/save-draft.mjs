#!/usr/bin/env node
import { runSaveCli } from "./lib/launch-save.mjs";

const code = await runSaveCli(process.argv.slice(2));
process.exit(code);
