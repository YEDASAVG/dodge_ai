"""SQL guardrails — code-level validation (not LLM-based)."""

import re
import sqlite3
from config import DB_PATH

# Known tables in our database — loaded eagerly at import to avoid race conditions
ALLOWED_TABLES: set[str] = set()


def _load_tables() -> None:
    global ALLOWED_TABLES
    if ALLOWED_TABLES:
        return
    try:
        conn = sqlite3.connect(str(DB_PATH))
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        ALLOWED_TABLES = {r[0].lower() for r in rows}
        conn.close()
    except Exception:
        pass  # DB may not exist yet during ingestion


# Load immediately so concurrent requests don't race
_load_tables()


def validate_sql(sql: str) -> tuple[bool, str]:
    """Validate SQL is safe to execute. Returns (is_valid, error_message)."""
    _load_tables()
    s = sql.strip().rstrip(";")

    # Block multiple statements (semicolons)
    if ";" in s:
        return False, "Multiple statements are not allowed."

    # Must be a SELECT statement
    if not re.match(r"^\s*SELECT\b", s, re.IGNORECASE):
        return False, "Only SELECT queries are allowed."

    # Block write operations anywhere in the statement
    write_patterns = r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|ATTACH|DETACH)\b"
    if re.search(write_patterns, s, re.IGNORECASE):
        return False, "Write operations are not allowed."

    # Block dangerous pragmas and functions
    if re.search(r"\bPRAGMA\b", s, re.IGNORECASE):
        return False, "PRAGMA statements are not allowed."
    if re.search(r"\b(load_extension|writefile|readfile|fts\d)\s*\(", s, re.IGNORECASE):
        return False, "Dangerous functions are not allowed."

    # Verify referenced tables exist
    # Extract table names after FROM and JOIN keywords
    table_refs = re.findall(r"\b(?:FROM|JOIN)\s+(\w+)", s, re.IGNORECASE)
    for t in table_refs:
        if t.lower() not in ALLOWED_TABLES:
            return False, f"Unknown table: {t}"

    return True, ""
