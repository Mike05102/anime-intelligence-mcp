"""Prepare bibliographic identity evidence from a bounded BnF SRU snapshot."""

import argparse
import json
import re
from xml.etree import ElementTree

MAX_BYTES = 64 * 1024
SRU = "{http://www.loc.gov/zing/srw/}"
MARC = "{info:lc/xmlns/marcxchange-v2}"
SOURCE = "https://catalogue.bnf.fr/api/SRU"


def isbn13(value):
    digits = re.sub(r"[- ]", "", value or "")
    if not re.fullmatch(r"(?:978|979[1-9])[0-9]+", digits) or len(digits) != 13:
        return None
    return digits if sum(int(n) * (1 if i % 2 == 0 else 3) for i, n in enumerate(digits)) % 10 == 0 else None


def single_value(record, tag, code):
    fields = record.findall(f"{MARC}datafield[@tag='{tag}']/{MARC}subfield[@code='{code}']")
    if len(fields) != 1:
        return None
    value = (fields[0].text or "").strip()
    if value and len(value) <= 300 and not re.search(r"[\x00-\x1f\x7f]", value):
        return value
    return None


def prepare_edition(payload, expected_isbn):
    expected = isbn13(expected_isbn)
    if not expected:
        raise ValueError("Expected a checked ISBN-13")
    if not payload or len(payload) > MAX_BYTES:
        raise ValueError("Expected bounded SRU XML")
    source_text = payload.decode("utf-8", errors="strict")
    if "\x00" in source_text or re.search(r"<!\s*(?:DOCTYPE|ENTITY)", source_text, re.I):
        raise ValueError("External declarations are not supported")
    root = ElementTree.fromstring(source_text)
    if root.tag != f"{SRU}searchRetrieveResponse" or root.find(f"{SRU}diagnostics") is not None:
        raise ValueError("Expected a successful BnF SRU response")
    records = root.findall(f"{SRU}records/{SRU}record")
    if root.findtext(f"{SRU}numberOfRecords") != "1" or len(records) != 1:
        return None
    entries = records[0].findall(f"{SRU}recordData/{MARC}record")
    if len(entries) != 1:
        return None
    edition = entries[0]
    ark = edition.get("id", "")
    if edition.get("format") != "UNIMARC" or edition.get("type") != "Bibliographic" or not re.fullmatch(
        r"ark:/12148/cb[0-9a-z]{5,24}", ark
    ):
        return None
    title = single_value(edition, "200", "a")
    publisher = single_value(edition, "210", "c") or single_value(edition, "214", "c")
    if isbn13(single_value(edition, "010", "a")) != expected or not title or not publisher:
        return None
    return {
        "schema": "gpd-bnf-edition-evidence-v1",
        "scope": "bibliographic_identity_only",
        "domain": "books_media",
        "source_url": SOURCE,
        "record_url": f"https://catalogue.bnf.fr/{ark}",
        "isbn13": expected,
        "title": title,
        "publisher": publisher,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("isbn")
    parser.add_argument("snapshot")
    args = parser.parse_args()
    try:
        with open(args.snapshot, "rb") as snapshot:
            result = prepare_edition(snapshot.read(MAX_BYTES + 1), args.isbn)
    except (OSError, ValueError, ElementTree.ParseError):
        parser.exit(1, "Unable to read the bounded BnF edition snapshot.\n")
    print(json.dumps({"edition": result}, ensure_ascii=False))


if __name__ == "__main__":
    main()
