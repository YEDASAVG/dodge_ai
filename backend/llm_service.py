"""LLM service — two-call Gemini pipeline for NL→SQL→Answer."""

import json
import re
import sqlite3
from typing import AsyncIterator

from google import genai

from config import DB_PATH, GEMINI_API_KEY
from guardrails import validate_sql
from prompts import build_answer_system_prompt, build_sql_system_prompt

# Ordered model fallback list — try each on 429/quota errors
MODEL_CANDIDATES = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3-flash-preview",
]

# Cache the system prompts
_sql_system_prompt: str | None = None
_answer_system_prompt: str | None = None


def _get_sql_prompt() -> str:
    global _sql_system_prompt
    if _sql_system_prompt is None:
        _sql_system_prompt = build_sql_system_prompt()
    return _sql_system_prompt


def _get_answer_prompt() -> str:
    global _answer_system_prompt
    if _answer_system_prompt is None:
        _answer_system_prompt = build_answer_system_prompt()
    return _answer_system_prompt


def _get_client() -> genai.Client:
    return genai.Client(api_key=GEMINI_API_KEY)


def _call_with_fallback(client: genai.Client, **kwargs) -> genai.types.GenerateContentResponse:
    """Try each model candidate until one succeeds (handles 429 quota errors)."""
    last_err = None
    for model in MODEL_CANDIDATES:
        try:
            return client.models.generate_content(model=model, **kwargs)
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "quota" in err_str.lower():
                last_err = e
                continue  # try next model
            raise
    raise last_err  # all models exhausted


def _execute_sql(sql: str) -> list[dict]:
    """Execute a SELECT query and return results as list of dicts."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(sql).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _extract_node_refs(sql: str, results: list[dict]) -> list[dict]:
    """Extract graph node references from query results."""
    refs = []
    seen = set()

    # Mapping of column names to node types
    col_type_map = {
        "salesOrder": "SalesOrder",
        "deliveryDocument": "Delivery",
        "billingDocument": "BillingDocument",
        "accountingDocument": "JournalEntry",
        "product": "Product",
        "material": "Product",
        "plant": "Plant",
        "businessPartner": "Customer",
        "customer": "Customer",
        "soldToParty": "Customer",
    }

    for row in results:
        for col, val in row.items():
            if val and col in col_type_map:
                node_type = col_type_map[col]
                key = f"{node_type}:{val}"
                if key not in seen:
                    seen.add(key)
                    refs.append({"type": node_type, "id": str(val)})

    return refs[:20]  # Limit to 20 references


async def process_message(message: str, history: list[dict]) -> AsyncIterator[str]:
    """Process a chat message through the NL→SQL→Answer pipeline.
    
    Yields SSE-formatted events:
      data: {"type": "status", "content": "..."}
      data: {"type": "sql", "content": "..."}
      data: {"type": "answer", "content": "..."}
      data: {"type": "nodes", "content": [...]}
      data: {"type": "error", "content": "..."}
      data: {"type": "done"}
    """
    client = _get_client()

    # --- Step 1: Generate SQL (with built-in guardrail) ---
    yield _sse({"type": "status", "content": "Analyzing question..."})

    # Build conversation for SQL generation
    sql_messages = []
    for h in history[-6:]:  # Last 3 exchanges
        sql_messages.append({"role": h["role"], "parts": [{"text": h["content"]}]})
    sql_messages.append({"role": "user", "parts": [{"text": message}]})

    try:
        sql_response = _call_with_fallback(
            client,
            contents=sql_messages,
            config=genai.types.GenerateContentConfig(
                system_instruction=_get_sql_prompt(),
                temperature=0.1,
            ),
        )
        raw_text = sql_response.text.strip()
    except Exception as e:
        yield _sse({"type": "error", "content": f"LLM call failed: {str(e)}"})
        yield _sse({"type": "done"})
        return

    # Parse the JSON response
    try:
        # Strip markdown code fences if present
        cleaned = re.sub(r"^```(?:json)?\s*", "", raw_text)
        cleaned = re.sub(r"\s*```$", "", cleaned)
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        yield _sse({"type": "error", "content": "Failed to parse LLM response."})
        yield _sse({"type": "done"})
        return

    # Check if off-topic
    if parsed.get("off_topic"):
        yield _sse({"type": "answer", "content": parsed.get("explanation", "This question is outside the scope of this system.")})
        yield _sse({"type": "done"})
        return

    sql = parsed.get("sql")
    if not sql:
        yield _sse({"type": "answer", "content": parsed.get("explanation", "Could not generate a query for this question.")})
        yield _sse({"type": "done"})
        return

    # --- Step 2: Validate SQL (code-based) ---
    is_valid, err = validate_sql(sql)
    if not is_valid:
        yield _sse({"type": "error", "content": f"Query validation failed: {err}"})
        yield _sse({"type": "done"})
        return

    yield _sse({"type": "sql", "content": sql})

    # --- Step 3: Execute SQL ---
    yield _sse({"type": "status", "content": "Running query..."})
    try:
        results = _execute_sql(sql)
    except Exception as e:
        yield _sse({"type": "error", "content": f"Query execution failed: {str(e)}"})
        yield _sse({"type": "done"})
        return

    # Extract node references
    node_refs = _extract_node_refs(sql, results)
    if node_refs:
        yield _sse({"type": "nodes", "content": node_refs})

    # --- Step 4: Compose answer (2nd LLM call) ---
    yield _sse({"type": "status", "content": "Composing answer..."})

    # Limit result size for LLM context
    result_str = json.dumps(results[:50], indent=2)
    answer_prompt = f"""User question: {message}

SQL query executed:
{sql}

Query results ({len(results)} rows{', showing first 50' if len(results) > 50 else ''}):
{result_str}"""

    try:
        answer_response = _call_with_fallback(
            client,
            contents=[{"role": "user", "parts": [{"text": answer_prompt}]}],
            config=genai.types.GenerateContentConfig(
                system_instruction=_get_answer_prompt(),
                temperature=0.3,
            ),
        )
        answer = answer_response.text.strip()
    except Exception as e:
        yield _sse({"type": "error", "content": f"Answer generation failed: {str(e)}"})
        yield _sse({"type": "done"})
        return

    yield _sse({"type": "answer", "content": answer})
    yield _sse({"type": "done"})


def _sse(data: dict) -> str:
    """Format as SSE event."""
    return f"data: {json.dumps(data)}\n\n"
