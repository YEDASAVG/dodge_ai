"""
JSONL → SQLite ingestion for 19 SAP Order-to-Cash entity types.

Reads all *.jsonl files from each subfolder under DATA_DIR,
flattens nested time objects, deduplicates cancellations,
and creates indexed SQLite tables.
"""

import json
import sqlite3
from pathlib import Path

from config import DATA_DIR, DB_PATH

# ---------------------------------------------------------------------------
# Folder → table name mapping (folder names are already valid SQLite names)
# ---------------------------------------------------------------------------
ENTITY_FOLDERS = [
    "billing_document_cancellations",
    "billing_document_headers",
    "billing_document_items",
    "business_partner_addresses",
    "business_partners",
    "customer_company_assignments",
    "customer_sales_area_assignments",
    "journal_entry_items_accounts_receivable",
    "outbound_delivery_headers",
    "outbound_delivery_items",
    "payments_accounts_receivable",
    "plants",
    "product_descriptions",
    "product_plants",
    "product_storage_locations",
    "products",
    "sales_order_headers",
    "sales_order_items",
    "sales_order_schedule_lines",
]

# ---------------------------------------------------------------------------
# Indexes to create after ingestion (table → list of index column tuples)
# Covers all FK columns used in the relationship map.
# ---------------------------------------------------------------------------
INDEXES: dict[str, list[tuple[str, ...]]] = {
    "sales_order_headers": [("soldToParty",)],
    "sales_order_items": [("salesOrder",), ("material",), ("productionPlant",)],
    "sales_order_schedule_lines": [("salesOrder", "salesOrderItem")],
    "outbound_delivery_items": [
        ("deliveryDocument",),
        ("referenceSdDocument",),
        ("plant",),
    ],
    "billing_document_headers": [
        ("soldToParty",),
        ("companyCode", "fiscalYear", "accountingDocument"),
    ],
    "billing_document_items": [
        ("billingDocument",),
        ("referenceSdDocument",),
        ("material",),
    ],
    "journal_entry_items_accounts_receivable": [
        ("referenceDocument",),
        ("customer",),
        ("clearingAccountingDocument",),
        ("companyCode", "fiscalYear", "accountingDocument"),
    ],
    "payments_accounts_receivable": [
        ("customer",),
        ("companyCode", "fiscalYear", "accountingDocument"),
    ],
    "business_partner_addresses": [("businessPartner",)],
    "customer_company_assignments": [("customer",)],
    "customer_sales_area_assignments": [("customer",)],
    "product_descriptions": [("product",)],
    "product_plants": [("product",), ("plant",)],
    "product_storage_locations": [("product", "plant")],
}


def _flatten_record(record: dict) -> dict:
    """Flatten nested time objects like {hours: 6, minutes: 49, seconds: 13} → '06:49:13'."""
    flat = {}
    for key, value in record.items():
        if isinstance(value, dict) and "hours" in value and "minutes" in value:
            h = value.get("hours", 0) or 0
            m = value.get("minutes", 0) or 0
            s = value.get("seconds", 0) or 0
            flat[key] = f"{int(h):02d}:{int(m):02d}:{int(s):02d}"
        elif isinstance(value, bool):
            flat[key] = int(value)  # SQLite: 0/1
        else:
            flat[key] = value
    return flat


