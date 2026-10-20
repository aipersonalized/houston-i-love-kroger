#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { openHistoryStore } from '../src/history-store.js';
import { cleanPath, printResult } from './init-history.js';

const HELP = `Inspect and maintain one local history database.

Usage: node scripts/maintain-history.js [action] [options]
Actions (choose one):
  --status                   Show counts and source state (default).
  --purge-expired             Delete expired/revoked/out-of-scope observation rows.
  --revoke-source SOURCE_ID   Disable that source and its rights immediately.
  --purge                    With --revoke-source, also delete its observations.

Options:
  --source SOURCE_ID         Source for status/purge-expired (default:kroger-public).
  --database FILE            Regular local database file (or HISTORY_DB_PATH).
  --json                     Print one fixed JSON receipt, without raw data.
  --no-input                 Never prompt (this command never prompts).
  --no-color                 Disable terminal colors; also respects NO_COLOR.
  --dry-run, -n              Describe the action; do not open or change storage.
  --verbose, -v              Include fixed schema/coverage details.
  --help, -h                 Show this help.

Examples:
  node scripts/maintain-history.js --status --json --no-input
  node scripts/maintain-history.js --purge-expired --source kroger-public
  node scripts/maintain-history.js --revoke-source kroger-public --purge --dry-run

Exit codes: 0 completed/dry run; 1 storage failure; 2 invalid input/unknown source.
Purge actions delete only matching observation rows in this database. They do
not erase SQLite free pages, journals, backups, or other copies. Revoked sources
cannot be reinstated by importing a policy. No action contacts the grocery API.
`;

export async function main(args = process.argv.slice(2), env = process.env) {
  let values;
  let sourceId;
  let action;
  try {
    ({ values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
      status: { type: 'boolean' }, 'purge-expired': { type: 'boolean' }, 'revoke-source': { type: 'string' },
      purge: { type: 'boolean' }, source: { type: 'string' }, database: { type: 'string' },
      json: { type: 'boolean' }, 'no-input': { type: 'boolean' }, 'no-color': { type: 'boolean' },
      'dry-run': { type: 'boolean', short: 'n' }, verbose: { type: 'boolean', short: 'v' }, help: { type: 'boolean', short: 'h' },
    } }));
    if (values.help) { process.stdout.write(values.json ? `${JSON.stringify({ status: 'help', help: HELP })}\n` : HELP); return 0; }
    const actions = [values.status, values['purge-expired'], values['revoke-source'] !== undefined].filter(Boolean).length;
    if (actions > 1 || (values.purge && !values['revoke-source']) || (values['revoke-source'] && values.source)) throw new Error();
    sourceId = values['revoke-source'] ?? values.source ?? 'kroger-public';
    if (!/^[a-z][a-z0-9-]{0,79}$/u.test(sourceId)) throw new Error();
    action = values['revoke-source'] ? 'revoke' : values['purge-expired'] ? 'purge_expired' : 'status';
    cleanPath(values.database ?? (env.HISTORY_DB_PATH || undefined));
  } catch {
    const result = { status: 'error', code: 'invalid_arguments', message: 'Error: choose one supported maintenance action and a valid source ID. Run with --help for examples.' };
    if (args.includes('--json')) process.stdout.write(`${JSON.stringify(result)}\n`);
    else process.stderr.write(`${result.message}\n`);
    return 2;
  }
  if (values['dry-run']) {
    printResult({ status: 'dry_run', action, purgeRequested: Boolean(values.purge),
      message: 'The maintenance action was checked without opening storage. Source existence and affected row counts were not inspected; no files changed.' }, values, 'History maintenance');
    return 0;
  }
  let store;
  try {
    store = openHistoryStore({ filename: cleanPath(values.database ?? (env.HISTORY_DB_PATH || undefined)), mustExist: true });
    const source = store.getSourceStatus(sourceId);
    if (source.status === 'unknown') {
      printResult({ status: 'error', code: 'source_unknown', message: 'Error: that source is not registered in this history database. Check the source ID before changing history.' }, values, 'History maintenance');
      return 2;
    }
    let removedObservations = 0;
    let removedDirectorySnapshots = 0;
    if (action === 'revoke') ({ removedObservations, removedDirectorySnapshots } = store.revokeSource(sourceId, { purge: Boolean(values.purge) }));
    if (action === 'purge_expired') ({ removedObservations, removedDirectorySnapshots } = store.purgeExpired({ sourceId }));
    const result = { status: 'completed', action, sourceStatus: store.getSourceStatus(sourceId).status,
      permissionStatus: store.getSourcePermission(sourceId).status,
      directoryPermissionStatus: store.getDirectoryPermission(sourceId).status,
      removedObservations, removedDirectorySnapshots, directory: store.getDirectorySummary(),
      ...store.getSummary(), message: action === 'status' ? 'Local history/directory counts and source state checked.' :
        action === 'revoke' ? 'The selected source is revoked. Requested price/directory row deletion is complete; other copies were not erased.' :
          'Expired, revoked, or currently out-of-scope price/directory rows were removed for the selected source. Other copies were not erased.' };
    printResult(result, values, 'History maintenance');
    if (!values.json) process.stdout.write(`Retained observations: ${result.observations}. Observation rows removed: ${removedObservations}. Source state: ${result.sourceStatus}.\n`);
    return 0;
  } catch {
    printResult({ status: 'failed', code: 'history_storage_unavailable', message: 'Error: local history maintenance failed. Check the documented storage setup; unknown schemas and linked paths are refused. No completion is claimed.' }, values, 'History maintenance');
    return 1;
  } finally { store?.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
