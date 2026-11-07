#!/usr/bin/env node
import { runExport } from "./lib/cli.mjs";

process.exit(runExport(process.argv.slice(2)));
