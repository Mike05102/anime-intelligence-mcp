"""Exercise the production quote check without deployment credentials or network."""
import ast
import base64
import io
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request

source = Path("supabase/maintenance/github_worker_release.py")
tree = ast.parse(source.read_text())
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                and node.name == "verify_unsigned_purchase")
jan = "4901234567894"
health = "https://fixture.invalid/v1/system/discovery-health"


accepts = [{"scheme": "exact"}]


def check(body, status=402, challenge=None):
    if challenge is None:
        challenge = {"x402Version": 2, "resource": {"url": "https://fixture.invalid/v1/purchase-decision?gtin=" + jan},
                     "accepts": accepts}
    header = base64.b64encode(json.dumps(challenge).encode()).decode()

    def fetch(request, *, timeout):
        assert timeout == 15
        assert request.full_url == "https://fixture.invalid/v1/purchase-decision?gtin=" + jan
        assert request.get_method() == "GET"
        assert request.get_header("Payment-signature") is None
        raise HTTPError(request.full_url, status, "", {"Payment-Required": header},
                        io.BytesIO(json.dumps({"accepts": accepts, **body}).encode()))

    scope = dict(health=health, smoke_jan=jan, Request=Request, HTTPError=HTTPError,
                 base64=base64, json=json, urlopen=fetch)
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), "exec"), scope)
    return scope["verify_unsigned_purchase"]()


preview = {"canonical_product_id": "fixture", "name": "Anime figure", "jan_code": jan}
assert check({"product_preview": preview})
assert not check({"product_preview": {**preview, "jan_code": "4901234567887"}})
assert not check({"product_preview": []})
assert not check({"product_preview": preview, "accepts": []})
assert not check({"product_preview": preview}, status=503)
assert not check({"product_preview": preview}, challenge=[])
assert not check({"product_preview": {**preview, "name": "x" * 17000}})
print("PASS unsigned deployment quote verification without network")
