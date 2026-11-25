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
try:
    prepare_edition(b'<!DOCTYPE doc SYSTEM "file:///private">' + sample, isbn)
except ValueError:
    pass
else:
    raise AssertionError("A DOCTYPE must be rejected")
print("PASS exact BnF ISBN/edition binding, ambiguity and bounded XML")
