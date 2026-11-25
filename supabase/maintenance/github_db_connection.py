import os
import re
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit


def connection_fields(value):
    value = value.strip()
    scheme, separator, rest = value.partition("://")
    userinfo, at, address = rest.rpartition("@")
    username, colon, password = userinfo.partition(":")
    if scheme not in ("postgres", "postgresql") or not separator or not at or not colon or not username:
        raise ValueError("Use the Supabase PostgreSQL Session pooler URI.")
    if re.fullmatch(r"\[?(?:your[-_ ]password|db[-_ ]password|password)\]?", unquote(password), re.I):
        raise ValueError("The connection still contains a password placeholder. Replace it in the GitHub secret.")
    try:
        url = urlsplit(f"postgresql://{address}")
        port = url.port or 5432
    except ValueError:
        raise ValueError("The connection host or port is invalid.") from None
    if (
        not url.hostname
        or not password
        or port != 5432
        or not url.hostname.endswith((".supabase.co", ".pooler.supabase.com"))
        or url.path != "/postgres"
        or url.fragment
        or parse_qs(url.query).get("sslmode") == ["disable"]
    ):
        raise ValueError("Use the Supabase Session pooler endpoint on port 5432 with a database password.")
    fields = dict(
        PGHOST=url.hostname,
        PGPORT="5432",
        PGDATABASE="postgres",
        PGUSER=unquote(username),
        PGPASSWORD=unquote(password),
        PGSSLMODE="verify-full",
        PGSSLROOTCERT="/private/root.crt",
    )
    if any("\n" in value or "\r" in value or "\0" in value for value in fields.values()):
        raise ValueError("Invalid PostgreSQL connection field.")
    return fields


def main():
    try:
        settings = connection_fields(os.environ.get("GPD33_DATABASE_URL", ""))
    except ValueError as error:
        raise SystemExit(str(error)) from None
    root = Path(os.environ["RUNNER_TEMP"]) / "gpd33-private"
    root.mkdir(mode=0o700, exist_ok=True)
    for filename, value in (
        ("db.env", "".join(f"{key}={value}\n" for key, value in settings.items())),
        ("root.crt", os.environ.get("GPD33_DB_CA_PEM") or Path("/etc/ssl/certs/ca-certificates.crt").read_text()),
    ):
        fd = os.open(root / filename, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as handle:
            handle.write(value)


if __name__ == "__main__":
    main()
