import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { DEVICE_ID } from './lib/constants';
import type { ClipboardUpdateMessage } from './lib/types';
import { getWsUrl, saveWsUrl } from './lib/storage';
import { useWebSocket, type WsStatus } from './lib/websocket';

const BLUE = '#2563EB';
const GREEN = '#16A34A';
const RED = '#DC2626';
const YELLOW = '#D97706';

type SendStatus = 'idle' | 'loading' | 'ok' | 'error';

interface SendState {
  kind: SendStatus;
  message: string;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const WS_STATUS_COLOR: Record<WsStatus, string> = {
  connected: GREEN,
  connecting: YELLOW,
  reconnecting: YELLOW,
  disconnected: RED,
};

const WS_STATUS_LABEL: Record<WsStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting...',
  reconnecting: 'Reconnecting...',
  disconnected: 'Disconnected',
};

export default function App() {
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [wsUrlDraft, setWsUrlDraft] = useState('');
  const [clipboardText, setClipboardText] = useState('');
  const [sendState, setSendState] = useState<SendState>({ kind: 'idle', message: '' });
  const [settingsVisible, setSettingsVisible] = useState(false);
  const appState = useRef(AppState.currentState);

  const { status: wsStatus, send: wsSend, reconnect: wsReconnect } = useWebSocket(wsUrl);

  useEffect(() => {
    getWsUrl().then((url) => {
      setWsUrl(url);
      setWsUrlDraft(url);
    });
  }, []);

  const refreshClipboard = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    setClipboardText(text);
  }, []);

  useEffect(() => {
    refreshClipboard();
    const sub = AppState.addEventListener('change', (next) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        refreshClipboard();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [refreshClipboard]);

  async function handleSend() {
    setSendState({ kind: 'loading', message: '' });
    const text = await Clipboard.getStringAsync();
    setClipboardText(text);

    if (!text.trim()) {
      setSendState({ kind: 'error', message: 'Clipboard is empty - copy something first' });
      return;
    }

    if (wsStatus !== 'connected') {
      setSendState({ kind: 'error', message: 'Not connected to Mac' });
      return;
    }

    const msg: ClipboardUpdateMessage = {
      type: 'clipboard_update',
      eventId: Crypto.randomUUID(),
      sourceDeviceId: DEVICE_ID,
      source: 'android',
      text,
      timestamp: Date.now(),
    };

    const sent = wsSend(msg);
    if (sent) {
      setSendState({ kind: 'ok', message: formatTime(new Date()) });
    } else {
      setSendState({ kind: 'error', message: 'Send failed - not connected' });
    }
  }

  async function handleSaveUrl() {
    const trimmed = wsUrlDraft.trim();
    if (!trimmed) return;
    await saveWsUrl(trimmed);
    setWsUrl(trimmed);
    setSettingsVisible(false);
    setSendState({ kind: 'idle', message: '' });
  }

  const clipboardPreview =
    clipboardText.length > 120 ? clipboardText.slice(0, 120) + '...' : clipboardText;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Clipboard Sync</Text>
        <Pressable
          onPress={() => {
            setWsUrlDraft(wsUrl ?? '');
            setSettingsVisible((v) => !v);
          }}
          style={styles.settingsBtn}
          hitSlop={12}
        >
          <Text style={styles.settingsBtnText}>{settingsVisible ? 'Cancel' : 'Settings'}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {settingsVisible ? (
          <View style={styles.card}>
            <Text style={styles.label}>Mac WS URL</Text>
            <TextInput
              style={styles.input}
              value={wsUrlDraft}
              onChangeText={setWsUrlDraft}
              placeholder="ws://192.168.1.10:8787/ws"
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={styles.hint}>
              Format: ws://IP:port/ws{'\n'}
              Example: ws://192.168.1.10:8787/ws
            </Text>
            <Pressable style={styles.btnSecondary} onPress={handleSaveUrl}>
              <Text style={styles.btnSecondaryText}>Save &amp; Reconnect</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.statusCard}>
            <View style={styles.statusRow}>
              <View
                style={[styles.statusDot, { backgroundColor: WS_STATUS_COLOR[wsStatus] }]}
              />
              <Text style={styles.statusLabel}>{WS_STATUS_LABEL[wsStatus]}</Text>
            </View>
            {wsUrl ? (
              <Text style={styles.statusUrl} numberOfLines={1}>
                {wsUrl}
              </Text>
            ) : null}
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.label}>Current clipboard</Text>
            <Pressable onPress={refreshClipboard} hitSlop={8}>
              <Text style={styles.refreshBtn}>Refresh</Text>
            </Pressable>
          </View>
          {clipboardText ? (
            <Text style={styles.clipboardText}>{clipboardPreview}</Text>
          ) : (
            <Text style={styles.clipboardEmpty}>Empty - copy something first</Text>
          )}
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.btnPrimary,
            (wsStatus !== 'connected' || sendState.kind === 'loading') && styles.btnDisabled,
            pressed && styles.btnPressed,
          ]}
          onPress={handleSend}
          disabled={wsStatus !== 'connected' || sendState.kind === 'loading'}
        >
          {sendState.kind === 'loading' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnPrimaryText}>Send clipboard to Mac</Text>
          )}
        </Pressable>

        {sendState.kind !== 'idle' && sendState.kind !== 'loading' && (
          <Text
            style={[
              styles.statusText,
              sendState.kind === 'ok' ? styles.textOk : styles.textError,
            ]}
          >
            {sendState.kind === 'ok'
              ? `Sent at ${sendState.message}`
              : `Error: ${sendState.message}`}
          </Text>
        )}

        {wsStatus !== 'connected' && (
          <Pressable
            style={({ pressed }) => [styles.btnOutline, pressed && styles.btnPressed]}
            onPress={wsReconnect}
          >
            <Text style={styles.btnOutlineText}>Reconnect</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F3F4F6' },
  header: {
    backgroundColor: BLUE,
    paddingTop: 56,
    paddingBottom: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  settingsBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  settingsBtnText: { color: '#fff', fontSize: 14 },
  scroll: { padding: 20, gap: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { fontSize: 15, fontWeight: '600', color: '#111827' },
  statusUrl: { fontSize: 12, color: '#6B7280' },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  refreshBtn: { fontSize: 13, color: BLUE },
  clipboardText: { fontSize: 15, color: '#111827', lineHeight: 22 },
  clipboardEmpty: { fontSize: 14, color: '#9CA3AF', fontStyle: 'italic' },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#F9FAFB',
  },
  hint: { fontSize: 12, color: '#9CA3AF', lineHeight: 18 },
  btnPrimary: { backgroundColor: BLUE, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  btnPrimaryText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  btnOutline: {
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  btnOutlineText: { color: '#374151', fontSize: 15, fontWeight: '500' },
  btnSecondary: {
    backgroundColor: BLUE,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnSecondaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.75 },
  statusText: { fontSize: 14, textAlign: 'center', marginTop: -4 },
  textOk: { color: GREEN },
  textError: { color: RED },
});
