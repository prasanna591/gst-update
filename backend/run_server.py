import faulthandler
import multiprocessing
import os
from pathlib import Path

import uvicorn

from app.main import app

if __name__ == "__main__":
    multiprocessing.freeze_support()
    fault_path = Path(os.getenv("APPDATA") or Path.home()) / "GSTClientApp" / "backend_fault.log"
    fault_file = fault_path.open("a", encoding="utf-8")
    faulthandler.enable(file=fault_file, all_threads=True)
    uvicorn.run(app, host="127.0.0.1", port=8077, log_level="info")