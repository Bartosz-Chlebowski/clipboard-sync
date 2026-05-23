import * as Clipboard from 'expo-clipboard';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  StatusBar as NativeStatusBar,
  View,
} from 'react-native';
import {
  getShizukuStatus,
  isReadClipboardAllowed,
  requestShizukuPermission,
  sendClipboardNow,
  addWsStatusListener,
  addClipboardReceivedListener,
  addDiscoveryStatusListener,
  discoverMacWsUrl,
  startClipboardService,
  type WsStatus,
  type ShizukuStatus,
  type DiscoveryStatus,
} from 'clipboard-native';
import { checkHealth } from './lib/api';
import { getWsUrl, saveWsUrl } from './lib/storage';
import { useAutoSync } from './lib/sync';

const COLORS = {
  bg: '#EEF2F7',
  surface: '#FFFFFF',
  surfaceMuted: '#F7F9FC',
  ink: '#111827',
  inkSoft: '#4B5563',
  muted: '#6B7280',
  line: '#D9E0EA',
  blue: '#2563EB',
  blueDark: '#163D93',
  blueSoft: '#DBEAFE',
  green: '#16A34A',
  greenSoft: '#DCFCE7',
  red: '#DC2626',
  redSoft: '#FEE2E2',
  yellow: '#D97706',
  yellowSoft: '#FEF3C7',
};

const TOP_INSET =
  Platform.OS === 'android' ? Math.max(NativeStatusBar.currentHeight ?? 0, 32) : 0;

type SendStatus = 'idle' | 'loading' | 'ok' | 'error';

interface SendState {
  kind: SendStatus;
  message: string;
}

type Tone = 'ok' | 'warn' | 'error' | 'muted';

function wsUrlToHttpBase(url: string): string {
  return url.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:').replace(/\/ws\/?$/, '');
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const WS_STATUS_TONE: Record<WsStatus, Tone> = {
  connected: 'ok',
  connecting: 'warn',
  reconnecting: 'warn',
  disconnected: 'error',
};

const WS_STATUS_LABEL: Record<WsStatus, string> = {
  connected: 'Połączono',
  connecting: 'Łączenie',
  reconnecting: 'Ponowne łączenie',
  disconnected: 'Rozłączono',
};

const SHIZUKU_UID_LABEL: Record<number, string> = {
  0: 'root',
  2000: 'ADB shell',
};

function toneStyles(tone: Tone) {
  switch (tone) {
    case 'ok':
      return {
        text: styles.textOk,
        badge: styles.badgeOk,
        dot: COLORS.green,
      };
    case 'warn':
      return {
        text: styles.textWarn,
        badge: styles.badgeWarn,
        dot: COLORS.yellow,
      };
    case 'error':
      return {
        text: styles.textError,
        badge: styles.badgeError,
        dot: COLORS.red,
      };
    default:
      return {
        text: styles.textMuted,
        badge: styles.badgeMuted,
        dot: COLORS.muted,
      };
  }
}

function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  const toneStyle = toneStyles(tone);

  return (
    <View style={[styles.statusBadge, toneStyle.badge]}>
      <View style={[styles.statusBadgeDot, { backgroundColor: toneStyle.dot }]} />
      <Text style={[styles.statusBadgeText, toneStyle.text]}>{label}</Text>
    </View>
  );
}

