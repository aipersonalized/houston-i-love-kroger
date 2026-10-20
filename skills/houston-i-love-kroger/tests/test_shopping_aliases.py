"""Alias regressions using synthetic records and a loopback-only HTTP fixture."""
import contextlib
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
import subprocess
import sys
import threading
import unittest

from test_shopping import CLI, SCRIPT, STORE, PID, IID, search, estimate


def aliases(count, width=13):
    values = [str(count - index).zfill(width) for index in range(count)]
    if count > 1:
        values[-1] = values[0]
    return values


def payload_with_aliases(count, operation='products'):
    payload = estimate() if operation == 'estimate' else search(operation)
    if operation == 'products':
        payload['scope'].update(term='apples', topics=['apples'],
                                queries=[{'term': 'apples', 'returnedProducts': 1}])
    rows = payload['lines'] if operation == 'estimate' else payload['products']
    rows[0]['source']['aliasProductIds'] = aliases(count)
    return payload


@contextlib.contextmanager
def synthetic_app(payload, wire_size=None):
    encoded = json.dumps(payload, separators=(',', ':')).encode()
    if wire_size is not None:
        assert wire_size >= len(encoded)
        encoded += b' ' * (wire_size - len(encoded))
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            requests.append((self.path, json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}/app/', requests
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)


def run_cli(base, summary=False, operation='products'):
    # Windows OpenSSL initialization needs its system-directory settings even
    # for urllib's HTTP fixture. Do not inherit app URLs, proxies or credentials.
    environment = {name: os.environ[name] for name in ('SYSTEMROOT', 'WINDIR') if name in os.environ}
    selection = {'products': ['--term', 'apples'], 'product': ['--product-id', PID],
                 'estimate': ['--item', PID, IID, '2']}[operation]
    return subprocess.run([sys.executable, '-B', str(SCRIPT), operation, '--store', STORE,
                           *selection, '--base-url', base, '--data-use-approved', '--json',
                           '--no-input', *(['--summary-only'] if summary else [])],
                          capture_output=True, text=True, timeout=15, env=environment)


class AliasAcceptance(unittest.TestCase):
    def test_alias_string_guard_and_exact_values(self):
        schema = CLI.SOURCE['?aliasProductIds']
        for count in (0, 50, 51, 69, 500):
            for width in (13, 64):
                value = aliases(count, width)
                original = list(value)
                CLI.shape(value, schema, False)
                self.assertEqual(value, original)
        for value in (False, 1, '', {}, [None], [1], [False], [{}], [[]], ['x' * 65]):
            with self.subTest(kind=type(value).__name__):
                with self.assertRaises(ValueError):
                    CLI.shape(value, schema, False)

    def test_actual_cli_preserves_larger_alias_arrays(self):
        for count in (50, 51, 500):
            for operation in ('products', 'product', 'estimate'):
                with self.subTest(count=count, operation=operation), synthetic_app(payload_with_aliases(count, operation)) as (base, requests):
                    completed = run_cli(base, operation=operation)
                    self.assertEqual(completed.returncode, 0, completed.stderr)
                    result = json.loads(completed.stdout)
                    rows = result['lines'] if operation == 'estimate' else result['products']
                    self.assertEqual(rows[0]['source']['aliasProductIds'], aliases(count))
                    if operation != 'estimate':
                        self.assertEqual(result['offers'][0]['source']['aliasProductIds'], aliases(count))
                    expected = {'products': {'locationId': STORE, 'term': 'apples', 'includeAll': True},
                                'product': {'locationId': STORE, 'productId': PID},
                                'estimate': {'locationId': STORE, 'items': [{'productId': PID, 'itemId': IID, 'quantity': 2}]}}
                    self.assertEqual(requests, [('/app/' + CLI.PATHS[operation], expected[operation])])

    def test_actual_cli_keeps_the_existing_response_byte_cap(self):
        payload = payload_with_aliases(500)
        for size, expected_code in ((CLI.MAX_RESPONSE, 0), (CLI.MAX_RESPONSE + 1, 1)):
            with self.subTest(size=size), synthetic_app(payload, wire_size=size) as (base, requests):
                completed = run_cli(base, summary=True)
                self.assertEqual(completed.returncode, expected_code, completed.stderr)
                result = json.loads(completed.stdout)
                self.assertEqual(result['ok'], expected_code == 0)
                self.assertEqual(len(requests), 1)


if __name__ == '__main__':
    unittest.main()
