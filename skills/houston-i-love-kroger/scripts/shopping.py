#!/usr/bin/env python3
"""Explicit current-shopping reads through this app, without credentials or Cart.

The app may contact its configured source for stores, products and estimates.
Stored history remains a separate promotions.py operation; nothing falls back.
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

# Reuse unchanged transport policy primitives; the stored client's routes and
# behavior remain independent. Install this complete scripts folder together.
from promotions import ToolError, NoRedirect, base_url as stored_base_url

EXIT_OK, EXIT_FAILED, EXIT_INPUT, EXIT_UNAVAILABLE = 0, 1, 2, 3
MAX_RESPONSE, SAFE_INTEGER = 8_000_000, 9_007_199_254_740_991
# Alias arrays have no source maxItems. Each serialized string element needs
# at least three bytes; the existing whole-response cap supplies a finite bound.
MAX_ALIAS_PRODUCT_IDS = MAX_RESPONSE // 3
PATHS = {'status': 'api/v1/status', 'stores': 'api/v1/stores/search',
         'products': 'api/v1/products/search', 'deals': 'api/v1/deals/search',
         'product': 'api/v1/products/retrieve', 'estimate': 'api/v1/basket/estimate'}
GAPS = {'currency_unreported', 'price_basis_unreported', 'eligibility_unreported',
        'modality_unreported', 'in_store_fulfillment_unreported', 'stock_unreported'}
TOTAL_GAPS = GAPS | {'unresolved_lines', 'no_resolved_prices', 'arithmetic_overflow', 'currency_incomparable'}
DISPOSITIONS = {'missing_items', 'missing_description', 'not_in_store', 'out_of_stock',
                'missing_regular_price', 'unsupported_price', 'no_positive_promo',
                'not_discounted', 'unqualified_dates', 'duplicate', 'identity_conflict'}


def invalid(message):
    raise ToolError('invalid_input', message, 'Run --help and correct the named input.', EXIT_INPUT)


def require(condition):
    if not condition:
        raise ValueError()


def clean_text(value, maximum, minimum=1):
    return (isinstance(value, str) and minimum <= len(value) <= maximum and
            not any(unicodedata.category(c) in {'Cc', 'Cf', 'Cs'} for c in value))


def base_url(value):
    if not clean_text(value, 2048) or value != value.strip():
        invalid('Use the actual app base address without surrounding spaces or control characters.')
    return stored_base_url(value)


def integer(value, low=0, high=SAFE_INTEGER):
    return type(value) is int and low <= value <= high


def instant(value):
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z', value))
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))


def canonical_term(value):
    if not clean_text(value, 300):
        invalid('--term needs 3–80 characters, at most eight words and no controls.')
    result = ' '.join(value.split())
    if not 3 <= len(result) <= 80 or len(result.split()) > 8:
        invalid('--term needs 3–80 characters and at most eight words.')
    return result


def product_id(value):
    return isinstance(value, str) and re.fullmatch(r'[0-9]{13}', value) is not None


def item_id(value):
    return clean_text(value, 64) and value == value.strip()


def build_body(args):
    fields = {'zip_code': args.zip_code, 'store': args.store, 'term': args.term,
              'product_id': args.product_id, 'basket_items': args.basket_items,
              'start': args.start, 'sort': args.sort, 'include_all': args.include_all}
    allowed = {'status': set(), 'stores': {'zip_code'},
               'products': {'store', 'term', 'start', 'sort', 'include_all'},
               'deals': {'store', 'term', 'start', 'sort'},
               'product': {'store', 'product_id'}, 'estimate': {'store', 'basket_items'}}[args.operation]
    if any(value is not None and key not in allowed for key, value in fields.items()):
        invalid('Use only the input fields documented for the selected operation.')
    if args.operation == 'status':
        return None
    if args.operation == 'stores':
        if not isinstance(args.zip_code, str) or not re.fullmatch(r'[0-9]{5}', args.zip_code):
            invalid('Stores needs --zip with five US ZIP digits, including leading zeros.')
        return {'zipCode': args.zip_code}
    if not isinstance(args.store, str) or not re.fullmatch(r'[A-Za-z0-9]{8}', args.store):
        invalid('Provide the complete confirmed eight-character store ID with --store.')
    result = {'locationId': args.store}
    if args.operation in {'products', 'deals'}:
        result['term'] = canonical_term(args.term)
        if args.sort is not None:
            if args.sort not in {'savings', 'percent', 'price'}:
                invalid('--sort must be savings, percent or price.')
            result['sort'] = args.sort
        if args.start is not None:
            if not integer(args.start, 1, 250):
                invalid('--start must be a returned candidate from 1 to 250 for this store and term.')
            result['start'] = args.start
        if args.operation == 'products':
            result['includeAll'] = args.include_all is not False
    elif args.operation == 'product':
        if not product_id(args.product_id):
            invalid('Product needs --product-id with the exact 13-digit source ID; preserve all zeros.')
        result['productId'] = args.product_id
    else:
        if not args.basket_items or not 1 <= len(args.basket_items) <= 10:
            invalid('Estimate needs one to ten --item PRODUCT_ID ITEM_ID QUANTITY selections.')
        items, seen = [], set()
        for pid, iid, quantity in args.basket_items:
            if not product_id(pid) or not item_id(iid) or not re.fullmatch(r'[1-9][0-9]?', quantity):
                invalid('Each --item needs an exact 13-digit product ID, source item ID (1–64 characters), and whole quantity 1–99.')
            if (pid, iid) in seen:
                invalid('Use each product/item pair once; combine its requested quantity.')
            seen.add((pid, iid))
            items.append({'productId': pid, 'itemId': iid, 'quantity': int(quantity)})
        result['items'] = items
    if len(json.dumps(result).encode('utf-8')) > 4096:
        invalid('The request exceeds 4 KB; shorten the request without changing source IDs.')
    return result


def reject_constant(_value):
    raise ValueError()


def unique_object(pairs):
    value = {}
    for key, entry in pairs:
        require(key not in value)
        value[key] = entry
    return value


def request(base, operation, body=None, timeout=15):
    headers = {'Accept': 'application/json', 'User-Agent': 'HoustonILoveKroger-ShoppingTool/1.0'}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    req = urllib.request.Request(base + PATHS[operation], headers=headers,
                                 data=None if body is None else json.dumps(body).encode('utf-8'))
    try:
        with opener.open(req, timeout=timeout) as response:
            require(response.status == 200 and response.headers.get_content_type() == 'application/json')
            raw = response.read(MAX_RESPONSE + 1)
            require(len(raw) <= MAX_RESPONSE)
            value = json.loads(raw, parse_constant=reject_constant, object_pairs_hook=unique_object)
            require(isinstance(value, dict) and value.get('ok') is True and type(value.get('apiVersion')) is int and value['apiVersion'] == 1)
            return value
    except urllib.error.HTTPError as error:
        code = error.code
        error.close()
        unavailable = code in {401, 403, 404, 503}
        messages = {400: 'The app rejected the requested fields.', 401: 'This installation requires authorization.',
                    403: 'This installation refused the request.', 404: 'The requested product or operation was not found.',
                    413: 'The request exceeds the installation limit.', 429: 'The installation has limited requests.',
                    502: 'The source could not provide a usable response.', 503: 'The requested capability is unavailable.'}
        raise ToolError('http_error', messages.get(code, 'The app could not complete this request.'),
                        'Check the operation and installation status; respect limits before a new explicit request. No retry was made.',
                        EXIT_UNAVAILABLE if unavailable else EXIT_FAILED) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ToolError('connection_failed', 'The app could not be reached.',
                        'Check the app address and connection, then run status. No automatic retry was made.') from None
    except (ValueError, UnicodeError, RecursionError):
        raise ToolError('invalid_response', 'The app returned an unsupported response.',
                        'Discard the result and ask the operator to check the version-1 API.') from None


# Closed field schemas preserve complete known source facts without allowing
# private/debug fields to flow through an otherwise valid response envelope.
S = lambda maximum: ('text', maximum)
L = lambda schema, maximum: ('list', schema, maximum)
TEXT, NUMBER, BOOLEAN = S(512), 'number', 'boolean'
DATE = {'?value': S(80), '?timezone': S(80)}
PRICE = {**{'?' + k: NUMBER for k in ('regular', 'promo', 'regularPerUnitEstimate', 'promoPerUnitEstimate')},
         '?effectiveDate': DATE, '?expirationDate': DATE}
FULFILLMENT = {'?' + key: BOOLEAN for key in ('curbside', 'delivery', 'instore', 'shiptohome')}
UNIT = {'?abbreviation': TEXT, '?code': TEXT, '?name': TEXT}
NUTRIENT = {'?code': TEXT, '?description': TEXT, '?displayName': TEXT, '?percentDailyIntake': NUMBER,
            '?quantity': NUMBER, 'precision': {'?code': TEXT, '?name': TEXT}, 'unitOfMeasure': UNIT}
NUTRITION = {'?dailyValueIntakeReference': TEXT, '?nutritionalRating': TEXT,
             '?ingredientStatement': S(8000), 'preparationState': {'?code': TEXT, '?name': TEXT},
             'servingsPerPackage': {'?description': TEXT, '?value': NUMBER},
             'servingSize': {'?description': TEXT, '?quantity': NUMBER, 'unitOfMeasure': UNIT},
             'nutrients': L(NUTRIENT, 100)}
SOURCE = {'productId': S(64), 'itemId': S(64), 'description': S(512), 'brand': S(200),
          'size': S(100), 'soldBy': S(40), 'price': PRICE, 'stockLevel': S(80),
          '?upc': S(64), '?productPageURI': S(2048), '?productUrl': S(2048),
          '?categories': L(S(200), 50), '?aliasProductIds': L(S(64), MAX_ALIAS_PRODUCT_IDS),
          '?aisleLocations': L({'?' + k: TEXT for k in ('bayNumber', 'description', 'number', 'numberOfFacings', 'sequenceNumber', 'side', 'shelfNumber', 'shelfPositionInBay')}, 30),
          '?images': L({'?id': TEXT, '?perspective': TEXT, '?default': BOOLEAN,
                        'sizes': L({'?id': TEXT, '?size': TEXT, 'url': S(2048)}, 10)}, 20),
          '?temperature': {'?indicator': TEXT, '?heatSensitive': BOOLEAN}, '?snapEligible': BOOLEAN,
          '?countryOrigin': S(200), '?manufacturerDeclarations': L(S(200), 50),
          '?allergens': L({'?levelOfContainmentName': TEXT, '?name': TEXT}, 50),
          '?allergensDescription': S(4000), '?warnings': S(4000), '?nonGmo': BOOLEAN,
          '?nonGmoClaimName': TEXT, '?organicClaimName': TEXT,
          '?nutritionInformation': 'nutrition', '?fulfillment': FULFILLMENT, '?nationalPrice': PRICE}


def shape(value, schema, nullable=True):
    if value is None:
        require(nullable)
        return
    if schema == 'number':
        require(type(value) in {int, float} and math.isfinite(value))
    elif schema == 'boolean':
        require(type(value) is bool)
    elif schema == 'nutrition':
        shape(value, L(NUTRITION, 20) if isinstance(value, list) else NUTRITION, False)
    elif isinstance(schema, dict):
        require(isinstance(value, dict))
        allowed = {key.lstrip('?') for key in schema}
        require(set(value) <= allowed and {key for key in schema if not key.startswith('?')} <= set(value))
        for key, child in value.items():
            shape(child, schema.get(key, schema.get('?' + key)))
    elif schema[0] == 'text':
        require(isinstance(value, str) and len(value) <= schema[1] and not any(unicodedata.category(c) == 'Cs' for c in value))
    elif schema[0] == 'list':
        require(isinstance(value, list) and len(value) <= schema[2])
        for entry in value:
            shape(entry, schema[1], False)
    else:
        raise ValueError()


def keys(value, required, optional=()):
    require(isinstance(value, dict) and set(required) <= set(value) and set(value) <= set(required) | set(optional))


def labels(value, allowed):
    require(isinstance(value, list) and len(value) == len(set(value)) and set(value) <= allowed)


def cents(value):
    if type(value) not in {int, float} or not math.isfinite(value) or value <= 0:
        return None
    # The backend receives JavaScript Numbers, applies Math.round and checks
    # binary64 subtraction tolerance. Decimal arithmetic changes boundary
    # qualification (for example 0.03000001), so mirror those Number operations.
    reported = float(value)
    scaled = reported * 100
    if not math.isfinite(scaled):
        return None
    lower = math.floor(scaled)
    # Avoid adding 0.5 to a large float: that addition can itself round a safe
    # integer upward. Positive Math.round uses the fractional part instead.
    rounded = lower + int(scaled - lower >= 0.5)
    return rounded if integer(rounded, 1) and abs(rounded / 100 - reported) <= 1e-8 else None


def dates_allowed(price, retrieved):
    for key in ('effectiveDate', 'expirationDate'):
        if key not in price:
            continue
        value = price[key]
        raw = value.get('value') if isinstance(value, dict) else None
        if not isinstance(raw, str) or not re.fullmatch(r'\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)', raw):
            return False
        try:
            # The app qualifies via JavaScript Date.parse (millisecond
            # precision), including source fractions with up to nine digits.
            # Truncate sub-millisecond digits before Python compares instants.
            normalized = re.sub(r'(\.\d{3})\d+(?=Z|[+-])', r'\1', raw)
            when = dt.datetime.fromisoformat(normalized.replace('Z', '+00:00'))
        except ValueError:
            return False
        if key == 'effectiveDate' and when > retrieved or key == 'expirationDate' and when <= retrieved:
            return False
    return True


def source(value):
    shape(value, SOURCE, False)
    shape(value['price'], PRICE, False)
    for key in ('productId', 'itemId'):
        # An empty source identity is still an unknown fact in evidence;
        # request validators separately require selectable exact source IDs.
        require(value[key] is None or clean_text(value[key], 64, 0))


def pricing(value, src, retrieved):
    keys(value, ('status', 'regularCents', 'promoCents', 'currentCents', 'reason'))
    regular, promo = cents(src['price'].get('regular')), cents(src['price'].get('promo'))
    allowed_dates = dates_allowed(src['price'], retrieved)
    raw = src['price']
    reason = ('missing_regular_price' if raw.get('regular') is None else
              'unsupported_price' if regular is None or promo is None and raw.get('promo') not in (None, 0) else
              'no_reported_promotion' if raw.get('promo') in (None, 0) else
              'not_discounted' if promo >= regular else 'unqualified_dates' if not allowed_dates else None)
    current = promo if reason is None or regular is None and promo is not None and allowed_dates else regular
    require(all(v is None or integer(v, 1) for v in (value['regularCents'], value['promoCents'], value['currentCents'])))
    require(integer(current, 1) and value['regularCents'] == regular and value['promoCents'] == promo and
            value['currentCents'] == current and value['reason'] == reason and
            value['status'] == ('promotion' if reason is None else 'unqualified_promotion' if regular is None else 'regular_only'))
    require(src['description'] and src['stockLevel'] != 'TEMPORARILY_OUT_OF_STOCK' and (src.get('fulfillment') or {}).get('instore') is not False)


def history(value):
    keys(value, ('status',), ('reason', 'message', 'observationCount', 'lastPromo', 'lowestPromo',
                            'deltaFromLastCents', 'sourceLabels', 'unitComparison', 'firstObservedAt', 'lastObservedAt', 'lowestObservedAt'))
    require(value['status'] in {'available', 'unavailable', 'permission_required', 'insufficient_history', 'incomparable', 'no_observations', 'comparable'})
    for key in ('reason', 'message'):
        if key in value:
            shape(value[key], S(2000), False)
    if 'observationCount' in value:
        require(integer(value['observationCount']))
    for key in ('lastPromo', 'lowestPromo'):
        if value.get(key) is not None:
            require(type(value[key]) in {int, float} and math.isfinite(value[key]) and value[key] > 0)
    for key in ('firstObservedAt', 'lastObservedAt', 'lowestObservedAt'):
        if key in value:
            instant(value[key])
    if 'deltaFromLastCents' in value:
        require(value['deltaFromLastCents'] is None or integer(value['deltaFromLastCents'], -SAFE_INTEGER))
    if 'sourceLabels' in value:
        shape(value['sourceLabels'], L(S(200), 100), False)
    if 'unitComparison' in value:
        shape(value['unitComparison'], {'status': S(100), '?message': S(2000), '?basis': S(100),
              '?lastPromoEstimate': NUMBER, '?lowestPromoEstimate': NUMBER, '?deltaFromLastEstimate': NUMBER}, False)


def priced_row(value, retrieved):
    keys(value, ('source', 'calculated', 'perUnit', 'history', 'dateStatus', 'pricing'))
    src = value['source']; source(src); pricing(value['pricing'], src, retrieved)
    price = src['price']
    keys(value['perUnit'], ('status', 'regularEstimate', 'promoEstimate', 'basis', 'isEstimate', 'message'))
    estimates = [price.get(key) if type(price.get(key)) in {int, float} and price[key] > 0 else None
                 for key in ('regularPerUnitEstimate', 'promoPerUnitEstimate')]
    unit = value['perUnit']
    require(unit['regularEstimate'] == estimates[0] and unit['promoEstimate'] == estimates[1] and
            unit['basis'] is None and unit['isEstimate'] is True and
            unit['status'] == ('reported_estimate' if any(v is not None for v in estimates) else 'unavailable'))
    shape(unit['message'], S(2000), False)
    date_status = ('within_reported_window' if dates_allowed(price, retrieved) else 'unqualified') if any(k in price for k in ('effectiveDate', 'expirationDate')) else 'not_provided'
    require(value['dateStatus'] == date_status)
    calc = value['calculated']
    if value['pricing']['status'] == 'promotion':
        keys(calc, ('savingsCents', 'percentOff'))
        regular, promo = cents(price['regular']), cents(price['promo'])
        require(integer(calc['savingsCents'], 1) and calc['savingsCents'] == regular - promo and
                type(calc['percentOff']) in {int, float} and math.isclose(calc['percentOff'], (regular - promo) / regular * 100, rel_tol=1e-12))
    else:
        require(calc is None)
    history(value['history'])


def evidence_record(value, retrieved):
    keys(value, ('recordIndex', 'productIndex', 'itemIndex', 'source', 'reportedPromotion',
                 'savingsArithmeticAvailable', 'includedInOffers', 'dispositions', 'duplicateOf'))
    require(integer(value['recordIndex'], 0, 499) and integer(value['productIndex'], 0, 49) and
            (value['itemIndex'] is None or integer(value['itemIndex'], 0, 9)))
    source(value['source'])
    labels(value['dispositions'], DISPOSITIONS)
    price = value['source']['price']; regular, promo = cents(price.get('regular')), cents(price.get('promo'))
    require(type(value['reportedPromotion']) is bool and value['reportedPromotion'] == (type(price.get('promo')) in {int, float} and price['promo'] > 0))
    require(type(value['savingsArithmeticAvailable']) is bool and value['savingsArithmeticAvailable'] == (regular is not None and promo is not None and promo < regular))
    require(type(value['includedInOffers']) is bool and (not value['includedInOffers'] or
            value['savingsArithmeticAvailable'] and not value['dispositions']))
    require(value['duplicateOf'] is None or integer(value['duplicateOf'], 0, value['recordIndex'] - 1))
    if 'unqualified_dates' in value['dispositions']:
        require(not dates_allowed(price, retrieved))


def verify_page(page, args, raw_count):
    keys(page, ('requestedStart', 'reported', 'continuation'))
    require(page['requestedStart'] == args.start)
    keys(page['reported'], ('start', 'limit', 'total'))
    start, limit, total = (page['reported'][key] for key in ('start', 'limit', 'total'))
    require(all(v is None or integer(v) for v in (start, limit, total)))
    require(args.start is None or start is None or start == args.start)
    next_start, state = None, 'unknown'
    if start is not None and (limit is None or 1 <= limit <= 50 and raw_count <= limit):
        candidate = start + raw_count
        if candidate <= SAFE_INTEGER and not (raw_count > 0 and total is not None and candidate > total):
            if total is not None and candidate >= total:
                state = 'reported_end'
            elif raw_count > 0:
                state, next_start = ('source_limit', None) if candidate > 250 else ('available', candidate)
    keys(page['continuation'], ('status', 'nextStart'))
    require(page['continuation'] == {'status': state, 'nextStart': next_start})


def search_result(args, value):
    exact = args.operation == 'product'
    required = {'ok', 'apiVersion', 'scope', 'offers', 'sourceEvidence', 'summary', 'page', 'history', 'dataSource', 'retrievedAt'}
    if args.operation in {'products', 'product'}:
        required.add('products')
    keys(value, required)
    retrieved = instant(value['retrievedAt']); scope = value['scope']
    if exact:
        keys(scope, ('locationId', 'mode', 'productId', 'exhaustive', 'coverage'))
        require(scope['mode'] == 'product' and scope['productId'] == args.product_id and value['page'] is None)
    else:
        keys(scope, ('locationId', 'mode', 'term', 'topics', 'queries', 'sort', 'productLimit', 'perQueryLimit', 'fulfillment', 'exhaustive', 'coverage'),
             ('includeAll',) if args.operation == 'products' else ())
        term = canonical_term(args.term)
        require(scope['mode'] == 'search' and scope['term'] == term and scope['topics'] == [term] and
                scope['sort'] == (args.sort or 'savings') and scope['productLimit'] == 50 and
                scope['perQueryLimit'] == 50 and scope['fulfillment'] == 'ais')
        if args.operation == 'products':
            require(scope.get('includeAll') is (args.include_all is not False))
    require(scope['locationId'] == args.store and scope['exhaustive'] is False)
    shape(scope['coverage'], S(2000), False)
    rows = value.get('products', value['offers'])
    for name in ('products', 'offers'):
        if name in value:
            require(isinstance(value[name], list) and len(value[name]) <= (10 if exact else 500))
            seen = set()
            for row in value[name]:
                priced_row(row, retrieved)
                if exact:
                    require(row['source']['productId'] == args.product_id)
                identity = (row['source']['productId'], row['source']['itemId'])
                require(None in identity or identity not in seen)
                seen.add(identity)
            if name == 'offers':
                require(all(row['pricing']['status'] == 'promotion' for row in value[name]))
    if 'products' in value:
        require(all(row in value['products'] for row in value['offers']))
    keys(value['summary'], ('products', 'items', 'unpriced', 'notDiscounted', 'unqualifiedDates', 'outOfStock',
                           'duplicateItems', 'conflictingItems', 'incompleteProducts', 'notInStore', 'noReportedPromotion',
                           'missingRegularPrice', 'unsupportedPrice', 'usablePriced', 'qualifyingPromotions'))
    summary = value['summary']
    require(all(integer(count, 0, 500) for count in summary.values()) and summary['products'] <= (1 if exact else 50) and
            summary['qualifyingPromotions'] == len(value['offers']))
    if args.operation in {'products', 'product'}:
        require(len(rows) == (summary['usablePriced'] if args.include_all is not False else summary['qualifyingPromotions']))
    evidence = value['sourceEvidence']; keys(evidence, ('records', 'summary'))
    require(isinstance(evidence['records'], list) and len(evidence['records']) <= (10 if exact else 500))
    for index, record in enumerate(evidence['records']):
        evidence_record(record, retrieved)
        require(record['recordIndex'] == index)
        if exact:
            require(record['source']['productId'] == args.product_id)
    def matching_evidence(row, record):
        return all(row['source'].get(key) == fact for key, fact in record['source'].items())
    for row in rows:
        require(any(matching_evidence(row, record) and not set(record['dispositions']) &
                    {'missing_items', 'missing_description', 'not_in_store', 'out_of_stock', 'duplicate', 'identity_conflict'}
                    for record in evidence['records']))
    included = [record for record in evidence['records'] if record['includedInOffers']]
    require(len(included) == len(value['offers']) and
            all(sum(matching_evidence(row, record) for record in included) == 1 for row in value['offers']))
    e_summary = evidence['summary']
    keys(e_summary, ('records', 'returnedProducts', 'returnedItems', 'missingItemLists', 'reportedPromotions', 'withoutSavingsArithmetic', 'otherReportedPromotions'))
    records = evidence['records']
    expected = {'records': len(records), 'returnedProducts': summary['products'],
                'returnedItems': sum(row['itemIndex'] is not None for row in records),
                'missingItemLists': sum(row['itemIndex'] is None for row in records),
                'reportedPromotions': sum(row['reportedPromotion'] for row in records),
                'withoutSavingsArithmetic': sum(row['reportedPromotion'] and not row['savingsArithmeticAvailable'] for row in records),
                'otherReportedPromotions': sum(row['reportedPromotion'] and not row['includedInOffers'] for row in records)}
    require(e_summary == expected and summary['items'] == e_summary['returnedItems'])
    if not exact:
        require(scope['queries'] == [{'term': term, 'returnedProducts': summary['products']}])
        verify_page(value['page'], args, summary['products'])
    history(value['history'])
    if args.summary_only:
        return {'ok': True, 'apiVersion': 1, 'status': 'available', 'dataSource': value['dataSource'],
                'retrievedAt': value['retrievedAt'], 'returned': len(rows), 'offers': len(value['offers']),
                'evidenceRecords': len(records), 'exhaustive': False,
                'continuation': None if exact else value['page']['continuation']['status']}, EXIT_OK
    return value, EXIT_OK


def store_result(args, value):
    keys(value, ('ok', 'apiVersion', 'stores', 'radiusInMiles', 'limit', 'dataSource', 'retrievedAt'))
    instant(value['retrievedAt'])
    require(value['radiusInMiles'] == 10 and value['limit'] == 10 and isinstance(value['stores'], list) and len(value['stores']) <= 10)
    hour = {'?gmtOffset': TEXT, '?timezone': TEXT, '?Open24': BOOLEAN,
            **{'?' + day: {'?open': TEXT, '?close': TEXT, '?open24': BOOLEAN} for day in
               ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')}}
    schema = {'locationId': S(8), 'name': S(200),
              'address': {'?' + k: TEXT for k in ('addressLine1', 'addressLine2', 'city', 'county', 'state', 'zipCode')},
              **{'?' + k: S(200) for k in ('chain', 'phone', 'storeNumber', 'divisionNumber')},
              '?hours': hour, '?departments': L({'?departmentId': TEXT, '?name': TEXT, '?phone': TEXT, '?hours': hour}, 100),
              '?geolocation': {'?latLng': TEXT, '?latitude': NUMBER, '?longitude': NUMBER}}
    seen = set()
    for store in value['stores']:
        shape(store, schema, False)
        require(isinstance(store['locationId'], str) and re.fullmatch(r'[A-Za-z0-9]{8}', store['locationId']) and
                clean_text(store['name'], 200) and store['locationId'] not in seen and isinstance(store['address'], dict))
        seen.add(store['locationId'])
        geo = store.get('geolocation') or {}
        require(geo.get('latitude') is None or abs(geo['latitude']) <= 90)
        require(geo.get('longitude') is None or abs(geo['longitude']) <= 180)
    if args.summary_only:
        return {'ok': True, 'apiVersion': 1, 'status': 'available', 'returned': len(value['stores']),
                'dataSource': value['dataSource'], 'retrievedAt': value['retrievedAt'], 'exhaustive': False}, EXIT_OK
    return value, EXIT_OK


def estimate_result(args, value):
    keys(value, ('ok', 'apiVersion', 'status', 'locationId', 'dataSource', 'retrievedAt', 'evaluatedAt', 'lines', 'totals', 'coverage', 'exclusions'))
    require(value['locationId'] == args.store)
    retrieved, evaluated = instant(value['retrievedAt']), instant(value['evaluatedAt'])
    require(retrieved == evaluated and isinstance(value['lines'], list) and len(value['lines']) == len(args.basket_items))
    resolved, subtotal, gaps = 0, 0, set()
    for line, requested in zip(value['lines'], args.basket_items):
        keys(line, ('productId', 'itemId', 'quantity', 'status', 'reason', 'unitPriceCents', 'lineTotalCents',
                    'currency', 'retrievedAt', 'source', 'pricing', 'sourceEvidence', 'qualificationGaps'))
        require((line['productId'], line['itemId'], line['quantity']) == (requested[0], requested[1], int(requested[2])) and
                type(line['quantity']) is int and line['currency'] is None and instant(line['retrievedAt']) <= evaluated)
        labels(line['qualificationGaps'], GAPS)
        gaps.update(line['qualificationGaps'])
        require(isinstance(line['sourceEvidence'], list) and len(line['sourceEvidence']) <= 10)
        for record in line['sourceEvidence']:
            evidence_record(record, evaluated)
            require(record['source']['productId'] == line['productId'] and record['source']['itemId'] == line['itemId'])
        if line['source'] is not None:
            source(line['source'])
            require(line['source']['productId'] == line['productId'] and line['source']['itemId'] == line['itemId'])
            require(any(all(line['source'].get(key) == fact for key, fact in record['source'].items())
                        for record in line['sourceEvidence']))
        if line['status'] == 'estimated':
            require(line['source'] is not None and line['pricing'] is not None and isinstance(line['source']['soldBy'], str) and line['source']['soldBy'].lower() == 'unit' and
                    line['reason'] is None and integer(line['unitPriceCents'], 1) and integer(line['lineTotalCents'], 1))
            pricing(line['pricing'], line['source'], evaluated)
            require(dates_allowed(line['source']['price'], evaluated) and line['source']['stockLevel'] != 'OUT_OF_STOCK' and
                    not any('identity_conflict' in record['dispositions'] for record in line['sourceEvidence']))
            require(line['unitPriceCents'] == line['pricing']['currentCents'] and line['lineTotalCents'] == line['unitPriceCents'] * line['quantity'])
            expected_gaps = {'currency_unreported', 'price_basis_unreported', 'eligibility_unreported', 'modality_unreported'}
            if (line['source'].get('fulfillment') or {}).get('instore') is not True:
                expected_gaps.add('in_store_fulfillment_unreported')
            if line['source']['stockLevel'] not in {'HIGH', 'LOW'}:
                expected_gaps.add('stock_unreported')
            require(set(line['qualificationGaps']) == expected_gaps)
            resolved += 1; subtotal += line['lineTotalCents']; gaps.update(expected_gaps)
        else:
            require(line['status'] == 'unresolved' and line['reason'] in {
                'product_not_found', 'item_not_found', 'identity_conflict', 'incomplete_product', 'not_in_store',
                'out_of_stock', 'unqualified_dates', 'missing_regular_price', 'missing_price', 'unsupported_price', 'variable_or_unknown_quantity_basis', 'arithmetic_overflow'} and
                line['unitPriceCents'] is None and line['lineTotalCents'] is None)
            if line['pricing'] is not None:
                require(line['source'] is not None)
                pricing(line['pricing'], line['source'], evaluated)
    unresolved = len(value['lines']) - resolved
    require(value['status'] == ('partial' if unresolved else 'complete'))
    totals = value['totals']
    keys(totals, ('reportedSubtotalCents', 'qualifiedSubtotalCents', 'currency', 'currencyQualification',
                 'estimatedLineCount', 'unresolvedLineCount', 'qualificationGaps'))
    labels(totals['qualificationGaps'], TOTAL_GAPS)
    if unresolved:
        gaps.add('unresolved_lines')
    if not resolved:
        gaps.add('no_resolved_prices')
    if subtotal > SAFE_INTEGER:
        gaps.add('arithmetic_overflow')
    require(totals['reportedSubtotalCents'] == (subtotal if resolved and subtotal <= SAFE_INTEGER else None) and
            totals['qualifiedSubtotalCents'] is None and totals['currency'] is None and
            totals['currencyQualification'] == ('unreported' if resolved else 'unavailable') and
            type(totals['estimatedLineCount']) is int and totals['estimatedLineCount'] == resolved and
            type(totals['unresolvedLineCount']) is int and totals['unresolvedLineCount'] == unresolved and set(totals['qualificationGaps']) == gaps)
    keys(value['coverage'], ('type', 'requestedLineCount', 'recheckedProductCount', 'exhaustive', 'message'))
    require(value['coverage']['type'] == 'selected_products' and value['coverage']['exhaustive'] is False and
            type(value['coverage']['requestedLineCount']) is int and value['coverage']['requestedLineCount'] == len(args.basket_items) and
            type(value['coverage']['recheckedProductCount']) is int and value['coverage']['recheckedProductCount'] == len({item[0] for item in args.basket_items}))
    shape(value['coverage']['message'], S(2000), False)
    require(value['exclusions'] == ['tax', 'fees', 'coupons', 'eligibility_verification', 'checkout_changes'])
    if args.summary_only:
        return {'ok': True, 'apiVersion': 1, 'status': value['status'], 'dataSource': value['dataSource'],
                'retrievedAt': value['retrievedAt'], 'evaluatedAt': value['evaluatedAt'],
                'estimatedLineCount': resolved, 'unresolvedLineCount': unresolved, 'exhaustive': False}, EXIT_OK
    return value, EXIT_OK


def result_for(args, value):
    try:
        require(isinstance(value, dict) and value.get('ok') is True and type(value.get('apiVersion')) is int and
                value['apiVersion'] == 1 and value.get('dataSource') in {'kroger-api', 'synthetic-fixture'})
        if args.operation == 'status':
            require(type(value['configured']) is bool and value['environment'] in {'production', 'certification'})
            caps = value['capabilities']
            require(isinstance(caps, dict) and all(type(caps.get(k)) is bool for k in ('products', 'basket', 'cart', 'promotionService')))
            result = {'ok': True, 'apiVersion': 1, 'configured': value['configured'], 'environment': value['environment'],
                      'dataSource': value['dataSource'], 'capabilities': {k: caps[k] for k in ('products', 'basket', 'cart', 'promotionService')}}
            for key in ('history', 'promotionService'):
                require(value[key]['status'] in {'available', 'unavailable', 'permission_required'})
                result[key] = {'status': value[key]['status']}
            return result, EXIT_OK if value['configured'] else EXIT_UNAVAILABLE
        if args.operation == 'stores':
            return store_result(args, value)
        if args.operation == 'estimate':
            return estimate_result(args, value)
        return search_result(args, value)
    except (ValueError, KeyError, TypeError, OverflowError, RecursionError):
        raise ToolError('invalid_response', 'The app result did not match the selected store, request or documented format.',
                        'Discard the result and ask the operator to check API compatibility. No fallback was made.') from None


class Parser(argparse.ArgumentParser):
    def error(self, _message):
        invalid('Missing, unknown or invalid command arguments. Values are not echoed; run --help.')


def parser():
    p = Parser(allow_abbrev=False, description='Find current stores/products and estimate selected quantities through this app. The server may contact Kroger. No Cart, collection, database access or automatic history fallback.',
        epilog='Examples: shopping.py status --json; shopping.py stores --zip 00000 --dry-run --json; '
        'shopping.py products --store TEST0001 --term milk --summary-only --dry-run --json. '
        'Set HOUSTON_APP_URL or --base-url to the actual app URL ending in /. '
        'Use --data-use-approved only after actual source/recipient permission is established; the flag grants no rights. '
        'Exit 0: successful bounded response/complete/partial/preview; 1: request/format failure; 2: input; 3: capability/permission gap. '
        'Use promotions.py separately for stored-only reads and dated history.')
    p.add_argument('operation', choices=list(PATHS))
    p.add_argument('--base-url', default=os.environ.get('HOUSTON_APP_URL', 'http://localhost:4173/apps/houston-i-love-kroger/'))
    p.add_argument('--zip', dest='zip_code', help='Stores only: five US ZIP digits.')
    p.add_argument('--store', help='Exact person-confirmed eight-character store ID, preserving zeros.')
    p.add_argument('--term', help='Products/deals: explicit grocery or brand term, 3–80 characters, at most eight words.')
    p.add_argument('--sort', help='Products/deals: savings, percent or price; ordering covers this returned page only.')
    p.add_argument('--start', type=int, help='Products/deals: matching returned next-page candidate from 1 to 250; no automatic paging.')
    p.add_argument('--include-all', action=argparse.BooleanOptionalAction, default=None,
                   help='Products only: include regular-only prices (default); --no-include-all restricts to qualifying promotions.')
    p.add_argument('--product-id', help='Product: exact 13-digit source product ID.')
    p.add_argument('--item', dest='basket_items', nargs=3, action='append', metavar=('PRODUCT_ID', 'ITEM_ID', 'QUANTITY'),
                   help='Estimate: repeat 1–10 unique source selections, whole quantities 1–99; never prices.')
    p.add_argument('--timeout', type=float, default=15, help='Per-request timeout, 1–35 seconds; no retry.')
    p.add_argument('--summary-only', action='store_true', help='Fixed counts/status only, with no rows, IDs, prices or ZIP.')
    p.add_argument('--data-use-approved', action='store_true', help='Acknowledge already established source/recipient rights; grants none.')
    p.add_argument('--json', action='store_true'); p.add_argument('--no-input', action='store_true')
    p.add_argument('--no-color', action='store_true'); p.add_argument('-q', '--quiet', action='store_true')
    p.add_argument('-v', '--verbose', action='store_true', help='Keeps the same bounded output; never raw exceptions.')
    p.add_argument('-n', '--dry-run', action='store_true', help='Validate only; no network, writes, checked time or input values.')
    return p


def run(args):
    base, body = base_url(args.base_url), build_body(args)
    if not math.isfinite(args.timeout) or not 1 <= args.timeout <= 35:
        invalid('--timeout must be between 1 and 35 seconds.')
    if args.dry_run:
        return {'ok': True, 'status': 'preview', 'operation': args.operation,
                'requestFields': sorted(body or {}), 'network': False, 'writes': False}, EXIT_OK
    if args.operation != 'status' and not args.summary_only and not args.data_use_approved:
        raise ToolError('recipient_permission_required', 'Returning source records needs actual source and recipient permission.',
                        'Use --summary-only for bounded diagnostics, or establish actual rights before --data-use-approved.', EXIT_UNAVAILABLE)
    return result_for(args, request(base, args.operation, body, args.timeout))


def main(argv=None):
    try:
        args = parser().parse_args(argv)
        human = sys.stdout.isatty() and not (args.json or args.no_input or args.quiet)
        color = human and not args.no_color and not os.environ.get('NO_COLOR')
        if human:
            print('Houston I Love Kroger — current shopping through the app\nExplicit store/product reads and quantity estimates; no purchases or collection.', file=sys.stderr)
        result, code = run(args)
    except ToolError as error:
        result, code = {'ok': False, 'error': {'code': error.code, 'message': str(error), 'recovery': error.recovery}}, error.exit_code
    except KeyboardInterrupt:
        result, code = {'ok': False, 'error': {'code': 'cancelled', 'message': 'The request was cancelled.',
                        'recovery': 'No automatic retry was made. Decide explicitly whether another read is needed.'}}, EXIT_FAILED
    except Exception:
        result, code = {'ok': False, 'error': {'code': 'failed', 'message': 'The tool could not complete this request.',
                        'recovery': 'Run --help and check the installation. No automatic retry was made.'}}, EXIT_FAILED
    if 'human' in locals() and human:
        label = 'Completed bounded read' if code == 0 else 'Needs attention'
        style = ('\033[32m' if code == 0 else '\033[33m' if code == 3 else '\033[31m') if color and sys.stderr.isatty() else ''
        print(style + label + ('\033[0m' if style else ''), file=sys.stderr)
    print(json.dumps(result, ensure_ascii=True, allow_nan=False))
    # Flush within the entry-point BrokenPipeError boundary, rather than leaving
    # a buffered final write to interpreter shutdown.
    sys.stdout.flush()
    return code


if __name__ == '__main__':
    try:
        sys.exit(main())
    except BrokenPipeError:
        sink = os.open(os.devnull, os.O_WRONLY)
        os.dup2(sink, sys.stdout.fileno()); os.close(sink)
        sys.exit(EXIT_FAILED)
