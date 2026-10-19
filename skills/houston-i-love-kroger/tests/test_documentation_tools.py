"""Synthetic filesystem tests; no app, catalog, browser or private data access."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / '_docs.py'
SPEC = importlib.util.spec_from_file_location('companion_docs', SCRIPT)
docs = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(docs)


class DocumentationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / 'Project With Spaces'
        self.skill = self.root / 'skills' / 'houston-i-love-kroger'
        (self.skill / 'research').mkdir(parents=True)
        source = Path(__file__).resolve().parents[1] / 'research' / 'source-inventory.json'
        (self.skill / 'research' / 'source-inventory.json').write_bytes(source.read_bytes())
        (self.root / 'package.json').write_text(json.dumps({'name': 'houston-i-love-kroger', 'version': '0.0.0-test'}), encoding='utf-8')
        for name in docs.SOURCE_FILES:
            path = self.root / name
            path.parent.mkdir(exist_ok=True)
            path.write_text('# Synthetic manual\n\n```json\n{"example": true}\n```\n', encoding='utf-8')

    def tearDown(self):
        self.temporary.cleanup()

    def collect(self):
        return docs.collect(self.root, self.skill / 'research' / 'official_docs', skill_root=self.skill)

    def test_exact_collection_and_repeated_refresh(self):
        self.assertEqual(self.collect()['counts']['saved'], 5)
        self.assertEqual(self.collect()['counts']['failed'], 0)
        for name in docs.SOURCE_FILES:
            self.assertEqual((self.root / name).read_bytes(), (self.skill / 'research' / 'official_docs' / 'pages' / Path(name).name).read_bytes())
        self.assertEqual(docs.audit(self.root, self.skill)['sourceFreshness'], 'checked')

    def test_hash_corruption_is_not_accepted(self):
        self.collect()
        (self.skill / 'research' / 'official_docs' / 'pages' / 'API.md').write_text('# Changed', encoding='utf-8')
        with self.assertRaises(docs.DocsError) as caught:
            docs.audit(skill_root=self.skill)
        self.assertEqual(caught.exception.code, 'hash_mismatch')

    def test_source_drift_is_distinct_from_corpus_integrity(self):
        self.collect()
        (self.root / 'docs' / 'API.md').write_text('# New API', encoding='utf-8')
        self.assertEqual(docs.audit(skill_root=self.skill)['sourceFreshness'], 'not_checked')
        with self.assertRaises(docs.DocsError) as caught:
            docs.audit(self.root, self.skill)
        self.assertEqual(caught.exception.code, 'source_changed')

    def test_missing_source_does_not_publish_partial_manifest(self):
        (self.root / 'docs' / 'API.md').unlink()
        with self.assertRaises(docs.DocsError) as caught:
            self.collect()
        self.assertEqual(caught.exception.code, 'source_unavailable')
        self.assertFalse((self.skill / 'research' / 'official_docs' / 'manifest.json').exists())

    def test_inventory_cannot_read_unselected_file(self):
        path = self.skill / 'research' / 'source-inventory.json'
        inventory = json.loads(path.read_text(encoding='utf-8'))
        inventory['pages'][0]['source'] = '.env'
        path.write_text(json.dumps(inventory), encoding='utf-8')
        with self.assertRaises(docs.DocsError) as caught:
            self.collect()
        self.assertEqual(caught.exception.code, 'invalid_inventory')

    def test_output_escape_and_network_source_rejected(self):
        with self.assertRaises(docs.DocsError):
            docs.destination(self.root / 'elsewhere', self.skill)
        with self.assertRaises(docs.DocsError) as caught:
            docs.collect(self.root, url='https://example.invalid/', skill_root=self.skill)
        self.assertEqual(caught.exception.code, 'unsupported_source')

    def test_unaccounted_corpus_page_fails(self):
        self.collect()
        (self.skill / 'research' / 'official_docs' / 'pages' / 'extra.md').write_text('# Extra', encoding='utf-8')
        with self.assertRaises(docs.DocsError) as caught:
            docs.audit(skill_root=self.skill)
        self.assertEqual(caught.exception.code, 'unexpected_page')

    def test_padded_quoted_paths_and_empty_input(self):
        result = docs.collect('  "' + str(self.root) + '"  ',
                              '  "' + str(self.skill / 'research' / 'official_docs') + '"  ', skill_root=self.skill)
        self.assertEqual(result['counts']['saved'], 5)
        with self.assertRaises(docs.DocsError) as caught:
            docs.repository_root('  ""  ', self.skill)
        self.assertEqual(caught.exception.code, 'invalid_arguments')


if __name__ == '__main__':
    unittest.main()
