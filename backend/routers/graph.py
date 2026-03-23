"""Graph API router — 5 endpoints."""

from fastapi import APIRouter, Query

from graph_service import (
    get_neighbors,
    get_node,
    get_sampled_subgraph,
    get_summary,
    search_nodes,
)
from models import GraphNode, GraphSummary, SearchResult, SubgraphResponse

router = APIRouter(prefix="/api/graph", tags=["graph"])


def _g():
    """Get the current graph from main module."""
    import sys
    mod = sys.modules.get("backend.main") or sys.modules.get("main")
    return mod.G


def _node_to_response(raw: dict) -> dict:
    """Convert raw node dict into GraphNode-compatible shape."""
    return {
        "id": raw["id"],
        "type": raw.get("type", ""),
        "label": str(raw.get("label", raw["id"])),
        "connections": raw.get("connections", 0),
        "properties": {k: v for k, v in raw.items() if k not in ("id", "type", "label", "connections")},
    }


@router.get("/summary", response_model=GraphSummary)
def summary():
    return get_summary(_g())


@router.get("", response_model=SubgraphResponse)
def sampled_subgraph(sample: int = Query(300, ge=1, le=5000)):
    raw = get_sampled_subgraph(_g(), max_nodes=sample)
    return {
        "nodes": [_node_to_response(n) for n in raw["nodes"]],
        "edges": raw["edges"],
    }


@router.get("/node/{node_type}/{node_id:path}", response_model=GraphNode)
def node_detail(node_type: str, node_id: str):
    full_id = f"{node_type}:{node_id}"
    raw = get_node(_g(), full_id)
    if raw is None:
        from fastapi import HTTPException
        raise HTTPException(404, f"Node {full_id} not found")
    return _node_to_response(raw)


@router.get("/neighbors/{node_type}/{node_id:path}", response_model=SubgraphResponse)
def neighbors(node_type: str, node_id: str, depth: int = Query(1, ge=1, le=3)):
    full_id = f"{node_type}:{node_id}"
    raw = get_neighbors(_g(), full_id, depth=depth)
    return {
        "nodes": [_node_to_response(n) for n in raw["nodes"]],
        "edges": raw["edges"],
    }


@router.get("/search", response_model=list[SearchResult])
def search(q: str = Query(..., min_length=1)):
    raw = search_nodes(_g(), q)
    return [
        {
            "id": r["id"],
            "type": r.get("type", ""),
            "label": str(r.get("label", r["id"])),
            "connections": r.get("connections", 0),
        }
        for r in raw
    ]
