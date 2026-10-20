#!/usr/bin/env python3
"""Collect Kroger's external documentation from its official public content service."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
import tempfile
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://developer.kroger.com"
CONTENT = SOURCE + "/api/v1/developer/content/"
INVENTORY = CONTENT + "manifests.json"
VERSION = "moving external documentation; API families versioned separately"
OWNER = "kroger-api-official-docs-v1"
PUBLIC_SPECS = ("product-api-public", "location-api-public", "cart-api-public", "identity-api-public", "authorization-endpoints-public")
PARTNER_SPECS = ("catalog-api-v2",)
REQUIRED_SPECS = PUBLIC_SPECS + PARTNER_SPECS
PUBLIC_CATALOG = SOURCE + "/api/ui/v1/developer/"
EXIT_SUCCESS, EXIT_FAILURE, EXIT_INPUT = 0, 1, 2


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def canonical(value: str) -> str:
    parsed = urlsplit(urljoin(SOURCE + "/", value))
    if parsed.scheme != "https" or parsed.netloc != "developer.kroger.com" or parsed.query:
        raise ValueError("source URL must use the official HTTPS host without query or credentials")
    return SOURCE + (parsed.path.rstrip("/") or "/")


def safe_path(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or path == root.resolve():
        raise ValueError("mirror path escapes the selected output directory")
    return path


def atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".kroger-docs-", suffix=".partial", delete=False) as stream:
        temp = Path(stream.name)
        stream.write(data)
    temp.replace(path)


def write_json(path: Path, data: object) -> None:
    atomic(path, (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode())


class PublicRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        canonical(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class PublicClient:
    def __init__(self):
        self.last = 0.0
        self.opener = build_opener(PublicRedirects())

    def get(self, url: str) -> bytes:
        # Only the fixed public version-lookup query is permitted.
        plain, _, query = url.partition("?")
        canonical(plain)
        if query and (plain != PUBLIC_CATALOG + "apis/versions" or query not in {"filter.alternateId=" + slug for slug in REQUIRED_SPECS}):
            raise ValueError("source query is outside the public documentation contract")
        for attempt in range(3):
            time.sleep(max(0, self.last + 1 - time.monotonic()))
            self.last = time.monotonic()
            try:
                request = Request(url, headers={"Accept": "application/json", "Content-Type": "application/json", "User-Agent": "kroger-api-docs/1 (public documentation collector)"})
                with self.opener.open(request, timeout=30) as response:
                    if response.url != url:
                        canonical(response.url)
                    data = response.read(32_000_001)
                    if len(data) > 32_000_000:
                        raise ValueError("public documentation response exceeds the collection bound")
                    return data
            except HTTPError as error:
                if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                    raise ValueError(f"public source returned HTTP {error.code}; retry later or inspect official navigation") from None
                retry = error.headers.get("Retry-After", "")
                wait = 2 ** (attempt + 1)
                if retry.isdigit():
                    wait = float(retry)
                elif retry:
                    try:
                        wait = max(0, (parsedate_to_datetime(retry) - datetime.now(timezone.utc)).total_seconds())
                    except (TypeError, ValueError, OverflowError):
                        pass  # Invalid server hint: use the bounded fallback.
                if wait > 60:
                    raise ValueError("source requests a long retry delay; stop and retry after its delay") from None
                time.sleep(wait)
            except (URLError, TimeoutError, OSError):
                if attempt == 2:
                    raise ValueError("public source could not be reached; check connectivity and retry") from None
                time.sleep(2 ** (attempt + 1))
        raise ValueError("public source unavailable")


def discover(raw: bytes) -> list[dict]:
    inventory = json.loads(raw)
    failure = "official inventory structure is malformed; inspect the public source and review scope before collection"
    if not isinstance(inventory, dict):
        raise ValueError(failure)
    data = inventory.get("data")
    if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
        raise ValueError(failure)
    categories = data[0].get("categories")
    if not isinstance(categories, list) or not all(isinstance(item, dict) and isinstance(item.get("name"), str) for item in categories):
        raise ValueError(failure)
    expected = {"Public APIs", "Partner APIs", "Support Resources"}
    if len(categories) != len(expected) or {item["name"] for item in categories} != expected:
        raise ValueError("official category inventory changed; review scope before collection")
    pages = []

    def walk(nodes, family):
        if not isinstance(nodes, list):
            raise ValueError(failure)
        for node in nodes:
            if not isinstance(node, dict) or not isinstance(node.get("name"), str):
                raise ValueError(failure)
            if "path" in node:
                if not all(isinstance(node.get(key), str) for key in ("path", "url", "id")):
                    raise ValueError(failure)
                url = canonical(node["url"])
                identifier = node["id"]
                if not re.fullmatch(r"[0-9a-f-]{36}", identifier):
                    raise ValueError("official article ID is malformed")
                pages.append({"url": url, "id": identifier, "title": node["name"], "family": family, "publisher_path": node["path"], "discovery": "official external navigation"})
            elif not node.get("pages"):
                raise ValueError(failure)
            walk(node.get("pages", []), family)

    for category in categories:
        walk(category.get("pages", []), category["name"])
    if len({p["url"] for p in pages}) != len(pages) or len({p["id"] for p in pages}) != len(pages):
        raise ValueError("official inventory has URL or article-ID collisions")
    if not pages:
        raise ValueError("official external inventory contains no articles")
    return pages


def article(raw: bytes, page: dict) -> bytes:
    response = json.loads(raw)
    if not isinstance(response, dict) or not isinstance(response.get("data"), dict):
        raise ValueError("official article structure is malformed; inspect its public source")
    data = response["data"]
    if not all(isinstance(data.get(key), str) for key in ("url", "id", "content")):
        raise ValueError("official article fields are malformed; inspect its public source")
    if canonical(data["url"]) != page["url"] or data["id"] != page["id"]:
        raise ValueError("article identity differs from official inventory")
    body = base64.b64decode(data["content"], validate=True)
    text = body.decode("utf-8")
    if len(text.strip()) < 40 or "<!DOCTYPE html" in text or not re.search(r"^#", text, re.M):
        raise ValueError("article lacks substantive Markdown; inspect public source format")
    return body


def collect(output: Path, resume: bool = False) -> dict:
    output = output.resolve()
    prior = {}
    previous = {}
    manifest_path = safe_path(output, "manifest.json")
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(previous, dict) or previous.get("owner") != OWNER:
            raise ValueError("output contains a manifest owned by another tool; choose a new mirror directory")
        prior = {page["url"]: page for page in previous.get("pages", [])}
    elif output.exists() and any(output.iterdir()):
        raise ValueError("output is nonempty without this collector's manifest; choose an empty directory")
    client = PublicClient()
    raw_inventory = client.get(INVENTORY)
    pages = discover(raw_inventory)
    atomic(safe_path(output, "inventory.json"), raw_inventory)
    known = {page["url"] for page in pages}
    unresolved = set()
    external_links = set()
    embedded_assets = 0
    for page in pages:
        relative = "pages/" + page["url"].removeprefix(SOURCE + "/") + ".md"
        path = safe_path(output, relative)
        page.update({"path": relative, "status": "failed", "content_url": CONTENT + page["id"] + ".json"})
        try:
            old = prior.get(page["url"], {})
            if resume and old.get("id") == page["id"] and path.is_file() and digest(path.read_bytes()) == old.get("sha256"):
                body = path.read_bytes()
                page["retrieved_at"] = old["retrieved_at"]
            else:
                raw = client.get(page["content_url"])
                body = article(raw, page)
                atomic(path, body)
                page["retrieved_at"] = timestamp()
            page.update({"status": "saved", "sha256": digest(body), "bytes": len(body)})
            for match in re.finditer(r"\]\(([^\s)]+)", body.decode("utf-8")):
                if match.group(1).startswith("data:"):
                    embedded_assets += 1
                    continue  # Exact bytes stay in the article, not the link inventory.
                target = urljoin(page["url"], match.group(1)).split("#")[0].rstrip("/")
                if target.startswith(SOURCE + "/documentation/") and target not in known:
                    unresolved.add(target)
                elif target and target not in known:
                    external_links.add(target)
        except (ValueError, KeyError, TypeError, UnicodeError, OSError) as error:
            page["error"] = str(error) if isinstance(error, ValueError) else "article data or local file is invalid; inspect public source and rerun"
    unresolved_removals = previous.get("removed_inventory_urls", [])
    if not isinstance(unresolved_removals, list) or not all(isinstance(url, str) for url in unresolved_removals):
        raise ValueError("recorded removals are malformed; restore the manifest before collection")
    removed = sorted((set(prior) | set(unresolved_removals)) - known)
    specs = []
    for slug in REQUIRED_SPECS:
        entry = {"url": SOURCE + "/api-products/api/" + slug, "slug": slug, "family": "Partner APIs" if slug in PARTNER_SPECS else "Public APIs", "status": "failed", "inventory_url": PUBLIC_CATALOG + "apis/versions?filter.alternateId=" + slug}
        try:
            # Metadata inventories may include publisher-user metadata. Retain
            # only document/version identity needed for source provenance.
            versions = json.loads(client.get(entry["inventory_url"]))["data"]["versions"]
            if not versions:
                raise ValueError("public API version inventory is empty")
            current = versions[0]
            identifier = current["id"]
            if not re.fullmatch(r"[0-9a-f-]{36}", identifier):
                raise ValueError("public API document ID is malformed")
            version = current["semanticVersion"]
            entry.update({"version": version, "document_id": identifier, "content_url": PUBLIC_CATALOG + "contracts/document/" + identifier, "other_versions": [v["semanticVersion"] for v in versions[1:]]})
            raw_spec = client.get(entry["content_url"])
            spec = json.loads(raw_spec)
            if not isinstance(spec, dict) or not spec.get("openapi") or not isinstance(spec.get("paths"), dict) or not spec["paths"] or not isinstance(spec.get("info"), dict) or spec["info"]["version"] != version:
                raise ValueError("public specification shape/version differs from its inventory")
            relative = "specs/" + slug + ".json"
            atomic(safe_path(output, relative), raw_spec)
            markdown = ("# " + spec["info"]["title"] + " " + version + "\n\nSource: " + entry["url"] + "\n\nLossless official OpenAPI JSON; use paths/components for complete contracts.\n\n```json\n").encode() + raw_spec + b"\n```\n"
            md_path = "specs/" + slug + ".md"
            atomic(safe_path(output, md_path), markdown)
            entry.update({"status": "saved", "path": relative, "sha256": digest(raw_spec), "bytes": len(raw_spec), "markdown_path": md_path, "markdown_sha256": digest(markdown), "retrieved_at": timestamp()})
        except (ValueError, KeyError, TypeError, UnicodeError, OSError) as error:
            entry["error"] = str(error) if isinstance(error, ValueError) else "public specification is malformed or unavailable; inspect its official reference"
        specs.append(entry)
    terms = {"url": SOURCE + "/terms", "path": "terms-browser-source.json", "status": "failed", "error": "public browser source has not been captured; request a fresh public main-article capture"}
    terms_path = safe_path(output, terms["path"])
    if terms_path.is_file():
        raw_terms = terms_path.read_bytes()
        data = json.loads(raw_terms)
        if isinstance(data, dict) and data.get("source_url") == terms["url"] and isinstance(data.get("content"), str) and len(data["content"]) > 5000:
            terms = {"url": terms["url"], "path": terms["path"], "status": "saved", "sha256": digest(raw_terms), "bytes": len(raw_terms), "retrieved_at": data["retrieved_at"], "method": data["method"], "publisher_modified": data["publisher_modified"], "freshness": "independent browser capture; HTTP refresh does not update this source"}
    manifest = {"owner": OWNER, "source": SOURCE, "inventory_url": INVENTORY, "source_version": VERSION, "retrieved_at": timestamp(), "inventory_sha256": digest(raw_inventory), "pages": pages, "specs": specs, "terms": terms, "counts": {"indexed": len(pages), "saved": sum(p["status"] == "saved" for p in pages), "failed": sum(p["status"] == "failed" for p in pages), "excluded": 0}, "exclusions": [], "unmapped_documentation_links": sorted(unresolved), "outside_scope_links": sorted(external_links), "embedded_asset_occurrences": embedded_assets, "removed_inventory_urls": removed}
    manifest["accepted_removal_reviews"] = previous.get("accepted_removal_reviews", [])
    write_json(manifest_path, manifest)
    return manifest


def common(parser):
    parser.add_argument("--json", action="store_true", help="Print one machine-readable JSON result")
    parser.add_argument("--no-input", action="store_true", help="Never prompt (all modes are noninteractive)")
    parser.add_argument("--quiet", action="store_true", help="Suppress human success detail")
    parser.add_argument("--verbose", action="store_true", help="Include public per-page status in results")
    parser.add_argument("--no-color", action="store_true", help="Disable human terminal colors")
    parser.add_argument("--dry-run", action="store_true", help="Validate options without network or filesystem changes")


def emit(result, args):
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    elif not args.quiet or not result.get("ok"):
        human = sys.stdout.isatty() and not args.no_input
        color = human and not args.no_color and "NO_COLOR" not in os.environ
        if human:
            print("Kroger official documentation — public sources only")
        start = ("\033[92m" if result.get("ok") else "\033[91m") if color else ""
        print(start + result["message"] + ("\033[0m" if color else ""))
        if "counts" in result:
            print(json.dumps(result["counts"], sort_keys=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__, epilog="Example: python scripts/fetch_docs.py --url https://developer.kroger.com --output research/official_docs --json")
    parser.add_argument("--url", required=True, help="Official source: https://developer.kroger.com")
    parser.add_argument("--output", required=True, type=Path, help="Empty or collector-owned mirror directory")
    parser.add_argument("--resume", action="store_true", help="Reuse hash-verified pages with unchanged article IDs")
    common(parser)
    args = parser.parse_args()
    code = EXIT_FAILURE
    try:
        if canonical(args.url) not in (SOURCE, SOURCE + "/"):
            raise ValueError("--url must be https://developer.kroger.com; use --help")
        if args.dry_run:
            result = {"ok": True, "message": "Options accepted; no files or network changed."}
        else:
            manifest = collect(args.output, args.resume)
            ok = not manifest["counts"]["failed"] and all(s["status"] == "saved" for s in manifest["specs"]) and manifest["terms"]["status"] == "saved" and not manifest["removed_inventory_urls"]
            result = {"ok": ok, "message": "Public documentation collected." if ok else "Collection needs review; inspect manifest failures, unmapped links and removed inventory URLs.", "counts": manifest["counts"]}
            if args.verbose:
                result["pages"] = [{"url": p["url"], "status": p["status"]} for p in manifest["pages"]]
        code = EXIT_SUCCESS if result["ok"] else EXIT_FAILURE
    except (ValueError, KeyError, TypeError, OSError) as error:
        result = {"ok": False, "message": str(error) if isinstance(error, ValueError) else "Collection input or local files are invalid; inspect the command contract and use --help."}
        code = EXIT_INPUT
    except KeyboardInterrupt:
        result = {"ok": False, "message": "Interrupted; preserve existing files and rerun with --resume."}
        code = 130
    emit(result, args)
    return code


if __name__ == "__main__":
    sys.exit(main())
