import contextlib
import copy
import importlib.util
import io
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'promotions.py'
SPEC = importlib.util.spec_from_file_location('promotion_cli', SCRIPT)
CLI = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CLI)


def observation(store='TEST0001', identifier='1'):
    return {'observationId': identifier, 'sourceId': 'synthetic-source',
            'sourceLabel': 'Synthetic test source', 'locationId': store,
            'productId': 'synthetic-product', 'itemId': 'synthetic-item',
            'description': 'Synthetic milk', 'brand': None, 'size': '1 unit',
            'soldBy': 'unit', 'currency': None, 'priceBasis': None,
            'modality': None, 'eligibilityKey': None, 'unitBasis': None,
            'price': {'regular': 4, 'promo': 3, 'regularCents': 400, 'promoCents': 300,
                      'regularPerUnitEstimate': None, 'promoPerUnitEstimate': None,
                      'effectiveDate': None, 'expirationDate': None},
            'observedAt': '2026-01-01T00:00:00.000Z',
            'priceQualification': 'qualified',
            'dateQualification': 'qualified', 'promotionStatus': 'reported_promotion'}


def latest(status='available', rows=None):
    row = {**observation(), 'availability': {'inStore': True, 'stockLevel': 'HIGH', 'status': 'reported_in_stock'},
           'calculated': {'savingsCents': 100, 'percentOff': 25}}
    rows = ([row] if status == 'available' else []) if rows is None else rows
    snapshot = {'snapshotId': '11', 'observedAt': '2026-01-01T00:00:00.000Z',
                'completedAt': '2026-01-01T00:01:00.000Z', 'ageSeconds': 60,
                'maxAgeSeconds': 86400} if status in {'available', 'stale'} else None
    if status == 'stale':
        snapshot['ageSeconds'] = 86400
    result = {'ok': True, 'apiVersion': 1, 'status': status, 'locationId': 'TEST0001',
            'topic': 'milk', 'deals': rows, 'snapshot': snapshot,
            'latestAttempt': {'status': 'failed', 'startedAt': '2026-01-01T00:02:00.000Z',
                              'finishedAt': '2026-01-01T00:03:00.000Z'},
            'page': {'limit': 20, 'returned': len(rows), 'truncated': False, 'nextCursor': None},
            'coverage': {'type': 'bounded_topic_sample', 'topic': 'milk', 'pagesPerTarget': 1,
                         'limitPerTarget': 20 if snapshot else None,
                         'returnedProductCount': 1 if snapshot else None, 'completeCatalog': False,
                         'message': 'Synthetic bounded topic sample, not live stock.'}}
    if status != 'available':
        result['reason'] = {'stale': 'snapshot_stale', 'no_data': 'no_completed_collection',
                            'permission_required': 'source_permission_required'}[status]
    return result


def price_product(currency='USD', product_id='synthetic-product', item_id='synthetic-item'):
    row = {**latest()['deals'][0], 'currency': currency, 'priceBasis': 'one-package',
           'eligibilityKey': 'all-shoppers', 'modality': 'IN_STORE',
           'productId': product_id, 'itemId': item_id,
           'pricing': {'status': 'promotion', 'currentCents': 300, 'reason': None},
           'qualificationGaps': ['currency_unreported'] if currency is None else []}
    return row


def prices(rows=None, status='available'):
    value = latest(status, [])
    value.pop('deals')
    value['products'] = [price_product()] if rows is None and status == 'available' else rows or []
    value['page']['returned'] = len(value['products'])
    return value


