import base64
import json
import os
import re
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

token = os.environ.get("CLOUDFLARE_API_TOKEN")
account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
if not token or not re.fullmatch(r"[a-fA-F0-9]{32}", account):
    raise SystemExit("Existing Cloudflare Worker deployment credentials are required.")

endpoint = f"https://api.cloudflare.com/client/v4/accounts/{account}/workers/scripts/anime-intelligence"
health = "https://anime-intelligence.goodmy0312.workers.dev/v1/system/discovery-health"


smoke_jan = os.environ.get("GPD33_RELEASE_SMOKE_JAN", "")
if smoke_jan and not re.fullmatch(r"(45|49)[0-9]{11}", smoke_jan):
    raise SystemExit("Release smoke JAN must be a 13-digit Japanese catalogue identifier.")


def verify_unsigned_purchase():
    request = Request(health.split("/v1/", 1)[0] + "/v1/purchase-decision?gtin=" + smoke_jan,
                      headers={"Accept": "application/json", "Cache-Control": "no-cache"})
    try:
        with urlopen(request, timeout=15):
            return False
    except HTTPError as response:
        with response:
            if response.code != 402 or not response.headers.get("Payment-Required"):
                return False
            data = response.read(16385)
            if len(data) > 16384:
                return False
            challenge = json.loads(base64.b64decode(response.headers["Payment-Required"], validate=True))
            preview = json.loads(data).get("product_preview") or {}
            return (challenge.get("x402Version") == 2 and preview.get("jan_code") == smoke_jan
                    and bool(preview.get("canonical_product_id")) and bool(preview.get("name")))


def cf(path, data=None, content_type="application/json"):
    request = Request(endpoint + path, data=data, headers={
        "Authorization": f"Bearer {token}", "Content-Type": content_type,
    })
    try:
        with urlopen(request, timeout=45) as response:
            result = json.load(response)
    except (HTTPError, URLError):
        raise RuntimeError(f"Cloudflare operation failed for {path.split('/')[1]}.") from None
    if not result.get("success"):
        raise RuntimeError("Cloudflare operation returned an unsuccessful status.")
    return result["result"]


def current():
    versions = cf("/deployments")["deployments"][0]["versions"]
    if len(versions) != 1 or versions[0]["percentage"] != 100:
        raise RuntimeError("Current Worker rollout is split across versions.")
    return versions[0]["version_id"]


def activate(version):
    cf("/deployments", json.dumps({"strategy": "percentage",
        "versions": [{"version_id": version, "percentage": 100}]}).encode())


def signature(resources):
    return sorted((binding["name"], binding["type"]) for binding in resources["bindings"])


previous = current()
baseline = cf(f"/versions/{previous}")["resources"]
runtime = baseline["script_runtime"]
metadata = {
    "main_module": "index.mjs",
    "keep_bindings": sorted({kind for _, kind in signature(baseline)}),
    "compatibility_date": runtime["compatibility_date"],
    "compatibility_flags": runtime.get("compatibility_flags", []),
}
boundary = uuid.uuid4().hex
parts = []
for name, mime, content in [
    ("metadata", "application/json", json.dumps(metadata).encode()),
    ("index.mjs", "application/javascript+module", Path("releases/GPD33_0_COMPLETE_WORKER.js").read_bytes()),
]:
    parts.extend([f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{name}\"\r\nContent-Type: {mime}\r\n\r\n".encode(), content, b"\r\n"])
parts.append(f"--{boundary}--\r\n".encode())
candidate = cf("/versions", b"".join(parts), f"multipart/form-data; boundary={boundary}")["id"]
uploaded = cf(f"/versions/{candidate}")["resources"]
if signature(uploaded) != signature(baseline) or current() != previous:
    raise SystemExit("Production bindings or active Worker changed. Activation withheld.")
activate(candidate)
for attempt in range(8):
    try:
        with urlopen(Request(health, headers={"Cache-Control": "no-cache"}), timeout=15) as response:
            status = json.load(response)
        if status.get("version") == "33.0.0" and status.get("verified_catalog") is not None:
            if smoke_jan and not verify_unsigned_purchase():
                raise ValueError("Unsigned purchase preview did not match")
            print("Worker 33.0.0 active with verified database coverage.")
            if smoke_jan:
                print("Unsigned catalogue product preview verified.")
            break
    except (HTTPError, URLError, TimeoutError, ValueError):
        pass
    time.sleep(8)
else:
    if current() == candidate:
        activate(previous)
        raise SystemExit("Worker health check failed. Prior version reactivated.")
    raise SystemExit("Worker health check failed and a different deployment is active.")
