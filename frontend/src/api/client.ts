import type { GraphNode, GraphSummary, SearchResult, SubgraphResponse } from '../types';

const BASE = '/api';

export async function fetchSummary(): Promise<GraphSummary> {
  const res = await fetch(`${BASE}/graph/summary`);
  if (!res.ok) throw new Error(`Summary fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchSubgraph(sample = 300): Promise<SubgraphResponse> {
  const res = await fetch(`${BASE}/graph?sample=${sample}`);
  if (!res.ok) throw new Error(`Subgraph fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchNode(nodeType: string, nodeId: string): Promise<GraphNode> {
  const res = await fetch(`${BASE}/graph/node/${nodeType}/${encodeURIComponent(nodeId)}`);
  if (!res.ok) throw new Error(`Node fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchNeighbors(nodeType: string, nodeId: string, depth = 1): Promise<SubgraphResponse> {
  const res = await fetch(`${BASE}/graph/neighbors/${nodeType}/${encodeURIComponent(nodeId)}?depth=${depth}`);
  if (!res.ok) throw new Error(`Neighbors fetch failed: ${res.status}`);
  return res.json();
}

export async function searchNodes(query: string): Promise<SearchResult[]> {
  const res = await fetch(`${BASE}/graph/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}
