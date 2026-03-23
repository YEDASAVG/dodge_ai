import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env")
load_dotenv(BASE_DIR / ".env")

DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR.parent / "sap-o2c-data")))
DB_PATH = Path(os.getenv("DB_PATH", str(BASE_DIR / "o2c.db")))
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