def basket(currency='USD', unresolved=False):
    product = price_product(currency)
    line = {'topic': 'milk', 'productId': 'synthetic-product', 'itemId': 'synthetic-item', 'quantity': 2,
            'status': 'estimated', 'reason': None, 'unitPriceCents': 300, 'lineTotalCents': 600,
            'currency': currency, 'observationId': product['observationId'], 'observedAt': product['observedAt'],
            'snapshot': latest()['snapshot'], 'product': product, 'qualificationGaps': product['qualificationGaps'][:]}
    lines = [line]
    if unresolved:
        lines.append({'topic': 'bread', 'productId': 'missing-product', 'itemId': 'missing-item', 'quantity': 1,
                      'status': 'unresolved', 'reason': 'not_in_latest_sample', 'unitPriceCents': None, 'lineTotalCents': None,
                      'currency': None, 'observationId': None, 'observedAt': None, 'snapshot': None,
                      'product': None, 'qualificationGaps': []})
    gap_labels = (['currency_unreported'] if currency is None else []) + (['unresolved_lines'] if unresolved else [])
    return {'ok': True, 'apiVersion': 1, 'status': 'partial' if unresolved else 'complete', 'locationId': 'TEST0001',
            'evaluatedAt': '2026-01-01T00:03:00.000Z', 'lines': lines,
            'totals': {'reportedSubtotalCents': 600, 'qualifiedSubtotalCents': None if gap_labels else 600,
                       'currency': currency, 'currencyQualification': 'unreported' if currency is None else 'source_reported',
                       'estimatedLineCount': 1, 'unresolvedLineCount': int(unresolved), 'qualificationGaps': gap_labels},
            'exclusions': ['tax', 'fees', 'coupons', 'eligibility_verification', 'checkout_changes'],
            'coverage': {'type': 'bounded_topic_sample', 'completeCatalog': False, 'message': 'Synthetic bounded estimate.'}}


