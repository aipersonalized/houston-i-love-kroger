"""Stored discovery contract checks with synthetic payloads and no source access."""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'promotions.py'
SPEC = importlib.util.spec_from_file_location('discovery_cli', SCRIPT)
CLI = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CLI)


def snapshot(stale=False):
    return {'snapshotId': '1', 'observedAt': '2026-01-02T12:00:00.000Z',
            'completedAt': '2026-01-02T12:00:01.000Z', 'ageSeconds': 86400 if stale else 1, 'maxAgeSeconds': 86400}


def directory(status='available', empty=False):
    return {'ok': True, 'apiVersion': 1, 'status': status, 'zipCode': '00000',
            'stores': [] if empty or status != 'available' else [{'locationId': 'TEST0001', 'name': 'Synthetic market',
                'address': dict.fromkeys(['addressLine1', 'addressLine2', 'city', 'county', 'state', 'zipCode'])}],
            'snapshot': snapshot(status == 'stale') if status in {'available', 'stale'} else None,
            'latestAttempt': None,
            'coverage': {'type': 'bounded_zip_directory', 'zipCode': '00000', 'radiusMiles': 10, 'limitPerQuery': 10,
                'returnedStoreCount': (0 if empty else 1) if status in {'available', 'stale'} else None,
                'completeNearbyStores': False, 'message': 'Synthetic bounded ZIP query.'}}


def topics(status='available', empty=False):
    return {'ok': True, 'apiVersion': 1, 'status': status, 'locationId': 'TEST0001',
            'topics': [] if status in {'permission_required', 'no_data'} else [
                {'topic': 'milk', 'status': status, 'snapshot': snapshot(status == 'stale'), 'latestAttempt': None,
                 'returnedProductCount': 0 if empty else 1}],
            'coverage': {'type': 'completed_store_topics', 'completeCatalog': False, 'message': 'Synthetic completed named samples only.'}}


class DiscoveryTests(unittest.TestCase):
    def arguments(self, operation='stores', fields=None):
        return CLI.parser().parse_args([operation] + (['--zip', '00000'] if operation == 'stores' else ['--store', 'TEST0001']) + (fields or []))

    def test_input_binding_and_no_live_fields(self):
        self.assertEqual(CLI.build_body(self.arguments()), {'zipCode': '00000'})
        self.assertEqual(CLI.build_body(self.arguments('topics')), {'locationId': 'TEST0001'})
        for fields in [['--zip', '0000'], ['--store', 'TEST0001'], ['--topic', 'milk'], ['--limit', '10'], ['--cursor', 'abc']]:
            args = self.arguments(fields=fields)
            with self.assertRaises(CLI.ToolError):
                CLI.build_body(args)
        with self.assertRaises(CLI.ToolError):
            CLI.build_body(self.arguments('topics', ['--zip', '00000']))

    def test_dry_run_and_recipient_gate_never_open_network(self):
        with patch.object(CLI, 'request') as request:
            result, code = CLI.run(self.arguments(fields=['--dry-run']))
            self.assertEqual(code, 0); self.assertEqual(result['network'], False)
            self.assertEqual(result['requestFields'], ['zipCode'])
            with self.assertRaises(CLI.ToolError) as caught:
                CLI.run(self.arguments())
            self.assertEqual(caught.exception.code, 'recipient_permission_required')
            request.assert_not_called()

    def test_exact_paths_and_bodies_through_documented_tool_interface(self):
        for operation, expected, payload in [('stores', {'zipCode': '00000'}, directory()),
                                              ('topics', {'locationId': 'TEST0001'}, topics())]:
            with patch.object(CLI, 'request', return_value=payload) as request:
                result, code = CLI.run(self.arguments(operation, ['--data-use-approved']))
                self.assertEqual(code, 0); self.assertEqual(result, payload)
                self.assertEqual(request.call_args.args[1:3], (operation, expected))

    def test_fresh_empty_stale_no_data_and_denied_are_distinct(self):
        for operation, factory in [('stores', directory), ('topics', topics)]:
            for status in ['available', 'stale', 'no_data', 'permission_required']:
                result, code = CLI.result_for(self.arguments(operation), factory(status))
                self.assertEqual(result['status'], status)
                self.assertEqual(code, 0 if status == 'available' else 3)
            result, code = CLI.result_for(self.arguments(operation), factory(empty=True))
            self.assertEqual(code, 0)
            if operation == 'topics':
                self.assertEqual(result['topics'][0]['returnedProductCount'], 0)
            else:
                self.assertEqual(result['stores'], [])

    def test_summary_omits_zip_store_labels_source_rows_and_snapshot_id(self):
        for operation, payload in [('stores', directory()), ('topics', topics())]:
            result, code = CLI.result_for(self.arguments(operation, ['--summary-only']), payload)
            self.assertEqual(code, 0); self.assertEqual(result['returned'], 1)
            rendered = str(result)
            for forbidden in ['00000', 'TEST0001', 'Synthetic market', 'milk', 'snapshotId', 'zipCode', 'locationId']:
                self.assertNotIn(forbidden, rendered)

    def test_directory_rejects_wrong_zip_invented_complete_scope_duplicate_ids_unknown_fields_and_incoherent_age(self):
        mutations = [lambda p: p.update(zipCode='00001'), lambda p: p['coverage'].update(completeNearbyStores=True),
            lambda p: p['coverage'].update(radiusMiles=20), lambda p: p['stores'].append(copy.deepcopy(p['stores'][0])),
            lambda p: p['stores'][0].update(distance=1), lambda p: p.update(privatePolicy='forbidden'),
            lambda p: p['stores'][0]['address'].update(account='forbidden'), lambda p: p['snapshot'].update(ageSeconds=86400),
            lambda p: p.update(status='stale'), lambda p: p['coverage'].update(returnedStoreCount=0),
            lambda p: p['coverage'].update(returnedStoreCount=10)]
        for mutate in mutations:
            payload = directory(); mutate(payload)
            with self.assertRaises(CLI.ToolError) as caught:
                CLI.result_for(self.arguments(), payload)
            self.assertEqual(caught.exception.code, 'invalid_response')

    def test_topics_rejects_wrong_store_private_plan_fields_duplicate_labels_and_unsupported_freshness(self):
        mutations = [lambda p: p.update(locationId='TEST0002'), lambda p: p.update(operatorConfig=['uncollected']),
            lambda p: p['topics'].append(copy.deepcopy(p['topics'][0])), lambda p: p['topics'][0].update(status='no_data'),
            lambda p: p['topics'][0].update(returnedProductCount=-1), lambda p: p['topics'][0]['snapshot'].update(ageSeconds=86400),
            lambda p: p.update(status='permission_required')]
        for mutate in mutations:
            payload = topics(); mutate(payload)
            with self.assertRaises(CLI.ToolError) as caught:
                CLI.result_for(self.arguments('topics'), payload)
            self.assertEqual(caught.exception.code, 'invalid_response')

    def test_operational_unavailable_is_fixed_and_does_not_fabricate_empty_directory(self):
        payload = {'ok': True, 'apiVersion': 1, 'status': 'unavailable', 'zipCode': '00000', 'reason': 'promotion_service_not_configured'}
        result, code = CLI.result_for(self.arguments(), payload)
        self.assertEqual(code, 3); self.assertNotIn('stores', result)
        with self.assertRaises(CLI.ToolError):
            CLI.result_for(self.arguments(), {**payload, 'stores': []})


if __name__ == '__main__':
    unittest.main()
