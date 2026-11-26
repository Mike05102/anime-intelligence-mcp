"""Preview identifiers from Taiwan Energy Administration dataset 145129."""

import csv
import hashlib
import io
import json
import sys
import unicodedata

MAX_BYTES = 256 * 1024
DATASET = "https://data.gov.tw/en/datasets/145129"
EXPECTED_COLUMNS = ["項次", "公司中文全名", "型號", "標示熱效率", "能源效率等級", "核准日期"]


def preview(data):
    if not data or len(data) > MAX_BYTES:
        raise ValueError("Invalid CSV size")
    rows = csv.DictReader(io.StringIO(data.decode("utf-8-sig"), newline=""), strict=True)
    if rows.fieldnames != EXPECTED_COLUMNS:
        raise ValueError("Unexpected dataset columns")
    count = 0
    pairs = set()
    for row in rows:
        if None in row or any(value is None for value in row.values()):
            raise ValueError("Malformed dataset row")
        company, model = (unicodedata.normalize("NFC", row[key]).strip() for key in EXPECTED_COLUMNS[1:3])
        if not company or not model:
            raise ValueError("Missing registered company or model")
        count += 1
        pairs.add((company, model))
    if not count:
        raise ValueError("No registered models")
    return {
        "dataset": DATASET,
        "region": "TW",
        "category": "home_appliances",
        "license": "https://data.gov.tw/en/license",
        "evidence": "energy_label_registration",
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "rows": count,
        "company_model_pairs": len(pairs),
        "registered_company_names": len({company for company, _ in pairs}),
        "gtin_column": False,
        "offer_column": False,
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: gpd33_tw_cooker_audit.py <downloaded-official-csv>")
    try:
        with open(sys.argv[1], "rb") as source:
            report = preview(source.read(MAX_BYTES + 1))
    except (OSError, ValueError, csv.Error) as error:
        raise SystemExit(str(error)) from error
    print(json.dumps(report, ensure_ascii=False))