function SignalRow({
  label,
  value,
  tone,
  actionLabel,
  onAction,
}: {
  label: string;
  value: string;
  tone: Tone;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const toneStyle = toneStyles(tone);

  return (
    <View style={styles.signalRow}>
      <View style={[styles.signalDot, { backgroundColor: toneStyle.dot }]} />
      <View style={styles.signalCopy}>
        <Text style={styles.signalLabel}>{label}</Text>
        <Text style={[styles.signalValue, toneStyle.text]} numberOfLines={2}>
          {value}
        </Text>
      </View>
      {actionLabel && onAction ? (
        <Pressable style={styles.miniButton} onPress={onAction} hitSlop={8}>
          <Text style={styles.miniButtonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function App() {
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [wsUrlDraft, setWsUrlDraft] = useState('');
  const [wsStatus, setWsStatus] = useState<WsStatus>('disconnected');
  const [clipboardText, setClipboardText] = useState('');
  const [sendState, setSendState] = useState<SendState>({ kind: 'idle', message: '' });
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [privilegedClipboard, setPrivilegedClipboard] = useState(false);
  const [shizukuStatus, setShizukuStatus] = useState<ShizukuStatus | null>(null);
  const [discoveryStatus, setDiscoveryStatus] = useState<DiscoveryStatus>('idle');
  const [macDeviceName, setMacDeviceName] = useState<string | null>(null);
  const appState = useRef(AppState.currentState);

  const { state: autoSync, toggle: toggleAutoSync } = useAutoSync();

  // Load saved WS URL on mount
  useEffect(() => {
    getWsUrl().then((url) => {
      setWsUrl(url);
      setWsUrlDraft(url ?? '');
      if (!url) {
        void handleDiscoverMac();
      }
    });
  }, []);

  // Listen to native WS status events
  useEffect(() => {
    const sub = addWsStatusListener(setWsStatus);
    return () => sub.remove();
  }, []);

  // Listen for clipboard received from Mac -> update UI
  useEffect(() => {
    const sub = addClipboardReceivedListener((text) => {
      setClipboardText(text);
    });
    return () => sub.remove();
  }, []);

  // Native service discovery updates (also fires while foreground service reconnects)
  useEffect(() => {
    const sub = addDiscoveryStatusListener((status, url) => {
      setDiscoveryStatus(status);
      if (url) {
        setWsUrl(url);
        setWsUrlDraft(url);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshMacDeviceName() {
      if (!wsUrl) {
        setMacDeviceName(null);
        return;
      }

      const health = await checkHealth(wsUrlToHttpBase(wsUrl));
      if (!cancelled) {
        setMacDeviceName(health.status === 'ok' && health.device ? health.device : null);
      }
    }

    void refreshMacDeviceName();
    return () => {
      cancelled = true;
    };
  }, [wsUrl]);

  const refreshPrivilegedClipboard = useCallback(async () => {
    try {
      setPrivilegedClipboard(await isReadClipboardAllowed());
      setShizukuStatus(await getShizukuStatus());
    } catch {
      setPrivilegedClipboard(false);
      setShizukuStatus(null);
    }
  }, []);

  const refreshClipboard = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    setClipboardText(text);
  }, []);

  useEffect(() => {
    refreshClipboard();
    refreshPrivilegedClipboard();
    const sub = AppState.addEventListener('change', (next) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        refreshClipboard();
        refreshPrivilegedClipboard();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [refreshClipboard, refreshPrivilegedClipboard]);

  async function handleSend() {
    setSendState({ kind: 'loading', message: '' });
    const text = await Clipboard.getStringAsync();
    setClipboardText(text);

    if (!text.trim()) {
      setSendState({ kind: 'error', message: 'Schowek jest pusty' });
      return;
    }

    if (wsStatus !== 'connected') {
      setSendState({ kind: 'error', message: 'Brak połączenia z Mac' });
      return;
    }

    const sent = await sendClipboardNow(text);
    if (sent) {
      setSendState({ kind: 'ok', message: formatTime(new Date()) });
    } else {
      setSendState({ kind: 'error', message: 'Wysyłka nie powiodła się' });
    }
  }

  async function handleSaveUrl() {
    const trimmed = wsUrlDraft.trim();
    if (!trimmed) return;
    await saveWsUrl(trimmed);
    setWsUrl(trimmed);
    setSettingsVisible(false);
    setSendState({ kind: 'idle', message: '' });

    // If service is running, restart with new URL
    if (autoSync.enabled) {
      await startClipboardService(trimmed);
    }
  }

  async function handleDiscoverMac(): Promise<string | null> {
    setDiscoveryStatus('searching');
    try {
      const discovered = await discoverMacWsUrl(8000);
      if (!discovered) {
        setDiscoveryStatus('not_found');
        return null;
      }

      await saveWsUrl(discovered);
      setWsUrl(discovered);
      setWsUrlDraft(discovered);
      setDiscoveryStatus('found');

      if (autoSync.enabled) {
        await startClipboardService(discovered);
      }

      return discovered;
    } catch {
      setDiscoveryStatus('not_found');
      return null;
    }
  }

  async function handleToggleAutoSync() {
    let nextUrl = wsUrl;
    if (!autoSync.enabled && !nextUrl) {
      nextUrl = await handleDiscoverMac();
    }
    await toggleAutoSync(nextUrl);
  }

  async function handleRequestShizukuPermission() {
    await requestShizukuPermission();
    setTimeout(refreshPrivilegedClipboard, 700);
  }

  const clipboardPreview =
    clipboardText.length > 180 ? clipboardText.slice(0, 180) + '...' : clipboardText;

  const autoSyncPreview = autoSync.lastSentText
    ? autoSync.lastSentText.length > 90
      ? autoSync.lastSentText.slice(0, 90) + '...'
      : autoSync.lastSentText
    : null;

  const shizukuUidLabel =
    shizukuStatus?.uid != null
      ? SHIZUKU_UID_LABEL[shizukuStatus.uid] ?? `uid ${shizukuStatus.uid}`
      : null;

  const shizukuLabel = !shizukuStatus?.available
    ? 'Shizuku nie działa'
    : shizukuStatus.permissionGranted
      ? `Autoryzacja aktywna (${shizukuUidLabel})`
      : 'Wymagana autoryzacja';

  const discoveryLabel =
    discoveryStatus === 'searching'
      ? 'Szukam Mac w sieci'
      : discoveryStatus === 'found'
        ? 'Mac wykryty automatycznie'
        : discoveryStatus === 'not_found'
          ? 'Nie znaleziono Mac w Wi-Fi'
          : 'Autowykrywanie gotowe';

  const discoveryTone: Tone =
    discoveryStatus === 'not_found' ? 'warn' : discoveryStatus === 'searching' ? 'muted' : 'ok';

  const canSend = wsStatus === 'connected' && sendState.kind !== 'loading';
  const destinationLabel = macDeviceName ?? (wsUrl ? 'Mac zapisany' : 'Brak zapisanego Mac');
  const syncStateLabel =
    wsStatus === 'connected'
      ? autoSync.enabled
        ? 'Synchronizacja aktywna'
        : 'Gotowe do wysyłki'
      : autoSync.enabled
        ? 'Szukam Maca'
        : 'Wymaga połączenia';

  return (
    <View style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ExpoStatusBar style="dark" backgroundColor={COLORS.bg} />

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.topBar}>
            <View>
              <Text style={styles.kicker}>Clipboard Sync</Text>
              <Text style={styles.headerTitle}>Schowek pod kontrolą</Text>
            </View>
            <Pressable
              onPress={() => {
                setWsUrlDraft(wsUrl ?? '');
                setSettingsVisible((v) => !v);
              }}
              style={({ pressed }) => [styles.settingsButton, pressed && styles.buttonPressed]}
              hitSlop={12}
            >
              <Text style={styles.settingsButtonText}>
                {settingsVisible ? 'Zamknij' : 'Ustawienia'}
              </Text>
            </Pressable>
          </View>

          {settingsVisible ? (
            <>
              <View style={styles.panel}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Połączenie z Mac</Text>
                  <StatusBadge label={discoveryLabel} tone={discoveryTone} />
                </View>

                <TextInput
                  style={styles.input}
                  value={wsUrlDraft}
                  onChangeText={setWsUrlDraft}
                  placeholder="ws://192.168.1.10:8787/ws"
                  placeholderTextColor="#8B95A5"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />

                <View style={styles.settingsActions}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      discoveryStatus === 'searching' && styles.buttonDisabled,
                      pressed && styles.buttonPressed,
                    ]}
                    onPress={handleDiscoverMac}
                    disabled={discoveryStatus === 'searching'}
                  >
                    {discoveryStatus === 'searching' ? (
                      <ActivityIndicator color={COLORS.blueDark} />
                    ) : (
                      <Text style={styles.secondaryButtonText}>Wykryj automatycznie</Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.primarySmallButton,
                      pressed && styles.buttonPressed,
                    ]}
                    onPress={handleSaveUrl}
                  >
                    <Text style={styles.primarySmallButtonText}>Zapisz</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.panel}>
                <View>
                  <Text style={styles.sectionTitle}>Diagnostyka</Text>
                  <Text style={styles.sectionSubtitle}>
                    Szczegóły techniczne przydatne tylko przy konfiguracji.
                  </Text>
                </View>

                <View style={styles.signalGroup}>
                  <SignalRow
                    label="Wykrywanie"
                    value={discoveryLabel}
                    tone={discoveryTone}
                    actionLabel={discoveryStatus !== 'searching' ? 'Szukaj' : undefined}
                    onAction={discoveryStatus !== 'searching' ? handleDiscoverMac : undefined}
                  />
                  <SignalRow label="Szyfrowanie" value="Sesja negocjowana automatycznie" tone="ok" />
                  <SignalRow
                    label="Shizuku"
                    value={shizukuLabel}
                    tone={shizukuStatus?.permissionGranted ? 'ok' : 'warn'}
                    actionLabel={
                      shizukuStatus?.available && !shizukuStatus.permissionGranted
                        ? 'Zezwól'
                        : undefined
                    }
                    onAction={
                      shizukuStatus?.available && !shizukuStatus.permissionGranted
                        ? handleRequestShizukuPermission
                        : undefined
                    }
                  />
                  <SignalRow
                    label="ADB app-op"
                    value={
                      privilegedClipboard ? 'Dostęp do schowka aktywny' : 'Brak dostępu do schowka'
                    }
                    tone={privilegedClipboard ? 'ok' : 'warn'}
                  />
                </View>
              </View>
            </>
          ) : (
            <View style={styles.heroPanel}>
              <View style={styles.heroTopRow}>
                <StatusBadge label={WS_STATUS_LABEL[wsStatus]} tone={WS_STATUS_TONE[wsStatus]} />
                <Text style={styles.heroMeta}>{syncStateLabel}</Text>
              </View>

              <Text style={styles.destinationText} numberOfLines={1}>
                {destinationLabel}
              </Text>
              <Text style={styles.destinationSubtext} numberOfLines={1}>
                {wsUrl ?? discoveryLabel}
              </Text>
            </View>
          )}

          <View style={styles.panel}>
            <View style={styles.autoSyncRow}>
              <View style={styles.autoSyncCopy}>
                <Text style={styles.sectionTitle}>Synchronizacja</Text>
                <Text style={styles.sectionSubtitle}>
                  {autoSync.enabled
                    ? 'Nowe kopie trafią na Mac automatycznie.'
                    : 'Włącz, kiedy chcesz synchronizować bez dotykania telefonu.'}
                </Text>
              </View>
              <Switch
                value={autoSync.enabled}
                onValueChange={handleToggleAutoSync}
                trackColor={{ false: COLORS.line, true: COLORS.blue }}
                thumbColor="#fff"
              />
            </View>

            {autoSync.enabled && autoSyncPreview !== null && (
              <View style={styles.lastSentBox}>
                <View style={styles.lastSentHeader}>
                  <Text style={styles.lastSentLabel}>Ostatnio wysłane</Text>
                  {autoSync.lastSentAt && (
                    <Text style={styles.lastSentTime}>{formatTime(autoSync.lastSentAt)}</Text>
                  )}
                </View>
                <Text style={styles.lastSentText} numberOfLines={3}>
                  {autoSyncPreview}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.panel}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>Schowek</Text>
                <Text style={styles.sectionSubtitle}>
                  {clipboardText ? `${clipboardText.length} znaków` : 'Brak tekstu'}
                </Text>
              </View>
              <Pressable style={styles.ghostButton} onPress={refreshClipboard} hitSlop={8}>
                <Text style={styles.ghostButtonText}>Odśwież</Text>
              </Pressable>
            </View>

            <View style={styles.clipboardBox}>
              {clipboardText ? (
                <Text style={styles.clipboardText} numberOfLines={7}>
                  {clipboardPreview}
                </Text>
              ) : (
                <Text style={styles.clipboardEmpty}>Skopiuj tekst, aby pojawił się tutaj.</Text>
              )}
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              !canSend && styles.buttonDisabled,
              pressed && canSend && styles.buttonPressed,
            ]}
            onPress={handleSend}
            disabled={!canSend}
          >
            {sendState.kind === 'loading' ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {wsStatus === 'connected' ? 'Wyślij do Mac' : 'Czekam na połączenie'}
              </Text>
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
                ? `Wysłano o ${sendState.message}`
                : `Błąd: ${sendState.message}`}
            </Text>
          )}

          {wsStatus !== 'connected' && autoSync.enabled && (
            <Text style={[styles.statusText, styles.textMuted]}>
              Usługa działa w tle i próbuje wrócić do połączenia.
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingTop: TOP_INSET,
  },
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scroll: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 14,
  },
  topBar: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  kicker: {
    color: COLORS.blue,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  headerTitle: {
    color: COLORS.ink,
    fontSize: 25,
    lineHeight: 31,
    fontWeight: '800',
    letterSpacing: 0,
  },
  settingsButton: {
    minHeight: 38,
    paddingHorizontal: 13,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  settingsButtonText: {
    color: COLORS.blueDark,
    fontSize: 13,
    fontWeight: '800',
  },
  heroPanel: {
    backgroundColor: COLORS.ink,
    borderRadius: 8,
    padding: 18,
    gap: 12,
    shadowColor: '#101828',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroMeta: {
    flexShrink: 1,
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  destinationText: {
    color: '#FFFFFF',
    fontSize: 27,
    lineHeight: 33,
    fontWeight: '800',
    letterSpacing: 0,
  },
  destinationSubtext: {
    color: '#CBD5E1',
    fontSize: 13,
  },
  panel: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    padding: 14,
    gap: 14,
    borderWidth: 1,
    borderColor: '#E4EAF2',
    shadowColor: '#101828',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    color: COLORS.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    letterSpacing: 0,
  },
  sectionSubtitle: {
    marginTop: 2,
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  statusBadge: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  statusBadgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  badgeOk: {
    backgroundColor: COLORS.greenSoft,
  },
  badgeWarn: {
    backgroundColor: COLORS.yellowSoft,
  },
  badgeError: {
    backgroundColor: COLORS.redSoft,
  },
  badgeMuted: {
    backgroundColor: COLORS.surfaceMuted,
  },
  autoSyncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  autoSyncCopy: {
    flex: 1,
  },
  signalGroup: {
    gap: 10,
  },
  signalRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 2,
  },
  signalDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  signalCopy: {
    flex: 1,
    gap: 1,
  },
  signalLabel: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  signalValue: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  miniButton: {
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 11,
    borderRadius: 8,
    backgroundColor: COLORS.blueSoft,
  },
  miniButtonText: {
    color: COLORS.blueDark,
    fontSize: 12,
    fontWeight: '800',
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 15,
    color: COLORS.ink,
    backgroundColor: COLORS.surfaceMuted,
  },
  settingsActions: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryButton: {
    minHeight: 46,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: COLORS.blueSoft,
  },
  secondaryButtonText: {
    color: COLORS.blueDark,
    fontSize: 14,
    fontWeight: '800',
  },
  primarySmallButton: {
    minHeight: 46,
    minWidth: 92,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: COLORS.blue,
  },
  primarySmallButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  ghostButton: {
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceMuted,
  },
  ghostButtonText: {
    color: COLORS.blueDark,
    fontSize: 12,
    fontWeight: '800',
  },
  clipboardBox: {
    minHeight: 112,
    borderRadius: 8,
    padding: 13,
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: '#E7ECF3',
  },
  clipboardText: {
    fontSize: 15,
    color: COLORS.ink,
    lineHeight: 22,
  },
  clipboardEmpty: {
    fontSize: 14,
    color: COLORS.muted,
    lineHeight: 20,
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.blue,
    shadowColor: COLORS.blueDark,
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
    elevation: 4,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    opacity: 0.72,
  },
  statusText: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  textOk: {
    color: COLORS.green,
  },
  textError: {
    color: COLORS.red,
  },
  textWarn: {
    color: COLORS.yellow,
  },
  textMuted: {
    color: COLORS.muted,
  },
  lastSentBox: {
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 8,
    padding: 12,
    gap: 7,
    borderWidth: 1,
    borderColor: '#E7ECF3',
  },
  lastSentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  lastSentLabel: {
    fontSize: 11,
    color: COLORS.muted,
    fontWeight: '800',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  lastSentText: {
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.inkSoft,
  },
  lastSentTime: {
    fontSize: 11,
    color: COLORS.muted,
    fontWeight: '700',
  },
});
