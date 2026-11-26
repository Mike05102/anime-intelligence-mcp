import json
import os
import re
import sys
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from github_db_connection import connection_fields

supplied = os.environ.get("DISK_FREE_BYTES", "0")
token = os.environ.get("SUPABASE_ACCESS_TOKEN")
if token:
    db = connection_fields(os.environ["GPD33_DATABASE_URL"])
    project = db["PGUSER"].split(".")[-1] if ".pooler." in db["PGHOST"] else db["PGHOST"].split(".")[1]
    if not re.fullmatch(r"[a-z0-9]{20}", project):
        raise SystemExit("Cannot identify Supabase disk metrics for the configured connection.")
    try:
        req = Request(f"https://api.supabase.com/v1/projects/{project}/config/disk/util",
                      headers={"Authorization": f"Bearer {token}"})
        with urlopen(req, timeout=20) as response:
            data = json.load(response)
        sample = datetime.fromisoformat(data["timestamp"].replace("Z", "+00:00"))
        if not 0 <= (datetime.now(timezone.utc) - sample).total_seconds() <= 900:
            raise ValueError("stale")
        supplied = str(int(data["metrics"]["fs_avail_bytes"]))
    except Exception:
        if not re.fullmatch(r"[1-9][0-9]{0,9}", supplied):
            raise SystemExit("The live Supabase disk sample was unavailable or stale.") from None
        print("Live disk telemetry unavailable. Using the operator-supplied recent measurement.", file=sys.stderr)
if not re.fullmatch(r"[1-9][0-9]{0,9}", supplied):
    raise SystemExit("A verified positive free-disk measurement is required.")
print(supplied)
