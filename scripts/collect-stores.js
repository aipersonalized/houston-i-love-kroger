#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KrogerClient } from '../src/kroger.js';
import { openHistoryStore } from '../src/history-store.js';
import { DIRECTORY_SOURCE } from '../src/store-directory.js';
import { DEFAULT_DIRECTORY_PLAN, runDirectoryCollection, validateDirectoryPlan } from '../src/directory-collector.js';
import { readJsonFile } from './collect-history.js';
import { cleanPath, printResult } from './init-history.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HELP = `Collect finite permission-approved ZIP queries for stored store discovery.

Usage: node scripts/collect-stores.js [options]
  --plan FILE              Private plan (default config/store-directory-plan.json).
  --directory-policy FILE  Private metadata for actual reviewed directory rights.
  --database FILE          Authoritative local SQLite file (or HISTORY_DB_PATH).
  --once                   Run once and exit (default); no automatic retry/watch.
  --json                   One clean JSON result, no source rows or private values.
  --no-input               Never prompt (this command never prompts).
  --no-color               Disable terminal colors; also respects NO_COLOR.
  --dry-run, -n            No network, database open/write or policy import/review.
  --verbose, -v            Fixed operational summary, never private exceptions.
  --help, -h               Show this help.

Examples:
  node scripts/collect-stores.js --dry-run --json --no-input
  node scripts/collect-stores.js --plan config/store-directory-plan.json --once --json
  node scripts/collect-stores.js --directory-policy config/directory-policy.json --no-color

Only an actual reviewed grant for directory collection, display and agent access
covering every configured ZIP permits collection. A policy file grants nothing.
At most ten explicit ZIP queries; fixed 10-mile radius, first page of ten stores
per ZIP. This is not every nearby store, distance ordering or full promotions.
The directory source starts pending, separately from product-history permission.
Durable lease/quota/backoff and completed-snapshot publication survive restart.
Scheduling is external and must honor the plan interval, source grant and limits.
Exit: 0 completed/already-collected/dry-run; 1 collection/storage failure;
2 invalid setup/arguments; 3 blocked/deferred; 130 cancelled.
See docs/HISTORY.md for setup, retention, revocation and recovery.
`;

export async function main(args = process.argv.slice(2), env = process.env,
  { openStore = openHistoryStore, createClient = options => new KrogerClient(options), collect = runDirectoryCollection } = {}) {
  let values;
  try {
    ({ values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
      plan: { type: 'string' }, 'directory-policy': { type: 'string' }, database: { type: 'string' }, once: { type: 'boolean' },
      json: { type: 'boolean' }, 'no-input': { type: 'boolean' }, 'no-color': { type: 'boolean' },
      'dry-run': { type: 'boolean', short: 'n' }, verbose: { type: 'boolean', short: 'v' }, help: { type: 'boolean', short: 'h' },
    } }));
  } catch {
    printResult({ status: 'error', code: 'invalid_arguments', message: 'Invalid directory arguments. Run --help for supported options.' }, { json: args.includes('--json') });
    return 2;
  }
  if (values.help) { process.stdout.write(values.json ? `${JSON.stringify({ status: 'help', help: HELP })}\n` : HELP); return 0; }
  let store;
  let collectionStarted = false;
  let output;
  let exitCode;
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    let plan = DEFAULT_DIRECTORY_PLAN;
    let planProvided = true;
    try { plan = readJsonFile(values.plan || join(ROOT, 'config', 'store-directory-plan.json')); }
    catch (error) { if (error.code === 'ENOENT' && !values.plan) planProvided = false; else throw error; }
    plan = validateDirectoryPlan(plan);
    if (plan.sourceId !== DIRECTORY_SOURCE || (env.KROGER_ENVIRONMENT || 'production') !== 'production') throw new Error('source_adapter_mismatch');
    const filename = cleanPath(values.database ?? (env.HISTORY_DB_PATH || undefined));
    if (!values['dry-run']) {
      store = openStore({ filename });
      if (values['directory-policy']) {
        const policy = readJsonFile(values['directory-policy']);
        if (policy.sourceId !== DIRECTORY_SOURCE) throw new Error('source_adapter_mismatch');
        store.recordDirectoryPolicy(policy);
      }
    }
    const client = createClient({ clientId: env.KROGER_CLIENT_ID || '', clientSecret: env.KROGER_CLIENT_SECRET || '', environment: 'production' });
    collectionStarted = !values['dry-run'];
    const result = await collect({ store, client, plan, planProvided,
      dryRun: values['dry-run'] === true, signal: controller.signal });
    if (values['dry-run']) result.message = 'No storage, policy review/import or network. Existing directory permission was not inspected.';
    output = { ...result, message: result.message || `${result.snapshotsWritten} snapshots and ${result.storesWritten} store rows written; ${result.requests} bounded source requests.` };
    exitCode = ['blocked', 'deferred'].includes(result.status) ? 3 : result.status === 'failed' ? 1 : result.status === 'cancelled' ? 130 : 0;
  } catch {
    output = collectionStarted ? { status: 'failed', code: 'directory_outcome_unknown',
      message: 'Directory collection did not return a verified result. Source requests or committed snapshots may exist. Stop scheduling and inspect the recorded last attempt and storage before retrying.' }
      : { status: 'failed', code: 'directory_setup_invalid', message: 'Directory setup could not be accepted. Check the documented plan, actual reviewed rights, local policy metadata and regular private file paths. No source request was started.' };
    exitCode = collectionStarted ? 1 : 2;
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    try { store?.close(); }
    catch {
      output = { ...output, status: 'failed', code: 'directory_storage_cleanup_failed',
        message: 'Storage could not be closed cleanly. Counts, if present, reflect the returned collection result. Stop scheduling and inspect storage and the recorded last attempt before retrying.' };
      exitCode = 1;
    }
  }
  printResult(output, values, 'Stored store directory');
  return exitCode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
