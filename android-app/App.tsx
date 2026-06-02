import * as Clipboard from 'expo-clipboard';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Linking,
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
  openShizuku,
  requestShizukuPermission,
  sendClipboardNow,
  addWsStatusListener,
  addClipboardReceivedListener,
  addDiscoveryStatusListener,
  discoverMacWsUrl,
  getTrustedMacFingerprint,
  startClipboardService,
  setTrustedMacFingerprint,
  type WsStatus,
  type ShizukuStatus,
  type DiscoveryStatus,
} from 'clipboard-native';
import { checkHealth } from './lib/api';
import {
  getOnboardingComplete,
  getWsUrl,
  saveOnboardingComplete,
  saveWsUrl,
} from './lib/storage';
import { useAutoSync } from './lib/sync';

const COLORS = {
  bg: '#F4F6F8',
  surface: '#FFFFFF',
  surfaceMuted: '#F8FAFC',
  ink: '#18202A',
  inkSoft: '#4B5563',
  muted: '#6B7280',
  line: '#DDE3EA',
  blue: '#0F766E',
  blueDark: '#0B4F4A',
  blueSoft: '#CCFBF1',
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

function queryParam(url: string, name: string): string | null {
  const queryStart = url.indexOf('?');
  if (queryStart < 0) return null;
  const query = url.slice(queryStart + 1);
  for (const part of query.split('&')) {
    const [rawKey, rawValue = ''] = part.split('=');
    if (decodeURIComponent(rawKey.replace(/\+/g, ' ')) === name) {
      return decodeURIComponent(rawValue.replace(/\+/g, ' '));
    }
  }
  return null;
}

function formatFingerprint(fingerprint: string | null): string {
  if (!fingerprint) return 'Not paired yet';
  const compact = fingerprint.replace(/[^0-9A-F]/gi, '').toUpperCase();
  if (compact.length < 16) return compact;
  return `${compact.slice(0, 4)} ${compact.slice(4, 8)} ${compact.slice(8, 12)} ${compact.slice(12, 16)}...`;
}

const WS_STATUS_TONE: Record<WsStatus, Tone> = {
  connected: 'ok',
  connecting: 'warn',
  reconnecting: 'warn',
  disconnected: 'error',
  untrusted: 'error',
};

const WS_STATUS_LABEL: Record<WsStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  disconnected: 'Disconnected',
  untrusted: 'Untrusted Mac',
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

function SetupInstruction({
  index,
  title,
  detail,
  badge,
  active,
  done,
}: {
  index: number;
  title: string;
  detail: string;
  badge?: string;
  active?: boolean;
  done?: boolean;
}) {
  return (
    <View style={[styles.setupInstruction, active && styles.setupInstructionActive]}>
      <View style={[styles.setupInstructionMarker, done && styles.setupInstructionMarkerDone]}>
        <Text style={[styles.setupInstructionMarkerText, done && styles.setupInstructionMarkerTextDone]}>
          {done ? '✓' : index}
        </Text>
      </View>
      <View style={styles.setupInstructionCopy}>
        <View style={styles.setupInstructionTitleRow}>
          <Text style={styles.setupInstructionTitle}>{title}</Text>
          {badge ? (
            <View style={styles.setupInstructionBadge}>
              <Text style={styles.setupInstructionBadgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.setupInstructionDetail}>{detail}</Text>
      </View>
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
  const [trustedMacFingerprint, setTrustedMacFingerprintState] = useState<string | null>(null);
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const appState = useRef(AppState.currentState);
  const shizukuPermissionPromptRequested = useRef(false);

  const { state: autoSync, toggle: toggleAutoSync } = useAutoSync();

  // Load saved setup state on mount
  useEffect(() => {
    Promise.all([getWsUrl(), getOnboardingComplete(), getTrustedMacFingerprint()]).then(
      ([url, onboardingComplete, fingerprint]) => {
        setWsUrl(url);
        setWsUrlDraft(url ?? '');
        setTrustedMacFingerprintState(fingerprint);
        setOnboardingVisible(!onboardingComplete);
        if (!url) {
          void handleDiscoverMac();
        }
      },
    );
  }, []);

  const handlePairingLink = useCallback(async (url: string | null) => {
    if (!url?.startsWith('exp+clipboard-sync://')) return;

    const fingerprint = queryParam(url, 'macFingerprint');
    if (fingerprint) {
      const saved = await setTrustedMacFingerprint(fingerprint);
      if (saved) {
        const current = await getTrustedMacFingerprint();
        setTrustedMacFingerprintState(current);
        setSetupMessage('Paired with this Mac.');
      }
    }

    const pairedWsUrl = queryParam(url, 'wsUrl');
    if (pairedWsUrl) {
      await saveWsUrl(pairedWsUrl);
      setWsUrl(pairedWsUrl);
      setWsUrlDraft(pairedWsUrl);
    }
  }, []);

  useEffect(() => {
    void Linking.getInitialURL().then(handlePairingLink);
    const sub = Linking.addEventListener('url', ({ url }) => {
      void handlePairingLink(url);
    });
    return () => sub.remove();
  }, [handlePairingLink]);

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
      setTrustedMacFingerprintState(await getTrustedMacFingerprint());
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

  useEffect(() => {
    if (!onboardingVisible) return;
    if (!shizukuStatus?.available || shizukuStatus.permissionGranted) return;
    if (shizukuPermissionPromptRequested.current) return;

    shizukuPermissionPromptRequested.current = true;
    void requestShizukuPermission().finally(() => {
      setTimeout(refreshPrivilegedClipboard, 800);
    });
  }, [onboardingVisible, refreshPrivilegedClipboard, shizukuStatus]);

  async function handleSend() {
    setSendState({ kind: 'loading', message: '' });
    const text = await Clipboard.getStringAsync();
    setClipboardText(text);

    if (!text.trim()) {
      setSendState({ kind: 'error', message: 'Clipboard is empty' });
      return;
    }

    if (wsStatus !== 'connected') {
      setSendState({ kind: 'error', message: 'No Mac connection' });
      return;
    }

    const sent = await sendClipboardNow(text);
    if (sent) {
      setSendState({ kind: 'ok', message: formatTime(new Date()) });
    } else {
      setSendState({ kind: 'error', message: 'Send failed' });
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
    setSetupMessage(null);
    await requestShizukuPermission();
    setTimeout(refreshPrivilegedClipboard, 700);
  }

  async function handleOpenShizuku() {
    setSetupMessage(null);
    const opened = await openShizuku();
    if (!opened) {
      setSetupMessage('Shizuku was not found. Install it from the store and start the service.');
    }
    setTimeout(refreshPrivilegedClipboard, 900);
  }

  async function handleFinishOnboarding() {
    await saveOnboardingComplete(true);
    setOnboardingVisible(false);
    setSettingsVisible(false);
  }

  function handleShowOnboarding() {
    setSetupMessage(null);
    shizukuPermissionPromptRequested.current = false;
    setSettingsVisible(false);
    setOnboardingVisible(true);
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
    ? 'Shizuku is not running'
    : shizukuStatus.permissionGranted
      ? `Authorization active (${shizukuUidLabel})`
      : 'Authorization required';
  const clipboardAccessReady = Boolean(shizukuStatus?.permissionGranted || privilegedClipboard);
  const pairingReady = Boolean(trustedMacFingerprint);
  const clipboardAccessLabel = shizukuStatus?.permissionGranted
    ? 'Clipboard will be read through Shizuku'
    : privilegedClipboard
      ? 'ADB app-op clipboard access is active'
      : 'Start Shizuku or grant the clipboard ADB app-op';

  const discoveryLabel =
    discoveryStatus === 'searching'
      ? 'Searching for your Mac'
      : discoveryStatus === 'found'
        ? 'Mac found automatically'
        : discoveryStatus === 'not_found'
          ? 'Mac not found on Wi-Fi'
          : 'Auto-discovery ready';

  const discoveryTone: Tone =
    discoveryStatus === 'not_found' ? 'warn' : discoveryStatus === 'searching' ? 'muted' : 'ok';

  const primaryActionDisabled = wsStatus === 'connected' && sendState.kind === 'loading';
  const destinationLabel = macDeviceName ?? (wsUrl ? 'Mac saved' : 'No Mac saved');
  const syncStateLabel =
    wsStatus === 'connected'
      ? autoSync.enabled
        ? 'Sync active'
        : 'Ready to send'
      : autoSync.enabled
        ? 'Looking for Mac'
        : 'Connection required';
  const macReady = Boolean(wsUrl);
  const androidSetupReady = macReady && pairingReady && clipboardAccessReady;
  const onboardingStepBusy = discoveryStatus === 'searching';
  const onboardingNextDisabled = !androidSetupReady;
  const onboardingStepTone: Tone = androidSetupReady
    ? 'ok'
    : shizukuStatus?.available === false
      ? 'error'
      : 'warn';

  return (
    <View style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ExpoStatusBar style="dark" backgroundColor={COLORS.bg} />

        {onboardingVisible ? (
          <View style={styles.onboardingScreen}>
            <View style={styles.onboardingTop}>
              <View>
                <Text style={styles.onboardingBrand}>Clipboard Sync</Text>
                <Text style={styles.onboardingCount}>First install via USB cable</Text>
              </View>
            </View>

            <View style={styles.onboardingProgressTrack}>
              {[0, 1, 2].map((step) => (
                <View
                  key={step}
                  style={[
                    styles.onboardingProgressSegment,
                    (step === 0 || (step === 1 && macReady && pairingReady) || (step === 2 && androidSetupReady)) &&
                      styles.onboardingProgressSegmentActive,
                  ]}
                />
              ))}
            </View>

            <ScrollView
              style={styles.onboardingMain}
              contentContainerStyle={styles.onboardingMainContent}
              showsVerticalScrollIndicator={false}
            >
              <StatusBadge
                label={androidSetupReady ? 'Ready' : 'Waiting for Mac setup'}
                tone={onboardingStepTone}
              />
              <Text style={styles.onboardingFullTitle}>Start with a USB cable</Text>
              <Text style={styles.onboardingFullText}>
                For the first install, plug this phone into the Mac and keep this screen open.
                The Mac handles the install, pairing, Shizuku, and clipboard access.
              </Text>

              {wsUrlDraft ? (
                <Text style={styles.onboardingStepMeta} numberOfLines={2}>
                  {wsUrlDraft}
                </Text>
              ) : null}

              <View style={styles.setupInstructionGroup}>
                <SetupInstruction
                  index={1}
                  title="Plug in by USB"
                  detail="Use a data cable and accept the Android debugging prompt. The Mac pairs this phone automatically."
                  badge="Recommended"
                  done={macReady && pairingReady}
                  active={!macReady || !pairingReady}
                />
                <SetupInstruction
                  index={2}
                  title="Approve Android prompts"
                  detail="Allow USB debugging and Shizuku only when Android asks."
                  done={Boolean(shizukuStatus?.permissionGranted)}
                  active={macReady && !shizukuStatus?.permissionGranted}
                />
                <SetupInstruction
                  index={3}
                  title="Let the Mac finish"
                  detail="The Mac grants clipboard access and returns this screen to Ready."
                  done={clipboardAccessReady}
                  active={Boolean(shizukuStatus?.permissionGranted) && !clipboardAccessReady}
                />
              </View>

              <View style={styles.onboardingAlternateNote}>
                <Text style={styles.onboardingAlternateLabel}>Advanced option</Text>
                <Text style={styles.onboardingAlternateText}>
                  Wireless debugging is available later for recovery or when USB is not practical.
                </Text>
              </View>

              <View style={styles.setupStepGroup}>
                <SignalRow
                  label="Mac app"
                  value={macReady ? 'Mac address saved' : discoveryLabel}
                  tone={macReady ? 'ok' : discoveryTone}
                />
                <SignalRow
                  label="Pairing"
                  value={formatFingerprint(trustedMacFingerprint)}
                  tone={pairingReady ? 'ok' : 'warn'}
                />
                <SignalRow
                  label="Shizuku"
                  value={shizukuLabel}
                  tone={shizukuStatus?.permissionGranted ? 'ok' : 'warn'}
                />
                <SignalRow
                  label="Clipboard access"
                  value={clipboardAccessLabel}
                  tone={clipboardAccessReady ? 'ok' : 'warn'}
                />
              </View>

              <View style={styles.onboardingActions}>
                <Pressable
                  style={({ pressed }) => [
                    styles.onboardingPrimaryAction,
                    onboardingStepBusy && styles.buttonDisabled,
                    pressed && !onboardingStepBusy && styles.buttonPressed,
                  ]}
                  onPress={() => {
                    void handleDiscoverMac();
                    void refreshPrivilegedClipboard();
                  }}
                  disabled={onboardingStepBusy}
                >
                  {onboardingStepBusy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.onboardingPrimaryActionText}>Refresh Status</Text>
                  )}
                </Pressable>
              </View>

              {setupMessage ? <Text style={styles.setupMessage}>{setupMessage}</Text> : null}
            </ScrollView>

            <View style={styles.onboardingBottom}>
              <Pressable
                style={({ pressed }) => [
                  styles.onboardingNextButton,
                  onboardingNextDisabled && styles.buttonDisabled,
                  pressed && !onboardingNextDisabled && styles.buttonPressed,
                ]}
                onPress={handleFinishOnboarding}
                disabled={onboardingNextDisabled}
              >
                <Text style={styles.onboardingNextButtonText}>Start Syncing</Text>
              </Pressable>
            </View>
            {onboardingNextDisabled ? (
              <Text style={styles.onboardingBlockedText}>
                Finish the USB setup on the Mac before continuing.
              </Text>
            ) : null}
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
          <View style={styles.topBar}>
            <View>
              <Text style={styles.kicker}>Clipboard Sync</Text>
              <Text style={styles.headerTitle}>Phone clipboard</Text>
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
                {settingsVisible ? 'Done' : 'Manage'}
              </Text>
            </Pressable>
          </View>

          {settingsVisible ? (
            <>
              <View style={styles.panel}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Mac connection</Text>
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
                      <Text style={styles.secondaryButtonText}>Find automatically</Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.primarySmallButton,
                      pressed && styles.buttonPressed,
                    ]}
                    onPress={handleSaveUrl}
                  >
                    <Text style={styles.primarySmallButtonText}>Save</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.panel}>
                <View>
                  <Text style={styles.sectionTitle}>Diagnostics</Text>
                  <Text style={styles.sectionSubtitle}>
                    Technical details used during setup.
                  </Text>
                </View>

                <View style={styles.signalGroup}>
                  <SignalRow
                    label="Discovery"
                    value={discoveryLabel}
                    tone={discoveryTone}
                    actionLabel={discoveryStatus !== 'searching' ? 'Search' : undefined}
                    onAction={discoveryStatus !== 'searching' ? handleDiscoverMac : undefined}
                  />
                  <SignalRow
                    label="Pairing"
                    value={formatFingerprint(trustedMacFingerprint)}
                    tone={pairingReady ? 'ok' : 'warn'}
                  />
                  <SignalRow
                    label="Encryption"
                    value={pairingReady ? 'Signed session with paired Mac' : 'Waiting for Mac pairing'}
                    tone={pairingReady ? 'ok' : 'warn'}
                  />
                  <SignalRow
                    label="Shizuku"
                    value={shizukuLabel}
                    tone={shizukuStatus?.permissionGranted ? 'ok' : 'warn'}
                    actionLabel={
                      shizukuStatus?.available
                        ? shizukuStatus.permissionGranted
                          ? undefined
                          : 'Allow'
                        : 'Open'
                    }
                    onAction={
                      shizukuStatus?.available
                        ? shizukuStatus.permissionGranted
                          ? undefined
                          : handleRequestShizukuPermission
                        : handleOpenShizuku
                    }
                  />
                  <SignalRow
                    label="ADB app-op"
                    value={
                      privilegedClipboard ? 'Clipboard access active' : 'No clipboard access'
                    }
                    tone={privilegedClipboard ? 'ok' : 'warn'}
                  />
                </View>

                <Pressable
                  style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
                  onPress={handleShowOnboarding}
                >
                  <Text style={styles.secondaryButtonText}>Show onboarding</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.heroPanel}>
              <View style={styles.heroTopRow}>
                <StatusBadge label={WS_STATUS_LABEL[wsStatus]} tone={WS_STATUS_TONE[wsStatus]} />
                <Text style={styles.heroMeta}>{syncStateLabel}</Text>
              </View>

              <Text style={styles.destinationLabel}>Paired Mac</Text>
              <Text style={styles.destinationText} numberOfLines={1}>
                {destinationLabel}
              </Text>
              <Text style={styles.destinationSubtext} numberOfLines={1}>
                {wsUrl ?? discoveryLabel}
              </Text>
            </View>
          )}

          {!onboardingVisible && (
            <>
              <View style={styles.panel}>
                <View style={styles.autoSyncRow}>
                  <View style={styles.autoSyncCopy}>
                    <Text style={styles.sectionTitle}>Sync</Text>
                    <Text style={styles.sectionSubtitle}>
                      {autoSync.enabled
                        ? 'New copies will go to your Mac automatically.'
                        : 'Enable this to sync without touching your phone.'}
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
                      <Text style={styles.lastSentLabel}>Last sent</Text>
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
                    <Text style={styles.sectionTitle}>Clipboard</Text>
                    <Text style={styles.sectionSubtitle}>
                      {clipboardText ? `${clipboardText.length} characters` : 'No text'}
                    </Text>
                  </View>
                  <Pressable style={styles.ghostButton} onPress={refreshClipboard} hitSlop={8}>
                    <Text style={styles.ghostButtonText}>Refresh</Text>
                  </Pressable>
                </View>

                <View style={styles.clipboardBox}>
                  {clipboardText ? (
                    <Text style={styles.clipboardText} numberOfLines={7}>
                      {clipboardPreview}
                    </Text>
                  ) : (
                    <Text style={styles.clipboardEmpty}>Copy text to make it appear here.</Text>
                  )}
                </View>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.primaryButton,
                  primaryActionDisabled && styles.buttonDisabled,
                  pressed && !primaryActionDisabled && styles.buttonPressed,
                ]}
                onPress={() => {
                  if (wsStatus === 'connected') {
                    void handleSend();
                  } else {
                    setWsUrlDraft(wsUrl ?? '');
                    setSettingsVisible(true);
                  }
                }}
                disabled={primaryActionDisabled}
              >
                {sendState.kind === 'loading' ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {wsStatus === 'connected' ? 'Send to Mac' : 'Configure connection'}
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
                    ? `Sent at ${sendState.message}`
                    : `Error: ${sendState.message}`}
                </Text>
              )}

              {wsStatus !== 'connected' && autoSync.enabled && (
                <Text style={[styles.statusText, styles.textMuted]}>
                  The background service is running and trying to reconnect.
                </Text>
              )}
            </>
          )}
          </ScrollView>
        )}
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
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 12,
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
    fontSize: 24,
    lineHeight: 30,
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
  onboardingScreen: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 22,
    backgroundColor: COLORS.bg,
  },
  onboardingTop: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  onboardingBrand: {
    color: COLORS.blue,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  onboardingCount: {
    marginTop: 2,
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  onboardingMain: {
    flex: 1,
  },
  onboardingMainContent: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 14,
  },
  onboardingFullTitle: {
    color: COLORS.ink,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900',
    letterSpacing: 0,
  },
  onboardingFullText: {
    color: COLORS.inkSoft,
    fontSize: 15,
    lineHeight: 22,
  },
  onboardingBottom: {
    flexDirection: 'row',
    gap: 10,
  },
  onboardingNextButton: {
    minHeight: 54,
    flex: 1.35,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: COLORS.blue,
  },
  onboardingNextButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  onboardingBlockedText: {
    marginTop: 10,
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    fontWeight: '700',
  },
  onboardingProgressTrack: {
    flexDirection: 'row',
    gap: 6,
  },
  onboardingProgressSegment: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.line,
  },
  onboardingProgressSegmentActive: {
    backgroundColor: COLORS.blue,
  },
  onboardingStepMeta: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
    padding: 10,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  onboardingPrimaryAction: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: COLORS.blue,
  },
  onboardingPrimaryActionText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  onboardingAlternateNote: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.line,
    gap: 3,
  },
  onboardingAlternateLabel: {
    color: COLORS.blueDark,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  onboardingAlternateText: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  heroPanel: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: '#E4EAF2',
    shadowColor: '#101828',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroMeta: {
    flexShrink: 1,
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  destinationLabel: {
    marginTop: 2,
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  destinationText: {
    color: COLORS.ink,
    fontSize: 25,
    lineHeight: 31,
    fontWeight: '800',
    letterSpacing: 0,
  },
  destinationSubtext: {
    color: COLORS.muted,
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
  setupStepGroup: {
    gap: 8,
  },
  setupInstructionGroup: {
    gap: 8,
  },
  setupInstruction: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: '#E4EAF2',
  },
  setupInstructionActive: {
    borderColor: COLORS.blue,
    backgroundColor: '#F0FDFA',
  },
  setupInstructionMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  setupInstructionMarkerDone: {
    backgroundColor: COLORS.green,
    borderColor: COLORS.green,
  },
  setupInstructionMarkerText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '900',
  },
  setupInstructionMarkerTextDone: {
    color: '#FFFFFF',
  },
  setupInstructionCopy: {
    flex: 1,
    gap: 2,
  },
  setupInstructionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  setupInstructionTitle: {
    color: COLORS.ink,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  setupInstructionBadge: {
    minHeight: 20,
    paddingHorizontal: 7,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: COLORS.blueSoft,
  },
  setupInstructionBadgeText: {
    color: COLORS.blueDark,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  setupInstructionDetail: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  setupMessage: {
    color: COLORS.yellow,
    fontSize: 12,
    lineHeight: 17,
  },
  onboardingActions: {
    flexDirection: 'row',
    gap: 10,
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
