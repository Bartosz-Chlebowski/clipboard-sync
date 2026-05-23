import { useCallback, useEffect, useState } from 'react';
import {
  addClipboardChangeListener,
  isServiceRunning,
  requestBatteryOptimizationExemption,
  isIgnoringBatteryOptimizations,
  startClipboardService,
  stopClipboardService,
} from 'clipboard-native';

export interface AutoSyncState {
  enabled: boolean;
  lastSentText: string | null;
  lastSentAt: Date | null;
}

export interface AutoSyncControls {
  state: AutoSyncState;
  toggle: (wsUrl: string | null) => Promise<void>;
}

export function useAutoSync(): AutoSyncControls {
  const [state, setState] = useState<AutoSyncState>({
    enabled: false,
    lastSentText: null,
    lastSentAt: null,
  });

  // Sync toggle state with service on mount (handles process restart with sticky service)
  useEffect(() => {
    isServiceRunning().then((running) => {
      if (running) setState((s) => ({ ...s, enabled: true }));
    });
  }, []);

  // Track last sent text for UI display via native clipboard change events
  useEffect(() => {
    if (!state.enabled) return;
    const sub = addClipboardChangeListener((text) => {
      setState((s) => ({ ...s, lastSentText: text, lastSentAt: new Date() }));
    });
    return () => sub.remove();
  }, [state.enabled]);

  const toggle = useCallback(async (wsUrl: string | null) => {
    const next = !state.enabled;

    if (next) {
      await startClipboardService(wsUrl);

      try {
        const ignoring = await isIgnoringBatteryOptimizations();
        if (!ignoring) await requestBatteryOptimizationExemption();
      } catch {
        // non-fatal
      }
    } else {
      await stopClipboardService();
    }

    setState((s) => ({ ...s, enabled: next }));
  }, [state.enabled]);

  return { state, toggle };
}
