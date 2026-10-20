#!/usr/bin/env python3
"""Audit or refresh the skill-local public Kroger documentation mirror."""
from __future__ import annotations
import argparse
from datetime import date
import json
from pathlib import Path
import sys
from fetch_docs import ROOT, SOURCE, INVENTORY, VERSION, OWNER, PUBLIC_SPECS, PARTNER_SPECS, REQUIRED_SPECS, canonical, collect, common, digest, discover, emit, safe_path, timestamp, write_json


def audit(output: Path) -> dict:
    manifest = json.loads(safe_path(output, "manifest.json").read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError("mirror manifest structure is malformed; restore it or run --refresh")
    if (manifest.get("owner"), manifest.get("source"), manifest.get("inventory_url"), manifest.get("source_version")) != (OWNER, SOURCE, INVENTORY, VERSION):
        raise ValueError("mirror identity differs from this collector; inspect the selected directory")
    raw = safe_path(output, "inventory.json").read_bytes()
    if digest(raw) != manifest["inventory_sha256"]:
        raise ValueError("inventory fingerprint changed; restore it or run --refresh")
    expected = discover(raw)
    pages = manifest["pages"]
    if not isinstance(pages, list) or not all(isinstance(page, dict) for page in pages):
        raise ValueError("manifest article entries are malformed; restore it or run --refresh")
    if {(p["url"], p["id"]) for p in expected} != {(p["url"], p["id"]) for p in pages} or len(pages) != len(expected):
        raise ValueError("manifest does not account for the complete official inventory; run --refresh")
    paths = set()
    for page in pages:
        if page["status"] != "saved":
            raise ValueError("mirror records a failed article; inspect its manifest entry and refresh")
        path = safe_path(output, page["path"])
        if path in paths:
            raise ValueError("article file paths collide; repair the collector")
        paths.add(path)
        body = path.read_bytes()
        if not body or digest(body) != page["sha256"] or len(body) != page["bytes"]:
            raise ValueError("article fingerprint failed; restore or refresh the mirror")
    counts = {"indexed": len(pages), "saved": len(pages), "failed": 0, "excluded": 0}
    if manifest["counts"] != counts or manifest["exclusions"]:
        raise ValueError("inventory counts or exclusion policy differ; inspect the collection contract")
    if manifest["removed_inventory_urls"]:
        raise ValueError("removed documentation requires scope review; inspect the manifest")
    if {s["slug"] for s in manifest["specs"]} != set(REQUIRED_SPECS) or len(manifest["specs"]) != len(REQUIRED_SPECS):
        raise ValueError("selected public/partner specification coverage is incomplete or duplicated; run --refresh")
    for resource in manifest["specs"] + [manifest["terms"]]:
        if resource["status"] != "saved":
            raise ValueError("a required selected specification or Terms source is missing; inspect manifest")
        body = safe_path(output, resource["path"]).read_bytes()
        if digest(body) != resource["sha256"] or len(body) != resource["bytes"]:
            raise ValueError("public specification or Terms fingerprint failed; restore or recollect source")
        if "markdown_path" in resource and digest(safe_path(output, resource["markdown_path"]).read_bytes()) != resource["markdown_sha256"]:
            raise ValueError("specification Markdown fingerprint failed; run --refresh")
    return {"ok": True, "message": "Offline mirror integrity passed; inspect reported nested-link gaps. This does not check remote freshness or refresh browser Terms.", "counts": counts, "public_specs": len(PUBLIC_SPECS), "partner_specs": len(PARTNER_SPECS), "nested_link_gaps": manifest["unmapped_documentation_links"], "retrieved_at": manifest["retrieved_at"]}


def accept_removal(output: Path, url: str, note: str) -> dict:
    """Record a deliberate source/consumer review without deleting old files."""
    url = canonical(url)
    if not note or len(note) > 240 or any(ord(char) < 32 for char in note):
        raise ValueError("provide a non-sensitive single-line --review-note of 1–240 characters describing the reviewed disposition")
    path = safe_path(output, "manifest.json")
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or manifest.get("owner") != OWNER or manifest.get("source") != SOURCE:
        raise ValueError("review target is not this collector's mirror; inspect --output")
    removed = manifest.get("removed_inventory_urls")
    if not isinstance(removed, list) or url not in removed:
        raise ValueError("URL is not an unresolved removal in this mirror; inspect manifest before accepting a disposition")
    reviews = manifest.get("accepted_removal_reviews", [])
    if not isinstance(reviews, list):
        raise ValueError("saved removal reviews are malformed; restore manifest before accepting a disposition")
    manifest["removed_inventory_urls"] = [item for item in removed if item != url]
    manifest["accepted_removal_reviews"] = reviews + [{"url": url, "reviewed_at": timestamp(), "disposition": note, "source_files": "preserved; no deletion authorized by this command"}]
    write_json(path, manifest)
    return {"ok": True, "message": "Source-removal review recorded; old source files preserved. Run --check to evaluate remaining gates."}


def import_terms(output: Path, source: Path, modified: str, replace: bool = False) -> dict:
    """Import an explicitly supplied public article; never inspect a browser."""
    try:
        if date.fromisoformat(modified).isoformat() != modified:
            raise ValueError('date format differs')
    except (TypeError, ValueError):
        raise ValueError("provide the public article's displayed modification date as --publisher-modified YYYY-MM-DD") from None
    manifest_path = safe_path(output, 'manifest.json')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if not isinstance(manifest, dict) or manifest.get('owner') != OWNER or manifest.get('source') != SOURCE:
        raise ValueError("run the public fetcher into this mirror first; Terms import requires its owned manifest")
    destination = safe_path(output, 'terms-browser-source.json')
    if destination.exists() and not replace:
        raise ValueError("a Terms capture already exists; preserve it or use --replace-terms after reviewing the newer public article")
    content = source.read_text(encoding='utf-8-sig')
    if (len(content) < 5000 or not content.lstrip().startswith('Terms of Service')
            or any(f'Section {number}:' not in content for number in range(1, 11))
            or 'Last modified:' not in content or 'HAMILTON COUNTY, OHIO' not in content
            or '<!DOCTYPE html' in content):
        raise ValueError("the text lacks the expected complete public Terms article; copy its full main article, not navigation, account content or HTML, and retry")
    captured_at = timestamp()
    document = {'source_url': SOURCE + '/terms', 'retrieved_at': captured_at,
                'method': 'operator-provided public main-article text imported locally; remote content not verified',
                'publisher_modified': modified, 'content': content}
    write_json(destination, document)
    raw = destination.read_bytes()
    manifest['terms'] = {'url': document['source_url'], 'path': destination.name, 'status': 'saved',
                         'sha256': digest(raw), 'bytes': len(raw), 'retrieved_at': captured_at,
                         'method': document['method'], 'publisher_modified': modified,
                         'freshness': 'operator-provided public capture; local import does not check remote freshness'}
    write_json(manifest_path, manifest)
    return {'ok': True, 'message': 'Public Terms text imported; its contents were not printed and remote content was not checked. Run --check, then review source applicability and rights separately.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__, epilog="Examples: python scripts/refresh_docs.py --check --json; python scripts/refresh_docs.py --refresh --json")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="Audit local files only; no network")
    mode.add_argument("--refresh", action="store_true", help="Collect current public external navigation, then audit")
    mode.add_argument("--repair", action="store_true", help="Resume verified local pages, then audit; unchanged IDs may still have changed remote content")
    mode.add_argument("--accept-removed", metavar="URL", help="After source/consumer review, explicitly accept one recorded removal; preserves old files and makes no network requests")
    mode.add_argument("--import-terms", type=Path, metavar="TEXTFILE", help="Import an explicitly supplied complete public Terms UTF-8 text file into an existing owned mirror; no network")
    parser.add_argument("--review-note", help="Non-sensitive single-line reviewed disposition, required with --accept-removed")
    parser.add_argument("--publisher-modified", help="Displayed public Terms modification date, YYYY-MM-DD; required with --import-terms")
    parser.add_argument("--replace-terms", action="store_true", help="Explicitly replace an existing Terms capture with the reviewed public text; only with --import-terms")
    parser.add_argument("--output", type=Path, default=ROOT / "research" / "official_docs", help="Mirror directory (default: this skill's research/official_docs)")
    common(parser)
    args = parser.parse_args()
    try:
        if bool(args.accept_removed) != bool(args.review_note):
            raise ValueError("use --review-note only with --accept-removed, and supply both for a reviewed removal")
        if bool(args.import_terms) != bool(args.publisher_modified) or (args.replace_terms and not args.import_terms):
            raise ValueError("use --publisher-modified with --import-terms; --replace-terms is optional only in that mode")
        if args.dry_run:
            result = {"ok": True, "message": "Options accepted; no files or network changed."}
        elif args.accept_removed:
            result = accept_removal(args.output, args.accept_removed, args.review_note)
        elif args.import_terms:
            result = import_terms(args.output, args.import_terms, args.publisher_modified, args.replace_terms)
        else:
            if args.refresh or args.repair:
                collect(args.output, resume=args.repair)
            result = audit(args.output)
        code = 0
    except (ValueError, KeyError, TypeError, OSError) as error:
        result = {"ok": False, "message": str(error) if isinstance(error, ValueError) else "Mirror is absent, malformed or unreadable; run --refresh after reviewing the command contract."}
        code = 1
    except KeyboardInterrupt:
        result = {"ok": False, "message": "Interrupted; preserve files and run --repair."}
        code = 130
    emit(result, args)
    return code


if __name__ == "__main__":
    sys.exit(main())
