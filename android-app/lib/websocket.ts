import { useCallback, useEffect, useRef, useState } from 'react';
import { DEVICE_ID, DEVICE_NAME } from './constants';

export type WsStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

interface WsState {
  active: boolean;
  url: string | null;
  ws: WebSocket | null;
  timer: ReturnType<typeof setTimeout> | null;
  delay: number;
  onMessage: ((msg: Record<string, unknown>) => void) | undefined;
}

export function useWebSocket(
  url: string | null,
  opts: { onMessage?: (msg: Record<string, unknown>) => void } = {},
) {
  const [status, setStatus] = useState<WsStatus>('disconnected');

  const state = useRef<WsState>({
    active: false,
    url,
    ws: null,
    timer: null,
    delay: BACKOFF_BASE_MS,
    onMessage: opts.onMessage,
  });
  state.current.url = url;
  state.current.onMessage = opts.onMessage;

  function clearTimer() {
    if (state.current.timer !== null) {
      clearTimeout(state.current.timer);
      state.current.timer = null;
    }
  }

  function closeSocket() {
    const ws = state.current.ws;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
      state.current.ws = null;
    }
  }

  function connectInternal() {
    const s = state.current;
    if (!s.active || !s.url) {
      setStatus('disconnected');
      return;
    }

    clearTimer();
    closeSocket();
    setStatus('connecting');

    const ws = new WebSocket(s.url);
    state.current.ws = ws;

    ws.onopen = () => {
      if (!state.current.active || state.current.ws !== ws) return;
      state.current.delay = BACKOFF_BASE_MS;
      ws.send(
        JSON.stringify({
          type: 'hello',
          sourceDeviceId: DEVICE_ID,
          deviceName: DEVICE_NAME,
          protocolVersion: 1,
        }),
      );
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      if (!state.current.active || state.current.ws !== ws) return;
      try {
        const msg = JSON.parse(event.data) as Record<string, unknown>;
        if (msg.type === 'hello_ack') {
          setStatus('connected');
          return;
        }
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
          return;
        }
        state.current.onMessage?.(msg);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      if (!state.current.active || state.current.ws !== ws) return;
      state.current.ws = null;
      setStatus('reconnecting');
      const delay = state.current.delay;
      state.current.delay = Math.min(delay * 2, BACKOFF_MAX_MS);
      state.current.timer = setTimeout(() => {
        if (state.current.active) connectInternal();
      }, delay);
    };

    ws.onerror = () => {
      // onclose fires after onerror - reconnect handled there
    };
  }

  const reconnect = useCallback(() => {
    state.current.delay = BACKOFF_BASE_MS;
    connectInternal();
  }, []);

  const send = useCallback((message: object): boolean => {
    const ws = state.current.ws;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    state.current.active = true;
    connectInternal();
    return () => {
      state.current.active = false;
      clearTimer();
      closeSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return { status, send, reconnect };
}
