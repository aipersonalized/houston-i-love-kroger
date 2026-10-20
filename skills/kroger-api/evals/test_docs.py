"""Synthetic source-fidelity and mirror-failure checks; no accounts or network."""
import base64
from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import shutil
import subprocess
import unittest
import io
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import fetch_docs as fetch
import refresh_docs as refresh


class DocumentationTests(unittest.TestCase):
    def test_malformed_inventory_parser_and_json_cli(self):
        names = ('Public APIs', 'Partner APIs', 'Support Resources')
        malformed = [{'data': []}, {'data': {}}, {'data': [{'categories': {}}]}, {'data': [{'categories': [{'name': n, 'pages': 'bad'} for n in names]}]}, {'data': [{'categories': [{'name': n, 'pages': [None]} for n in names]}]}]
        source = fetch.ROOT / 'research' / 'official_docs'
        for value in malformed:
            raw = json.dumps(value).encode()
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    fetch.discover(raw)
                with tempfile.TemporaryDirectory(prefix='kroger malformed ') as tmp:
                    target = Path(tmp)
                    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
                    manifest['inventory_sha256'] = fetch.digest(raw)
                    (target / 'inventory.json').write_bytes(raw)
                    fetch.write_json(target / 'manifest.json', manifest)
                    result = subprocess.run([sys.executable, '-B', str(fetch.ROOT / 'scripts' / 'refresh_docs.py'), '--check', '--json', '--output', tmp], capture_output=True, text=True, timeout=15)
                    self.assertEqual(result.returncode, 1)
                    self.assertFalse(json.loads(result.stdout)['ok'])
                    self.assertIn('public source', json.loads(result.stdout)['message'])
                    self.assertNotIn('Traceback', result.stderr)

    def test_removed_source_persists_until_review_or_reinstatement(self):
        source = fetch.ROOT / 'research' / 'official_docs'
        original = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
        inventory = json.loads((source / 'inventory.json').read_text(encoding='utf-8'))
        missing_url = fetch.SOURCE + '/documentation/public/getting-started/quick-start'
        reduced = deepcopy(inventory)
        def remove(nodes):
            nodes[:] = [node for node in nodes if fetch.SOURCE + node.get('url', '') != missing_url]
            for node in nodes:
                remove(node.get('pages', []))
        for category in reduced['data'][0]['categories']:
            remove(category['pages'])
        selected_inventory = [json.dumps(reduced).encode()]
        responses = {}
        for page in original['pages']:
            responses[page['content_url']] = json.dumps({'data': {'url': page['url'], 'id': page['id'], 'content': base64.b64encode((source / page['path']).read_bytes()).decode()}}).encode()
        for spec in original['specs']:
            responses[spec['inventory_url']] = json.dumps({'data': {'versions': [{'id': spec['document_id'], 'semanticVersion': spec['version']}]}}).encode()
            responses[spec['content_url']] = (source / spec['path']).read_bytes()
        def response(url):
            return selected_inventory[0] if url == fetch.INVENTORY else responses[url]
        with tempfile.TemporaryDirectory(prefix='kroger source review ') as tmp:
            target = Path(tmp) / 'mirror with spaces'
            shutil.copytree(source, target)
            with patch.object(fetch.PublicClient, 'get', side_effect=response):
                for _ in range(2):
                    result = fetch.collect(target, resume=True)
                    self.assertIn(missing_url, result['removed_inventory_urls'])
                    with self.assertRaises(ValueError):
                        refresh.audit(target)
                with self.assertRaises(ValueError):
                    refresh.accept_removal(target, fetch.SOURCE + '/documentation/not-recorded', 'Synthetic reviewed disposition.')
                acknowledgment = subprocess.run([sys.executable, '-B', str(fetch.ROOT / 'scripts' / 'refresh_docs.py'), '--accept-removed', missing_url, '--review-note', 'Synthetic source and consumers reviewed; obsolete guidance replaced.', '--output', str(target), '--json'], capture_output=True, text=True, timeout=15)
                self.assertEqual(acknowledgment.returncode, 0)
                self.assertTrue(json.loads(acknowledgment.stdout)['ok'])
                self.assertNotIn('Traceback', acknowledgment.stderr)
                self.assertTrue(refresh.audit(target)['ok'])
                self.assertTrue((target / original['pages'][0]['path']).exists())
                result = fetch.collect(target, resume=True)
                self.assertFalse(result['removed_inventory_urls'])
                self.assertEqual(len(result['accepted_removal_reviews']), 1)
                selected_inventory[0] = json.dumps(inventory).encode()
                fetch.collect(target, resume=True)
                self.assertTrue(refresh.audit(target)['ok'])
                selected_inventory[0] = json.dumps(reduced).encode()
                result = fetch.collect(target, resume=True)
                self.assertIn(missing_url, result['removed_inventory_urls'])
                selected_inventory[0] = json.dumps(inventory).encode()
                result = fetch.collect(target, resume=True)
                self.assertFalse(result['removed_inventory_urls'])
                self.assertTrue(refresh.audit(target)['ok'])

    def test_json_output_has_no_banner_or_escape_codes(self):
        args = SimpleNamespace(json=True, quiet=False, no_input=False, no_color=False)
        output = io.StringIO()
        with patch('sys.stdout', output):
            fetch.emit({'ok': True, 'message': 'Synthetic check passed.'}, args)
        self.assertEqual(json.loads(output.getvalue())['ok'], True)
        self.assertNotIn('\033', output.getvalue())

    def test_synthetic_tty_respects_no_color(self):
        class Terminal(io.StringIO):
            def isatty(self):
                return True
        args = SimpleNamespace(json=False, quiet=False, no_input=False, no_color=False)
        output = Terminal()
        with patch('sys.stdout', output), patch.dict('os.environ', {'NO_COLOR': '1'}):
            fetch.emit({'ok': False, 'message': 'Synthetic failure; restore fixture.'}, args)
        self.assertIn('public sources only', output.getvalue())
        self.assertNotIn('\033', output.getvalue())

    def test_official_host_and_query_boundaries(self):
        for url in ("https://example.org", "http://developer.kroger.com", "https://user:pass@developer.kroger.com", "https://developer.kroger.com/?secret=x"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                fetch.canonical(url)
        with self.assertRaises(ValueError):
            fetch.PublicClient().get(fetch.PUBLIC_CATALOG + "apis/versions?arbitrary=x")

    def test_selected_partner_version_query_is_public_only(self):
        url = fetch.PUBLIC_CATALOG + "apis/versions?filter.alternateId=catalog-api-v2"
        response = io.BytesIO(b'{"data":{"versions":[]}}')
        response.url = url
        client = fetch.PublicClient()
        with patch.object(client.opener, 'open', return_value=response) as opened:
            self.assertEqual(json.loads(client.get(url))['data']['versions'], [])
        request = opened.call_args.args[0]
        self.assertEqual(request.full_url, url)
        self.assertNotIn('authorization', {name.lower() for name in request.headers})
        self.assertNotIn('cookie', {name.lower() for name in request.headers})
        with self.assertRaises(ValueError):
            client.get(fetch.PUBLIC_CATALOG + 'apis/versions?filter.alternateId=unreviewed-partner-api')

    def test_catalog_spec_is_required_once_and_counted_separately(self):
        source = fetch.ROOT / 'research' / 'official_docs'
        original = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(refresh.audit(source)['public_specs'], 5)
        self.assertEqual(refresh.audit(source)['partner_specs'], 1)
        with tempfile.TemporaryDirectory(prefix='kroger selected spec ') as tmp:
            target = Path(tmp) / 'mirror'
            shutil.copytree(source, target)
            for mutation in ('missing', 'duplicate'):
                manifest = deepcopy(original)
                catalog = next(spec for spec in manifest['specs'] if spec['slug'] == 'catalog-api-v2')
                if mutation == 'missing':
                    manifest['specs'].remove(catalog)
                else:
                    manifest['specs'].append(deepcopy(catalog))
                fetch.write_json(target / 'manifest.json', manifest)
                with self.subTest(mutation=mutation), self.assertRaisesRegex(ValueError, 'specification coverage'):
                    refresh.audit(target)

    def test_catalog_failure_preserves_good_bytes_then_recovery_passes(self):
        source = fetch.ROOT / 'research' / 'official_docs'
        original = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
        catalog = next(spec for spec in original['specs'] if spec['slug'] == 'catalog-api-v2')
        raw_catalog = (source / catalog['path']).read_bytes()
        responses = {fetch.INVENTORY: (source / 'inventory.json').read_bytes()}
        for spec in original['specs']:
            responses[spec['inventory_url']] = json.dumps({'data': {'versions': [{'id': spec['document_id'], 'semanticVersion': spec['version']}]}}).encode()
            responses[spec['content_url']] = (source / spec['path']).read_bytes()
        fail_catalog = True
        def response(url):
            if fail_catalog and url == catalog['content_url']:
                raise ValueError('public source returned HTTP 503; retry later or inspect official navigation')
            return responses[url]
        with tempfile.TemporaryDirectory(prefix='kroger catalog recovery ') as tmp:
            target = Path(tmp) / 'mirror with spaces'
            shutil.copytree(source, target)
            with patch.object(fetch.PublicClient, 'get', side_effect=response):
                failed = fetch.collect(target, resume=True)
                failed_catalog = next(spec for spec in failed['specs'] if spec['slug'] == 'catalog-api-v2')
                self.assertEqual(failed_catalog['status'], 'failed')
                self.assertEqual((target / catalog['path']).read_bytes(), raw_catalog)
                with self.assertRaisesRegex(ValueError, 'required selected specification or Terms'):
                    refresh.audit(target)
                fail_catalog = False
                recovered = fetch.collect(target, resume=True)
                self.assertTrue(all(spec['status'] == 'saved' for spec in recovered['specs']))
                self.assertTrue(refresh.audit(target)['ok'])

    def test_public_terms_bootstrap_import_and_offline_audit(self):
        source = fetch.ROOT / 'research' / 'official_docs'
        capture = json.loads((source / 'terms-browser-source.json').read_text(encoding='utf-8'))
        with tempfile.TemporaryDirectory(prefix='kroger public terms ') as tmp:
            target = Path(tmp) / 'mirror with spaces'
            shutil.copytree(source, target, ignore=shutil.ignore_patterns('terms-browser-source.json'))
            supplied = Path(tmp) / 'public terms.txt'
            supplied.write_text(capture['content'], encoding='utf-8')
            completed = subprocess.run([sys.executable, '-B', str(fetch.ROOT / 'scripts' / 'refresh_docs.py'),
                                        '--import-terms', str(supplied), '--publisher-modified', capture['publisher_modified'],
                                        '--output', str(target), '--json', '--no-input'], capture_output=True, text=True, timeout=15)
            self.assertEqual(completed.returncode, 0)
            self.assertNotIn('Traceback', completed.stderr)
            result = json.loads(completed.stdout)
            self.assertTrue(result['ok'])
            self.assertTrue(refresh.audit(target)['ok'])
            saved = json.loads((target / 'terms-browser-source.json').read_text(encoding='utf-8'))
            self.assertEqual(saved['content'], capture['content'])
            self.assertIn('remote content not verified', saved['method'])
            self.assertNotIn(capture['content'][:100], result['message'])

    def test_terms_import_preserves_existing_unless_replacement_is_explicit(self):
        source = fetch.ROOT / 'research' / 'official_docs'
        capture = json.loads((source / 'terms-browser-source.json').read_text(encoding='utf-8'))
        with tempfile.TemporaryDirectory(prefix='kroger terms replacement ') as tmp:
            target = Path(tmp) / 'mirror'
            shutil.copytree(source, target)
            supplied = Path(tmp) / 'public terms.txt'
            supplied.write_text(capture['content'], encoding='utf-8')
            original = (target / 'terms-browser-source.json').read_bytes()
            with self.assertRaisesRegex(ValueError, 'already exists'):
                refresh.import_terms(target, supplied, capture['publisher_modified'])
            self.assertEqual((target / 'terms-browser-source.json').read_bytes(), original)
            with patch.object(fetch.PublicClient, 'get', side_effect=AssertionError('offline import made a request')):
                self.assertTrue(refresh.import_terms(target, supplied, capture['publisher_modified'], replace=True)['ok'])
            self.assertTrue(refresh.audit(target)['ok'])

    def test_terms_import_rejects_incomplete_article_and_bad_date_without_writes(self):
        source = fetch.ROOT / 'research' / 'official_docs'
        with tempfile.TemporaryDirectory(prefix='kroger invalid terms ') as tmp:
            target = Path(tmp) / 'mirror'
            shutil.copytree(source, target)
            supplied = Path(tmp) / 'incomplete.txt'
            supplied.write_text('Terms of Service\nNavigation only', encoding='utf-8')
            original = (target / 'terms-browser-source.json').read_bytes()
            for modified in ('not-a-date', '20261019', '2026-10-19'):
                with self.subTest(modified=modified), self.assertRaises(ValueError):
                    refresh.import_terms(target, supplied, modified, replace=True)
                self.assertEqual((target / 'terms-browser-source.json').read_bytes(), original)

    def test_terms_cli_requires_date_without_emitting_file_content(self):
        result = subprocess.run([sys.executable, '-B', str(fetch.ROOT / 'scripts' / 'refresh_docs.py'),
                                 '--import-terms', 'public terms.txt', '--json'], capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(json.loads(result.stdout)['ok'])
        self.assertIn('--publisher-modified', json.loads(result.stdout)['message'])
        self.assertNotIn('Traceback', result.stderr)

    def test_paths_cannot_escape(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                fetch.safe_path(Path(tmp), "../escaped.md")

    def test_markdown_whitespace_code_and_table_preserved(self):
        page = {"url": fetch.SOURCE + "/documentation/test", "id": "12345678-1234-1234-1234-123456789abc"}
        body = b"# Article\n\n| Name | Value |\n| --- | --- |\n| a | b |\n\n```js\n// multiline comment\n/* keep\n   whitespace */\nconst x = 1;\n```\n"
        raw = json.dumps({"data": {**page, "content": base64.b64encode(body).decode()}}).encode()
        self.assertEqual(fetch.article(raw, page), body)

    def test_shell_and_wrong_identity_rejected(self):
        page = {"url": fetch.SOURCE + "/documentation/test", "id": "12345678-1234-1234-1234-123456789abc"}
        for content in (b"", b"<!DOCTYPE html><html><h1>Navigation shell</h1></html>"):
            raw = json.dumps({"data": {**page, "content": base64.b64encode(content).decode()}}).encode()
            with self.assertRaises(ValueError):
                fetch.article(raw, page)

    def test_inventory_new_category_requires_review(self):
        raw = {"data": [{"categories": [{"name": "Unexpected", "pages": []}]}]}
        with self.assertRaises(ValueError):
            fetch.discover(json.dumps(raw).encode())

    def test_offline_audit_detects_missing_changed_failed_and_escape(self):
        # Reuse only public mirror structure; material under test is in a
        # disposable fixture, never mutate the accepted source mirror.
        source = fetch.ROOT / "research" / "official_docs"
        original = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            for resource in [{"path": "inventory.json"}] + original["pages"] + original["specs"] + [original["terms"]]:
                path = resource["path"]
                destination = fetch.safe_path(target, path)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes((source / path).read_bytes())
                if "markdown_path" in resource:
                    md = fetch.safe_path(target, resource["markdown_path"])
                    md.parent.mkdir(parents=True, exist_ok=True)
                    md.write_bytes((source / resource["markdown_path"]).read_bytes())
            fetch.write_json(target / "manifest.json", original)
            with patch.object(fetch.PublicClient, "get", side_effect=AssertionError("offline audit made a request")):
                self.assertTrue(refresh.audit(target)["ok"])
            for mutation in ("hash", "failed", "escape", "missing"):
                manifest = deepcopy(original)
                if mutation == "hash":
                    manifest["pages"][0]["sha256"] = "0" * 64
                elif mutation == "failed":
                    manifest["pages"][0]["status"] = "failed"
                elif mutation == "escape":
                    manifest["pages"][0]["path"] = "../escaped.md"
                else:
                    manifest["pages"][0]["path"] = "missing.md"
                fetch.write_json(target / "manifest.json", manifest)
                with self.subTest(mutation=mutation), self.assertRaises((ValueError, OSError)):
                    refresh.audit(target)

    def test_unowned_nonempty_directory_is_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            protected = target / "unrelated.txt"
            protected.write_text("preserve", encoding="utf-8")
            with self.assertRaises(ValueError):
                fetch.collect(target)
            self.assertEqual(protected.read_text(encoding="utf-8"), "preserve")


if __name__ == "__main__":
    unittest.main()
