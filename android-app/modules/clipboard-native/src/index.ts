import { EventEmitter, requireNativeModule } from 'expo-modules-core';

const native = requireNativeModule('ClipboardNative');
const emitter = new EventEmitter(native);

export function getClipboardText(): Promise<string | null> {
  return native.getClipboardText();
}

export function setClipboardText(text: string): Promise<void> {
  return native.setClipboardText(text);
}

export function startClipboardService(): Promise<void> {
  return native.startClipboardService();
}

export function stopClipboardService(): Promise<void> {
  return native.stopClipboardService();
}

export function isServiceRunning(): Promise<boolean> {
  return native.isServiceRunning();
}

export function isIgnoringBatteryOptimizations(): Promise<boolean> {
  return native.isIgnoringBatteryOptimizations();
}

export function requestBatteryOptimizationExemption(): Promise<void> {
  return native.requestBatteryOptimizationExemption();
}

export function addClipboardChangeListener(listener: (text: string) => void) {
  return emitter.addListener<{ text: string }>('clipboardChange', (event) =>
    listener(event.text),
  );
}
