import { useEffect, useRef, useState, useCallback } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export interface OrderStreamEvent {
  orderId: string;
  status: string;
  timelineLogs?: Array<{
    tag: string;
    message: string;
    timestamp: string;
    level?: string;
  }>;
  completedAt?: string | null;
  errorMessage?: string | null;
  epicDisplayName?: string | null;
}

export interface OrderStepEvent {
  orderId: string;
  step: string;
  status: 'started' | 'completed' | 'failed';
  message: string;
  timestamp: string;
  progress: number;
}

export type OrderStreamState =
  | { phase: 'idle' }
  | { phase: 'connecting' }
  | { phase: 'open'; lastEvent: OrderStreamEvent | null }
  | { phase: 'closed'; reason: 'terminal' | 'error' };

const TERMINAL_STEPS = new Set(['completed', 'failed']);

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

/**
 * Маппит новый формат StepEvent в legacy OrderStreamEvent для обратной совместимости.
 */
export function mapToLegacy(event: OrderStepEvent): OrderStreamEvent {
  return {
    orderId: event.orderId,
    status: event.step === 'completed'
      ? 'completed'
      : event.step === 'failed'
        ? 'failed'
        : 'processing',
    timelineLogs: [{
      tag: `[${event.step}]`,
      message: event.message,
      timestamp: event.timestamp,
      level: event.status === 'failed' ? 'error' : 'info',
    }],
  };
}

/**
 * Подписывается на SSE-поток обновлений статуса заказа.
 * Бэкенд: GET /api/orders/:orderId/stream (см. orders.controller.ts @Sse).
 *
 * Поток автоматически закрывается, когда заказ переходит в терминальный step
 * (completed/failed). Переподключение с экспоненциальным backoff при разрывах.
 */
export function useOrderStream(orderId: string | null | undefined): {
  state: OrderStreamState;
  lastEvent: OrderStreamEvent | null;
  currentStep: string | null;
  progress: number;
  stepHistory: OrderStepEvent[];
} {
  const [state, setState] = useState<OrderStreamState>({ phase: 'idle' });
  const [lastEvent, setLastEvent] = useState<OrderStreamEvent | null>(null);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [stepHistory, setStepHistory] = useState<OrderStepEvent[]>([]);

  const backoffRef = useRef<number>(INITIAL_BACKOFF_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const terminalRef = useRef<boolean>(false);

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!orderId) return;
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    terminalRef.current = false;
    backoffRef.current = INITIAL_BACKOFF_MS;

    const connect = () => {
      if (terminalRef.current) return;

      setState({ phase: 'connecting' });

      const url = `${API_URL}/orders/${encodeURIComponent(orderId)}/stream`;
      const source = new EventSource(url);
      sourceRef.current = source;

      source.onopen = () => {
        // Reset backoff on successful connection
        backoffRef.current = INITIAL_BACKOFF_MS;
        setState({ phase: 'open', lastEvent: null });
      };

      source.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as OrderStepEvent;

          // Update step-based state
          setCurrentStep(data.step);
          setProgress(data.progress);
          setStepHistory((prev) => [...prev, data]);

          // Map to legacy format for backward compatibility
          const legacyEvent = mapToLegacy(data);
          setLastEvent(legacyEvent);
          setState({ phase: 'open', lastEvent: legacyEvent });

          // Close on terminal step
          if (TERMINAL_STEPS.has(data.step)) {
            terminalRef.current = true;
            source.close();
            sourceRef.current = null;
            setState({ phase: 'closed', reason: 'terminal' });
          }
        } catch (err) {
          console.warn('Failed to parse SSE event:', err);
        }
      };

      source.onerror = () => {
        source.close();
        sourceRef.current = null;

        // Don't reconnect if we already reached terminal state
        if (terminalRef.current) return;

        setState({ phase: 'closed', reason: 'error' });

        // Exponential backoff reconnection
        const delay = backoffRef.current;
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);

        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, delay);
      };
    };

    connect();

    return () => {
      terminalRef.current = true;
      cleanup();
    };
  }, [orderId, cleanup]);

  return { state, lastEvent, currentStep, progress, stepHistory };
}
