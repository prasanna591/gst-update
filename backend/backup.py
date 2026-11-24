import glob
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import zipfile
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy.engine import make_url

BASE = Path(__file__).resolve().parent
BACKUP_ROOT = BASE.parent / "backups"
UPLOADS = BASE / "uploads"
KEEP = 14

load_dotenv(BASE / ".env")


def find_pg_dump() -> str:
    found = shutil.which("pg_dump")
    if found:
        return found

    matches = glob.glob(r"C:\Program Files\PostgreSQL\*\bin\pg_dump.exe")
    if matches:
        def version(path: str) -> int:
            m = re.search(r"PostgreSQL\\(\d+)", path)
            return int(m.group(1)) if m else 0
        return max(matches, key=version)

    sys.exit(
        "pg_dump was not found. Install PostgreSQL command line tools, or add "
        r"C:\Program Files\PostgreSQL\<version>\bin to your PATH."
    )


def sqlite_source() -> Path | None:
    base = Path(os.getenv("APPDATA") or str(Path.home()))
    candidates = (
        base / "GSTClientApp" / "gst_client.db",
        Path.home() / "GSTClientApp" / "gst_client.db",
    )
    for path in candidates:
        if path.is_file():
            return path
    return None


def sqlite_backup(source: Path, folder: Path) -> Path:
    target = folder / "gst_client.db"
    with sqlite3.connect(source) as src, sqlite3.connect(target) as dst:
        src.backup(dst)
    return target


def zip_uploads(folder: Path) -> tuple[Path, int]:
    uploads_zip = folder / "uploads.zip"
    count = 0
    with zipfile.ZipFile(uploads_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        if UPLOADS.exists():
            for file in UPLOADS.rglob("*"):
                if file.is_file():
                    zf.write(file, file.relative_to(UPLOADS))
                    count += 1
    return uploads_zip, count


def rotate_backups():
    folders = sorted(p for p in BACKUP_ROOT.iterdir() if p.is_dir())
    for old in folders[:-KEEP]:
        shutil.rmtree(old, ignore_errors=True)


def report_success(folder: Path, dump_file: Path, uploads_zip: Path, count: int):
    mb = lambda p: f"{p.stat().st_size / (1024 * 1024):.2f} MB"
    print(f"[{datetime.now():%Y-%m-%d %H:%M}] Backup saved to {folder}")
    print(f"  {dump_file.name}  {mb(dump_file)}")
    print(f"  uploads.zip    {mb(uploads_zip)} ({count} files)")


def backup_sqlite(source: Path, folder: Path):
    folder.mkdir(parents=True, exist_ok=True)
    try:
        dump_file = sqlite_backup(source, folder)
        uploads_zip, count = zip_uploads(folder)
    except Exception as exc:
        shutil.rmtree(folder, ignore_errors=True)
        sys.exit(f"Database backup failed:\n{exc}")
    rotate_backups()
    report_success(folder, dump_file, uploads_zip, count)


def main():
    database_url = os.getenv("DATABASE_URL")
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    folder = BACKUP_ROOT / stamp

    if not database_url:
        source = sqlite_source()
        if not source:
            sys.exit("DATABASE_URL is missing and no installed SQLite database was found")
        backup_sqlite(source, folder)
        return

    url = make_url(database_url)

    if url.drivername.startswith("sqlite"):
        configured = Path(url.database) if url.database else None
        source = configured if configured and configured.is_file() else sqlite_source()
        if not source:
            sys.exit("SQLite database file was not found")
        backup_sqlite(source, folder)
        return

    if not url.drivername.startswith("postgresql"):
        sys.exit("This backup script is for PostgreSQL only.")
    if not url.database:
        sys.exit("DATABASE_URL is missing the database name")

    folder.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    if url.password:
        env["PGPASSWORD"] = url.password

    args = [
        find_pg_dump(),
        "-h", url.host or "localhost",
        "-p", str(url.port or 5432),
    ]
    if url.username:
        args += ["-U", url.username]
    args += ["-F", "c", "-f", str(folder / "database.dump"), url.database]

    result = subprocess.run(args, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        shutil.rmtree(folder, ignore_errors=True)
        sys.exit(f"Database backup failed:\n{result.stderr.strip()}")

    dump_file = folder / "database.dump"
    uploads_zip, count = zip_uploads(folder)
    rotate_backups()
    report_success(folder, dump_file, uploads_zip, count)


if __name__ == "__main__":
    main()
