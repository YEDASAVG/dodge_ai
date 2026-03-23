import { useCallback, useRef, useState } from 'react';
import GraphCanvas from './components/GraphCanvas';
import type { GraphCanvasHandle } from './components/GraphCanvas';
import NodeDetail from './components/NodeDetail';
import ChatPanel from './components/ChatPanel';
import { useGraph } from './hooks/useGraph';
import { useChat } from './hooks/useChat';
import { searchNodes } from './api/client';
import { useTheme } from './ThemeContext';
import type { ChatNodeRef, GraphNode, SearchResult } from './types';

interface ForceNode extends GraphNode { x?: number; y?: number }

const NODE_TYPES = ['SalesOrder', 'Delivery', 'BillingDocument', 'JournalEntry', 'Customer', 'Product', 'Plant'] as const;

const DOT: Record<string, string> = {
  SalesOrder: 'bg-amber-500', Delivery: 'bg-blue-500', BillingDocument: 'bg-emerald-500',
  JournalEntry: 'bg-violet-500', Customer: 'bg-red-500', Product: 'bg-cyan-500', Plant: 'bg-orange-500',
};

export default function App() {
  const { isDark, toggleTheme } = useTheme();
  const { nodes, edges, loading, error, expandNode } = useGraph(150);
  const { messages, isLoading: chatLoading, sendMessage, clearChat } = useChat();
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatWidth, setChatWidth] = useState(380);

  const [showHelp, setShowHelp] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set(['JournalEntry']));
  const graphRef = useRef<GraphCanvasHandle | null>(null);

  /** Expand a node — fetch its neighbors and add to graph */
  const handleExpand = useCallback((nodeId: string) => {
    expandNode(nodeId);
  }, [expandNode]);

  const handleSearchChange = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!q.trim()) { setSearchResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try { setSearchResults((await searchNodes(q.trim())).slice(0, 10)); }
      catch { setSearchResults([]); }
      setSearching(false);
    }, 300);
  }, []);

  const focusNode = (found: GraphNode) => {
    setSelectedNode(found);
    const fg = graphRef.current;
    const fn = found as ForceNode;
    if (fg && fn.x != null) { fg.centerAt(fn.x, fn.y ?? 0, 600); fg.zoom(3, 600); }
  };

  const selectSearchResult = (r: SearchResult) => {
    const found = nodes.find(n => n.id === r.id);
    if (found) focusNode(found); else handleExpand(r.id);
    setSearchQuery(''); setSearchResults([]);
  };

  const handleChatNodeClick = (ref: ChatNodeRef) => {
    const fullId = `${ref.type}:${ref.id}`;
    const found = nodes.find(n => n.id === fullId);
    if (found) focusNode(found); else handleExpand(fullId);
  };

  const askAboutNode = (node: GraphNode) => {
    if (!chatOpen) setChatOpen(true);
    sendMessage(`Tell me about ${node.type} ${node.label}`);
  };

  const toggleType = (type: string) => {
    setHiddenTypes(prev => { const next = new Set(prev); if (next.has(type)) next.delete(type); else next.add(type); return next; });
  };



  const visibleNodes = hiddenTypes.size === 0 ? nodes : nodes.filter(n => !hiddenTypes.has(n.type));
  const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
  const visibleEdges = hiddenTypes.size === 0 ? edges : edges.filter(e => {
    const s = typeof e.source === 'object' ? (e.source as any).id : e.source;
    const t = typeof e.target === 'object' ? (e.target as any).id : e.target;
    return visibleNodeIds.has(s) && visibleNodeIds.has(t);
  });

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-stone-100 dark:bg-zinc-950 transition-colors">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-gray-300 dark:border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
        <span className="text-sm text-gray-500 dark:text-zinc-400">Loading graph…</span>
      </div>
    </div>
  );

  if (error) return (
    <div className="flex items-center justify-center h-screen bg-stone-100 dark:bg-zinc-950 text-red-500 transition-colors">Error: {error}</div>
  );

  return (
    <div className="relative w-screen h-screen flex flex-col overflow-hidden bg-stone-100 dark:bg-zinc-950 transition-colors duration-150">
      {/* ─── Header ─── */}
      <header className="shrink-0 h-12 flex items-center px-5 border-b border-gray-200/80 dark:border-zinc-800/80 bg-stone-50/90 dark:bg-zinc-900/90 backdrop-blur-sm z-30 transition-colors">
        <div className="flex items-center gap-3">
          {/* Logo */}
          <div className="w-7 h-7 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center shrink-0 transition-colors">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-white dark:text-zinc-900">
              <rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor" opacity=".4" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" fill="currentColor" opacity=".4" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" fill="currentColor" />
            </svg>
          </div>
          <nav className="flex items-center gap-1.5 text-sm select-none">
            <span className="text-gray-400 dark:text-zinc-500">Mapping</span>
            <span className="text-gray-300 dark:text-zinc-700">/</span>
            <span className="font-semibold text-gray-900 dark:text-zinc-100">Graph</span>
          </nav>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Search */}
          <div className="relative w-44 hidden sm:block">
            <input
              type="text"
              value={searchQuery}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search nodes…"
              className="w-full bg-gray-100 dark:bg-zinc-800/80 border border-gray-200 dark:border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-gray-800 dark:text-zinc-200 placeholder:text-gray-400 dark:placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-blue-500/40 transition"
            />
            {searching && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">…</span>}
            {searchResults.length > 0 && (
              <div className="absolute top-full mt-1 left-0 w-64 bg-stone-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700/50 rounded-lg shadow-xl overflow-hidden z-50">
                {searchResults.map(r => (
                  <button key={r.id} onClick={() => selectSearchResult(r)} className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-700/50 flex items-center gap-2 transition-colors">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[r.type] ?? 'bg-gray-400'}`} />
                    <span className="truncate">{r.label}</span>
                    <span className="text-gray-400 dark:text-zinc-600 text-[10px] ml-auto shrink-0">{r.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Theme toggle */}
          <button onClick={toggleTheme} className="p-1.5 rounded-lg text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors" title={isDark ? 'Light mode' : 'Dark mode'}>
            {isDark ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M10 2a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 2ZM10 15a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 15ZM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM15.657 5.404a.75.75 0 1 0-1.06-1.06l-1.061 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM6.464 14.596a.75.75 0 1 0-1.06-1.06l-1.06 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM18 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 18 10ZM5 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 5 10ZM14.596 15.657a.75.75 0 0 0 1.06-1.06l-1.06-1.061a.75.75 0 1 0-1.06 1.06l1.06 1.06ZM5.404 6.464a.75.75 0 0 0 1.06-1.06l-1.06-1.06a.75.75 0 1 0-1.06 1.06l1.06 1.06Z" /></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M7.455 2.004a.75.75 0 0 1 .26.77 7 7 0 0 0 9.958 7.967.75.75 0 0 1 1.067.853A8.5 8.5 0 1 1 6.647 1.921a.75.75 0 0 1 .808.083Z" clipRule="evenodd" /></svg>
            )}
          </button>

          {/* Help */}
          <button onClick={() => setShowHelp(p => !p)} className="px-2 py-1.5 rounded-lg text-xs text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors">?</button>

          {/* Chat toggle */}
          <button
            onClick={() => setChatOpen(p => !p)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              chatOpen
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/25'
                : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-700 border border-gray-200 dark:border-zinc-700/50'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M10 2c-2.236 0-4.43.18-6.57.524C1.993 2.755 1 4.014 1 5.426v5.148c0 1.413.993 2.67 2.43 2.902.848.137 1.705.248 2.57.331v3.443a.75.75 0 0 0 1.28.53l3.58-3.579a.78.78 0 0 1 .527-.224 41.2 41.2 0 0 0 5.183-.5c1.437-.232 2.43-1.49 2.43-2.903V5.426c0-1.413-.993-2.67-2.43-2.902A41.3 41.3 0 0 0 10 2Z" clipRule="evenodd" />
            </svg>
            Chat
            {messages.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
          </button>
        </div>
      </header>

      {/* ─── Body ─── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Graph area */}
        <div className="relative flex-1 h-full min-w-0">
          {/* Legend / type filter */}
          <div className="absolute bottom-4 left-4 z-10 bg-stone-50/90 dark:bg-zinc-900/90 backdrop-blur border border-gray-200/80 dark:border-zinc-700/50 rounded-xl shadow-lg p-3 transition-colors">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500 mb-2">Node Types</p>
              <div className="flex flex-col gap-1">
                {NODE_TYPES.map(type => {
                  const hidden = hiddenTypes.has(type);
                  return (
                    <button
                      key={type}
                      onClick={() => toggleType(type)}
                      className={`flex items-center gap-2 text-xs px-2 py-1 rounded-lg transition-all ${
                        hidden
                          ? 'text-gray-400 dark:text-zinc-600 opacity-50'
                          : 'text-gray-700 dark:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <span className={`w-3 h-3 rounded shrink-0 flex items-center justify-center text-[7px] font-bold text-white ${DOT[type]} ${hidden ? 'opacity-30' : ''}`}>
                        {{ SalesOrder: 'SO', Delivery: 'DL', BillingDocument: 'BD', JournalEntry: 'JE', Customer: 'CU', Product: 'PR', Plant: 'PL' }[type]}
                      </span>
                      <span className={hidden ? 'line-through' : ''}>{type.replace(/([A-Z])/g, ' $1').trim()}</span>
                    </button>
                  );
                })}
              </div>
          </div>

          {/* Graph canvas */}
          <GraphCanvas
            ref={graphRef}
            nodes={visibleNodes}
            edges={visibleEdges}
            selectedNodeId={selectedNode?.id ?? null}
            onNodeClick={(node: GraphNode) => {
              // null comes from background click — clear selection
              if (!node) { setSelectedNode(null); return; }
              setSelectedNode(prev => prev?.id === node.id ? null : node);
            }}
            onNodeDoubleClick={(nodeId: string) => handleExpand(nodeId)}
            isDark={isDark}
          />
        </div>

        {/* Node detail floating card — outside graph container to avoid canvas event capture */}
        {selectedNode && (
          <div className="absolute top-16 right-4 z-30" style={chatOpen ? { right: chatWidth + 16 } : undefined}>
            <NodeDetail
              node={selectedNode}
              onClose={() => setSelectedNode(null)}
              onExpand={(nodeId: string) => handleExpand(nodeId)}
              onAskChat={(node: GraphNode) => askAboutNode(node)}
            />
          </div>
        )}

        {/* ─── Chat Panel ─── */}
        {chatOpen && (
          <div className="h-full shrink-0 flex border-l border-gray-200 dark:border-zinc-800 transition-colors" style={{ width: chatWidth }}>
            {/* Resize handle */}
            <div
              className="w-2.5 h-full cursor-col-resize relative group flex items-center justify-center select-none"
              onMouseDown={e => {
                e.preventDefault();
                const startX = e.clientX;
                const startW = chatWidth;
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                const onMove = (ev: MouseEvent) => {
                  const maxW = Math.min(900, window.innerWidth * 0.65);
                  setChatWidth(Math.min(maxW, Math.max(320, startW + (startX - ev.clientX))));
                };
                const onUp = () => {
                  document.body.style.cursor = '';
                  document.body.style.userSelect = '';
                  document.removeEventListener('mousemove', onMove);
                  document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
              }}
            >
              <div className="w-px h-full bg-transparent group-hover:bg-blue-500 group-active:bg-blue-400 transition-colors" />
            </div>
            <div className="flex-1 h-full min-w-0">
              <ChatPanel
                messages={messages}
                isLoading={chatLoading}
                onSend={sendMessage}
                onClear={clearChat}
                onNodeClick={handleChatNodeClick}
              />
            </div>
          </div>
        )}
      </div>

      {/* ─── Help modal ─── */}
      {showHelp && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowHelp(false)}>
          <div className="bg-stone-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700/50 rounded-2xl p-6 max-w-md mx-4 shadow-2xl transition-colors" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">How to use the Graph</h2>
            <div className="space-y-3 text-sm text-gray-500 dark:text-zinc-400">
              {([
                ['Click node', 'View details in floating card'],
                ['Right-click', 'Expand node neighbors'],
                ['Scroll', 'Zoom — labels appear zoomed in'],
                ['Drag canvas', 'Pan around the graph'],
                ['Drag node', 'Reposition — it stays pinned'],
                ['Search', 'Find nodes by ID, name, or type'],
                ['Type filters', 'Hide/show node types via badges'],
                ['Chat', 'Ask natural language questions'],
              ] as const).map(([key, desc]) => (
                <div key={key} className="flex gap-3 items-start">
                  <span className="text-gray-800 dark:text-zinc-200 font-medium w-24 shrink-0">{key}</span>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
            <button onClick={() => setShowHelp(false)} className="mt-5 w-full py-2 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-300 text-sm rounded-lg transition-colors">
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
