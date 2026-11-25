import os
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

try:
    url = urlsplit(os.environ.get("GPD33_DATABASE_URL", ""))
    port = url.port or 5432
except ValueError:
    raise SystemExit("Invalid PostgreSQL connection URI.") from None
if (
    url.scheme not in ("postgres", "postgresql")
    or not url.hostname
    or not url.username
    or not url.password
    or port != 5432
    or not url.hostname.endswith((".supabase.co", ".pooler.supabase.com"))
    or url.path != "/postgres"
    or parse_qs(url.query).get("sslmode") == ["disable"]
):
    raise SystemExit("Configure the existing Supabase direct or session-pooler connection in GPD33_DATABASE_URL.")
settings = dict(
    PGHOST=url.hostname,
    PGPORT="5432",
    PGDATABASE="postgres",
    PGUSER=unquote(url.username),
    PGPASSWORD=unquote(url.password),
    PGSSLMODE="verify-full",
    PGSSLROOTCERT="/private/root.crt",
)
if any("\n" in value or "\r" in value or "\0" in value for value in settings.values()):
    raise SystemExit("Invalid PostgreSQL connection field.")
root = Path(os.environ["RUNNER_TEMP"]) / "gpd33-private"
root.mkdir(mode=0o700, exist_ok=True)
for filename, value in (
    ("db.env", "".join(f"{key}={value}\n" for key, value in settings.items())),
    ("root.crt", os.environ.get("GPD33_DB_CA_PEM") or Path("/etc/ssl/certs/ca-certificates.crt").read_text()),
):
    fd = os.open(root / filename, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(value)
