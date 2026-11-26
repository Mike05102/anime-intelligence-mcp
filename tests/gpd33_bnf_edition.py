from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from gpd33_bnf_edition import prepare_edition

isbn = "9782070612758"
sample = """<searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/">
<numberOfRecords>1</numberOfRecords><records><record><recordData>
<record xmlns="info:lc/xmlns/marcxchange-v2" format="UNIMARC" type="Bibliographic" id="ark:/12148/cb123456789">
<datafield tag="010"><subfield code="a">978-2-07-061275-8</subfield><subfield code="d">5 EUR</subfield></datafield>
<datafield tag="200"><subfield code="a">Titre du livre</subfield></datafield>
<datafield tag="210"><subfield code="c">Éditeur exemple</subfield></datafield>
</record></recordData></record></records></searchRetrieveResponse>""".encode()

assert prepare_edition(sample, isbn) == {
    "schema": "gpd-bnf-edition-evidence-v1", "scope": "bibliographic_identity_only",
    "domain": "books_media", "source_url": "https://catalogue.bnf.fr/api/SRU",
    "record_url": "https://catalogue.bnf.fr/ark:/12148/cb123456789", "isbn13": isbn,
    "title": "Titre du livre", "publisher": "Éditeur exemple",
}
assert prepare_edition(sample.replace(b">1</", b">2</"), isbn) is None
assert prepare_edition(sample.replace(b'code="a">978-', b'code="z">978-'), isbn) is None
assert prepare_edition(sample.replace(b'code="d">5 EUR', b'code="a">978-2-07-061275-8'), isbn) is None
assert prepare_edition(sample.replace(b"061275-8", b"061275-9"), isbn) is None
assert prepare_edition(sample.replace(b'ark:/12148/cb123456789', b'https://example.org'), isbn) is None
modern = sample.replace(
    '<datafield tag="210"><subfield code="c">Éditeur exemple</subfield></datafield>'.encode(),
    '<datafield tag="214" ind2="0"><subfield code="c">Éditeur exemple</subfield></datafield>'
    '<datafield tag="214" ind2="3"><subfield code="c">Imprimeur exemple</subfield></datafield>'.encode()
)
assert prepare_edition(modern, isbn)["publisher"] == "Éditeur exemple"
assert prepare_edition(modern.replace(b'ind2="0"', b'ind2="2"'), isbn) is None
try:
    prepare_edition(b'<!DOCTYPE doc SYSTEM "file:///private">' + sample, isbn)
except ValueError:
    pass
else:
    raise AssertionError("A DOCTYPE must be rejected")
print("PASS exact BnF ISBN/edition binding, ambiguity and bounded XML")

from email.message import Message
from io import BytesIO
from urllib.parse import parse_qs, urlsplit
from gpd33_bnf_edition import MAX_BYTES, read_edition


def response_for(request, timeout, status=200, body=sample, moved=False):
    assert timeout == 8
    url = urlsplit(request.full_url)
    assert url.scheme == "https" and url.hostname == "catalogue.bnf.fr" and url.path == "/api/SRU"
    assert parse_qs(url.query)["query"] == [f'bib.isbn adj "{isbn}"']
    assert request.get_method() == "GET"
    stream = BytesIO(body)
    stream.status = status
    stream.geturl = lambda: request.full_url + ("&moved=1" if moved else "")
    stream.headers = Message()
    stream.headers["Content-Type"] = "application/xml"
    stream.headers["Content-Length"] = str(len(body))
    return stream


assert read_edition(isbn, response_for)["isbn13"] == isbn
for bad in ({"status": 302}, {"body": b"x" * (MAX_BYTES + 1)}, {"moved": True}):
    try:
        read_edition(isbn, lambda request, timeout: response_for(request, timeout, **bad))
    except ValueError:
        pass
    else:
        raise AssertionError("Unexpected SRU response must not be accepted")
print("PASS read-only BnF transport, parameter binding and response bounds")


from gpd33_bnf_edition import read_editions

seen = []
def batch_reader(value):
    seen.append(value)
    return {"isbn13": value} if value == isbn else None

batch = read_editions([isbn, "978-2-07-061275-8", "9782413088882"], batch_reader)
assert seen == [isbn, "9782413088882"]
assert batch["duplicate_inputs"] == 1
assert batch["editions"] == [{"isbn13": isbn}]
assert batch["unresolved_isbns"] == ["9782413088882"]
try:
    read_editions([isbn, "invalid"], batch_reader)
except ValueError:
    assert len(seen) == 2
else:
    raise AssertionError("Invalid ISBN admitted")
