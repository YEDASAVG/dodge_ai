# Dodge AI — SAP O2C Knowledge Graph

Interactive knowledge-graph explorer for SAP Order-to-Cash data. Visualise entity relationships with a force-directed canvas and ask natural-language questions powered by Google Gemini.

**Live Demo**: [dodge-ai-zkhs.onrender.com](https://dodge-ai-zkhs.onrender.com)

![React 19](https://img.shields.io/badge/React-19-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green)
![NetworkX](https://img.shields.io/badge/NetworkX-3.6-orange)
![Gemini](https://img.shields.io/badge/Gemini-2.5--flash-purple)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4)

---

## Features

- **Force-directed graph** — 2D canvas rendering via `react-force-graph-2d` with chain highlighting and zoom-to-fit
- **Expand on demand** — click/double-click any node to fetch its neighbors and grow the graph
- **Natural-language chat** — ask questions about the data; Gemini converts them to SQL and returns formatted answers
- **Node type filtering** — toggle visibility of SalesOrder, Delivery, BillingDocument, JournalEntry, Customer, Product, Plant
- **Search** — fuzzy node search with instant results
- **Stratified sampling** — initial view loads a representative 150-node sample from the full 593-node graph
- **Graph ↔ Chat bidirection** — click node pills in chat answers to locate them on the graph; click graph nodes to "Ask chat about this"

---

## Architecture Decisions

### High-Level Data Flow

```
19 JSONL folders ──► SQLite (18 tables) ──► NetworkX DiGraph (593 nodes, 1 356 edges)
                           │                           │
                           ▼                           ▼
                    Gemini NL→SQL pipeline      Force-directed graph UI
                           │                           │
                           └──────── FastAPI ◄──────────┘
                                       │
                                React + Vite SPA (served as static files)
```

### Why This Stack

| Decision | Rationale |
|----------|-----------|
| **Single-process Docker** | FastAPI serves both the REST/SSE API and the built React SPA from one container. This avoids CORS complexity and simplifies deployment to a single Render web service. |
| **In-memory graph (NetworkX)** | The O2C dataset is 593 nodes / 1,356 edges — small enough to hold entirely in memory. NetworkX gives instant traversal, neighbor lookups, and subgraph extraction without query overhead. A graph database (Neo4j) would be overkill and add infrastructure cost. |
| **Two separate data stores** | SQLite handles the *relational* queries from the LLM (SQL is the natural interface for structured SAP data). NetworkX handles the *graph* queries (neighbor expansion, stratified sampling, path tracing). Each tool is used for what it's best at. |
| **Server-Sent Events (SSE) via POST** | The chat endpoint streams incremental status updates → SQL → answer → node references. POST is required because the request body carries message history. Browser `EventSource` only supports GET, so we use `fetch()` + `ReadableStream` on the frontend. |
| **Model fallback chain** | Gemini free tier has a 15 RPM limit. The backend tries `gemini-2.5-flash` → `gemini-2.5-flash-lite` → `gemini-3-flash-preview`, falling back on 429/quota errors to maximize availability at zero cost. |
| **Items as edge metadata** | SAP line items (sales_order_items, delivery_items, billing_items) are *not* modeled as graph nodes. Making them nodes would balloon the graph to thousands of nodes and obscure the business flow. Instead, items are used to derive edges between header-level entities (e.g., Delivery → SalesOrder is derived via `delivery_items.referenceSdDocument`). |

### Node & Edge Model

**7 node types:** SalesOrder · Delivery · BillingDocument · JournalEntry · Customer · Product · Plant  
**10 edge types:** soldToParty · orderedProduct · productionPlant · hasDelivery · deliveryPlant · hasBilling · billedTo · billedProduct · hasJournalEntry · journalCustomer

Key indirect relationships that required item-table JOINs:
- Sales Order → Delivery: via `outbound_delivery_items.referenceSdDocument`
- Delivery → Billing Document: via `billing_document_items.referenceSdDocument`
- Billing → Journal Entry: 3-field composite FK (`companyCode` + `fiscalYear` + `accountingDocument`)

---

## Database Choice: SQLite

### Why SQLite over PostgreSQL / MySQL / MongoDB

| Factor | SQLite Wins |
|--------|-------------|
| **Zero infrastructure** | Single `o2c.db` file, no server process, works inside Docker with no additional services |
| **Read-heavy workload** | After one-time ingestion, the database is 100% read-only. SQLite excels here with `PRAGMA journal_mode=WAL`. |
| **Dataset size** | 18 tables from 19 JSONL folders, ~1.6 MB total. Well within SQLite's sweet spot. |
| **LLM compatibility** | SQLite SQL dialect is simple and well-represented in Gemini's training data, leading to higher quality generated queries |
| **Portability** | The DB ships with the Docker image — no connection strings, no migrations, no env-specific setup |
| **Cost** | Free. No managed database service needed. |

### Ingestion Pipeline

```
19 JSONL folders → read with glob("*.jsonl") → flatten nested time objects →
  deduplicate cancellations against headers → INSERT into 18 SQLite tables →
  create composite indexes on all FK columns → PRAGMA optimize
```

Notable data handling:
- **Time flattening**: SAP `creationTime` fields are `{hours, minutes, seconds}` objects → converted to `"HH:MM:SS"` strings
- **Cancellation dedup**: `billing_document_cancellations` is a pre-filtered subset of `billing_document_headers` → only insert records whose PK doesn't already exist in headers
- **Payments = Journal Entries**: `payments_accounts_receivable` and `journal_entry_items_accounts_receivable` share the same `accountingDocument` values (same underlying AR postings from different API views) → payment fields are merged onto JournalEntry nodes instead of creating a separate Payment node type

---

## LLM Prompting Strategy

The chat feature uses a **two-call pipeline** with Google Gemini:

### Call 1: NL → SQL Generation (with built-in off-topic guardrail)

The system prompt includes:
1. **Auto-generated DDL** — `CREATE TABLE` statements read from the live database at startup, so the prompt always matches the actual schema
2. **Relationship documentation** — explains the indirect JOINs (item-table links, composite FKs) that the LLM wouldn't know from DDL alone
3. **Business rules** — e.g., "cancelled billing ≠ missing billing", "`CAST(totalNetAmount AS REAL)` since all columns are TEXT"
4. **Off-topic guardrail** (prompt-level) — instructs the model to return `{"off_topic": true}` for non-O2C questions
5. **4 few-shot examples** — covering the 3 required queries (top products by billing, trace billing flow, broken flows) plus one off-topic example

**Temperature**: 0.1 (near-deterministic SQL generation)

### Call 2: SQL Results → Natural Language Answer

A separate Gemini call receives the user's question, the SQL that ran, and the query results (capped at 50 rows). It composes a human-readable answer referencing specific document IDs, counts, and amounts.

**Temperature**: 0.3 (allows slightly more natural phrasing)

### Conversation History

The last 3 user/assistant exchanges (6 messages) are forwarded to Call 1, enabling follow-up questions like "show me more details on that order" without re-stating context.

---

## AI Guardrails

The system implements **defense in depth** — multiple independent layers that each block a different class of misuse:

### Layer 1: Prompt-Level Guardrail (LLM-based)

The system prompt instructs Gemini to return `{"off_topic": true}` for questions unrelated to O2C data. This handles:
- General knowledge questions ("What is the weather?")
- Requests to ignore instructions or act as a different system
- Questions about unrelated databases or systems

### Layer 2: Code-Level SQL Validation (`guardrails.py`)

After the LLM generates SQL, it passes through strict programmatic validation **before execution**:

| Check | What It Blocks |
|-------|---------------|
| **SELECT-only** | Rejects any query not starting with `SELECT` |
| **No semicolons** | Blocks multi-statement injection (`SELECT 1; DROP TABLE...`) |
| **No write keywords** | Regex blocks `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `TRUNCATE`, `REPLACE`, `ATTACH`, `DETACH` anywhere in the query |
| **No PRAGMA** | Blocks `PRAGMA` statements that could modify database behavior |
| **No dangerous functions** | Regex blocks `load_extension()`, `writefile()`, `readfile()`, `fts*()` — SQLite functions that can access the filesystem |
| **Table allowlist** | Extracts table names from `FROM`/`JOIN` clauses and verifies each exists in the actual database. Rejects queries against unknown tables. |

### Layer 3: Concurrency Limiter

`asyncio.Semaphore(3)` on the chat endpoint — max 3 concurrent LLM calls. Returns HTTP 429 if exceeded. Prevents quota exhaustion and abuse.

### Layer 4: Read-Only Database Access

- SQLite is opened in read-only mode for query execution
- `PRAGMA journal_mode=WAL` set during ingestion (read-optimized)
- No write paths exist in the chat/query pipeline

### What the Guardrails Catch (examples)

```
✅ "SELECT salesOrder FROM sales_order_headers LIMIT 10"  →  PASS
❌ "SELECT 1; DROP TABLE sales_order_headers"              →  BLOCKED (semicolons)
❌ "INSERT INTO sales_order_headers VALUES (...)"           →  BLOCKED (write keyword)
❌ "SELECT load_extension('/tmp/evil.so')"                  →  BLOCKED (dangerous function)
❌ "PRAGMA table_info(sales_order_headers)"                 →  BLOCKED (PRAGMA)
❌ "SELECT * FROM hacked_table"                             →  BLOCKED (unknown table)
❌ "What is the weather today?"                             →  OFF-TOPIC (prompt guardrail)
```

---

## Quick Start

### Prerequisites

| Tool | Version |
|------|---------|
| Python | 3.11+ |
| Node.js | 18+ |
| Gemini API key | [Get one free](https://aistudio.google.com/apikey) |

### 1. Clone & install

```bash
git clone https://github.com/<your-org>/dodge-graph.git
cd dodge-graph

# Python deps
pip install -r requirements.txt
pip install python-dotenv

# Frontend deps
cd frontend && npm install && cd ..
```

### 2. Data setup

Place the SAP O2C JSONL data in a `sap-o2c-data/` folder next to the project (sibling directory). The backend auto-ingests these into `o2c.db` on first startup.

```
parent-folder/
├── dodge-graph/      ← this repo
└── sap-o2c-data/     ← JSONL source files
    ├── sales_order_headers/
    ├── outbound_delivery_headers/
    ├── billing_document_headers/
    └── ...
```

Or set the `DATA_DIR` environment variable to point to your data folder.

### 3. Configure environment

```bash
cp .env.example backend/.env
# Edit backend/.env and add your Gemini API key
```

### 4. Run (development)

**Terminal 1 — Backend:**
```bash
cd backend
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

Open **http://localhost:5173**.

### 5. Run (Docker)

```bash
docker build -t dodge-graph .
docker run -p 8000:8000 -e GEMINI_API_KEY=your_key_here dodge-graph
```

Open **http://localhost:8000**.

---

## How to Use

| Action | What it does |
|---|---|
| **Click a node** | Opens the detail panel showing type, ID, properties, and connection count |
| **Double-click a node** | Expands that node's neighbours — loads connected entities into the graph |
| **Scroll wheel** | Zoom in/out. Labels appear when you zoom in past ~1.5× |
| **Drag the canvas** | Pan around |
| **Drag a node** | Reposition it — the node stays pinned |
| **Search bar** (top) | Type a name, ID, or type to find nodes. Click a result to center on it |
| **Type filter badges** (bottom) | Click a colored badge to hide/show that node type |
| **Chat** (top-right button) | Opens the LLM chat panel — ask questions in plain English |
| **"Ask chat"** (detail panel) | Sends a query about the selected node to the chat |
| **Node pills in chat** | Click the colored pills in chat responses to locate those nodes on the graph |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/graph/summary` | Node/edge counts by type |
| `GET` | `/api/graph?sample=N` | Stratified subgraph sample |
| `GET` | `/api/graph/node/{type}/{id}` | Single node details |
| `GET` | `/api/graph/neighbors/{type}/{id}?depth=N` | Neighbourhood subgraph |
| `GET` | `/api/graph/search?q=...` | Full-text node search |
| `POST` | `/api/chat` | NL→SQL chat (SSE stream) |

---

## Project Structure

```
dodge-graph/
├── backend/
│   ├── main.py            # FastAPI app, lifespan startup, SPA serving, auto-ingestion
│   ├── config.py           # Env config (DATA_DIR, DB_PATH, GEMINI_API_KEY)
│   ├── database.py         # SQLite connection provider
│   ├── ingestion.py        # 19-folder JSONL → SQLite with dedup & indexing
│   ├── graph_service.py    # NetworkX graph build (7 node types, 10 edge types) + queries
│   ├── llm_service.py      # Two-call Gemini pipeline with model fallback
│   ├── prompts.py          # Auto-generated DDL system prompt + few-shot examples
│   ├── guardrails.py       # Code-level SQL validation (SELECT-only, table allowlist, function blocklist)
│   ├── models.py           # Pydantic response schemas
│   └── routers/
│       ├── graph.py        # 5 graph REST endpoints
│       └── chat.py         # SSE streaming POST endpoint with concurrency limiter
├── frontend/
│   └── src/
│       ├── App.tsx         # Main layout, search, filter legend, graph↔chat wiring
│       ├── api/client.ts   # 5 typed API client functions
│       ├── hooks/
│       │   ├── useGraph.ts    # Graph state, expand with dedup guard
│       │   └── useChat.ts     # SSE streaming with abort cleanup
│       ├── components/
│       │   ├── GraphCanvas.tsx  # Force-directed 2D canvas with chain highlighting
│       │   ├── NodeDetail.tsx   # Node info card with expand/ask buttons
│       │   └── ChatPanel.tsx    # Chat UI, markdown rendering, SQL badge, node pills
│       ├── types/index.ts
│       └── ThemeContext.tsx     # Dark/light theme with localStorage persistence
├── o2c.db                 # Pre-built SQLite database (1.6 MB)
├── requirements.txt
├── Dockerfile             # Multi-stage: Node 20 build → Python 3.12 runtime
├── .env.example
└── README.md
```

---

## Deployment

Hosted on **Render** as a single Docker web service.

- **Why Render**: Persistent container keeps the NetworkX graph in memory. Serverless platforms (Vercel, Netlify) kill the process between requests, which would destroy the in-memory graph.
- **Env var**: `GEMINI_API_KEY` set in Render dashboard
- **Auto-ingestion**: If `o2c.db` is missing on startup, the backend auto-runs the ingestion pipeline

---

## License

Private — all rights reserved.
