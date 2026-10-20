#!/usr/bin/env node
import { parseArgs, styleText } from 'node:util';
import { pathToFileURL } from 'node:url';
import { openHistoryStore } from '../src/history-store.js';

const HELP = `Initialize local history storage without collecting prices.

Usage: node scripts/init-history.js [options]
  --database FILE       Use a regular local database file (or HISTORY_DB_PATH).
  --json                Print one JSON result, without terminal decoration.
  --no-input            Never prompt (this command never prompts).
  --no-color            Disable terminal colors; also respects NO_COLOR.
  --dry-run, -n         Show the operation without creating or opening a database.
  --verbose, -v         Include the schema version in the result.
  --help, -h            Show this help.

Examples:
  node scripts/init-history.js
  node scripts/init-history.js --json --no-input
  node scripts/init-history.js --dry-run --no-color

Exit codes: 0 ready or dry run; 1 storage failure; 2 invalid arguments.
Initialization is idempotent. Unknown or changed schemas are never overwritten.
The default source remains pending; initialization does not grant data rights.
`;

export function cleanPath(value) {
  if (value === undefined) return undefined;
  const cleaned = value.trim().replace(/^"([\s\S]*)"$/u, '$1');
  if (!cleaned || /[\u0000-\u001f\u007f]/u.test(cleaned)) throw new Error('invalid_path');
  return cleaned;
}
export function printResult(result, values, title = 'History storage') {
  if (values.json) { process.stdout.write(`${JSON.stringify(result)}\n`); return; }
  const stream = ['failed', 'error'].includes(result.status) ? process.stderr : process.stdout;
  const colored = stream.isTTY && !values['no-color'] && !process.env.NO_COLOR;
  const style = (color, value) => colored ? styleText(color, value) : value;
  if (stream.isTTY) stream.write(`${style('cyan', title)}\n`);
  stream.write(`${style(['failed', 'error'].includes(result.status) ? 'red' : result.status === 'blocked' ? 'yellow' : 'green', result.status)}: ${result.message || 'Operation evaluated.'}\n`);
  for (const blocker of result.blockers ?? []) stream.write(`- ${blocker.code}: ${blocker.message}\n`);
  if (typeof result.observationsWritten === 'number') stream.write(`Observations written: ${result.observationsWritten}. Source requests: ${result.requests}.\n`);
  if (values.verbose && result.schemaVersion) stream.write(`Schema version: ${result.schemaVersion}.\n`);
  if (values.verbose && result.coverage) stream.write(result.coverage.type === 'bounded_zip_directory'
    ? `Coverage: ${result.coverage.targetCount} bounded ZIP queries; 10-mile radius and first 10 store results each.\n`
    : `Coverage: bounded sample; ${result.coverage.targetCount} targets; at most ${result.coverage.limitPerTarget} products each; one page per target.\n`);
}
export async function main(args = process.argv.slice(2)) {
  let values;
  try {
    ({ values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
      database: { type: 'string' }, json: { type: 'boolean' }, 'no-input': { type: 'boolean' },
      'no-color': { type: 'boolean' }, 'dry-run': { type: 'boolean', short: 'n' },
      verbose: { type: 'boolean', short: 'v' }, help: { type: 'boolean', short: 'h' },
    } }));
  } catch {
    const result = { status: 'error', code: 'invalid_arguments', message: 'Error: invalid command arguments. Run with --help for supported options.' };
    if (args.includes('--json')) process.stdout.write(`${JSON.stringify(result)}\n`);
    else process.stderr.write(`${result.message}\n`);
    return 2;
  }
  if (values.help) { process.stdout.write(values.json ? `${JSON.stringify({ status: 'help', help: HELP })}\n` : HELP); return 0; }
  let store;
  try {
    const filename = cleanPath(values.database);
    if (values['dry-run']) { printResult({ status: 'dry_run', message: 'Would initialize or verify local history storage. No file was opened or changed.' }, values); return 0; }
    store = openHistoryStore({ filename });
    printResult({ status: 'ready', ...store.getSummary(), message: 'Local SQLite history is ready. No grocery prices were collected.' }, values);
    return 0;
  } catch {
    printResult({ status: 'failed', code: 'history_storage_unavailable', message: 'Error: history storage could not be opened. Check the documented local database setup; unknown schemas and linked paths are refused.' }, values);
    return 1;
  } finally { store?.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
