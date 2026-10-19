#!/usr/bin/env python3
"""List this skill's public procedures without executing them."""
import json
import os
from pathlib import Path
import re
import sys
from _docs import DocsError, Parser, public_path


def extract_playbook_steps(playbook_path):
    text = playbook_path.read_text(encoding='utf-8')
    pattern = re.compile(r'^## Step (\d+[a-z]?)[.:]?\s+(.+?)\s*$', re.MULTILINE | re.IGNORECASE)
    return pattern.findall(text)


def main(arguments=None):
    arguments = list(sys.argv[1:] if arguments is None else arguments)
    machine = '--json' in arguments
    command = Parser(description='List local playbook names and numbered steps. No writes, network, prompts or procedure execution.')
    command.add_argument('--json', action='store_true', help='Emit one JSON object.')
    command.add_argument('--no-input', action='store_true', help='Never prompt; all modes already run once.')
    command.add_argument('--no-color', action='store_true', help='Disable terminal color.')
    try:
        args = command.parse_args(arguments)
        skill = Path(__file__).resolve().parent.parent
        folder = public_path(skill, 'playbooks')
        files = sorted(folder.glob('*.md'))
        if not files:
            raise DocsError('missing_playbooks', 'No local playbooks are available.', 'Restore the complete skill folder.')
        playbooks = []
        for file in files:
            source = public_path(skill, 'playbooks/' + file.name)
            playbooks.append({'name': file.stem, 'steps': [{'number': number, 'title': title} for number, title in extract_playbook_steps(source)]})
        if args.json:
            print(json.dumps({'ok': True, 'playbooks': playbooks, 'assurance': 'Step listing only; no procedure was executed.'}))
        else:
            color = '\033[36m' if sys.stdout.isatty() and not args.no_color and not os.environ.get('NO_COLOR') else ''
            reset = '\033[0m' if color else ''
            for playbook in playbooks:
                print(f"{color}# {playbook['name']}{reset}")
                for step in playbook['steps']:
                    print(f"## Step {step['number']} {step['title']}")
                print()
        return 0
    except (DocsError, OSError, UnicodeError) as error:
        failure = {'ok': False, 'error': {'code': 'listing_failed', 'message': 'Procedure listing could not finish.',
                   'recovery': 'Run --help, check the arguments and restore the complete ordinary local skill folder.'}}
        if machine:
            print(json.dumps(failure))
        else:
            print('Error: ' + failure['error']['message'] + '\nFix: ' + failure['error']['recovery'], file=sys.stderr)
        return 2 if isinstance(error, DocsError) and error.code == 'invalid_arguments' else 1
    except KeyboardInterrupt:
        if machine:
            print(json.dumps({'ok': False, 'error': {'code': 'interrupted', 'message': 'Listing was interrupted.', 'recovery': 'Repeat listing when ready.'}}))
        else:
            print('Interrupted. No procedure was executed.', file=sys.stderr)
        return 130


if __name__ == '__main__':
    raise SystemExit(main())
