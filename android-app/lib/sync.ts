import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addClipboardChangeListener,
  isServiceRunning,
  requestBatteryOptimizationExemption,
  isIgnoringBatteryOptimizations,
  startClipboardService,
  stopClipboardService,
} from 'clipboard-native';
import { DEVICE_ID } from './constants';
import type { ClipboardUpdateMessage } from './types';
import type { WsStatus } from './websocket';

export interface AutoSyncState {
  enabled: boolean;
  lastSentText: string | null;
  lastSentAt: Date | null;
}

export interface AutoSyncControls {
  state: AutoSyncState;
  toggle: () => Promise<void>;
  notifyReceivedFromMac: (text: string) => void;
}

export function useAutoSync(
  wsSend: (msg: object) => boolean,
  wsStatus: WsStatus,
): AutoSyncControls {
  const [state, setState] = useState<AutoSyncState>({
    enabled: false,
    lastSentText: null,
    lastSentAt: null,
  });

  const lastSentText = useRef<string | null>(null);
  const lastReceivedText = useRef<string | null>(null);
  const wsStatusRef = useRef(wsStatus);
  wsStatusRef.current = wsStatus;
  const wsSendRef = useRef(wsSend);
  wsSendRef.current = wsSend;

  // Sync toggle state with service on mount (handles process restart with sticky service)
  useEffect(() => {
    isServiceRunning().then((running) => {
      if (running) {
        setState((s) => ({ ...s, enabled: true }));
      }
    });
  }, []);

  const sendClipboard = useCallback((text: string) => {
    if (text === lastSentText.current) return;
    if (text === lastReceivedText.current) return;
    if (text.trim() === '') return;
    if (wsStatusRef.current !== 'connected') return;

    lastSentText.current = text;

    const msg: ClipboardUpdateMessage = {
      type: 'clipboard_update',
      eventId: Crypto.randomUUID(),
      sourceDeviceId: DEVICE_ID,
      source: 'android',
      text,
      timestamp: Date.now(),
    };

    wsSendRef.current(msg);
    setState((s) => ({ ...s, lastSentText: text, lastSentAt: new Date() }));
  }, []);

  // Subscribe to clipboard events while enabled
  useEffect(() => {
    if (!state.enabled) return;

    const sub = addClipboardChangeListener((text) => {
      sendClipboard(text);
    });

    return () => sub.remove();
  }, [state.enabled, sendClipboard]);

  const toggle = useCallback(async () => {
    const next = !state.enabled;

    if (next) {
      await startClipboardService();

      // Best-effort: prompt battery optimization exemption on first start
      try {
        const ignoring = await isIgnoringBatteryOptimizations();
        if (!ignoring) {
          await requestBatteryOptimizationExemption();
        }
      } catch {
        // Non-fatal: service runs, but Samsung may throttle it
      }
    } else {
      await stopClipboardService();
    }

    setState((s) => ({ ...s, enabled: next }));
  }, [state.enabled]);

  const notifyReceivedFromMac = useCallback((text: string) => {
    lastReceivedText.current = text;
  }, []);

  return { state, toggle, notifyReceivedFromMac };
}
