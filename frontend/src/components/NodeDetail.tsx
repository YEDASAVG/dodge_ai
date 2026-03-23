import { useState } from 'react';
import type { GraphNode } from '../types';

const TYPE_COLOR: Record<string, string> = {
  SalesOrder: 'text-amber-600 dark:text-amber-400',
  Delivery: 'text-blue-600 dark:text-blue-400',
  BillingDocument: 'text-emerald-600 dark:text-emerald-400',
  JournalEntry: 'text-violet-600 dark:text-violet-400',
  Customer: 'text-red-600 dark:text-red-400',
  Product: 'text-cyan-600 dark:text-cyan-400',
  Plant: 'text-orange-600 dark:text-orange-400',
};

interface Props {
  node: GraphNode;
  onClose: () => void;
  onExpand: (nodeId: string) => void;
  onAskChat?: (node: GraphNode) => void;
}

const MAX_FIELDS = 12;

export default function NodeDetail({ node, onClose, onExpand, onAskChat }: Props) {
  const [showAll, setShowAll] = useState(false);
  const typeColor = TYPE_COLOR[node.type] ?? 'text-gray-500 dark:text-zinc-400';

  const entries = Object.entries(node.properties).filter(
    ([, v]) => v !== null && v !== '' && v !== undefined,
  );

  const visibleEntries = showAll ? entries : entries.slice(0, MAX_FIELDS);
  const hiddenCount = entries.length - MAX_FIELDS;

  return (
    <div
      className="w-72 max-h-[calc(100vh-80px)] bg-stone-50/95 dark:bg-zinc-900/95 backdrop-blur-sm border border-gray-200 dark:border-zinc-700/50 rounded-xl shadow-2xl dark:shadow-black/50 overflow-hidden flex flex-col transition-colors"
    >
      {/* Header */}
      <div className="p-4 pb-2 shrink-0">
        <div className="flex items-start justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">{node.type}</h3>
          <button onClick={onClose} className="text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 text-lg leading-none ml-2 -mt-0.5 transition-colors">&times;</button>
        </div>
        <p className={`text-xs ${typeColor} mt-0.5`}>Entity: {node.type}</p>
      </div>

      {/* Properties */}
      <div className="flex-1 overflow-y-auto hide-scrollbar px-4 py-2">
        <div className="space-y-1.5">
          {visibleEntries.map(([key, value]) => (
            <div key={key}>
              <span className="text-xs font-medium text-gray-900 dark:text-zinc-200">{key}:</span>{' '}
              <span className="text-xs text-gray-500 dark:text-zinc-400">{String(value)}</span>
            </div>
          ))}
        </div>
        {!showAll && hiddenCount > 0 && (
          <button
            onClick={() => setShowAll(true)}
            className="text-xs italic text-gray-400 dark:text-zinc-500 mt-2.5 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors block"
          >
            Additional fields hidden for readability
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-100 dark:border-zinc-800 shrink-0 flex items-center justify-between">
        <span className="text-xs text-gray-500 dark:text-zinc-400">Connections: {node.connections}</span>
        <div className="flex gap-3">
          <button onClick={() => onExpand(node.id)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Expand</button>
          {onAskChat && <button onClick={() => onAskChat(node)} className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline">Ask chat</button>}
        </div>
      </div>
    </div>
  );
}
