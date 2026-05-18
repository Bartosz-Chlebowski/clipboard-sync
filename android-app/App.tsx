import * as Clipboard from 'expo-clipboard';
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
import { checkHealth, sendToMac } from './lib/api';
import { getMacAddress, saveMacAddress } from './lib/storage';

type StatusKind = 'idle' | 'loading' | 'ok' | 'error';

interface StatusState {
  kind: StatusKind;
  message: string;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function App() {
  const [macAddress, setMacAddress] = useState('');
  const [macAddressDraft, setMacAddressDraft] = useState('');
  const [clipboardText, setClipboardText] = useState('');
  const [sendStatus, setSendStatus] = useState<StatusState>({ kind: 'idle', message: '' });
  const [healthStatus, setHealthStatus] = useState<StatusState>({ kind: 'idle', message: '' });
  const [settingsVisible, setSettingsVisible] = useState(false);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    getMacAddress().then((addr) => {
      setMacAddress(addr);
      setMacAddressDraft(addr);
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
    setSendStatus({ kind: 'loading', message: '' });
    const text = await Clipboard.getStringAsync();
    setClipboardText(text);

    if (!text.trim()) {
      setSendStatus({ kind: 'error', message: 'Clipboard is empty - copy something first' });
      return;
    }

    const result = await sendToMac(macAddress, text);
    if (result.status === 'ok') {
      setSendStatus({ kind: 'ok', message: formatTime(new Date()) });
    } else {
      setSendStatus({ kind: 'error', message: result.message ?? 'Unknown error' });
    }
  }

  async function handleTestConnection() {
    setHealthStatus({ kind: 'loading', message: '' });
    const result = await checkHealth(macAddress);
    if (result.status === 'ok') {
      setHealthStatus({ kind: 'ok', message: `device: ${result.device ?? 'unknown'}` });
    } else {
      setHealthStatus({ kind: 'error', message: result.device ?? 'Unreachable' });
    }
  }

  async function handleSaveAddress() {
    const trimmed = macAddressDraft.trim();
    if (!trimmed) return;
    await saveMacAddress(trimmed);
    setMacAddress(trimmed);
    setSettingsVisible(false);
    setSendStatus({ kind: 'idle', message: '' });
    setHealthStatus({ kind: 'idle', message: '' });
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
            setMacAddressDraft(macAddress);
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
            <Text style={styles.label}>Mac address</Text>
            <TextInput
              style={styles.input}
              value={macAddressDraft}
              onChangeText={setMacAddressDraft}
              placeholder="192.168.1.10:8787"
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={styles.hint}>
              Format: IP:port or hostname:port{'\n'}
              Example: 192.168.1.10:8787 or macbook.local:8787
            </Text>
            <Pressable style={styles.btnSecondary} onPress={handleSaveAddress}>
              <Text style={styles.btnSecondaryText}>Save</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.row}>
            <Text style={styles.metaLabel}>Mac: </Text>
            <Text style={styles.metaValue}>{macAddress}</Text>
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
          style={({ pressed }) => [styles.btnPrimary, pressed && styles.btnPressed]}
          onPress={handleSend}
          disabled={sendStatus.kind === 'loading'}
        >
          {sendStatus.kind === 'loading' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnPrimaryText}>Send clipboard to Mac</Text>
          )}
        </Pressable>

        {sendStatus.kind !== 'idle' && sendStatus.kind !== 'loading' && (
          <Text style={[styles.statusText, sendStatus.kind === 'ok' ? styles.statusOk : styles.statusError]}>
            {sendStatus.kind === 'ok' ? `Sent at ${sendStatus.message}` : `Error: ${sendStatus.message}`}
          </Text>
        )}

        <Pressable
          style={({ pressed }) => [styles.btnOutline, pressed && styles.btnPressed]}
          onPress={handleTestConnection}
          disabled={healthStatus.kind === 'loading'}
        >
          {healthStatus.kind === 'loading' ? (
            <ActivityIndicator color="#555" />
          ) : (
            <Text style={styles.btnOutlineText}>Test connection</Text>
          )}
        </Pressable>

        {healthStatus.kind !== 'idle' && healthStatus.kind !== 'loading' && (
          <Text style={[styles.statusText, healthStatus.kind === 'ok' ? styles.statusOk : styles.statusError]}>
            {healthStatus.kind === 'ok'
              ? `Connected - ${healthStatus.message}`
              : `Unreachable: ${healthStatus.message}`}
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const BLUE = '#2563EB';
const GREEN = '#16A34A';
const RED = '#DC2626';

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
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', textTransform: 'uppercase', letterSpacing: 0.5 },
  refreshBtn: { fontSize: 13, color: BLUE },
  clipboardText: { fontSize: 15, color: '#111827', lineHeight: 22 },
  clipboardEmpty: { fontSize: 14, color: '#9CA3AF', fontStyle: 'italic' },
  row: { flexDirection: 'row', alignItems: 'center' },
  metaLabel: { fontSize: 13, color: '#6B7280' },
  metaValue: { fontSize: 13, color: '#111827', fontWeight: '500' },
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
  btnSecondary: { backgroundColor: BLUE, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  btnSecondaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnPressed: { opacity: 0.75 },
  statusText: { fontSize: 14, textAlign: 'center', marginTop: -4 },
  statusOk: { color: GREEN },
  statusError: { color: RED },
});
