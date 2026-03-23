import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import type { GraphEdge, GraphNode } from '../types';

const NODE_COLORS: Record<string, string> = {
  SalesOrder: '#f59e0b',     // amber
  Delivery: '#3b82f6',       // blue
  BillingDocument: '#10b981', // emerald
  JournalEntry: '#8b5cf6',   // violet
  Customer: '#ef4444',        // red
  Product: '#06b6d4',         // cyan
  Plant: '#f97316',           // orange
};

/* Short abbreviation drawn inside each node so type is visible at a glance */
const NODE_ABBR: Record<string, string> = {
  SalesOrder: 'SO', Delivery: 'DL', BillingDocument: 'BD',
  JournalEntry: 'JE', Customer: 'CU', Product: 'PR', Plant: 'PL',
};

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick: (node: GraphNode) => void;
  onNodeDoubleClick: (nodeId: string) => void;
  selectedNodeId: string | null;
  isDark: boolean;
}

interface ForceNode extends GraphNode {
  x?: number;
  y?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface ForceLink { source: any; target: any; relation?: string }

export interface GraphCanvasHandle {
  centerAt: (x: number, y: number, ms: number) => void;
  zoom: (val: number, ms: number) => void;
  graphData: () => { nodes: any[]; links: any[] };
}

export default forwardRef(function GraphCanvas({ nodes, edges, onNodeClick, onNodeDoubleClick, selectedNodeId, isDark }: Props, ref: React.Ref<GraphCanvasHandle>) {
  const fgRef = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredData, setHoveredData] = useState<{ node: ForceNode; sx: number; sy: number } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width: Math.floor(width), height: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useImperativeHandle(ref, () => ({
    centerAt: (x: number, y: number, ms: number) => fgRef.current?.centerAt(x, y, ms),
    zoom: (val: number, ms: number) => fgRef.current?.zoom(val, ms),
    graphData: () => fgRef.current?.graphData() ?? { nodes: [], links: [] },
  }));

  // Zoom to fit after initial layout settles
  const hasZoomedToFit = useRef(false);
  useEffect(() => {
    if (hasZoomedToFit.current || !fgRef.current || nodes.length === 0) return;
    const timer = setTimeout(() => {
      fgRef.current?.zoomToFit(400, 60);
      hasZoomedToFit.current = true;
    }, 1500);
    return () => clearTimeout(timer);
  }, [nodes.length]);

  const graphData = useMemo(() => ({
    nodes: nodes.map((n) => ({ ...n })),
    links: edges.map((e) => ({ source: e.source, target: e.target, relation: e.relation })),
  }), [nodes, edges]);

  /* ── Adjacency map: for any node, which nodes are directly connected? ── */
  const neighborSet = useMemo(() => {
    if (!selectedNodeId) return null; // no selection → show everything
    const set = new Set<string>();
    set.add(selectedNodeId);
    for (const e of edges) {
      if (e.source === selectedNodeId) set.add(e.target);
      if (e.target === selectedNodeId) set.add(e.source);
    }
    return set;
  }, [selectedNodeId, edges]);

  /* Is this node "in focus"? (selected, neighbor, or nothing selected) */
  const isInFocus = useCallback(
    (nodeId: string) => !neighborSet || neighborSet.has(nodeId),
    [neighborSet],
  );

  /* Is this link "in focus"? */
  const isLinkInFocus = useCallback(
    (srcId: string, tgtId: string) => {
      if (!selectedNodeId) return true;
      return srcId === selectedNodeId || tgtId === selectedNodeId;
    },
    [selectedNodeId],
  );

  const nodeColor = useCallback(
    (node: ForceNode) => NODE_COLORS[node.type] ?? '#6b7280',
    [],
  );

  const nodeCanvasObject = useCallback(
    (node: ForceNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const r = Math.min(12, Math.max(3, Math.sqrt(node.connections + 1) * 1.4));
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const isSelected = node.id === selectedNodeId;
      const isHovered = node.id === hoveredNode;
      const focused = isInFocus(node.id);
      const color = nodeColor(node);

      // ── Dimmed ghost for non-focused nodes ──
      if (!focused) {
        ctx.globalAlpha = 0.08;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fillStyle = isDark ? '#71717a' : '#a1a1aa';
        ctx.fill();
        ctx.globalAlpha = 1;
        return; // skip labels, tooltips — they're background noise
      }

      // Selection / hover ring
      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(x, y, r + 2.5 / globalScale, 0, 2 * Math.PI);
        ctx.strokeStyle = isSelected
          ? (isDark ? '#ffffff' : '#111827')
          : (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.3)');
        ctx.lineWidth = (isSelected ? 2.5 : 1.5) / globalScale;
        ctx.stroke();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      // Type abbreviation inside node
      const abbr = NODE_ABBR[node.type] ?? '?';
      const abbrSize = Math.max(2.5, r * 0.75);
      ctx.font = `bold ${abbrSize}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillText(abbr, x, y);

      // Label below node — only on zoom, hover, selected, or chain-highlighted
      const showLabel = isSelected || isHovered || (selectedNodeId != null && focused) || globalScale > 2.5;
      if (showLabel) {
        const labelSize = Math.max(3, (isHovered || isSelected ? 11 : 9) / globalScale);
        ctx.font = `500 ${labelSize}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const labelText = node.label;
        const labelW = ctx.measureText(labelText).width;
        const padH = 2 / globalScale;
        const padW = 4 / globalScale;
        const labelY = y + r + 3 / globalScale;
        ctx.fillStyle = isDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.75)';
        ctx.beginPath();
        ctx.roundRect(x - labelW / 2 - padW, labelY - padH, labelW + padW * 2, labelSize + padH * 2, 2 / globalScale);
        ctx.fill();

        ctx.fillStyle = isHovered || isSelected
          ? (isDark ? '#ffffff' : '#111827')
          : (isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.75)');
        ctx.fillText(labelText, x, labelY);
      }
    },
    [selectedNodeId, hoveredNode, nodeColor, isDark, isInFocus],
  );

  // Edge label renderer — only on hover over the edge (midpoint proximity)
  const linkCanvasObjectMode = useCallback(() => 'after' as const, []);
  const linkCanvasObject = useCallback(
    (_link: ForceLink, _ctx: CanvasRenderingContext2D, _globalScale: number) => {
      // Removed: no edge labels drawn by default. Relationship info is
      // visible in the node detail card and chat instead.
    },
    [],
  );

  return (
    <div ref={containerRef} className="w-full h-full">
    <ForceGraph2D
      ref={fgRef}
      width={dimensions.width}
      height={dimensions.height}
      graphData={graphData}
      nodeId="id"
      nodeCanvasObject={nodeCanvasObject}
      nodePointerAreaPaint={(node: ForceNode, color: string, ctx: CanvasRenderingContext2D) => {
        const r = Math.min(12, Math.max(3, Math.sqrt(node.connections + 1) * 1.4)) + 2;
        ctx.beginPath();
        ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
      }}
      linkSource="source"
      linkTarget="target"
      linkColor={(link: ForceLink) => {
        const srcId = typeof link.source === 'object' ? link.source.id : link.source;
        const tgtId = typeof link.target === 'object' ? link.target.id : link.target;
        if (selectedNodeId && !isLinkInFocus(srcId, tgtId))
          return isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)';
        if (selectedNodeId && isLinkInFocus(srcId, tgtId))
          return isDark ? 'rgba(99,179,237,0.6)' : 'rgba(59,130,246,0.5)';
        return isDark ? 'rgba(255,255,255,0.12)' : 'rgba(59,130,246,0.18)';
      }}
      linkDirectionalArrowLength={3.5}
      linkDirectionalArrowRelPos={1}
      linkWidth={(link: ForceLink) => {
        if (!selectedNodeId) return 0.8;
        const srcId = typeof link.source === 'object' ? link.source.id : link.source;
        const tgtId = typeof link.target === 'object' ? link.target.id : link.target;
        return isLinkInFocus(srcId, tgtId) ? 2 : 0.3;
      }}
      linkCanvasObjectMode={linkCanvasObjectMode}
      linkCanvasObject={linkCanvasObject}
      onNodeClick={(node: ForceNode) => onNodeClick(node)}
      onNodeRightClick={(node: ForceNode) => onNodeDoubleClick(node.id)}
      onNodeHover={(node: ForceNode | null) => {
        setHoveredNode(node?.id ?? null);
        if (node && node.x != null && fgRef.current) {
          const coords = fgRef.current.graph2ScreenCoords(node.x, node.y ?? 0);
          setHoveredData({ node, sx: coords.x, sy: coords.y });
        } else {
          setHoveredData(null);
        }
      }}
      onBackgroundClick={() => onNodeClick(null as unknown as GraphNode)}
      backgroundColor="transparent"
      cooldownTicks={120}
      d3AlphaDecay={0.025}
      d3VelocityDecay={0.4}
      d3AlphaMin={0.005}
      nodeRelSize={4}
      warmupTicks={80}
      dagMode={undefined}
      onEngineStop={() => {
        if (!hasZoomedToFit.current && fgRef.current) {
          fgRef.current.zoomToFit(400, 40);
          hasZoomedToFit.current = true;
        }
      }}
    />
    {/* HTML tooltip — floats above canvas */}
    {hoveredData && (
      <div
        className="absolute pointer-events-none z-30"
        style={{ left: hoveredData.sx, top: hoveredData.sy - 12, transform: 'translate(-50%, -100%)' }}
      >
        <div className={`rounded-lg px-3 py-2 shadow-lg border text-xs whitespace-nowrap ${
          isDark
            ? 'bg-zinc-900/95 border-zinc-700/60 text-zinc-100'
            : 'bg-white/95 border-gray-200 text-gray-900'
        }`}>
          <div className="font-semibold" style={{ color: NODE_COLORS[hoveredData.node.type] ?? '#6b7280' }}>
            {hoveredData.node.type}: {hoveredData.node.label}
          </div>
          <div className={`mt-0.5 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
            Connections: {hoveredData.node.connections}
          </div>
        </div>
      </div>
    )}
    </div>
  );
})
