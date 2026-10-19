#!/usr/bin/env python3
"""Collect the app's selected first-party public Markdown, without network access."""
from _docs import collect, parser, run


def operation(arguments):
    command = parser('Collect this app’s reviewed first-party documentation inventory. No network or API requests.')
    command.add_argument('--url', required=True, help='Source inventory identifier; only repo:/ is accepted.')
    command.add_argument('--output', required=True, help='This skill’s research/official_docs folder.')
    args = command.parse_args(arguments)
    return collect(args.repository, args.output, args.url)


if __name__ == '__main__':
    raise SystemExit(run(operation))
