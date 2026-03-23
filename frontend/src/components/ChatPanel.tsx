import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import type { ChatMessage, ChatNodeRef } from '../types';

const PILL: Record<string, string> = {
  SalesOrder: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10',
  Delivery: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10',
  BillingDocument: 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10',
  JournalEntry: 'text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10',
  Customer: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10',
  Product: 'text-cyan-700 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-500/10',
  Plant: 'text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10',
};

const SUGGESTIONS = [
  'Which products have the most billing documents?',
  'Trace the flow of billing document 90504248',
  'Find sales orders with broken flows',
];

interface Props {
  messages: ChatMessage[];
  isLoading: boolean;
  onSend: (text: string) => void;
  onClear: () => void;
  onNodeClick?: (nodeRef: ChatNodeRef) => void;
}

/* Dodge AI logo mini icon */
function Logo({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor" opacity=".4" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" fill="currentColor" opacity=".4" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export default function ChatPanel({ messages, isLoading, onSend, onClear, onNodeClick }: Props) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setInput('');
  };

  return (
    <div className="flex flex-col h-full bg-stone-50 dark:bg-zinc-900/95 dark:backdrop-blur transition-colors">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 dark:border-zinc-800 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Chat with Graph</h2>
            <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">Graph</p>
          </div>
          <button
            onClick={onClear}
            className={`text-xs px-2 py-1 rounded transition-colors ${messages.length > 0 ? 'text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800' : 'text-gray-300 dark:text-zinc-700 cursor-default'}`}
            disabled={messages.length === 0}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto hide-scrollbar px-5 py-4 space-y-5">
        {/* Welcome — always visible */}
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-zinc-900 dark:bg-white flex items-center justify-center shrink-0 mt-0.5 transition-colors">
            <Logo className="w-4 h-4 text-white dark:text-zinc-900" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Dodge AI</span>
              <span className="text-xs text-gray-400 dark:text-zinc-500">Graph Agent</span>
            </div>
            <p className="text-sm text-gray-600 dark:text-zinc-300 mt-1 leading-relaxed">
              Hi! I can help you explore and analyze this <strong className="font-semibold text-gray-900 dark:text-white">graph</strong>.
            </p>
          </div>
        </div>

        {/* Suggestion chips */}
        {messages.length === 0 && (
          <div className="flex flex-col gap-2 pl-11">
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => onSend(s)}
                className="text-left text-xs text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-zinc-800/60 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg px-3 py-2.5 transition-colors border border-gray-200/60 dark:border-zinc-700/40 hover:border-gray-300 dark:hover:border-zinc-600/50"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Conversation */}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'items-start gap-3'}`}>
            {/* AI avatar */}
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 rounded-full bg-zinc-900 dark:bg-white flex items-center justify-center shrink-0 mt-0.5 transition-colors">
                <Logo className="w-4 h-4 text-white dark:text-zinc-900" />
              </div>
            )}

            {/* User message */}
            {msg.role === 'user' && (
              <div className="flex items-start gap-2 max-w-[85%]">
                <div className="bg-zinc-800 dark:bg-zinc-700 text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed">
                  {msg.content}
                </div>
                <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-zinc-600 flex items-center justify-center shrink-0 mt-0.5 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-gray-500 dark:text-zinc-300">
                    <path d="M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.465 14.493a1.23 1.23 0 0 0 .41 1.412A9.957 9.957 0 0 0 10 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 0 0-13.074.003Z" />
                  </svg>
                </div>
              </div>
            )}

            {/* Assistant message */}
            {msg.role === 'assistant' && (
              <div className="max-w-[88%]">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Dodge AI</span>
                  <span className="text-xs text-gray-400 dark:text-zinc-500">Graph Agent</span>
                </div>

                {msg.sql && <SqlBlock sql={msg.sql} />}

                {msg.isStreaming && !msg.content ? (
                  <div className="flex gap-1 items-center py-1">
                    <span className="w-1.5 h-1.5 bg-gray-400 dark:bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 dark:bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 dark:bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                ) : msg.error ? (
                  <p className="text-sm text-red-500">{msg.content}</p>
                ) : (
                  <div className="text-sm text-gray-700 dark:text-zinc-300 leading-relaxed wrap-break-word">
                    <Markdown
                      components={{
                        p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
                        strong: ({ children }) => <strong className="font-semibold text-gray-900 dark:text-white">{children}</strong>,
                        ul: ({ children }) => <ul className="list-disc pl-4 mb-1.5 space-y-0.5">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-4 mb-1.5 space-y-0.5">{children}</ol>,
                        li: ({ children }) => <li className="text-sm">{children}</li>,
                        code: ({ children }) => <code className="bg-gray-100 dark:bg-zinc-700/60 px-1 py-0.5 rounded text-xs font-mono text-emerald-600 dark:text-emerald-400">{children}</code>,
                      }}
                    >
                      {msg.content}
                    </Markdown>
                  </div>
                )}

                {msg.nodes && msg.nodes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {msg.nodes.slice(0, 8).map((n, j) => (
                      <button
                        key={j}
                        onClick={() => onNodeClick?.(n)}
                        className={`text-[10px] px-1.5 py-0.5 rounded transition-colors cursor-pointer ${PILL[n.type] ?? 'text-gray-500 bg-gray-100 dark:text-zinc-400 dark:bg-zinc-700/50'}`}
                      >
                        {n.type}:{n.id}
                      </button>
                    ))}
                    {msg.nodes.length > 8 && <span className="text-[10px] text-gray-400 dark:text-zinc-500 py-0.5">+{msg.nodes.length - 8} more</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="px-4 py-3 border-t border-gray-100 dark:border-zinc-800 shrink-0">
        <div className="flex items-center gap-1.5 mb-2">
          <span className={`w-2 h-2 rounded-full ${isLoading ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`} />
          <span className="text-xs text-gray-400 dark:text-zinc-500">{isLoading ? 'Thinking…' : 'Dodge AI is awaiting instructions'}</span>
        </div>
        <div className="flex items-end gap-2 bg-gray-50 dark:bg-zinc-800/60 rounded-xl border border-gray-200 dark:border-zinc-700/40 px-3 py-2 focus-within:border-blue-400 dark:focus-within:border-zinc-600/60 transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            placeholder="Analyze anything"
            rows={1}
            className="flex-1 bg-transparent text-sm text-gray-800 dark:text-zinc-200 placeholder:text-gray-400 dark:placeholder:text-zinc-600 resize-none outline-none max-h-30"
          />
          <button
            onClick={handleSubmit}
            disabled={isLoading || !input.trim()}
            className="shrink-0 px-3 py-1 rounded-lg text-xs font-medium bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-default transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function SqlBlock({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2">
      <button onClick={() => setOpen(p => !p)} className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`}>
          <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
        SQL Query
      </button>
      {open && (
        <pre className="mt-1 p-2 rounded-lg bg-gray-100 dark:bg-zinc-800/80 text-[11px] text-gray-600 dark:text-zinc-400 font-mono overflow-x-auto">{sql}</pre>
      )}
    </div>
  );
}
