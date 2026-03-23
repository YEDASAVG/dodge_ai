"""Pydantic response schemas."""

from pydantic import BaseModel


class GraphSummary(BaseModel):
    total_nodes: int
    total_edges: int
    node_counts: dict[str, int]
    edge_counts: dict[str, int]


class GraphNode(BaseModel):
    id: str
    type: str
    label: str
    connections: int
    properties: dict


class GraphEdge(BaseModel):
    source: str
    target: str
    relation: str


class SubgraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class SearchResult(BaseModel):
    id: str
    type: str
    label: str
    connections: int
