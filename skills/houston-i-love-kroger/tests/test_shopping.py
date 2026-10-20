"""Synthetic current-shopping client checks; never use a live source or account."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'shopping.py'
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location('shopping_cli', SCRIPT)
CLI = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CLI)
sys.path.pop(0)
STORE, PID, IID = 'TEST0001', '0000000000001', '00001'
AT = '2026-01-01T00:00:00.000Z'


def row():
    return {'source': {'productId': PID, 'itemId': IID, 'description': 'Synthetic whole milk',
            'brand': 'Example', 'size': '1 gal', 'soldBy': 'unit', 'price': {'regular': 4, 'promo': 3,
            'regularPerUnitEstimate': 0.03125, 'promoPerUnitEstimate': 0.0234375},
            'stockLevel': 'HIGH', 'fulfillment': {'instore': True}},
            'calculated': {'savingsCents': 100, 'percentOff': 25},
            'perUnit': {'status': 'reported_estimate', 'regularEstimate': 0.03125,
                        'promoEstimate': 0.0234375, 'basis': None, 'isEstimate': True, 'message': 'Synthetic estimate with unknown basis.'},
            'history': {'status': 'permission_required', 'message': 'Synthetic permission gap.'},
            'dateStatus': 'not_provided', 'pricing': {'status': 'promotion', 'regularCents': 400,
                        'promoCents': 300, 'currentCents': 300, 'reason': None}}


def record(product=None):
    return {'recordIndex': 0, 'productIndex': 0, 'itemIndex': 0,
            'source': copy.deepcopy((product or row())['source']), 'reportedPromotion': True,
            'savingsArithmeticAvailable': True, 'includedInOffers': True,
            'dispositions': [], 'duplicateOf': None}


def search(operation='products', start=None, empty=False, include_all=True):
    product = row()
    summary = dict.fromkeys(('products', 'items', 'unpriced', 'notDiscounted', 'unqualifiedDates', 'outOfStock',
                            'duplicateItems', 'conflictingItems', 'incompleteProducts', 'notInStore', 'noReportedPromotion',
                            'missingRegularPrice', 'unsupportedPrice', 'usablePriced', 'qualifyingPromotions'), 0)
    for key in ('products', 'items', 'usablePriced', 'qualifyingPromotions'):
        summary[key] = 0 if empty else 1
    scope = {'locationId': STORE, 'mode': 'search', 'term': 'whole milk', 'topics': ['whole milk'],
             'queries': [{'term': 'whole milk', 'returnedProducts': 0 if empty else 1}], 'sort': 'savings',
             'productLimit': 50, 'perQueryLimit': 50, 'fulfillment': 'ais', 'exhaustive': False,
             'coverage': 'One synthetic bounded page, not every promotion.'}
    if operation == 'products':
        scope['includeAll'] = include_all
    if operation == 'product':
        scope = {'locationId': STORE, 'mode': 'product', 'productId': PID, 'exhaustive': False,
                 'coverage': 'Selected product only.'}
    payload = {'ok': True, 'apiVersion': 1, 'scope': scope, 'offers': [] if empty else [product],
               'summary': summary, 'sourceEvidence': {'records': [] if empty else [record(product)],
               'summary': {'records': 0 if empty else 1, 'returnedProducts': 0 if empty else 1,
                           'returnedItems': 0 if empty else 1, 'missingItemLists': 0,
                           'reportedPromotions': 0 if empty else 1, 'withoutSavingsArithmetic': 0, 'otherReportedPromotions': 0}},
               'page': None if operation == 'product' else {'requestedStart': start,
                   'reported': {'start': start, 'limit': None, 'total': None},
                   'continuation': {'status': 'available' if start is not None and not empty else 'unknown',
                                    'nextStart': start + 1 if start is not None and not empty else None}},
               'history': {'status': 'permission_required'}, 'dataSource': 'synthetic-fixture', 'retrievedAt': AT}
    if operation != 'deals':
        payload['products'] = [] if empty else [product]
    return payload


def stores():
    return {'ok': True, 'apiVersion': 1, 'stores': [{'locationId': STORE, 'name': 'Synthetic store',
            'address': {'city': 'Example city', 'zipCode': '00000'}}], 'radiusInMiles': 10, 'limit': 10,
            'dataSource': 'synthetic-fixture', 'retrievedAt': AT}


def status():
    return {'ok': True, 'apiVersion': 1, 'configured': True, 'environment': 'production',
            'dataSource': 'synthetic-fixture', 'capabilities': {'products': True, 'basket': True,
            'cart': False, 'promotionService': False}, 'history': {'status': 'permission_required'},
            'promotionService': {'status': 'unavailable'}}


def estimate(unresolved=False):
    product = row()
    gaps = ['currency_unreported', 'price_basis_unreported', 'eligibility_unreported', 'modality_unreported']
    line = {'productId': PID, 'itemId': IID, 'quantity': 2, 'status': 'estimated', 'reason': None,
            'unitPriceCents': 300, 'lineTotalCents': 600, 'currency': None, 'retrievedAt': AT,
            'source': product['source'], 'pricing': product['pricing'], 'sourceEvidence': [record(product)],
            'qualificationGaps': gaps}
    if unresolved:
        line.update(status='unresolved', reason='product_not_found', source=None, pricing=None,
                    sourceEvidence=[], unitPriceCents=None, lineTotalCents=None, qualificationGaps=[])
        gaps = ['no_resolved_prices', 'unresolved_lines']
    return {'ok': True, 'apiVersion': 1, 'status': 'partial' if unresolved else 'complete', 'locationId': STORE,
            'dataSource': 'synthetic-fixture', 'retrievedAt': AT, 'evaluatedAt': AT, 'lines': [line],
            'totals': {'reportedSubtotalCents': None if unresolved else 600, 'qualifiedSubtotalCents': None,
                       'currency': None, 'currencyQualification': 'unavailable' if unresolved else 'unreported',
                       'estimatedLineCount': 0 if unresolved else 1, 'unresolvedLineCount': 1 if unresolved else 0,
                       'qualificationGaps': sorted(gaps)},
            'coverage': {'type': 'selected_products', 'requestedLineCount': 1, 'recheckedProductCount': 1,
                         'exhaustive': False, 'message': 'Synthetic selected products only.'},
            'exclusions': ['tax', 'fees', 'coupons', 'eligibility_verification', 'checkout_changes']}


class ShoppingTests(unittest.TestCase):
    def args(self, *extra):
        return CLI.parser().parse_args(list(extra))

    def test_requests_have_explicit_terms_and_source_ids_only(self):
        self.assertEqual(CLI.build_body(self.args('stores', '--zip', '00001')), {'zipCode': '00001'})
        self.assertEqual(CLI.build_body(self.args('products', '--store', STORE, '--term', '  whole   milk  ', '--start', '50')),
                         {'locationId': STORE, 'term': 'whole milk', 'start': 50, 'includeAll': True})
        self.assertEqual(CLI.build_body(self.args('product', '--store', STORE, '--product-id', PID)),
                         {'locationId': STORE, 'productId': PID})
        self.assertEqual(CLI.build_body(self.args('estimate', '--store', STORE, '--item', PID, IID, '2')),
                         {'locationId': STORE, 'items': [{'productId': PID, 'itemId': IID, 'quantity': 2}]})

    def test_input_boundaries_and_inapplicable_fields(self):
        bad = [('stores', '--zip', '0001'), ('status', '--store', STORE), ('deals', '--store', STORE),
               ('products', '--store', STORE, '--term', 'hi'), ('products', '--store', STORE, '--term', 'bad\nterm'),
               ('products', '--store', STORE, '--term', 'milk', '--start', '0'),
               ('deals', '--store', STORE, '--term', 'milk', '--include-all'),
               ('product', '--store', STORE, '--product-id', '1'),
               ('product', '--store', 'bad', '--product-id', PID),
               ('estimate', '--store', STORE, '--item', PID, IID, '0'),
               ('estimate', '--store', STORE, '--item', PID, 'bad\u200bid', '1'),
               ('estimate', '--store', STORE, '--item', PID, IID, '2', '--item', PID, IID, '3')]
        for fields in bad:
            with self.subTest(fields=fields), self.assertRaises(CLI.ToolError):
                CLI.build_body(self.args(*fields))
        with self.assertRaises(CLI.ToolError):
            CLI.build_body(self.args('estimate', '--store', STORE, *sum((['--item', PID, str(i), '1'] for i in range(11)), [])))

    def test_transport_address_policy(self):
        for good in ['https://example.test/app/', 'http://localhost:4173/app/', 'http://[::1]:4173/']:
            self.assertEqual(CLI.base_url(good), good)
        for bad in ['https://user:secret@example.test/', 'http://remote.test/', 'https://example.test/app',
                    'https://example.test/?secret=value', 'https://example.test/#secret', '\nhttps://example.test/', 'file:///tmp/']:
            with self.subTest(bad=bad), self.assertRaises(CLI.ToolError) as caught:
                CLI.base_url(bad)
            self.assertNotIn('secret', str(caught.exception))

    def test_gate_and_preview_perform_no_network(self):
        with patch.object(CLI, 'request', side_effect=AssertionError('network forbidden')):
            with self.assertRaises(CLI.ToolError) as caught:
                CLI.run(self.args('products', '--store', STORE, '--term', 'whole milk'))
            value, code = CLI.run(self.args('products', '--store', STORE, '--term', 'whole milk', '--dry-run'))
        self.assertEqual(caught.exception.exit_code, 3)
        self.assertEqual(code, 0)
        self.assertEqual(value['network'], False)
        self.assertNotIn('checkedAt', value)
        self.assertNotIn(STORE, json.dumps(value))
        self.assertNotIn('whole milk', json.dumps(value))

    def test_all_success_and_empty_responses(self):
        for operation in ('products', 'deals', 'product'):
            fields = ['--product-id', PID] if operation == 'product' else ['--term', 'whole milk']
            args = self.args(operation, '--store', STORE, *fields, '--summary-only')
            for empty in (False, True):
                with self.subTest(operation=operation, empty=empty):
                    result, code = CLI.result_for(args, search(operation, empty=empty))
                    self.assertEqual(code, 0)
                    self.assertEqual(result['returned'], 0 if empty else 1)
                    self.assertFalse(result['exhaustive'])

    def test_scope_and_private_field_rejection(self):
        args = self.args('products', '--store', STORE, '--term', 'whole milk')
        for mutate in [lambda v: v['scope'].update(locationId='WRONG001'),
                       lambda v: v['scope'].update(term='bread'), lambda v: v['scope'].update(exhaustive=True),
                       lambda v: v.update(apiVersion=True), lambda v: v.update(dataSource='unreviewed'),
                       lambda v: v.update(privateToken='secret'),
                       lambda v: v['products'][0]['source'].update(privateToken='secret'),
                       lambda v: v['sourceEvidence']['records'][0]['source'].update(privateToken='secret')]:
            value = search(); mutate(value)
            with self.subTest(mutate=mutate), self.assertRaises(CLI.ToolError) as caught:
                CLI.result_for(args, value)
            self.assertEqual(caught.exception.code, 'invalid_response')

    def test_prices_are_reconciled_without_missing_zero_or_currency_invention(self):
        args = self.args('products', '--store', STORE, '--term', 'whole milk')
        for mutate in [lambda v: v['products'][0]['pricing'].update(currentCents=1),
                       lambda v: v['products'][0]['calculated'].update(savingsCents=101),
                       lambda v: v['products'][0]['perUnit'].update(basis='ounce'),
                       lambda v: v['products'][0]['source']['price'].update(promo=0),
                       lambda v: v['products'][0]['pricing'].update(currentCents=True),
                       lambda v: v['sourceEvidence']['records'][0]['source']['price'].update(promo=2)]:
            value = search(); mutate(value)
            with self.subTest(mutate=mutate), self.assertRaises(CLI.ToolError):
                CLI.result_for(args, value)
        result, _ = CLI.result_for(args, search())
        self.assertIsNone(result['products'][0]['perUnit']['basis'])

    def test_regular_only_price_does_not_become_an_offer(self):
        value = search(); product = value['products'][0]
        product['source']['price'].pop('promo'); product['calculated'] = None
        product['pricing'].update(status='regular_only', promoCents=None, currentCents=400, reason='no_reported_promotion')
        product['perUnit'].update(promoEstimate=0.0234375)
        value['offers'] = []; value['summary'].update(qualifyingPromotions=0, noReportedPromotion=1, unpriced=1)
        value['sourceEvidence']['records'] = [record(product)]
        value['sourceEvidence']['records'][0].update(reportedPromotion=False, savingsArithmeticAvailable=False,
                                                   includedInOffers=False, dispositions=['no_positive_promo'])
        value['sourceEvidence']['summary'].update(reportedPromotions=0)
        args = self.args('products', '--store', STORE, '--term', 'whole milk')
        self.assertEqual(CLI.result_for(args, value)[1], 0)

    def test_binary_float_price_tolerance_preserves_backend_regular_fallback(self):
        # Backend compareOffers marks this exact promo unsupported because its
        # Number subtraction is slightly greater than 1e-8, while preserving
        # the usable regular price. Decimal subtraction would disagree.
        value = search(); product = value['products'][0]
        product['source']['price']['promo'] = 0.03000001
        product['calculated'] = None
        product['pricing'].update(status='regular_only', promoCents=None,
                                  currentCents=400, reason='unsupported_price')
        value['offers'] = []
        value['summary'].update(qualifyingPromotions=0, unsupportedPrice=1, unpriced=1)
        value['sourceEvidence']['records'] = [record(product)]
        value['sourceEvidence']['records'][0].update(savingsArithmeticAvailable=False,
            includedInOffers=False, dispositions=['unsupported_price'])
        value['sourceEvidence']['summary'].update(withoutSavingsArithmetic=1, otherReportedPromotions=1)
        result, code = CLI.result_for(self.args('products', '--store', STORE, '--term', 'whole milk'), value)
        self.assertEqual(code, 0)
        self.assertEqual(result['products'][0]['pricing']['currentCents'], 400)
        self.assertIsNone(CLI.cents(0.03000001))
        self.assertEqual(CLI.cents(1.23000001), 123)
        self.assertEqual(CLI.cents(1.23), 123)

    def test_source_date_fractions_follow_app_millisecond_precision(self):
        now = CLI.instant(AT)
        for digits in ('000999', '000999999'):
            expiration = {'expirationDate': {'value': '2026-01-01T00:00:00.' + digits + 'Z'}}
            effective = {'effectiveDate': {'value': '2026-01-01T00:00:00.' + digits + 'Z'}}
            self.assertFalse(CLI.dates_allowed(expiration, now))
            self.assertTrue(CLI.dates_allowed(effective, now))

    def test_invalid_source_offsets_remain_unqualified(self):
        for invalid in ('2026-01-01T00:00:00+01:99', '2026-01-01T24:00:00Z', '2026-01-01T00:00:00+24:00'):
            self.assertFalse(CLI.dates_allowed({'effectiveDate': {'value': invalid}}, CLI.instant(AT)))
        value = search(); product = value['products'][0]
        product['source']['price']['effectiveDate'] = {'value': '2026-01-01T00:00:00+01:99'}
        product.update(calculated=None, dateStatus='unqualified')
        product['pricing'].update(status='regular_only', currentCents=400, reason='unqualified_dates')
        value['offers'] = []; value['summary'].update(qualifyingPromotions=0, unqualifiedDates=1)
        value['sourceEvidence']['records'] = [record(product)]
        value['sourceEvidence']['records'][0].update(includedInOffers=False, dispositions=['unqualified_dates'])
        value['sourceEvidence']['summary'].update(otherReportedPromotions=1)
        self.assertEqual(CLI.result_for(self.args('products', '--store', STORE, '--term', 'whole milk'), value)[1], 0)

    def test_promo_only_can_estimate_without_regular_savings(self):
        value = estimate(); line = value['lines'][0]
        line['source']['price']['regular'] = None
        line['pricing'].update(status='unqualified_promotion', regularCents=None, reason='missing_regular_price')
        line['sourceEvidence'][0]['source']['price']['regular'] = None
        line['sourceEvidence'][0].update(savingsArithmeticAvailable=False, includedInOffers=False, dispositions=['missing_regular_price'])
        result, code = CLI.result_for(self.args('estimate', '--store', STORE, '--item', PID, IID, '2'), value)
        self.assertEqual(code, 0)
        self.assertIsNone(result['totals']['qualifiedSubtotalCents'])
        self.assertEqual(result['totals']['reportedSubtotalCents'], 600)

    def test_page_is_bound_and_continuation_derived(self):
        args = self.args('products', '--store', STORE, '--term', 'whole milk', '--start', '50')
        value = search(start=50)
        self.assertEqual(CLI.result_for(args, value)[1], 0)
        for mutate in [lambda v: v['page'].update(requestedStart=None),
                       lambda v: v['page']['reported'].update(start=100),
                       lambda v: v['page']['continuation'].update(nextStart=52),
                       lambda v: v['sourceEvidence']['summary'].update(returnedProducts=2)]:
            invalid = search(start=50); mutate(invalid)
            with self.assertRaises(CLI.ToolError):
                CLI.result_for(args, invalid)

    def test_explicit_start_with_unreported_position_keeps_usable_page(self):
        value = search(start=50)
        value['page']['reported']['start'] = None
        value['page']['continuation'] = {'status': 'unknown', 'nextStart': None}
        args = self.args('products', '--store', STORE, '--term', 'whole milk', '--start', '50')
        result, code = CLI.result_for(args, value)
        self.assertEqual(code, 0)
        self.assertIsNone(result['page']['reported']['start'])
        self.assertEqual(result['page']['continuation']['status'], 'unknown')

    def test_source_history_preserves_dated_unknown_comparison(self):
        value = search()
        value['products'][0]['history'] = {'status': 'incomparable', 'observationCount': 1,
            'lastPromo': 2.5, 'lowestPromo': 2.5, 'deltaFromLastCents': None,
            'firstObservedAt': AT, 'lastObservedAt': AT, 'lowestObservedAt': AT,
            'sourceLabels': ['Synthetic source'], 'unitComparison': {'status': 'basis_unreported'},
            'message': 'Unknown currency prevents a qualified monetary comparison.'}
        self.assertEqual(CLI.result_for(self.args('products', '--store', STORE, '--term', 'whole milk'), value)[1], 0)

    def test_estimate_complete_and_unresolved_are_distinct(self):
        args = self.args('estimate', '--store', STORE, '--item', PID, IID, '2')
        for unresolved in (False, True):
            value, code = CLI.result_for(args, estimate(unresolved))
            self.assertEqual(code, 0)
            self.assertEqual(value['status'], 'partial' if unresolved else 'complete')
            self.assertIsNone(value['totals']['qualifiedSubtotalCents'])
            self.assertIsNone(value['totals']['currency'])
            self.assertEqual(value['totals']['reportedSubtotalCents'], None if unresolved else 600)

    def test_estimate_rejects_identity_arithmetic_and_qualification_changes(self):
        args = self.args('estimate', '--store', STORE, '--item', PID, IID, '2')
        for mutate in [lambda v: v['lines'][0].update(productId='0000000000002'),
                       lambda v: v['lines'][0].update(quantity=3), lambda v: v['lines'][0].update(lineTotalCents=601),
                       lambda v: v['totals'].update(reportedSubtotalCents=601), lambda v: v['totals'].update(currency='USD'),
                       lambda v: v['totals'].update(qualifiedSubtotalCents=600),
                       lambda v: v['coverage'].update(exhaustive=True),
                       lambda v: v['lines'][0].update(qualificationGaps=[])]:
            value = estimate(); mutate(value)
            with self.subTest(mutate=mutate), self.assertRaises(CLI.ToolError):
                CLI.result_for(args, value)

    def test_summaries_expose_no_rows_identifiers_prices_or_zip(self):
        cases = [('stores', ['--zip', '00000'], stores()),
                 ('products', ['--store', STORE, '--term', 'whole milk'], search()),
                 ('estimate', ['--store', STORE, '--item', PID, IID, '2'], estimate())]
        for operation, fields, value in cases:
            result, code = CLI.result_for(self.args(operation, *fields, '--summary-only'), value)
            encoded = json.dumps(result)
            for forbidden in (STORE, PID, 'Synthetic whole milk', 'Synthetic store', 'zipCode', 'lineTotalCents', 'reportedSubtotalCents'):
                self.assertNotIn(forbidden, encoded)
            self.assertEqual(code, 0)

    def test_status_projects_only_fixed_capability_facts(self):
        value = status(); value['privateConfig'] = 'must never appear'
        result, code = CLI.result_for(self.args('status'), value)
        self.assertEqual(code, 0); self.assertNotIn('privateConfig', result)
        value['configured'] = False
        self.assertEqual(CLI.result_for(self.args('status'), value)[1], 3)

    def test_errors_are_clean_json_in_machine_mode_including_parse_failures(self):
        for fields, expected in [(['products', '--store', STORE, '--term', 'milk', '--dry-run', '--json', '--no-input'], 0),
                                 (['product', '--store', STORE, '--product-id', 'secret', '--json'], 2),
                                 (['status', '--timeout', 'secret', '--json'], 2),
                                 (['status', '--base-url', 'https://user:secret@example.test/', '--json'], 2)]:
            completed = subprocess.run([sys.executable, '-B', str(SCRIPT), *fields], capture_output=True, text=True, timeout=10)
            self.assertEqual(completed.returncode, expected, completed.stderr)
            self.assertEqual(completed.stderr, '')
            self.assertNotIn('secret', completed.stdout)
            self.assertNotIn('Traceback', completed.stdout)
            json.loads(completed.stdout)


class NativeHttpTests(unittest.TestCase):
    def serve(self, response, status_code=200, content_type='application/json', location=None):
        requests = []
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append((self.command, self.path, None, dict(self.headers)))
                self.respond()
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                requests.append((self.command, self.path, body, dict(self.headers)))
                self.respond()
            def respond(self):
                self.send_response(status_code)
                self.send_header('Content-Type', content_type)
                if location:
                    self.send_header('Location', location)
                self.end_headers()
                self.wfile.write(response if isinstance(response, bytes) else json.dumps(response).encode())
            def log_message(self, *_args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        self.addCleanup(server.server_close); self.addCleanup(lambda: thread.join(timeout=2)); self.addCleanup(server.shutdown)
        return f'http://127.0.0.1:{server.server_address[1]}/app/', requests

    def test_every_route_and_body_through_actual_subprocess(self):
        cases = [('status', [], status(), 'GET', None), ('stores', ['--zip', '00001'], stores(), 'POST', {'zipCode': '00001'}),
                 ('products', ['--store', STORE, '--term', 'whole milk'], search(), 'POST', {'locationId': STORE, 'term': 'whole milk', 'includeAll': True}),
                 ('deals', ['--store', STORE, '--term', 'whole milk'], search('deals'), 'POST', {'locationId': STORE, 'term': 'whole milk'}),
                 ('product', ['--store', STORE, '--product-id', PID], search('product'), 'POST', {'locationId': STORE, 'productId': PID}),
                 ('estimate', ['--store', STORE, '--item', PID, IID, '2'], estimate(), 'POST',
                  {'locationId': STORE, 'items': [{'productId': PID, 'itemId': IID, 'quantity': 2}]})]
        for operation, fields, payload, method, body in cases:
            with self.subTest(operation=operation):
                base, requests = self.serve(payload)
                completed = subprocess.run([sys.executable, '-B', str(SCRIPT), operation, *fields,
                    '--base-url', base, '--data-use-approved', '--json', '--no-input'], capture_output=True, text=True, timeout=10,
                    env={**os.environ, 'HTTP_PROXY': 'http://127.0.0.1:1', 'HTTPS_PROXY': 'http://127.0.0.1:1'})
                self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
                self.assertEqual(json.loads(completed.stdout)['dataSource'], 'synthetic-fixture')
                self.assertEqual(len(requests), 1)
                self.assertEqual(requests[0][:3], (method, '/app/' + CLI.PATHS[operation], body))
                self.assertNotIn('Cookie', requests[0][3]); self.assertNotIn('Authorization', requests[0][3])
                self.assertNotIn('?', requests[0][1])

    def test_redirect_raw_errors_and_malformed_json_never_escape(self):
        for response, status_code, content_type in [(b'{"ok":true,"private":"secret"}', 503, 'application/json'),
                (status(), 302, 'application/json'), (status(), 200, 'text/html'),
                (b'{"ok":true,"apiVersion":1,"apiVersion":1}', 200, 'application/json'),
                (b'{"ok":true,"apiVersion":1,"value":NaN}', 200, 'application/json'),
                (b'x' * (CLI.MAX_RESPONSE + 1), 200, 'application/json')]:
            with self.subTest(status=status_code, content=content_type):
                base, requests = self.serve(response, status_code, content_type, location='/should-not-follow')
                with self.assertRaises(CLI.ToolError) as caught:
                    CLI.request(base, 'status')
                self.assertNotIn('secret', str(caught.exception))
                self.assertEqual(len(requests), 1)


if __name__ == '__main__':
    unittest.main()