class ToolTests(unittest.TestCase):
    def args(self, *extra):
        return CLI.parser().parse_args(list(extra))

    def test_base_address_boundaries(self):
        for good in ['https://example.test/app/', 'http://localhost:4173/app/', 'http://[::1]:4173/']:
            self.assertEqual(CLI.base_url(good), good)
        for bad in ['http://remote.test/', 'file:///tmp/test', 'https://user:secret@example.test/',
                    'https://example.test/app?secret=value', 'https://example.test/#fragment',
                    'https://example.test/app', 'https://example.test/../', 'https://example.test:0/']:
            with self.subTest(bad=bad), self.assertRaises(CLI.ToolError):
                CLI.base_url(bad)

    def test_dry_run_performs_no_network_and_does_not_echo_search(self):
        with patch.object(CLI, 'request', side_effect=AssertionError('network forbidden')):
            value, code = CLI.run(self.args('search', '--store', 'TEST0001', '--term', 'synthetic', '--dry-run'))
        self.assertEqual(code, 0)
        self.assertFalse(value['network'])
        self.assertNotIn('synthetic', json.dumps(value))

    def test_requires_actual_recipient_check_before_records(self):
        with patch.object(CLI, 'request', side_effect=AssertionError('network forbidden')):
            with self.assertRaises(CLI.ToolError) as caught:
                CLI.run(self.args('search', '--store', 'TEST0001'))
        self.assertEqual(caught.exception.code, 'recipient_permission_required')

    def test_filters_and_calendar_validation(self):
        body = CLI.build_body(self.args('search', '--store', 'TEST0001', '--term', 'milk',
                              '--product-id', 'synthetic', '--from', '2026-01-01T00:00:00Z', '--limit', '50'))
        self.assertEqual(body['observedFrom'], '2026-01-01T00:00:00Z')
        self.assertEqual(body['limit'], 50)
        for extra in [('search', '--store', 'bad'), ('search', '--store', 'TEST0001', '--limit', '51'),
                      ('search', '--store', 'TEST0001', '--from', '2026-02-30T00:00:00Z'),
                      ('search', '--store', 'TEST0001', '--from', '2026-02-01T00:00:00Z', '--to', '2026-01-01T00:00:00Z'),
                      ('search', '--store', 'TEST0001', '--term', 'bad\nterm'),
                      ('status', '--store', 'TEST0001'), ('retrieve', '--store', 'TEST0001', '--observation-id', '../1')]:
            with self.subTest(extra=extra), self.assertRaises(CLI.ToolError):
                CLI.build_body(self.args(*extra))

    def test_history_matches_public_utc_and_cursor_bounds(self):
        for instant in ['2026-01-01T00:00:00Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.123Z']:
            body = CLI.build_body(self.args('search', '--store', 'TEST0001', '--from', instant, '--cursor', 'a' * 512))
            self.assertEqual(body['observedFrom'], instant)
        for fields in [('--from', '2026-01-01T00:00:00.1Z'), ('--from', '2026-01-01T00:00:00.12Z'), ('--cursor', 'a' * 513)]:
            with self.subTest(fields=fields), self.assertRaises(CLI.ToolError):
                CLI.build_body(self.args('search', '--store', 'TEST0001', *fields))

    def test_latest_exact_topic_and_no_history_or_live_fields(self):
        self.assertEqual(CLI.build_body(self.args('latest', '--store', '00000001', '--topic', 'milk')),
                         {'locationId': '00000001', 'topic': 'milk', 'limit': 20})
        for fields in [[], ['--topic', '*'], ['--topic', 'mi\u200blk'], ['--topic', 'milk', '--term', 'bread'],
                       ['--topic', 'milk', '--from', '2026-01-01T00:00:00Z'],
                       ['--topic', 'milk', '--cursor', '../value'], ['--topic', 'milk', '--limit', '51']]:
            with self.subTest(fields=fields), self.assertRaises(CLI.ToolError):
                CLI.build_body(self.args('latest', '--store', 'TEST0001', *fields))
        for operation in ['search', 'status', 'retrieve']:
            with self.subTest(operation=operation), self.assertRaises(CLI.ToolError):
                CLI.build_body(self.args(operation, '--store', 'TEST0001', '--topic', 'milk'))

    def test_latest_recipient_gate_and_dry_run_never_network(self):
        with patch.object(CLI, 'request', side_effect=AssertionError('network forbidden')):
            with self.assertRaises(CLI.ToolError) as caught:
                CLI.run(self.args('latest', '--store', 'TEST0001', '--topic', 'milk'))
            value, code = CLI.run(self.args('latest', '--store', 'TEST0001', '--topic', 'milk', '--dry-run'))
        self.assertEqual(caught.exception.code, 'recipient_permission_required')
        self.assertEqual(code, 0)
        self.assertFalse(value['network'])
        self.assertNotIn('milk', json.dumps(value))

    def test_latest_fresh_empty_no_data_stale_and_permission_are_distinct(self):
        args = self.args('latest', '--store', 'TEST0001', '--topic', 'milk', '--summary-only')
        for status, rows, exit_code in [('available', None, 0), ('available', [], 0),
                                        ('no_data', [], 3), ('stale', [], 3), ('permission_required', [], 3)]:
            with self.subTest(status=status, rows=rows):
                value, code = CLI.result_for(args, latest(status, rows))
                self.assertEqual(value['status'], status)
                self.assertEqual(code, exit_code)
                self.assertEqual(value['returned'], 1 if rows is None else 0)
                self.assertNotIn('locationId', value)
                self.assertNotIn('topic', value)
                self.assertNotIn('snapshotId', value.get('snapshot') or {})
                self.assertNotIn('Synthetic milk', json.dumps(value))
                self.assertEqual(value['latestAttempt']['status'], 'failed')

    def test_latest_rejects_wrong_scope_private_fields_and_old_promotion(self):
        args = self.args('latest', '--store', 'TEST0001', '--topic', 'milk', '--data-use-approved')
        alterations = [lambda p: p.update(topic='bread'), lambda p: p.update(locationId='TEST0002'),
                       lambda p: p.update(clientSecret='synthetic-private'),
                       lambda p: p['snapshot'].update(ageSeconds=86400),
                       lambda p: p['deals'][0].update(observedAt='2025-12-31T00:00:00.000Z'),
                       lambda p: p['deals'][0].update(privateEvidence='synthetic-private'),
                       lambda p: p['deals'][0]['availability'].update(inStore=False),
                       lambda p: p['deals'][0]['calculated'].update(savingsCents=101),
                       lambda p: p['deals'][0].update(priceQualification='unsupported_source_price'),
                       lambda p: p['coverage'].update(completeCatalog=True),
                       lambda p: p['page'].update(returned=2)]
        for alter in alterations:
            payload = latest()
            alter(payload)
            with self.subTest(payload=payload), self.assertRaises(CLI.ToolError):
                CLI.result_for(args, payload)
        with self.assertRaises(CLI.ToolError):
            CLI.result_for(args, {**latest('stale'), 'deals': latest()['deals']})
        value, code = CLI.result_for(args, latest())
        self.assertEqual(code, 0)
        self.assertEqual(value['deals'][0]['description'], 'Synthetic milk')

    def test_latest_unavailable_is_operational_gap_without_fake_empty_snapshot(self):
        args = self.args('latest', '--store', 'TEST0001', '--topic', 'milk', '--summary-only')
        value, code = CLI.result_for(args, {'ok': True, 'apiVersion': 1, 'status': 'unavailable',
                                          'reason': 'no_authorized_source', 'locationId': 'TEST0001'})
        self.assertEqual(code, 3)
        self.assertEqual(value['status'], 'unavailable')
        self.assertNotIn('deals', value)
        self.assertNotIn('snapshot', value)

    def test_history_unsupported_price_keeps_qualification_and_no_invalid_numbers(self):
        args = self.args('search', '--store', 'TEST0001', '--data-use-approved')
        row = observation()
        row.update(priceQualification='unsupported_source_price', promotionStatus='not_verified_promotion')
        row['price'].update(regular=None, regularCents=None)
        value, code = CLI.result_for(args, {'ok': True, 'apiVersion': 1, 'status': 'available',
                                          'locationId': 'TEST0001', 'observations': [row]})
        self.assertEqual(code, 0)
        self.assertEqual(value['observations'][0]['priceQualification'], 'unsupported_source_price')

    def estimate_args(self, extra=None, *flags):
        argv = ['estimate', '--store', 'TEST0001', '--item', 'milk', 'synthetic-product', 'synthetic-item', '2']
        if extra:
            argv.extend(['--item', *extra])
        return self.args(*argv, *flags)

    def test_prices_exact_identity_and_regular_only_price_is_not_a_deal(self):
        args = self.args('prices', '--store', 'TEST0001', '--topic', 'milk', '--product-id', 'synthetic-product', '--data-use-approved')
        self.assertEqual(CLI.build_body(args)['productId'], 'synthetic-product')
        row = price_product()
        row.update(promotionStatus='not_verified_promotion', calculated=None,
                   pricing={'status': 'regular_only', 'currentCents': 400, 'reason': None})
        row['price'].update(promo=None, promoCents=None)
        value, code = CLI.result_for(args, prices([row]))
        self.assertEqual(code, 0)
        self.assertEqual(value['products'][0]['pricing']['status'], 'regular_only')
        row['productId'] = 'other'
        with self.assertRaises(CLI.ToolError):
            CLI.result_for(args, prices([row]))

    def test_prices_unavailable_facts_remain_explicit_and_snapshot_bound(self):
        args = self.args('prices', '--store', 'TEST0001', '--topic', 'milk', '--data-use-approved')
        for reason, changes in [('out_of_stock', {'availability': {'inStore': True, 'stockLevel': 'OUT_OF_STOCK', 'status': 'reported_out_of_stock'}}),
                                ('unsupported_source_price', {'priceQualification': 'unsupported_source_price'}),
                                ('unqualified_dates', {'dateQualification': 'unqualified'})]:
            row = price_product()
            row.update(changes, calculated=None, pricing={'status': 'unavailable', 'currentCents': None, 'reason': reason})
            value, code = CLI.result_for(args, prices([row]))
            self.assertEqual(code, 0)
            self.assertIsNone(value['products'][0]['pricing']['currentCents'])
        payload = prices()
        payload['products'][0]['observedAt'] = '2025-12-31T00:00:00.000Z'
        with self.assertRaises(CLI.ToolError):
            CLI.result_for(args, payload)

    def test_estimate_input_bounds_no_caller_prices_and_permission_gate(self):
        args = self.estimate_args()
        self.assertEqual(CLI.build_body(args)['items'][0]['quantity'], 2)
        for fields in [('--item', 'milk', 'p', 'i', '0'), ('--item', 'milk', 'p', 'i', '100'),
                       ('--item', 'milk', 'p', 'i', '1.5'), ('--item', 'milk', 'synthetic-product', 'synthetic-item', '1'),
                       ('--term', 'milk'), ('--topic', 'milk')]:
            with self.subTest(fields=fields), self.assertRaises(CLI.ToolError):
                CLI.build_body(self.estimate_args(None, *fields))
        with patch.object(CLI, 'request', side_effect=AssertionError('network forbidden')):
            with self.assertRaises(CLI.ToolError):
                CLI.run(args)
            value, code = CLI.run(self.estimate_args(None, '--dry-run'))
            self.assertEqual(code, 0)
            self.assertFalse(value['network'])
            self.assertNotIn('synthetic-product', json.dumps(value))

    def test_estimate_complete_partial_and_unreported_currency_are_qualified(self):
        for currency, partial in [('USD', False), ('USD', True), (None, False)]:
            with self.subTest(currency=currency, partial=partial):
                args = self.estimate_args(['bread', 'missing-product', 'missing-item', '1'] if partial else None, '--data-use-approved')
                value, code = CLI.result_for(args, basket(currency, partial))
                self.assertEqual(code, 0)
                self.assertEqual(value['totals']['reportedSubtotalCents'], 600)
                self.assertEqual(value['totals']['qualifiedSubtotalCents'], 600 if currency and not partial else None)
                self.assertEqual(value['status'], 'partial' if partial else 'complete')
        summary, code = CLI.result_for(self.estimate_args(None, '--summary-only'), basket())
        self.assertEqual(summary['estimatedLineCount'], 1)
        self.assertNotIn('Synthetic milk', json.dumps(summary))
        self.assertNotIn('totals', summary)

    def test_estimate_mixed_currency_never_combines_amounts(self):
        payload = basket()
        second = copy.deepcopy(payload['lines'][0])
        second.update(topic='bread', productId='second-product', itemId='second-item', quantity=1,
                      currency=None, lineTotalCents=300, qualificationGaps=['currency_unreported'])
        second['product'] = price_product(None, 'second-product', 'second-item')
        payload['lines'].append(second)
        payload['totals'].update(reportedSubtotalCents=None, qualifiedSubtotalCents=None, currency=None,
                                 currencyQualification='incomparable', estimatedLineCount=2,
                                 qualificationGaps=['currency_unreported', 'currency_incomparable'])
        args = self.estimate_args(['bread', 'second-product', 'second-item', '1'], '--data-use-approved')
        self.assertEqual(CLI.result_for(args, payload)[1], 0)
        payload['totals']['reportedSubtotalCents'] = 900
        with self.assertRaises(CLI.ToolError):
            CLI.result_for(args, payload)

    def test_estimate_rejects_arithmetic_identity_and_unsupported_qualification(self):
        args = self.estimate_args(None, '--data-use-approved')
        alterations = [lambda p: p['lines'][0].update(lineTotalCents=601),
                       lambda p: p['lines'][0].update(quantity=3),
                       lambda p: p['lines'][0].update(productId='other-product'),
                       lambda p: p['lines'][0]['product'].update(soldBy='weight'),
                       lambda p: p['totals'].update(reportedSubtotalCents=601),
                       lambda p: p['lines'][0]['snapshot'].update(ageSeconds=86400),
                       lambda p: p.update(clientSecret='synthetic-private')]
        for alteration in alterations:
            payload = basket()
            alteration(payload)
            with self.subTest(payload=payload), self.assertRaises(CLI.ToolError):
                CLI.result_for(args, payload)

    def test_estimate_all_unresolved_has_no_fake_zero_total(self):
        args = self.estimate_args(None, '--data-use-approved')
        for reason, status in [('permission_required', 'permission_required'), ('no_data', 'unavailable'), ('stale', 'unavailable')]:
            payload = basket()
            payload['status'] = status
            line = payload['lines'][0]
            line.update(status='unresolved', reason=reason, unitPriceCents=None, lineTotalCents=None,
                        currency=None, observationId=None, observedAt=None, product=None, snapshot=None)
            payload['totals'].update(reportedSubtotalCents=None, qualifiedSubtotalCents=None, currency=None,
                                     currencyQualification='unavailable', estimatedLineCount=0, unresolvedLineCount=1,
                                     qualificationGaps=['unresolved_lines', 'no_resolved_prices'])
            value, code = CLI.result_for(args, payload)
            self.assertEqual(code, 3)
            self.assertIsNone(value['totals']['reportedSubtotalCents'])

    def test_pending_permission_is_not_empty_success(self):
        args = self.args('search', '--store', 'TEST0001', '--summary-only')
        payload = {'ok': True, 'apiVersion': 1, 'status': 'permission_required', 'locationId': 'TEST0001', 'observations': []}
        value, code = CLI.result_for(args, payload)
        self.assertEqual(code, 3)
        self.assertEqual(value['status'], 'permission_required')
        self.assertNotIn('locationId', value)

    def test_store_and_observation_binding(self):
        args = self.args('retrieve', '--store', 'TEST0001', '--observation-id', '1', '--data-use-approved')
        payload = {'ok': True, 'apiVersion': 1, 'status': 'available', 'locationId': 'TEST0001', 'observation': observation()}
        self.assertEqual(CLI.result_for(args, payload)[1], 0)
        for row in [observation('TEST0002'), observation(identifier='2')]:
            with self.assertRaises(CLI.ToolError):
                CLI.result_for(args, {**payload, 'observation': row})

    def test_unavailable_search_and_retrieve_are_capability_gaps(self):
        for operation, fields in [('search', ['--summary-only']),
                                  ('retrieve', ['--observation-id', '1', '--summary-only'])]:
            with self.subTest(operation=operation):
                args = self.args(operation, '--store', 'TEST0001', *fields)
                payload = {'ok': True, 'apiVersion': 1, 'status': 'unavailable',
                           'reason': 'history_environment_mismatch', 'locationId': 'TEST0001',
                           'observations': []} if operation == 'search' else {
                           'ok': True, 'apiVersion': 1, 'status': 'unavailable',
                           'reason': 'no_authorized_source', 'locationId': 'TEST0001', 'observation': None}
                value, code = CLI.result_for(args, payload)
                self.assertEqual(code, 3)
                self.assertEqual(value['status'], 'unavailable')
                self.assertEqual(value['returned'], 0)

    def test_unknown_private_fields_and_malformed_prices_fail_closed(self):
        args = self.args('search', '--store', 'TEST0001', '--data-use-approved')
        base = {'ok': True, 'apiVersion': 1, 'status': 'available', 'locationId': 'TEST0001'}
        for row in [{**observation(), 'privateEvidence': 'synthetic-secret'},
                    {**observation(), 'description': {'nested': 'synthetic-secret'}},
                    {**observation(), 'price': {'regular': float('nan')}}]:
            with self.assertRaises(CLI.ToolError):
                CLI.result_for(args, {**base, 'observations': [row]})
        with self.assertRaises(CLI.ToolError):
            CLI.result_for(args, {**base, 'observations': [], 'clientSecret': 'synthetic-secret'})

    def test_fixed_status_projection_does_not_emit_target_credentials(self):
        value, code = CLI.result_for(self.args('status'), {'ok': True, 'apiVersion': 1, 'configured': True,
                'status': 'permission_required', 'secret': 'synthetic-secret'})
        self.assertEqual(code, 3)
        self.assertNotIn('synthetic-secret', json.dumps(value))

    def test_machine_failure_no_traceback_or_secret(self):
        output = io.StringIO()
        with patch.object(CLI, 'request', side_effect=RuntimeError('synthetic-secret')), contextlib.redirect_stdout(output):
            code = CLI.main(['status', '--json', '--no-input'])
        self.assertEqual(code, 1)
        self.assertFalse(json.loads(output.getvalue())['ok'])
        self.assertNotIn('synthetic-secret', output.getvalue())
        self.assertNotIn('Traceback', output.getvalue())


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.mode = 'good'
        test = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                if test.mode == 'redirect':
                    self.send_response(302)
                    self.send_header('Location', '/unexpected')
                    self.end_headers()
                    return
                test.requests.append(('GET', self.path, None, self.headers.get('User-Agent')))
                self.reply({'ok': True, 'apiVersion': 1, 'status': 'permission_required'})

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                test.requests.append(('POST', self.path, body, self.headers.get('User-Agent')))
                if self.path.endswith('/latest'):
                    self.reply(latest())
                    return
                if self.path.endswith('/prices'):
                    self.reply(prices())
                    return
                if self.path.endswith('/estimate'):
                    self.reply(basket())
                    return
                self.reply({'ok': True, 'apiVersion': 1, 'status': 'available',
                            'locationId': 'TEST0001', 'observations': [observation()],
                            'page': {'limit': 20, 'returned': 1, 'truncated': False, 'nextCursor': None}})

            def reply(self, value):
                body = json.dumps(value).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html' if test.mode == 'html' else 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}/app/'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_native_status_and_search_no_query_or_credential(self):
        self.assertTrue(CLI.request(self.url, 'status')['ok'])
        p = subprocess.run([sys.executable, '-B', str(SCRIPT), 'search', '--base-url', self.url,
                            '--store', 'TEST0001', '--term', 'milk', '--summary-only', '--json', '--no-input'],
                           capture_output=True, text=True, timeout=5)
        self.assertEqual(p.returncode, 0, p.stderr)
        value = json.loads(p.stdout)
        self.assertEqual(value['returned'], 1)
        self.assertNotIn('Synthetic milk', p.stdout)
        self.assertEqual(self.requests[-1][:3], ('POST', '/app/api/v1/promotions/search',
                                               {'locationId': 'TEST0001', 'term': 'milk', 'limit': 20}))
        self.assertIn('PromotionsTool', self.requests[-1][3])

    def test_redirect_and_html_refused(self):
        for mode in ['redirect', 'html']:
            self.mode = mode
            with self.assertRaises(CLI.ToolError):
                CLI.request(self.url, 'status')

    def test_native_latest_uses_only_our_stored_endpoint_and_preserves_snapshot(self):
        p = subprocess.run([sys.executable, '-B', str(SCRIPT), 'latest', '--base-url', self.url,
                            '--store', 'TEST0001', '--topic', 'milk', '--data-use-approved', '--json', '--no-input'],
                           capture_output=True, text=True, timeout=5)
        self.assertEqual(p.returncode, 0, p.stderr)
        value = json.loads(p.stdout)
        self.assertEqual(value['snapshot']['snapshotId'], '11')
        self.assertEqual(value['deals'][0]['description'], 'Synthetic milk')
        self.assertEqual(self.requests[-1][:3], ('POST', '/app/api/v1/promotions/latest',
                                               {'locationId': 'TEST0001', 'topic': 'milk', 'limit': 20}))
        self.assertEqual(len(self.requests), 1)

    def test_native_prices_and_estimate_use_only_our_db_read_routes(self):
        commands = [('prices', ['--topic', 'milk'], '/prices'),
                    ('estimate', ['--item', 'milk', 'synthetic-product', 'synthetic-item', '2'], '/estimate')]
        for operation, fields, suffix in commands:
            p = subprocess.run([sys.executable, '-B', str(SCRIPT), operation, '--base-url', self.url,
                                '--store', 'TEST0001', *fields, '--data-use-approved', '--json', '--no-input'],
                               capture_output=True, text=True, timeout=5)
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
            value = json.loads(p.stdout)
            self.assertTrue(value['ok'])
            self.assertEqual(self.requests[-1][1], '/app/api/v1/promotions' + suffix)
            self.assertNotIn('price', self.requests[-1][2])
        self.assertEqual(self.requests[-1][2]['items'][0]['quantity'], 2)


if __name__ == '__main__':
    unittest.main()
