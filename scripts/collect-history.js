#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { lstatSync, readFileSync } from 'node:fs';
import { join, parse, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { KrogerClient } from '../src/kroger.js';
import { openHistoryStore, validateSourcePolicy } from '../src/history-store.js';
import { DEFAULT_COLLECTION_PLAN, runCollection, validateCollectionPlan } from '../src/collector.js';
import { cleanPath, printResult } from './init-history.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HELP = `Collect a bounded sample of reported prices into local SQLite history.

Usage: node scripts/collect-history.js [options]
  --plan FILE           Operator plan (default: config/collection-plan.json).
  --database FILE       Local database file (or HISTORY_DB_PATH).
  --source-policy FILE  Import metadata for actual written permission and review.
                        This flag cannot establish that permission exists.
  --once                Collect once and exit (default).
  --watch               Run a bounded schedule; stops immediately when blocked.
  --max-runs NUMBER     Watch limit, 1–100 (default: plan.maxRuns).
  --json                Print one JSON result without banners or secrets.
  --no-input            Never prompt (this command never prompts).
  --no-color            Disable terminal colors; also respects NO_COLOR.
  --dry-run, -n         Check prerequisites; no network, policy import, or DB write.
  --verbose, -v         Include fixed summary details, never raw API data.
  --help, -h            Show this help.

Examples:
  node scripts/collect-history.js --once --json --no-input
  node scripts/collect-history.js --plan config/collection-plan.json --dry-run
  node scripts/collect-history.js --watch --max-runs 2 --no-color

Exit codes: 0 completed, already collected, or dry run; 1 collection/storage
failure; 2 invalid arguments/configuration; 3 blocked/deferred; 130 cancelled.

The source must permit historical collection, display, and agent access, within
finite approved stores/topics and current retention/expiry limits. The default
Kroger public API source has no such permission. API credentials alone do not
enable collection. One request per topic, at most 10 topics and 50 products each;
no catalog crawl, shopper search history, or price backfill. Retries are disabled
by default; an operator plan may enable at most three safe-read attempts.
Durable quota reservations, source leases and backoff survive process restarts.
See README for the complete policy format and local credential setup.
`;

// Config files may contain private references. Bound reads and never echo their
// content, paths, source-policy references, or parse errors into CLI output.
export function readJsonFile(filename) {
  const full = resolve(cleanPath(filename));
  let current = parse(full).root;
  for (const part of full.slice(current.length).split(/[\\/]/u).filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error('linked_config');
  }
  const info = lstatSync(full);
  if (!info.isFile() || info.nlink > 1 || info.size > 65536) throw new Error('invalid_config');
  return JSON.parse(readFileSync(full, 'utf8'));
}
function resultCode(result) {
  return ['blocked', 'deferred'].includes(result.status) ? 3 : result.status === 'failed' ? 1 : result.status === 'cancelled' ? 130 : 0;
}
export async function main(args = process.argv.slice(2), env = process.env) {
  let values;
  try {
    ({ values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
      plan: { type: 'string' }, database: { type: 'string' }, 'source-policy': { type: 'string' },
      once: { type: 'boolean' }, watch: { type: 'boolean' }, 'max-runs': { type: 'string' },
      json: { type: 'boolean' }, 'no-input': { type: 'boolean' }, 'no-color': { type: 'boolean' },
      'dry-run': { type: 'boolean', short: 'n' }, verbose: { type: 'boolean', short: 'v' }, help: { type: 'boolean', short: 'h' },
    } }));
    if ((values.once && values.watch) || (values['max-runs'] !== undefined &&
        (!/^\d{1,3}$/u.test(values['max-runs']) || +values['max-runs'] < 1 || +values['max-runs'] > 100 || !values.watch))) throw new Error();
  } catch {
    const result = { status: 'error', code: 'invalid_arguments', message: 'Error: invalid collection arguments. Run with --help for supported options.' };
    if (args.includes('--json')) process.stdout.write(`${JSON.stringify(result)}\n`);
    else process.stderr.write(`${result.message}\n`);
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
    let plan = DEFAULT_COLLECTION_PLAN;
    let planProvided = true;
    try { plan = readJsonFile(values.plan || join(ROOT, 'config', 'collection-plan.json')); }
    catch (error) {
      if (error.code === 'ENOENT' && !values.plan) planProvided = false;
      else throw new Error('collection_plan_invalid');
    }
    const acceptedPlan = validateCollectionPlan(plan);
    // This executable owns the production Kroger adapter. A different source
    // label or certification server cannot borrow production data permission.
    if (acceptedPlan.sourceId !== 'kroger-public' || (env.KROGER_ENVIRONMENT || 'production') !== 'production') {
      throw new Error('source_adapter_mismatch');
    }
    let policy;
    if (values['source-policy']) {
      policy = readJsonFile(values['source-policy']);
      validateSourcePolicy(policy);
      if (policy.sourceId !== plan.sourceId) throw new Error('source_policy_invalid');
    }
    const filename = cleanPath(values.database ?? (env.HISTORY_DB_PATH || undefined));
    const client = new KrogerClient({ clientId: env.KROGER_CLIENT_ID || '', clientSecret: env.KROGER_CLIENT_SECRET || '',
      environment: env.KROGER_ENVIRONMENT || 'production' });
    if (!values['dry-run']) {
      store = openHistoryStore({ filename });
      if (policy) store.recordSourcePolicy(policy);
    }
    const maxRuns = values.watch ? Number(values['max-runs'] ?? plan.maxRuns ?? 1) : 1;
    const results = [];
    for (let count = 0; count < maxRuns; count++) {
      collectionStarted = !values['dry-run'];
      const result = await runCollection({ store, client, plan, planProvided, dryRun: values['dry-run'] === true, signal: controller.signal });
      if (values['dry-run']) {
        result.message = 'Prerequisites checked without opening storage, importing policy, or making source requests. Existing stored permission was not inspected.';
        if (policy) result.policyImport = 'not_applied';
      }
      results.push(result);
      if (!['completed', 'already_collected'].includes(result.status) || count + 1 === maxRuns) break;
      // One bounded wait, interruptible on SIGINT/SIGTERM. The watch never spins
      // on missing prerequisites or starts another job while one is in flight.
      try { await delay(plan.intervalMinutes * 60_000, undefined, { signal: controller.signal }); }
      catch { results.push({ status: 'cancelled', requests: 0, observationsWritten: 0 }); break; }
    }
    const final = results.at(-1);
    output = values.watch ? { ...final, runs: results.length, totalRequests: results.reduce((n, r) => n + r.requests, 0),
      totalObservationsWritten: results.reduce((n, r) => n + r.observationsWritten, 0) } : final;
    exitCode = resultCode(final);
  } catch {
    output = collectionStarted ? { status: 'failed', code: 'collection_outcome_unknown',
      message: 'Collection did not return a verified result. Source requests or committed observations may exist. Stop scheduling and inspect the recorded last attempt and storage before retrying.' }
      : { status: 'failed', code: 'collection_setup_invalid', message: 'Error: collection setup could not be accepted. Check the documented plan, policy metadata, credentials configuration, and regular local file paths. No source request was started.' };
    exitCode = collectionStarted ? 1 : 2;
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    try { store?.close(); }
    catch {
      output = { ...output, status: 'failed', code: 'collection_storage_cleanup_failed',
        message: 'Storage could not be closed cleanly. Counts, if present, reflect the returned collection result. Stop scheduling and inspect storage and the recorded last attempt before retrying.' };
      exitCode = 1;
    }
  }
  printResult(output, values, 'Historical price collection');
  return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
