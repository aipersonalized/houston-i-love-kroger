"""First-party documentation collection for this app; never reads runtime data."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import uuid

SKILL_ROOT = Path(__file__).resolve().parent.parent
SOURCE_FILES = frozenset({
    'docs/API.md', 'docs/USER_GUIDE.md', 'docs/SELF_HOSTING.md',
    'docs/KROGER_PERMISSION_REQUEST.md', 'docs/HISTORY.md',
})


class DocsError(Exception):
    def __init__(self, code, message, recovery):
        super().__init__(message)
        self.code, self.message, self.recovery = code, message, recovery


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise DocsError('invalid_arguments', 'The command arguments are incomplete or unsupported.',
                        'Run this command with --help and supply the documented options.')


def parser(description):
    result = Parser(description=description)
    result.add_argument('--repository', help='Project checkout containing package.json and the selected public docs.')
    result.add_argument('--json', action='store_true', help='Emit one JSON result without banners or color.')
    result.add_argument('--no-input', action='store_true', help='Never prompt; all modes already run without prompts.')
    result.add_argument('--no-color', action='store_true', help='Disable terminal colors.')
    result.add_argument('--verbose', action='store_true', help='Include document hashes in the result.')
    return result


def public_path(root, relative):
    root = Path(root).absolute()
    path = root / relative
    if Path(relative).is_absolute() or '..' in Path(relative).parts:
        raise DocsError('unsafe_path', 'A documentation path leaves its permitted folder.', 'Restore the reviewed source inventory.')
    if not path.resolve().is_relative_to(root.resolve()):
        raise DocsError('unsafe_path', 'A documentation path leaves its permitted folder.', 'Use ordinary files within the selected folder.')
    for part in [root, *path.parents, path]:
        if part.is_symlink() or part.is_junction():
            raise DocsError('linked_path', 'A selected documentation path uses a symbolic link or junction.',
                            'Use an ordinary local checkout and an ordinary skill folder for collection.')
    return path


def read_json(path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, UnicodeError, ValueError):
        raise DocsError('invalid_document', 'A required documentation control file is missing or unreadable.',
                        'Restore the reviewed inventory or collect a complete snapshot before auditing.') from None


def inventory(skill_root=SKILL_ROOT):
    data = read_json(public_path(skill_root, 'research/source-inventory.json'))
    pages = data.get('pages') if isinstance(data, dict) else None
    if data.get('schemaVersion') != 1 or data.get('inventoryUrl') != 'repo:/' or not isinstance(pages, list):
        raise DocsError('invalid_inventory', 'The source inventory has an unsupported shape.', 'Restore the reviewed version-1 inventory.')
    seen = set()
    for entry in pages:
        if not isinstance(entry, dict) or entry.get('source') not in SOURCE_FILES or entry.get('source') in seen or \
                entry.get('path') != 'pages/' + Path(entry.get('source', '')).name or not entry.get('title'):
            raise DocsError('invalid_inventory', 'The inventory contains an unsupported, duplicate or misplaced document.',
                            'Use the reviewed first-party documentation allowlist.')
        seen.add(entry['source'])
    if seen != SOURCE_FILES or not isinstance(data.get('exclusions'), list):
        raise DocsError('invalid_inventory', 'The inventory does not account for the selected documentation scope.',
                        'Restore every selected source and its reviewed exclusion record.')
    return data


def repository_root(value=None, skill_root=SKILL_ROOT):
    root = Path(clean_path(value)).expanduser().absolute() if value is not None else Path(skill_root).parents[1]
    package = read_json(public_path(root, 'package.json'))
    if package.get('name') != 'houston-i-love-kroger' or not isinstance(package.get('version'), str):
        raise DocsError('wrong_repository', 'The selected folder is not this app checkout.',
                        'Set --repository to the project folder containing its package.json.')
    return root, package['version']


def destination(value, skill_root=SKILL_ROOT):
    expected = public_path(skill_root, 'research/official_docs')
    given = Path(clean_path(value)).expanduser().absolute()
    if given.resolve() != expected.resolve():
        raise DocsError('invalid_output', 'The output must be this skill’s research/official_docs folder.',
                        'Run from the skill folder with --output research/official_docs.')
    public_path(skill_root, 'research/official_docs')
    return expected


def clean_path(value):
    if isinstance(value, Path):
        return value
    if not isinstance(value, str):
        raise DocsError('invalid_arguments', 'A required folder path is missing.', 'Supply the documented ordinary local folder path.')
    cleaned = value.strip()
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] == '"':
        cleaned = cleaned[1:-1]
    if not cleaned:
        raise DocsError('invalid_arguments', 'A required folder path is empty.', 'Supply the documented ordinary local folder path.')
    return cleaned


def digest(content):
    return hashlib.sha256(content).hexdigest()


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('xb') as stream:
            stream.write(content)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def collect(repository=None, output=None, url='repo:/', skill_root=SKILL_ROOT):
    if url != 'repo:/':
        raise DocsError('unsupported_source', 'This collector accepts only the local repo:/ inventory.',
                        'Use --url repo:/. It never downloads web pages or API results.')
    source_inventory = inventory(skill_root)
    root, version = repository_root(repository, skill_root)
    target = destination(output or Path(skill_root) / 'research/official_docs', skill_root)
    snapshots = []
    for entry in source_inventory['pages']:
        source = public_path(root, entry['source'])
        try:
            content = source.read_bytes()
            text = content.decode('utf-8')
        except (OSError, UnicodeError):
            raise DocsError('source_unavailable', 'A selected first-party document is missing or unreadable.',
                            'Finish the selected app documents, then repeat collection. No failed page is treated as an exclusion.') from None
        if not text.strip() or not text.lstrip().startswith('#') or len(content) > 1_000_000:
            raise DocsError('source_invalid', 'A selected source is empty, oversized or not a substantive Markdown document.',
                            'Repair the first-party document before collecting it.')
        snapshots.append((entry, content))
    stamp = datetime.now(timezone.utc).isoformat()
    pages = [{**entry, 'url': 'repo:/' + entry['source'], 'status': 'saved',
              'sha256': digest(content), 'bytes': len(content), 'retrievedAt': stamp,
              'discovery': 'reviewed first-party inventory'} for entry, content in snapshots]
    manifest = {'schemaVersion': 1, 'publisher': source_inventory['publisher'],
                'inventoryUrl': 'repo:/', 'appVersion': version, 'sourceRevision': 'working-tree-snapshot',
                'retrievedAt': stamp, 'inventorySha256': digest(json.dumps(source_inventory, sort_keys=True).encode()),
                'counts': {'indexed': len(pages), 'saved': len(pages), 'failed': 0,
                           'reviewedExclusions': len(source_inventory['exclusions'])}, 'pages': pages}
    for entry, content in snapshots:
        atomic_write(public_path(target, entry['path']), content)
    atomic_write(public_path(target, 'exclusions.json'), (json.dumps(source_inventory['exclusions'], indent=2) + '\n').encode())
    atomic_write(public_path(target, 'manifest.json'), (json.dumps(manifest, indent=2) + '\n').encode())
    return audit(repository, skill_root)


def audit(repository=None, skill_root=SKILL_ROOT):
    source_inventory = inventory(skill_root)
    target = public_path(skill_root, 'research/official_docs')
    manifest = read_json(public_path(target, 'manifest.json'))
    expected_hash = digest(json.dumps(source_inventory, sort_keys=True).encode())
    if not isinstance(manifest, dict) or manifest.get('schemaVersion') != 1 or manifest.get('inventoryUrl') != 'repo:/' or \
            manifest.get('publisher') != source_inventory['publisher'] or manifest.get('inventorySha256') != expected_hash:
        raise DocsError('manifest_mismatch', 'The snapshot does not match the reviewed source inventory.', 'Run the documented refresh, then read the changed documents.')
    pages = manifest.get('pages')
    expected = {entry['source']: entry for entry in source_inventory['pages']}
    if not isinstance(pages, list) or len(pages) != len(expected) or {entry.get('source') for entry in pages if isinstance(entry, dict)} != set(expected):
        raise DocsError('page_accounting', 'The snapshot does not account for every selected document.', 'Collect the complete selected inventory again.')
    root = None
    if repository is not None:
        root, version = repository_root(repository, skill_root)
        if version != manifest.get('appVersion'):
            raise DocsError('source_changed', 'The source package version differs from the snapshot.', 'Refresh the corpus and reconcile affected instructions.')
    for page in pages:
        entry = expected[page['source']]
        if page.get('path') != entry['path'] or page.get('url') != 'repo:/' + entry['source'] or page.get('status') != 'saved':
            raise DocsError('page_identity', 'A snapshot page has the wrong identity or status.', 'Collect the complete selected inventory again.')
        content = public_path(target, entry['path']).read_bytes()
        if not content.strip() or digest(content) != page.get('sha256') or len(content) != page.get('bytes'):
            raise DocsError('hash_mismatch', 'A collected document is missing, empty or changed.', 'Refresh from the reviewed source; do not accept a partial snapshot.')
        if root is not None and digest(public_path(root, entry['source']).read_bytes()) != page['sha256']:
            raise DocsError('source_changed', 'The app documents changed after collection.', 'Refresh, read the changed sources, and reconcile dependent skill instructions.')
    counts = {'indexed': len(expected), 'saved': len(expected), 'failed': 0,
              'reviewedExclusions': len(source_inventory['exclusions'])}
    if manifest.get('counts') != counts or read_json(public_path(target, 'exclusions.json')) != source_inventory['exclusions']:
        raise DocsError('page_accounting', 'Counts or reviewed exclusions do not reconcile.', 'Collect the complete selected inventory again.')
    actual_pages = {path.relative_to(target).as_posix() for path in public_path(target, 'pages').rglob('*') if path.is_file()}
    if actual_pages != {entry['path'] for entry in expected.values()}:
        raise DocsError('unexpected_page', 'Unaccounted pages remain in the snapshot.', 'Inspect the extra material; remove it only within an authorized cleanup scope.')
    return {'status': 'passed', 'appVersion': manifest['appVersion'], 'pages': pages,
            'counts': counts, 'networkRequests': 0, 'sourceFreshness': 'checked' if root else 'not_checked',
            'assurance': 'Exact first-party document bytes and inventory integrity, not agent behavior or live access.'}


def run(operation, arguments=None):
    arguments = list(sys.argv[1:] if arguments is None else arguments)
    machine = '--json' in arguments
    no_color = '--no-color' in arguments or bool(os.environ.get('NO_COLOR'))
    try:
        result = operation(arguments)
        if not '--verbose' in arguments:
            result.pop('pages', None)
        payload, code = {'ok': True, 'result': result}, 0
    except DocsError as error:
        payload = {'ok': False, 'error': {'code': error.code, 'message': error.message, 'recovery': error.recovery}}
        code = 2 if error.code in {'invalid_arguments', 'unsupported_source', 'invalid_output', 'unsafe_path', 'linked_path'} else 1
    except (OSError, UnicodeError, ValueError, KeyError, TypeError, AttributeError):
        payload, code = {'ok': False, 'error': {'code': 'documentation_io',
                         'message': 'Documentation files could not be read or written completely.',
                         'recovery': 'Check the ordinary local files and folder permissions, then run --check. An interrupted collection may require refresh.'}}, 1
    except KeyboardInterrupt:
        payload, code = {'ok': False, 'error': {'code': 'interrupted', 'message': 'Documentation maintenance was interrupted.',
                         'recovery': 'Run --check before deciding whether collection needs to be repeated.'}}, 130
    if machine:
        print(json.dumps(payload))
    else:
        stream = sys.stdout if code == 0 else sys.stderr
        color = ('\033[32m' if code == 0 else '\033[31m') if stream.isatty() and not no_color else ''
        reset = '\033[0m' if color else ''
        if code == 0:
            print(f"{color}Houston I Love Kroger documentation: PASS — {payload['result']['counts']['saved']} selected pages.{reset}", file=stream)
            print('Local source collection only. No shopper or live API data was accessed.', file=stream)
        else:
            print(f"{color}Error: {payload['error']['message']}{reset}\nFix: {payload['error']['recovery']}", file=stream)
    return code
