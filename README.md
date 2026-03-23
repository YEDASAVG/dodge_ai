# Dodge AI — SAP O2C Knowledge Graph

Interactive knowledge-graph explorer for SAP Order-to-Cash data. Visualise entity relationships with a force-directed canvas and ask natural-language questions powered by Google Gemini.

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

---

## Architecture

```
JSONL files ──► SQLite (18 tables) ──► NetworkX DiGraph (593 nodes, 1 356 edges)
                     │                           │
                     ▼                           ▼
              Gemini NL→SQL pipeline      Force-directed graph UI
                     │                           │
                     └──────── FastAPI ◄──────────┘
                                 │
                          React + Vite frontend
```

| Layer | Tech |
|-------|------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, react-force-graph-2d |
| Backend | FastAPI, Uvicorn, NetworkX, Google GenAI SDK |
| Data | SQLite (`o2c.db`), JSONL source files |

**Node types:** SalesOrder · Delivery · BillingDocument · JournalEntry · Customer · Product · Plant  
**Edge types:** ORDERED_BY · CONTAINS_PRODUCT · DELIVERED_FROM · HAS_DELIVERY · HAS_BILLING · BILLED_FOR · POSTED_FOR_BILLING · POSTED_FOR_DELIVERY · POSTED_FOR_ORDER · PAYMENT_FOR

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

## How to Use the Graph

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

### Tips

- **Start by zooming in** — the initial view shows 150 nodes which can look dense. Zoom into a cluster to see labels.
- **Use type filters** — hide JournalEntry nodes first (there are many). This reveals the SalesOrder → Delivery → BillingDocument flow more clearly.
- **Double-click to explore** — pick a SalesOrder, double-click it, and watch connected Deliveries, Billing Docs, Customer, and Products fan out.
- **Use Chat for analysis** — ask things like *"Which products have the most billing documents?"* or *"Find sales orders with broken flows"*.

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
│   ├── main.py           # FastAPI app + graph startup
│   ├── config.py          # Env + paths
│   ├── database.py        # SQLite connection
│   ├── ingestion.py       # JSONL → SQLite
│   ├── graph_service.py   # NetworkX graph build + queries
│   ├── llm_service.py     # Gemini NL→SQL pipeline
│   ├── prompts.py         # System prompts + DDL
│   ├── guardrails.py      # SQL validation
│   ├── models.py          # Pydantic schemas
│   └── routers/
│       ├── graph.py       # Graph API endpoints
│       └── chat.py        # Chat SSE endpoint
├── frontend/
│   └── src/
│       ├── App.tsx        # Main layout + search + filters
│       ├── api/client.ts  # API client functions
│       ├── hooks/
│       │   ├── useGraph.ts   # Graph data + expand
│       │   └── useChat.ts    # SSE chat streaming
│       ├── components/
│       │   ├── GraphCanvas.tsx  # Force-directed graph
│       │   ├── NodeDetail.tsx   # Node info panel
│       │   └── ChatPanel.tsx    # Chat UI + markdown
│       └── types/index.ts
├── o2c.db                # SQLite database (git-ignored, auto-generated)
├── requirements.txt
├── Dockerfile
├── .env.example          # Template for secrets
└── README.md
```

---

## License

Private — all rights reserved.
