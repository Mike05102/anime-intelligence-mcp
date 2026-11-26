"""Prepare a bounded, source-attributed catalogue identity batch."""

import argparse
from collections import defaultdict
import json
from pathlib import Path
import subprocess
from xml.etree.ElementTree import ParseError

from gpd33_bnf_edition import MAX_BYTES, prepare_edition
from gpd33_tw_cooker_audit import MAX_BYTES as MAX_TAIWAN_BYTES, preview


def prepare_batch(washers, cooker, books):
    if not washers and not cooker and not books:
        raise ValueError("At least one snapshot is required")
    if len(books) > 8:
        raise ValueError("Expected at most eight BnF snapshots")
    candidates = defaultdict(set)
    sources = []
    if washers:
        adapter = Path(__file__).with_name("gpd33_energy_star_washers.mjs")
        result = subprocess.run(["node", str(adapter), "--local-batch", str(washers)],
                                capture_output=True, check=True, timeout=15)
        report = json.loads(result.stdout)
        sources.append({"dataset": report["source_dataset"], "rows_seen": report["rows_seen"],
                        "accepted_rows": len(report["products"])})
        for item in report["products"]:
            candidates[item["gtin"]].add(json.dumps({
                "category": item["domain"], "source": report["source_url"],
                "brand": item["brand"], "model": item["model"],
                "record_id": item["source_record_id"], "market_countries": item["registered_market_countries"],
            }, sort_keys=True, ensure_ascii=False))
    if cooker:
        with cooker.open("rb") as snapshot:
            sources.append(preview(snapshot.read(MAX_TAIWAN_BYTES + 1)))
    if books:
        accepted = 0
        for isbn, path in books:
            with Path(path).open("rb") as snapshot:
                item = prepare_edition(snapshot.read(MAX_BYTES + 1), isbn)
            if item is None:
                continue
            accepted += 1
            candidates[item["isbn13"].zfill(14)].add(json.dumps({
                "category": item["domain"], "source": item["source_url"], "record_id": item["record_url"],
                "title": item["title"], "publisher": item["publisher"],
            }, sort_keys=True, ensure_ascii=False))
        sources.append({"dataset": "bnf_sru", "rows_seen": len(books), "accepted_rows": accepted})
    identities = []
    quarantined = []
    for gtin, records in sorted(candidates.items()):
        if len(records) != 1:
            quarantined.append(gtin)
        else:
            identities.append({"gtin": gtin, **json.loads(next(iter(records)))})
    return {"schema": "gpd-catalogue-identity-batch-v1", "scope": "identity_evidence_only",
            "sources": sources, "identities": identities, "conflicting_gtins": quarantined}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--washers", type=Path)
    parser.add_argument("--cooker", type=Path)
    parser.add_argument("--book", action="append", nargs=2, default=[], metavar=("ISBN", "XML"))
    args = parser.parse_args()
    try:
        batch = prepare_batch(args.washers, args.cooker, args.book)
    except (OSError, ValueError, ParseError, subprocess.SubprocessError) as error:
        parser.exit(1, f"Catalogue identity batch failed ({type(error).__name__}).\n")
    print(json.dumps(batch, ensure_ascii=False))


if __name__ == "__main__":
    main()
