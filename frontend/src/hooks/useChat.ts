import { useCallback, useRef, useState } from 'react';
import type { ChatMessage, ChatNodeRef } from '../types';

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (text: string) => {
    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    // Build history from previous messages (last 6 for context)
    const history = messages
      .filter((m) => !m.isStreaming && !m.error)
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));

    // Placeholder assistant message
    const assistantIdx = messages.length + 1; // +1 for user msg just added
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: '', isStreaming: true },
    ]);

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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
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

            // Update the assistant message in-place
            setMessages((prev) => {
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
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return;
      setMessages((prev) => {
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
  }, [messages]);

  const clearChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setIsLoading(false);
  }, []);

  return { messages, isLoading, sendMessage, clearChat };
}
