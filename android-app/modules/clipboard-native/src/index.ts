import { requireNativeModule } from 'expo-modules-core';

const native = requireNativeModule('ClipboardNative');

export function getClipboardText(): Promise<string | null> {
  return native.getClipboardText();
}

export function setClipboardText(text: string): Promise<void> {
  return native.setClipboardText(text);
}

export function startClipboardService(wsUrl?: string | null): Promise<boolean> {
  return native.startClipboardService(wsUrl ?? null);
}

export function stopClipboardService(): Promise<void> {
  return native.stopClipboardService();
}

export function isServiceRunning(): Promise<boolean> {
  return native.isServiceRunning();
}

export function isWsConnected(): Promise<boolean> {
  return native.isWsConnected();
}

export function discoverMacWsUrl(timeoutMs?: number): Promise<string | null> {
  return native.discoverMacWsUrl(timeoutMs ?? null);
}

export function sendClipboardNow(text: string): Promise<boolean> {
  return native.sendClipboardNow(text);
}

export function isReadClipboardAllowed(): Promise<boolean> {
  return native.isReadClipboardAllowed();
}

export interface ShizukuStatus {
  available: boolean;
  permissionGranted: boolean;
  uid: number | null;
  packageName: string;
}

export function getShizukuStatus(): Promise<ShizukuStatus> {
  return native.getShizukuStatus();
}

export function requestShizukuPermission(): Promise<boolean> {
  return native.requestShizukuPermission();
}

export function isIgnoringBatteryOptimizations(): Promise<boolean> {
  return native.isIgnoringBatteryOptimizations();
}

export function requestBatteryOptimizationExemption(): Promise<void> {
  return native.requestBatteryOptimizationExemption();
}

export type WsStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
export type DiscoveryStatus = 'idle' | 'searching' | 'found' | 'not_found';

export function addClipboardChangeListener(listener: (text: string) => void) {
  return native.addListener('clipboardChange', (e: { text: string }) => listener(e.text));
}

export function addWsStatusListener(listener: (status: WsStatus) => void) {
  return native.addListener('wsStatus', (e: { status: WsStatus }) => listener(e.status));
}

export function addClipboardReceivedListener(listener: (text: string) => void) {
  return native.addListener('clipboardReceived', (e: { text: string }) => listener(e.text));
}

export function addDiscoveryStatusListener(
  listener: (status: DiscoveryStatus, url: string | null) => void,
) {
  return native.addListener('discoveryStatus', (e: { status: DiscoveryStatus; url?: string | null }) =>
    listener(e.status, e.url ?? null),
  );
}
