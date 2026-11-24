import os
import sys
from pathlib import Path
from dotenv import load_dotenv


def _config_candidates() -> list[Path]:
    candidates: list[Path] = []
    if getattr(sys, "frozen", False):
        exe = Path(sys.executable).resolve()
        candidates.extend(
            (
                exe.parent / ".env",
                exe.parent.parent / ".env",
                exe.parent.parent.parent / ".env",
            )
        )
    else:
        here = Path(__file__).resolve().parent
        candidates.extend((here.parent / ".env", here.parent.parent / ".env"))
    appdata = os.getenv("APPDATA")
    if appdata:
        candidates.append(Path(appdata) / "GSTClientApp" / ".env")
    candidates.append(Path.home() / ".gstclientapp" / ".env")
    return candidates


CONFIG_CANDIDATES = _config_candidates()
CONFIG_PATH = next((path for path in CONFIG_CANDIDATES if path.exists()), None)

for candidate in CONFIG_CANDIDATES:
    if candidate.exists():
        load_dotenv(candidate, override=False)
        break
else:
    load_dotenv()

CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")


def is_configured() -> bool:
    return bool(
        CLIENT_ID
        and CLIENT_SECRET
        and not CLIENT_ID.startswith("PASTE")
        and not CLIENT_SECRET.startswith("PASTE")
    )