def _read_jsonl_folder(folder_path: Path) -> list[dict]:
    """Read and concatenate all *.jsonl files in a folder."""
    records = []
    for jsonl_file in sorted(folder_path.glob("*.jsonl")):
        with open(jsonl_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    records.append(_flatten_record(json.loads(line)))
    return records


def _create_table(conn: sqlite3.Connection, table_name: str, columns: list[str]):
    """Create table with all TEXT columns (SQLite is type-flexible anyway)."""
    col_defs = ", ".join(f'"{col}" TEXT' for col in columns)
    conn.execute(f'DROP TABLE IF EXISTS "{table_name}"')
    conn.execute(f'CREATE TABLE "{table_name}" ({col_defs})')


def _insert_records(conn: sqlite3.Connection, table_name: str, records: list[dict]):
    """Bulk insert records into table."""
    if not records:
        return
    columns = list(records[0].keys())
    placeholders = ", ".join("?" for _ in columns)
    col_names = ", ".join(f'"{c}"' for c in columns)
    sql = f'INSERT INTO "{table_name}" ({col_names}) VALUES ({placeholders})'
    rows = [tuple(r.get(c) for c in columns) for r in records]
    conn.executemany(sql, rows)


def _create_indexes(conn: sqlite3.Connection):
    """Create indexes on FK columns for query performance."""
    for table, idx_list in INDEXES.items():
        for cols in idx_list:
            idx_name = f"idx_{table}_{'_'.join(cols)}"
            col_str = ", ".join(f'"{c}"' for c in cols)
            conn.execute(
                f'CREATE INDEX IF NOT EXISTS "{idx_name}" ON "{table}" ({col_str})'
            )


def ingest(data_dir: Path | None = None, db_path: Path | None = None) -> dict[str, int]:
    """
    Main ingestion entry point.
    Returns dict of table_name → row_count.
    """
    data_dir = data_dir or DATA_DIR
    db_path = db_path or DB_PATH

    # Ensure parent directory exists
    db_path.parent.mkdir(parents=True, exist_ok=True)

    # Remove existing DB for clean rebuild
    if db_path.exists():
        db_path.unlink()

    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=OFF")  # Safe for write-once ingestion
    counts: dict[str, int] = {}

    try:
        # ---------------------------------------------------------------
        # Step 1: Ingest billing_document_headers first (need the PKs for dedup)
        # ---------------------------------------------------------------
        headers_records = _read_jsonl_folder(data_dir / "billing_document_headers")
        if headers_records:
            _create_table(conn, "billing_document_headers", list(headers_records[0].keys()))
            _insert_records(conn, "billing_document_headers", headers_records)
        header_pks = {r["billingDocument"] for r in headers_records}
        counts["billing_document_headers"] = len(headers_records)

        # Step 2: Merge cancellations — only add records NOT already in headers
        cancel_records = _read_jsonl_folder(data_dir / "billing_document_cancellations")
        new_cancels = [r for r in cancel_records if r["billingDocument"] not in header_pks]
        if new_cancels:
            _insert_records(conn, "billing_document_headers", new_cancels)
            counts["billing_document_headers"] += len(new_cancels)
        counts["billing_document_cancellations_skipped"] = len(cancel_records) - len(new_cancels)
        counts["billing_document_cancellations_added"] = len(new_cancels)
        conn.commit()

        # ---------------------------------------------------------------
        # Step 3: Ingest all other entity folders
        # ---------------------------------------------------------------
        skip = {"billing_document_headers", "billing_document_cancellations"}
        for folder_name in ENTITY_FOLDERS:
            if folder_name in skip:
                continue

            folder_path = data_dir / folder_name
            if not folder_path.is_dir():
                print(f"  WARN: folder not found: {folder_path}")
                counts[folder_name] = 0
                continue

            records = _read_jsonl_folder(folder_path)
            if not records:
                print(f"  WARN: no records in {folder_name}")
                counts[folder_name] = 0
                continue

            _create_table(conn, folder_name, list(records[0].keys()))
            _insert_records(conn, folder_name, records)
            conn.commit()
            counts[folder_name] = len(records)
            print(f"  {folder_name}: {len(records)} rows")

        # ---------------------------------------------------------------
        # Step 4: Create indexes
        # ---------------------------------------------------------------
        _create_indexes(conn)
        conn.commit()

        print(f"\n✅ Ingestion complete → {db_path}")
        print(f"   Total tables: {len([k for k in counts if not k.startswith('billing_document_cancellations_')])}")

    finally:
        conn.close()

    return counts


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print(f"Data dir: {DATA_DIR}")
    print(f"DB path:  {DB_PATH}\n")

    counts = ingest()

    print("\n--- Row Counts ---")
    for table, count in sorted(counts.items()):
        print(f"  {table}: {count}")
