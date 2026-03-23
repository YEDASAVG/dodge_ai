export interface GraphNode {
  id: string;
  type: string;
  label: string;
  connections: number;
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
}

export interface SubgraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphSummary {
  total_nodes: number;
  total_edges: number;
  node_counts: Record<string, number>;
  edge_counts: Record<string, number>;
}

export interface SearchResult {
  id: string;
  type: string;
  label: string;
  connections: number;
}

// Chat types
export interface ChatNodeRef {
  type: string;
  id: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  nodes?: ChatNodeRef[];
  isStreaming?: boolean;
  error?: boolean;
}
