import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatNodeRef } from '../types';

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight stream on unmount
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const sendMessage = useCallback(async (text: string) => {
    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    // Build history from current messages (stale-safe via functional update snapshot)
    let history: { role: string; content: string }[] = [];
    setMessages((prev) => {
      history = prev
        .filter((m) => !m.isStreaming && !m.error)
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }));
      return prev;
    });

    // Placeholder assistant message — use functional update to get correct index
    let assistantIdx = -1;
    setMessages((prev) => {
      assistantIdx = prev.length;
      return [...prev, { role: 'assistant', content: '', isStreaming: true }];
    });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Chat request failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sql = '';
      let nodes: ChatNodeRef[] = [];
      let answer = '';
      let error = '';

      const processLine = (line: string) => {
        if (!line.startsWith('data: ')) return;
        try {
          const event = JSON.parse(line.slice(6));
          switch (event.type) {
            case 'sql':
              sql = event.content;
              break;
            case 'nodes':
              nodes = event.content;
              break;
            case 'answer':
              answer = event.content;
              break;
            case 'error':
              error = event.content;
              break;
          }

          setMessages((prev) => {
            if (assistantIdx < 0 || assistantIdx >= prev.length) return prev;
            const updated = [...prev];
            updated[assistantIdx] = {
              role: 'assistant',
              content: answer || error || (event.type === 'status' ? event.content + '...' : ''),
              sql: sql || undefined,
              nodes: nodes.length ? nodes : undefined,
              isStreaming: event.type !== 'done',
              error: !!error,
            };
            return updated;
          });
        } catch {
          // skip malformed lines
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          processLine(line);
        }
      }

      // Process any remaining buffer after stream ends
      if (buffer.trim()) {
        processLine(buffer.trim());
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return;
      setMessages((prev) => {
        if (assistantIdx < 0 || assistantIdx >= prev.length) return prev;
        const updated = [...prev];
        updated[assistantIdx] = {
          role: 'assistant',
          content: (err as Error).message || 'Something went wrong.',
          isStreaming: false,
          error: true,
        };
        return updated;
      });
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, []);

  const clearChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setIsLoading(false);
  }, []);

  return { messages, isLoading, sendMessage, clearChat };
}
