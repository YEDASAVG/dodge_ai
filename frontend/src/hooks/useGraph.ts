import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchNeighbors, fetchSubgraph } from '../api/client';
import type { GraphEdge, GraphNode, SubgraphResponse } from '../types';

interface GraphState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  loading: boolean;
  error: string | null;
  expandNode: (nodeId: string, depth?: number, anchor?: { x: number; y: number }) => Promise<void>;
}

export function useGraph(initialSample = 150): GraphState {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const expandingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetchSubgraph(initialSample)
      .then((data: SubgraphResponse) => {
        if (cancelled) return;
        setNodes(data.nodes);
        setEdges(data.edges);
      })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [initialSample]);

  const expandNode = useCallback(
    (nodeId: string, depth = 1, anchor?: { x: number; y: number }): Promise<void> => {
      // Prevent duplicate concurrent expands for the same node
      if (expandingRef.current.has(nodeId)) return Promise.resolve();
      expandingRef.current.add(nodeId);

      const [nodeType, ...idParts] = nodeId.split(':');
      const id = idParts.join(':');
      return fetchNeighbors(nodeType, id, depth)
        .then((data: SubgraphResponse) => {
          setNodes((prev) => {
            const existing = new Set(prev.map((n) => n.id));
            const newNodes = data.nodes.filter((n) => !existing.has(n.id));
            if (anchor) {
              newNodes.forEach((n, i) => {
                const angle = (2 * Math.PI * i) / Math.max(newNodes.length, 1);
                const spread = 40 + Math.random() * 20;
                (n as any).x = anchor.x + Math.cos(angle) * spread;
                (n as any).y = anchor.y + Math.sin(angle) * spread;
              });
            }
            return [...prev, ...newNodes];
          });
          setEdges((prev) => {
            // After force-graph processes edges, source/target may be object refs
            const edgeKey = (e: { source: any; target: any }) => {
              const s = typeof e.source === 'object' ? e.source.id : e.source;
              const t = typeof e.target === 'object' ? e.target.id : e.target;
              return `${s}-${t}`;
            };
            const existing = new Set(prev.map(edgeKey));
            const newEdges = data.edges.filter((e) => !existing.has(edgeKey(e)));
            return [...prev, ...newEdges];
          });
        })
        .catch((err: Error) => { setError(err.message); })
        .finally(() => { expandingRef.current.delete(nodeId); });
    },
    [],
  );

  return { nodes, edges, loading, error, expandNode };
}
