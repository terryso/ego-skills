#!/usr/bin/env node
import { runDeps } from "./lib/cli.mjs";

process.exit(runDeps(process.argv.slice(2)));
