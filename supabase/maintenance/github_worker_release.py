import base64
import hashlib
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
    resource_url = health.split("/v1/", 1)[0] + "/v1/purchase-decision"
    request = Request(resource_url + "?gtin=" + smoke_jan,
                      headers={"Accept": "application/json", "Cache-Control": "no-cache"})
    try:
        with urlopen(request, timeout=15):
            return False
    except HTTPError as response:
        with response:
            header = response.headers.get("Payment-Required", "")
            if response.code != 402 or response.url != request.full_url or not 0 < len(header) <= 12000:
                return False
            data = response.read(16385)
            if len(data) > 16384:
                return False
            challenge = json.loads(base64.b64decode(header, validate=True))
            body = json.loads(data)
            preview = body.get("product_preview") if isinstance(body, dict) else None
            if not isinstance(challenge, dict) or not isinstance(preview, dict):
                return False
            resource = challenge.get("resource")
            accepts = challenge.get("accepts")
            return (challenge.get("x402Version") == 2
                    and isinstance(resource, dict) and resource.get("url") == resource_url
                    and isinstance(accepts, list) and len(accepts) == 1 and body.get("accepts") == accepts
                    and preview.get("jan_code") == smoke_jan
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


def await_deployment(version):
    for attempt in range(8):
        try:
            if current() == version:
                return True
        except (RuntimeError, TimeoutError, ValueError):
            pass
        if attempt < 7:
            time.sleep(8)
    return False


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
source = Path("releases/GPD33_0_COMPLETE_WORKER.js").read_bytes()
build_id = "anime-" + hashlib.sha256(source).hexdigest()[:24]
source, replacements = re.subn(rb'^const BUILD_ID="[^"]+";', f'const BUILD_ID="{build_id}";'.encode(),
                               source, count=1, flags=re.MULTILINE)
if replacements != 1:
    raise SystemExit("Worker release build ID could not be stamped.")
boundary = uuid.uuid4().hex
parts = []
for name, mime, content in [
    ("metadata", "application/json", json.dumps(metadata).encode()),
    ("index.mjs", "application/javascript+module", source),
]:
    parts.extend([f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{name}\"\r\nContent-Type: {mime}\r\n\r\n".encode(), content, b"\r\n"])
parts.append(f"--{boundary}--\r\n".encode())
candidate = cf("/versions", b"".join(parts), f"multipart/form-data; boundary={boundary}")["id"]
uploaded = cf(f"/versions/{candidate}")["resources"]
if signature(uploaded) != signature(baseline) or current() != previous:
    raise SystemExit("Production bindings or active Worker changed. Activation withheld.")
try:
    activate(candidate)
except (RuntimeError, TimeoutError, ValueError):
    if not await_deployment(candidate):
        raise SystemExit("Worker activation outcome unconfirmed. Check the active Cloudflare deployment before retrying.") from None
for attempt in range(8):
    try:
        with urlopen(Request(health, headers={"Cache-Control": "no-cache"}), timeout=15) as response:
            status = json.load(response)
        if (isinstance(status, dict) and status.get("ok") is True
                and status.get("version") == "33.0.0" and status.get("build_id") == build_id
                and status.get("verified_catalog") is not None and current() == candidate):
            if smoke_jan and not verify_unsigned_purchase():
                raise ValueError("Unsigned purchase preview did not match")
            print(f"Worker 33.0.0 active with verified database coverage. build_id={build_id}")
            if smoke_jan:
                print("Unsigned catalogue product preview verified.")
            break
    except (HTTPError, URLError, TimeoutError, ValueError):
        pass
    time.sleep(8)
else:
    if current() == candidate:
        try:
            activate(previous)
        except (RuntimeError, TimeoutError, ValueError):
            pass
        if await_deployment(previous):
            raise SystemExit("Worker health check failed. Restored prior deployment confirmed by Cloudflare.")
        raise SystemExit("Worker health check failed. Cloudflare has not confirmed restoration of the prior deployment.")
    raise SystemExit("Worker health check failed and a different deployment is active.")
