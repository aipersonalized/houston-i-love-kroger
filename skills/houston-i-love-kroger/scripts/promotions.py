#!/usr/bin/env python3
"""Read latest collected deals or dated history through the project's app API.

No database access, credentials, API collection, files or model SDKs are used.
The operator's source permission and approved recipient still govern results.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

EXIT_OK, EXIT_FAILED, EXIT_INPUT, EXIT_UNAVAILABLE = 0, 1, 2, 3
MAX_RESPONSE = 1_000_000
OBSERVATION_FIELDS = {
    'observationId', 'sourceId', 'sourceLabel', 'locationId', 'productId', 'itemId',
    'description', 'brand', 'size', 'soldBy', 'currency', 'priceBasis', 'modality',
    'eligibilityKey', 'unitBasis', 'price', 'observedAt', 'dateQualification',
    'promotionStatus', 'priceQualification',
}


class ToolError(Exception):
    def __init__(self, code, message, recovery, exit_code=EXIT_FAILED):
        super().__init__(message)
        self.code, self.recovery, self.exit_code = code, recovery, exit_code


def invalid(message):
    raise ToolError('invalid_input', message, 'Run --help and correct the named input.', EXIT_INPUT)


def base_url(value):
    try:
        url = urllib.parse.urlsplit(value)
        local = url.hostname in {'localhost', '127.0.0.1', '::1'}
        if (url.scheme != 'https' and not (url.scheme == 'http' and local)) or not url.hostname:
            raise ValueError()
        if url.username or url.password or url.query or url.fragment or url.port == 0:
            raise ValueError()
        if not re.fullmatch(r'/(?:[A-Za-z0-9_-]+/)*', url.path or '/'):
            raise ValueError()
        return urllib.parse.urlunsplit((url.scheme, url.netloc, url.path or '/', '', ''))
    except (TypeError, ValueError):
        invalid('Use an HTTPS app base address ending in /, or HTTP on localhost. Do not include credentials or a query.')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(base, operation, body=None, timeout=15):
    paths = {'status': 'api/v1/promotions/status', 'latest': 'api/v1/promotions/latest',
             'prices': 'api/v1/promotions/prices', 'estimate': 'api/v1/promotions/estimate', 'search': 'api/v1/promotions/search',
             'retrieve': 'api/v1/promotions/retrieve'}
    headers = {'Accept': 'application/json', 'User-Agent': 'HoustonILoveKroger-PromotionsTool/1.0'}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    # A native read client: no ambient credential, proxy, cookie or redirect state.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    req = urllib.request.Request(base + paths[operation], headers=headers,
                                 data=None if body is None else json.dumps(body).encode('utf-8'))
    try:
        with opener.open(req, timeout=timeout) as response:
            if response.status != 200 or response.headers.get_content_type() != 'application/json':
                raise ValueError()
            raw = response.read(MAX_RESPONSE + 1)
            if len(raw) > MAX_RESPONSE:
                raise ValueError()
            value = json.loads(raw)
            if not isinstance(value, dict) or value.get('ok') is not True or value.get('apiVersion') != 1:
                raise ValueError()
            return value
    except urllib.error.HTTPError as error:
        error.close()
        messages = {400: 'The app rejected the search fields.', 401: 'The installation requires authorization.',
                    403: 'The installation or its hosting provider refused this request.',
                    404: 'This installation does not provide the requested operation.',
                    413: 'The search request exceeds the installation limit.',
                    429: 'The installation has limited requests.',
                    502: 'The promotion service could not be reached.',
                    503: 'The promotion service is unavailable.'}
        raise ToolError('http_error', messages.get(error.code, 'The app could not complete this request.'),
                        'Check the app address and status. Respect any limit before trying again.') from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ToolError('connection_failed', 'The app could not be reached.',
                        'Check the address and connection, then run status. No automatic retry was made.') from None
    except (ValueError, UnicodeError):
        raise ToolError('invalid_response', 'The app returned an unsupported response.',
                        'Use an installation that supports the documented API version.') from None


def text(value, name, maximum=100):
    if not isinstance(value, str) or not value.strip() or value != value.strip() or len(value) > maximum:
        invalid(f'{name} must be nonempty text of at most {maximum} characters without surrounding spaces.')
    if any(ord(c) < 32 or 127 <= ord(c) <= 159 or unicodedata.category(c) == 'Cf' for c in value):
        invalid(f'{name} cannot contain control characters.')
    return value


def timestamp(value, name):
    try:
        if not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z', value):
            raise ValueError()
        return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    except (ValueError, TypeError):
        invalid(f'{name} must be a real UTC timestamp, such as 2026-01-01T00:00:00Z.')


def build_body(args):
    if args.operation == 'status':
        if any(getattr(args, name) is not None for name in ('store', 'topic', 'term', 'product_id', 'item_id', 'from_date', 'to_date', 'observation_id', 'cursor', 'basket_items')):
            invalid('Status does not take store or search fields.')
        return None
    if not args.store or not re.fullmatch(r'[A-Za-z0-9]{8}', args.store):
        invalid('Provide the complete eight-character store ID with --store.')
    result = {'locationId': args.store}
    if args.operation == 'estimate':
        if (any(getattr(args, name) is not None for name in ('topic', 'term', 'product_id', 'item_id', 'from_date', 'to_date', 'observation_id', 'cursor')) or args.limit != 20):
            invalid('Estimate takes --store and repeated --item TOPIC PRODUCT_ID ITEM_ID QUANTITY only.')
        if not args.basket_items or not 1 <= len(args.basket_items) <= 10:
            invalid('Estimate needs one to ten --item lines with source-backed IDs and requested whole quantities.')
        items, seen = [], set()
        for topic, product_id, item_id, quantity in args.basket_items:
            topic = collection_topic(topic)
            product_id, item_id = text(product_id, 'productId'), text(item_id, 'itemId')
            if not re.fullmatch(r'[1-9][0-9]?', quantity):
                invalid('Each requested quantity must be a whole number from 1 to 99.')
            if (product_id, item_id) in seen:
                invalid('Select each product/item pair once and combine its requested quantity.')
            seen.add((product_id, item_id))
            items.append({'topic': topic, 'productId': product_id, 'itemId': item_id, 'quantity': int(quantity)})
        result['items'] = items
        if len(json.dumps(result).encode('utf-8')) > 4096:
            invalid('The estimate exceeds the 4 KB request limit; use fewer or shorter source-backed lines.')
        return result
    if args.basket_items is not None:
        invalid('--item lines belong only to estimate.')
    if args.operation in {'latest', 'prices'}:
        topic = collection_topic(args.topic)
        forbidden = ('term', 'from_date', 'to_date', 'observation_id') + (('product_id', 'item_id') if args.operation == 'latest' else ())
        if any(getattr(args, name) is not None for name in forbidden):
            invalid('Use only the documented topic/identity/page fields for this stored read.')
        if not 1 <= args.limit <= 50:
            invalid('--limit must be from 1 to 50.')
        result.update(topic=topic, limit=args.limit)
        if args.operation == 'prices':
            for attribute, field in [('product_id', 'productId'), ('item_id', 'itemId')]:
                if getattr(args, attribute) is not None:
                    result[field] = text(getattr(args, attribute), field)
        if args.cursor is not None:
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,512}', args.cursor):
                invalid('Use the matching latest-page cursor, at most 512 URL-safe characters.')
            result['cursor'] = args.cursor
        return result
    if args.topic is not None:
        invalid('--topic belongs to latest/prices; use --term for dated history search.')
    if args.operation == 'retrieve':
        if not args.observation_id or not re.fullmatch(r'[1-9][0-9]{0,15}', args.observation_id) or int(args.observation_id) > 9_007_199_254_740_991:
            invalid('Retrieve needs --observation-id with the positive ID from a prior search.')
        if any(getattr(args, name) is not None for name in ('term', 'product_id', 'item_id', 'from_date', 'to_date', 'cursor')):
            invalid('Retrieve takes only the store and observation ID.')
        return {**result, 'observationId': args.observation_id}
    if args.observation_id is not None:
        invalid('Use retrieve for an observation ID.')
    for attribute, field, maximum in [('term', 'term', 80), ('product_id', 'productId', 100),
                                      ('item_id', 'itemId', 100), ('cursor', 'cursor', 512)]:
        value = getattr(args, attribute)
        if value is not None:
            result[field] = text(value, field, maximum)
    start = timestamp(args.from_date, '--from') if args.from_date is not None else None
    end = timestamp(args.to_date, '--to') if args.to_date is not None else None
    if start and end and start > end:
        invalid('--from must not be after --to.')
    if start:
        result['observedFrom'] = args.from_date
    if end:
        result['observedTo'] = args.to_date
    if not 1 <= args.limit <= 50:
        invalid('--limit must be from 1 to 50.')
    result['limit'] = args.limit
    return result


def verify_observation(row, store):
    if not isinstance(row, dict) or set(row) - OBSERVATION_FIELDS or row.get('locationId') != store:
        raise ValueError()
    if not isinstance(row.get('observationId'), str) or not re.fullmatch(r'[1-9][0-9]*', row['observationId']):
        raise ValueError()
    for key, value in row.items():
        if key != 'price' and value is not None and (not isinstance(value, str) or len(value) > 2000):
            raise ValueError()
    if row.get('promotionStatus') not in {'reported_promotion', 'not_verified_promotion'} or row.get('dateQualification') not in {'qualified', 'unqualified'}:
        raise ValueError()
    if row.get('priceQualification') not in {'qualified', 'unsupported_source_price'}:
        raise ValueError()
    price = row.get('price')
    fields = {'regular', 'promo', 'regularCents', 'promoCents', 'regularPerUnitEstimate',
              'promoPerUnitEstimate', 'effectiveDate', 'expirationDate'}
    if not isinstance(price, dict) or set(price) - fields:
        raise ValueError()
    for key, value in price.items():
        if key in {'effectiveDate', 'expirationDate'}:
            if value is not None and (not isinstance(value, dict) or set(value) - {'value', 'timezone'}):
                raise ValueError()
            if value is not None and any(v is not None and (not isinstance(v, str) or len(v) > 100) for v in value.values()):
                raise ValueError()
        elif value is not None and (type(value) not in {int, float} or not math.isfinite(value) or value < 0):
            raise ValueError()


def collection_topic(value):
    value = text(value, 'topic', 80)
    if len(value) < 3 or len(value.split()) > 8 or value == '*' or any(unicodedata.category(c) == 'Cf' for c in value):
        invalid('Use an exact approved collection topic of 3–80 characters and at most eight words.')
    return value


def response_time(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z', value):
        raise ValueError()
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))


def verify_latest_deal(row, store, observed_at):
    if not isinstance(row, dict) or set(row) - OBSERVATION_FIELDS - {'availability', 'calculated'}:
        raise ValueError()
    verify_observation({key: value for key, value in row.items() if key in OBSERVATION_FIELDS}, store)
    if (row.get('observedAt') != observed_at or row.get('priceQualification') != 'qualified' or
            row.get('dateQualification') != 'qualified' or row.get('promotionStatus') != 'reported_promotion'):
        raise ValueError()
    price, availability, calculated = row['price'], row.get('availability'), row.get('calculated')
    regular, promo = price.get('regularCents'), price.get('promoCents')
    if type(regular) is not int or type(promo) is not int or not 0 < promo < regular <= 9_007_199_254_740_991:
        raise ValueError()
    if price.get('regular') != regular / 100 or price.get('promo') != promo / 100:
        raise ValueError()
    if (not isinstance(availability, dict) or set(availability) != {'inStore', 'stockLevel', 'status'} or
            availability['inStore'] is not None and type(availability['inStore']) is not bool or
            availability['inStore'] is False or availability['status'] not in {'reported_in_stock', 'unreported'} or
            availability['stockLevel'] in {'TEMPORARILY_OUT_OF_STOCK', 'OUT_OF_STOCK'} or
            availability['stockLevel'] is not None and
            (not isinstance(availability['stockLevel'], str) or len(availability['stockLevel']) > 80)):
        raise ValueError()
    if (not isinstance(calculated, dict) or set(calculated) != {'savingsCents', 'percentOff'} or
            type(calculated['savingsCents']) is not int or calculated['savingsCents'] != regular - promo or
            type(calculated['percentOff']) not in {int, float} or not math.isfinite(calculated['percentOff']) or
            not math.isclose(calculated['percentOff'], (regular - promo) / regular * 100, rel_tol=1e-12)):
        raise ValueError()


def gaps(value):
    allowed = {'currency_unreported', 'currency_unsupported', 'price_basis_unreported', 'price_basis_unverified',
               'eligibility_unreported', 'eligibility_unverified', 'modality_unreported', 'modality_unverified',
               'in_store_fulfillment_unreported', 'stock_unreported', 'unresolved_lines', 'currency_incomparable',
               'no_resolved_prices', 'arithmetic_overflow'}
    if (not isinstance(value, list) or len(value) > 20 or len(set(value)) != len(value) or
            any(not isinstance(part, str) or part not in allowed for part in value)):
        raise ValueError()
    return value


def verify_price_product(row, store, observed_at):
    extra = {'availability', 'pricing', 'calculated', 'qualificationGaps'}
    if not isinstance(row, dict) or set(row) - OBSERVATION_FIELDS - extra or not extra <= set(row):
        raise ValueError()
    verify_observation({key: value for key, value in row.items() if key in OBSERVATION_FIELDS}, store)
    if row['observedAt'] != observed_at:
        raise ValueError()
    availability, pricing = row['availability'], row['pricing']
    if (not isinstance(availability, dict) or set(availability) != {'inStore', 'stockLevel', 'status'} or
            availability['inStore'] is not None and type(availability['inStore']) is not bool or
            availability['stockLevel'] is not None and (not isinstance(availability['stockLevel'], str) or len(availability['stockLevel']) > 80) or
            availability['status'] not in {'reported_in_stock', 'reported_out_of_stock', 'not_in_store', 'unreported'}):
        raise ValueError()
    if not isinstance(pricing, dict) or set(pricing) != {'status', 'currentCents', 'reason'}:
        raise ValueError()
    gaps(row['qualificationGaps'])
    expected_gaps = set()
    if row['currency'] is None:
        expected_gaps.add('currency_unreported')
    elif not re.fullmatch(r'[A-Z]{3}', row['currency']):
        expected_gaps.add('currency_unsupported')
    for field, supported, label in [('priceBasis', 'one-package', 'price_basis'), ('eligibilityKey', 'all-shoppers', 'eligibility'), ('modality', 'IN_STORE', 'modality')]:
        if row[field] != supported:
            expected_gaps.add(label + ('_unreported' if row[field] is None else '_unverified'))
    if availability['inStore'] is None:
        expected_gaps.add('in_store_fulfillment_unreported')
    if availability['status'] == 'unreported':
        expected_gaps.add('stock_unreported')
    if set(row['qualificationGaps']) != expected_gaps:
        raise ValueError()
    if pricing['status'] == 'unavailable':
        if (pricing['currentCents'] is not None or row['calculated'] is not None or
                pricing['reason'] not in {'missing_price', 'missing_regular_price', 'unsupported_source_price', 'unqualified_dates', 'out_of_stock', 'not_in_store'}):
            raise ValueError()
        return
    if (pricing['status'] not in {'promotion', 'regular_only'} or pricing['reason'] is not None or
            type(pricing['currentCents']) is not int or not 0 < pricing['currentCents'] <= 9_007_199_254_740_991 or
            row['priceQualification'] != 'qualified' or row['dateQualification'] != 'qualified' or
            availability['inStore'] is False or availability['status'] in {'reported_out_of_stock', 'not_in_store'}):
        raise ValueError()
    if pricing['status'] == 'promotion':
        verify_latest_deal({key: value for key, value in row.items() if key not in {'pricing', 'qualificationGaps'}}, store, observed_at)
        if pricing['currentCents'] != row['price']['promoCents']:
            raise ValueError()
    elif (pricing['currentCents'] != row['price'].get('regularCents') or row['calculated'] is not None or
          row['price'].get('regular') != pricing['currentCents'] / 100):
        raise ValueError()


def verify_snapshot(snapshot):
    if not isinstance(snapshot, dict) or set(snapshot) != {'snapshotId', 'observedAt', 'completedAt', 'ageSeconds', 'maxAgeSeconds'}:
        raise ValueError()
    if not isinstance(snapshot['snapshotId'], str) or not re.fullmatch(r'[1-9][0-9]{0,15}', snapshot['snapshotId']):
        raise ValueError()
    if response_time(snapshot['completedAt']) < response_time(snapshot['observedAt']):
        raise ValueError()
    if (type(snapshot['ageSeconds']) is not int or snapshot['ageSeconds'] < 0 or
            type(snapshot['maxAgeSeconds']) is not int or not 1 <= snapshot['maxAgeSeconds'] <= 604_800):
        raise ValueError()


def estimate_result(args, payload):
    if payload.get('status') == 'unavailable' and 'lines' not in payload:
        return latest_result(args, payload)
    try:
        required = {'ok', 'apiVersion', 'status', 'locationId', 'evaluatedAt', 'lines', 'totals', 'exclusions', 'coverage'}
        if set(payload) != required or payload['locationId'] != args.store:
            raise ValueError()
        response_time(payload['evaluatedAt'])
        status, lines, totals = payload['status'], payload['lines'], payload['totals']
        if status not in {'complete', 'partial', 'unavailable', 'permission_required'} or not isinstance(lines, list) or len(lines) != len(args.basket_items):
            raise ValueError()
        estimated = []
        line_fields = {'topic', 'productId', 'itemId', 'quantity', 'status', 'reason', 'unitPriceCents', 'lineTotalCents', 'currency',
                       'observationId', 'observedAt', 'snapshot', 'product', 'qualificationGaps'}
        for line, requested in zip(lines, args.basket_items):
            if not isinstance(line, dict) or set(line) != line_fields:
                raise ValueError()
            topic, product_id, item_id, quantity = requested
            if (line['topic'], line['productId'], line['itemId'], line['quantity']) != (topic, product_id, item_id, int(quantity)) or type(line['quantity']) is not int:
                raise ValueError()
            gaps(line['qualificationGaps'])
            snapshot, product = line['snapshot'], line['product']
            if snapshot is not None:
                verify_snapshot(snapshot)
            if product is not None:
                if snapshot is None:
                    raise ValueError()
                verify_price_product(product, args.store, snapshot['observedAt'])
                if set(line['qualificationGaps']) != set(product['qualificationGaps']):
                    raise ValueError()
                if (product['productId'], product['itemId'], product['observationId'], product['observedAt'], product['currency']) != (
                        product_id, item_id, line['observationId'], line['observedAt'], line['currency']):
                    raise ValueError()
            elif line['observationId'] is not None or line['observedAt'] is not None or line['currency'] is not None:
                raise ValueError()
            if line['status'] == 'estimated':
                unit, total = line['unitPriceCents'], line['lineTotalCents']
                if (line['reason'] is not None or product is None or snapshot['ageSeconds'] >= snapshot['maxAgeSeconds'] or
                        not isinstance(product['soldBy'], str) or product['soldBy'].lower() != 'unit' or
                        type(unit) is not int or unit != product['pricing']['currentCents'] or not 0 < unit <= 9_007_199_254_740_991 or
                        type(total) is not int or total != unit * line['quantity'] or total > 9_007_199_254_740_991):
                    raise ValueError()
                estimated.append(line)
            elif (line['status'] != 'unresolved' or not isinstance(line['reason'], str) or
                  line['reason'] not in {'not_in_latest_sample', 'not_in_store', 'out_of_stock', 'unsupported_source_price',
                      'unqualified_dates', 'missing_regular_price', 'missing_price', 'variable_or_unknown_quantity_basis',
                      'arithmetic_overflow', 'permission_required', 'no_data', 'stale'} or line['unitPriceCents'] is not None or line['lineTotalCents'] is not None):
                raise ValueError()
        fields = {'reportedSubtotalCents', 'qualifiedSubtotalCents', 'currency', 'currencyQualification',
                  'estimatedLineCount', 'unresolvedLineCount', 'qualificationGaps'}
        if not isinstance(totals, dict) or set(totals) != fields:
            raise ValueError()
        gaps(totals['qualificationGaps'])
        if (type(totals['estimatedLineCount']) is not int or totals['estimatedLineCount'] != len(estimated) or
                type(totals['unresolvedLineCount']) is not int or totals['unresolvedLineCount'] != len(lines) - len(estimated)):
            raise ValueError()
        currencies = {line['currency'] for line in estimated}
        source_currency = next(iter(currencies)) if len(currencies) == 1 else None
        homogeneous = len(currencies) == 1 and (source_currency is None or re.fullmatch(r'[A-Z]{3}', source_currency))
        summed = sum(line['lineTotalCents'] for line in estimated) if estimated and homogeneous else None
        expected_gaps = {gap for line in lines for gap in line['qualificationGaps']}
        if len(estimated) != len(lines):
            expected_gaps.add('unresolved_lines')
        if not estimated:
            expected_gaps.add('no_resolved_prices')
        elif not homogeneous:
            expected_gaps.add('currency_incomparable')
        if summed is not None and summed > 9_007_199_254_740_991:
            summed = None
            expected_gaps.add('arithmetic_overflow')
        currency = source_currency if homogeneous else None
        qualification = 'unavailable' if not estimated else 'incomparable' if not homogeneous else 'unreported' if currency is None else 'source_reported'
        if (totals['reportedSubtotalCents'] != summed or totals['currency'] != currency or totals['currencyQualification'] != qualification or
                totals['reportedSubtotalCents'] is not None and type(totals['reportedSubtotalCents']) is not int):
            raise ValueError()
        if set(totals['qualificationGaps']) != expected_gaps:
            raise ValueError()
        qualified = totals['qualifiedSubtotalCents']
        if qualified != (summed if not expected_gaps else None) or qualified is not None and type(qualified) is not int:
            raise ValueError()
        if (status == 'complete' and len(estimated) != len(lines) or status == 'partial' and not 0 < len(estimated) < len(lines) or
                status in {'unavailable', 'permission_required'} and estimated):
            raise ValueError()
        if payload['exclusions'] != ['tax', 'fees', 'coupons', 'eligibility_verification', 'checkout_changes']:
            raise ValueError()
        coverage = payload['coverage']
        if (not isinstance(coverage, dict) or set(coverage) != {'type', 'completeCatalog', 'message'} or
                coverage['type'] != 'bounded_topic_sample' or coverage['completeCatalog'] is not False or
                not isinstance(coverage['message'], str) or len(coverage['message']) > 2000):
            raise ValueError()
        if args.summary_only:
            result = {'ok': True, 'apiVersion': 1, 'status': status, 'evaluatedAt': payload['evaluatedAt'],
                      'estimatedLineCount': len(estimated), 'unresolvedLineCount': len(lines) - len(estimated)}
        else:
            result = payload
        return result, EXIT_OK if status in {'complete', 'partial'} else EXIT_UNAVAILABLE
    except (ValueError, KeyError, TypeError, OverflowError):
        raise ToolError('invalid_response', 'The estimate did not match selected products, quantities or supported arithmetic.',
                        'Discard it and ask the operator to check the stored-price estimate API. No live fallback was made.') from None


def latest_result(args, payload):
    try:
        if payload.get('status') == 'unavailable':
            if set(payload) - {'ok', 'apiVersion', 'status', 'reason', 'message', 'locationId'} or payload.get('locationId') != args.store:
                raise ValueError()
            reason = payload.get('reason')
            if reason not in {'promotion_service_not_configured', 'promotion_service_unavailable', 'history_environment_mismatch', 'no_authorized_source'}:
                raise ValueError()
            # Operational gaps are fixed diagnostics, never a fabricated empty dataset.
            return {'ok': True, 'apiVersion': 1, 'status': 'unavailable',
                    'reason': reason,
                    'message': 'Stored deals are unavailable for this installation. Ask the operator to check service configuration and environment.'}, EXIT_UNAVAILABLE
        row_key = 'products' if args.operation == 'prices' else 'deals'
        required = {'ok', 'apiVersion', 'status', 'locationId', 'topic', row_key, 'snapshot', 'latestAttempt', 'page', 'coverage'}
        if not required <= set(payload) or set(payload) - required - {'reason', 'message'}:
            raise ValueError()
        if payload['locationId'] != args.store or payload['topic'] != args.topic:
            raise ValueError()
        status, rows, snapshot = payload['status'], payload[row_key], payload['snapshot']
        if status not in {'available', 'no_data', 'stale', 'permission_required'} or not isinstance(rows, list) or len(rows) > args.limit:
            raise ValueError()
        if status in {'available', 'stale'}:
            verify_snapshot(snapshot)
            age, maximum = snapshot['ageSeconds'], snapshot['maxAgeSeconds']
            if (status == 'available') != (age < maximum):
                raise ValueError()
        elif snapshot is not None:
            raise ValueError()
        if status != 'available' and rows:
            raise ValueError()
        for row in rows:
            if args.operation == 'prices':
                verify_price_product(row, args.store, snapshot['observedAt'])
                if args.product_id is not None and row['productId'] != args.product_id or args.item_id is not None and row['itemId'] != args.item_id:
                    raise ValueError()
            else:
                verify_latest_deal(row, args.store, snapshot['observedAt'])
        attempt = payload['latestAttempt']
        if attempt is not None:
            if not isinstance(attempt, dict) or set(attempt) != {'status', 'startedAt', 'finishedAt'} or attempt['status'] not in {'running', 'completed', 'failed', 'blocked'}:
                raise ValueError()
            started = response_time(attempt['startedAt'])
            if attempt['finishedAt'] is not None and response_time(attempt['finishedAt']) < started:
                raise ValueError()
        page = payload['page']
        if (not isinstance(page, dict) or set(page) != {'limit', 'returned', 'truncated', 'nextCursor'} or
                type(page['limit']) is not int or page['limit'] != args.limit or type(page['returned']) is not int or
                page['returned'] != len(rows) or type(page['truncated']) is not bool or
                (page['truncated'] and (not rows or not isinstance(page['nextCursor'], str) or
                 not re.fullmatch(r'[A-Za-z0-9_-]{1,512}', page['nextCursor']))) or
                (not page['truncated'] and page['nextCursor'] is not None)):
            raise ValueError()
        coverage = payload['coverage']
        if (not isinstance(coverage, dict) or set(coverage) != {'type', 'topic', 'pagesPerTarget', 'limitPerTarget', 'returnedProductCount', 'completeCatalog', 'message'} or
                coverage['type'] != 'bounded_topic_sample' or coverage['topic'] != args.topic or
                type(coverage['pagesPerTarget']) is not int or coverage['pagesPerTarget'] != 1 or
                coverage['completeCatalog'] is not False or not isinstance(coverage['message'], str) or len(coverage['message']) > 2000):
            raise ValueError()
        for key, low in [('limitPerTarget', 1), ('returnedProductCount', 0)]:
            value = coverage[key]
            if value is not None and (type(value) is not int or not low <= value <= 50):
                raise ValueError()
            if status in {'available', 'stale'} and value is None:
                raise ValueError()
        if status != 'available' and (page['returned'] or page['truncated']):
            raise ValueError()
        for key in ('reason', 'message'):
            if key in payload and (not isinstance(payload[key], str) or len(payload[key]) > 2000):
                raise ValueError()
        if status != 'available' and payload.get('reason') not in {
                'no_data': {'no_completed_collection', 'snapshot_not_readable'},
                'stale': {'snapshot_stale'},
                'permission_required': {'source_permission_required', 'source_scope_not_approved'}}[status]:
            raise ValueError()
        if args.summary_only:
            result = {'ok': True, 'apiVersion': 1, 'status': status, 'returned': len(rows),
                      'truncated': page['truncated'],
                      'snapshot': None if snapshot is None else {key: value for key, value in snapshot.items() if key != 'snapshotId'},
                      'latestAttempt': attempt}
            if 'reason' in payload:
                result['reason'] = payload['reason']
        else:
            result = payload
        return result, EXIT_OK if status == 'available' else EXIT_UNAVAILABLE
    except (ValueError, KeyError, TypeError):
        raise ToolError('invalid_response', 'The stored price/deal result did not match the accepted scope or snapshot format.',
                        'Discard the result and ask the operator to check the stored-read API. No live fallback was made.') from None


def result_for(args, payload):
    if args.operation in {'latest', 'prices'}:
        return latest_result(args, payload)
    if args.operation == 'estimate':
        return estimate_result(args, payload)
    if args.operation == 'status':
        # Emit only fixed capability facts, never arbitrary target configuration.
        status = payload.get('status')
        if status not in {'permission_required', 'available', 'unavailable'}:
            raise ToolError('invalid_response', 'The app did not provide a supported history status.', 'Check the API version with the operator.')
        return {'ok': True, 'apiVersion': 1, 'status': status}, EXIT_OK if status == 'available' else EXIT_UNAVAILABLE
    try:
        allowed = {'ok', 'apiVersion', 'status', 'reason', 'message', 'locationId',
                   'observations', 'observation', 'page', 'coverage'}
        if set(payload) - allowed:
            raise ValueError()
        if payload.get('locationId') != args.store:
            raise ValueError()
        status = payload.get('status')
        if status not in {'available', 'permission_required', 'not_found', 'unavailable'}:
            raise ValueError()
        rows = payload.get('observations', []) if args.operation == 'search' else ([payload['observation']] if payload.get('observation') is not None else [])
        if not isinstance(rows, list) or len(rows) > args.limit or (args.operation == 'retrieve' and len(rows) > 1):
            raise ValueError()
        for row in rows:
            verify_observation(row, args.store)
        page = payload.get('page', {})
        if not isinstance(page, dict) or set(page) - {'limit', 'returned', 'truncated', 'nextCursor'}:
            raise ValueError()
        if page and (type(page.get('limit')) is not int or not 1 <= page['limit'] <= 50 or
                     type(page.get('returned')) is not int or page['returned'] != len(rows) or
                     type(page.get('truncated')) is not bool or
                     (page.get('nextCursor') is not None and (not isinstance(page['nextCursor'], str) or len(page['nextCursor']) > 512))):
            raise ValueError()
        if args.operation == 'retrieve' and rows and rows[0]['observationId'] != args.observation_id:
            raise ValueError()
        if status != 'available' and rows:
            raise ValueError()
        if args.summary_only:
            result = {'ok': True, 'apiVersion': 1, 'status': status, 'returned': len(rows),
                      'truncated': payload.get('page', {}).get('truncated') is True}
        else:
            result = payload
        return result, EXIT_OK if status == 'available' else EXIT_UNAVAILABLE
    except (ValueError, KeyError, TypeError):
        raise ToolError('invalid_response', 'The result did not match the requested store or documented format.',
                        'Discard the result and ask the installation operator to check its API.') from None


def parser():
    p = argparse.ArgumentParser(allow_abbrev=False, description='Read stored deals/prices, estimate requested quantities or inspect dated history. No live Kroger requests, collection or purchases.',
        epilog='Examples: promotions.py status --base-url http://localhost:4173/apps/houston-i-love-kroger/ --json\n'
        'promotions.py latest --store TEST0001 --topic milk --summary-only --json\n'
        'promotions.py prices --store TEST0001 --topic milk --summary-only --json\n'
        'promotions.py estimate --store TEST0001 --item milk PRODUCT_ID ITEM_ID 2 --summary-only --dry-run --json\n'
        'promotions.py search --store TEST0001 --term milk --summary-only --json\n'
        'promotions.py retrieve --store TEST0001 --observation-id 1 --data-use-approved --json\n'
        'Set HOUSTON_APP_URL or --base-url. Use --data-use-approved only after actual source/recipient permission is established; this flag grants no rights. Exit 0: available/complete/partial/preview; 1: request failure; 2: input; 3: permission required/unavailable/no data/stale/not found. Complete means arithmetic line coverage, never checkout total.')
    p.add_argument('operation', choices=['status', 'latest', 'prices', 'estimate', 'search', 'retrieve'])
    p.add_argument('--base-url', default=os.environ.get('HOUSTON_APP_URL', 'http://localhost:4173/apps/houston-i-love-kroger/'))
    p.add_argument('--store'); p.add_argument('--topic', help='Exact approved operator collection topic for latest/prices; no live search.')
    p.add_argument('--item', dest='basket_items', nargs=4, action='append', metavar=('TOPIC', 'PRODUCT_ID', 'ITEM_ID', 'QUANTITY'),
                   help='Repeat for 1–10 source-backed estimate lines with whole quantities 1–99; never caller prices.')
    p.add_argument('--term'); p.add_argument('--product-id'); p.add_argument('--item-id')
    p.add_argument('--observation-id'); p.add_argument('--from', dest='from_date'); p.add_argument('--to', dest='to_date')
    p.add_argument('--limit', type=int, default=20); p.add_argument('--cursor')
    p.add_argument('--timeout', type=float, default=15)
    p.add_argument('--summary-only', action='store_true', help='Return fixed status/counts without source records or store identifiers.')
    p.add_argument('--data-use-approved', action='store_true', help='Acknowledge actual source and recipient permission for returning records; not a permission grant.')
    p.add_argument('--json', action='store_true'); p.add_argument('--no-input', action='store_true')
    p.add_argument('--no-color', action='store_true'); p.add_argument('-q', '--quiet', action='store_true')
    p.add_argument('-v', '--verbose', action='store_true'); p.add_argument('-n', '--dry-run', action='store_true')
    return p


def run(args):
    base = base_url(args.base_url); body = build_body(args)
    if not math.isfinite(args.timeout) or not 1 <= args.timeout <= 35:
        invalid('--timeout must be between 1 and 35 seconds.')
    if args.dry_run:
        return {'ok': True, 'status': 'preview', 'operation': args.operation,
                'requestFields': sorted(body or {}), 'network': False, 'writes': False}, EXIT_OK
    if args.operation != 'status' and not args.summary_only and not args.data_use_approved:
        raise ToolError('recipient_permission_required', 'Returning source records needs actual source and recipient permission.',
                        'Use --summary-only for a bounded diagnostic, or establish permission before --data-use-approved.', EXIT_UNAVAILABLE)
    result, code = result_for(args, request(base, args.operation, body, args.timeout))
    if args.operation in {'latest', 'prices'}:
        result = {**result, 'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')}
    return result, code


def main(argv=None):
    args = parser().parse_args(argv)
    human = sys.stdout.isatty() and not (args.json or args.no_input or args.quiet)
    color = human and not args.no_color and not os.environ.get('NO_COLOR')
    if human:
        print('Houston I Love Kroger — stored prices, deals and cost estimates\nRead dated collections; this tool never contacts Kroger or starts collection.')
    try:
        result, code = run(args)
    except ToolError as error:
        result, code = {'ok': False, 'error': {'code': error.code, 'message': str(error), 'recovery': error.recovery}}, error.exit_code
    except KeyboardInterrupt:
        result, code = {'ok': False, 'error': {'code': 'cancelled', 'message': 'The request was cancelled.', 'recovery': 'Inspect status before deciding whether to search again.'}}, EXIT_FAILED
    except Exception:
        result, code = {'ok': False, 'error': {'code': 'failed', 'message': 'The tool could not complete this request.', 'recovery': 'Run --help and check the installation. No automatic retry was made.'}}, EXIT_FAILED
    if human:
        label = 'Available' if code == 0 else 'Needs attention'
        print((('\033[32m' if code == 0 else '\033[33m' if code == EXIT_UNAVAILABLE else '\033[31m') if color else '') + label + ('\033[0m' if color else ''))
    print(json.dumps(result, ensure_ascii=True, allow_nan=False))
    return code


if __name__ == '__main__':
    try:
        sys.exit(main())
    except BrokenPipeError:
        # A closed downstream consumer is not a successful delivered result.
        # Silence the interpreter's later stdout flush without a traceback.
        sink = os.open(os.devnull, os.O_WRONLY)
        os.dup2(sink, sys.stdout.fileno())
        os.close(sink)
        sys.exit(EXIT_FAILED)
