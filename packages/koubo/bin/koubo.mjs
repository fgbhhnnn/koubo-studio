#!/usr/bin/env node
import { runCli } from '../src/cli.mjs';

const code = await runCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  cwd: process.cwd(),
});
process.exit(code ?? 0);
