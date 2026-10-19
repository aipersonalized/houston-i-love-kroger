#!/usr/bin/env python3
"""Audit or refresh the selected first-party documentation snapshot."""
from _docs import audit, collect, parser, run


def operation(arguments):
    command = parser('Audit or refresh the app documentation snapshot. No network or API requests.')
    modes = command.add_mutually_exclusive_group(required=True)
    modes.add_argument('--check', action='store_true', help='Read-only local snapshot audit; --repository also checks source drift.')
    modes.add_argument('--refresh', action='store_true', help='Collect the selected first-party source files, then audit them.')
    args = command.parse_args(arguments)
    return collect(args.repository) if args.refresh else audit(args.repository)


if __name__ == '__main__':
    raise SystemExit(run(operation))
