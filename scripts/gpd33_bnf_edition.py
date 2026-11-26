"""Prepare bibliographic identity evidence from a bounded BnF SRU snapshot."""

import argparse
import json
import re
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener
from xml.etree import ElementTree

MAX_BATCH = 8
MAX_BYTES = 64 * 1024
SRU = "{http://www.loc.gov/zing/srw/}"
MARC = "{info:lc/xmlns/marcxchange-v2}"
SOURCE = "https://catalogue.bnf.fr/api/SRU"


def isbn13(value):
    digits = re.sub(r"[- ]", "", value or "")
    if not re.fullmatch(r"(?:978|979[1-9])[0-9]+", digits) or len(digits) != 13:
        return None
    return digits if sum(int(n) * (1 if i % 2 == 0 else 3) for i, n in enumerate(digits)) % 10 == 0 else None


def single_value(record, tag, code, indicator=None):
    role = f"[@ind2='{indicator}']" if indicator is not None else ""
    fields = record.findall(f"{MARC}datafield[@tag='{tag}']{role}/{MARC}subfield[@code='{code}']")
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
    legacy_publisher = single_value(edition, "210", "c")
    publication = single_value(edition, "214", "c", indicator="0")
    if publication and legacy_publisher and publication != legacy_publisher:
        return None
    publisher = publication or legacy_publisher
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


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def read_edition(expected_isbn, opener=None):
    expected = isbn13(expected_isbn)
    if not expected:
        raise ValueError("Expected a checked ISBN-13")
    query = urlencode({
        "version": "1.2", "operation": "searchRetrieve", "query": f'bib.isbn adj "{expected}"',
        "maximumRecords": "2", "recordSchema": "unimarcXchange",
    })
    url = f"{SOURCE}?{query}"
    request = Request(url, headers={"Accept": "application/xml, text/xml", "Accept-Encoding": "identity"})
    open_url = opener if opener is not None else build_opener(NoRedirect()).open
    with open_url(request, timeout=8) as response:
        if (response.status != 200 or response.geturl() != url
                or response.headers.get_content_type() not in ("application/xml", "text/xml")
                or response.headers.get("Content-Encoding", "identity").lower() != "identity"):
            raise ValueError("Unexpected BnF SRU response")
        claimed = response.headers.get("Content-Length")
        if claimed is not None and (not re.fullmatch(r"[0-9]{1,10}", claimed) or int(claimed) > MAX_BYTES):
            raise ValueError("Expected bounded SRU XML")
        payload = response.read(MAX_BYTES + 1)
        if claimed is not None and int(claimed) != len(payload):
            raise ValueError("Incomplete BnF SRU response")
    return prepare_edition(payload, expected)


def read_editions(values, reader=read_edition):
    if not 1 <= len(values) <= MAX_BATCH:
        raise ValueError("Expected one to eight ISBNs")
    checked = [isbn13(value) for value in values]
    if any(value is None for value in checked):
        raise ValueError("Expected only checked ISBN-13 values")
    identifiers = list(dict.fromkeys(checked))
    editions = []
    unresolved = []
    for identifier in identifiers:
        edition = reader(identifier)
        if edition is None:
            unresolved.append(identifier)
        else:
            editions.append(edition)
    return {"scope": "bibliographic_identity_only", "identifiers_requested": len(identifiers),
            "duplicate_inputs": len(values) - len(identifiers), "editions": editions,
            "unresolved_isbns": unresolved}


def main():
    import sys

    if sys.argv[1:2] == ["--read-batch"]:
        try:
            report = read_editions(sys.argv[2:])
        except (OSError, ValueError, ElementTree.ParseError):
            raise SystemExit("Unable to read the bounded BnF edition batch.")
        print(json.dumps(report, ensure_ascii=False))
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("isbn")
    parser.add_argument("snapshot", nargs="?")
    parser.add_argument("--read", action="store_true", help="Perform one read from the public BnF API")
    args = parser.parse_args()
    if args.read == bool(args.snapshot):
        parser.error("Choose one local snapshot or --read")
    try:
        if args.read:
            result = read_edition(args.isbn)
        else:
            with open(args.snapshot, "rb") as snapshot:
                result = prepare_edition(snapshot.read(MAX_BYTES + 1), args.isbn)
    except (OSError, ValueError, ElementTree.ParseError):
        parser.exit(1, "Unable to read the bounded BnF edition snapshot.\n")
    print(json.dumps({"edition": result}, ensure_ascii=False))


if __name__ == "__main__":
    main()
