import * as Crypto from 'expo-crypto';
import { DEVICE_ID, REQUEST_TIMEOUT_MS } from './constants';
import type { ApiResponse, ClipboardUpdateMessage, HealthResponse } from './types';

function buildUrl(macAddress: string, path: string): string {
  const base = macAddress.includes('://') ? macAddress : `http://${macAddress}`;
  return `${base}${path}`;
}

function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

export async function sendToMac(
  macAddress: string,
  text: string,
): Promise<ApiResponse> {
  if (!text.trim()) {
    return { status: 'error', message: 'Clipboard is empty' };
  }

  const body: ClipboardUpdateMessage = {
    type: 'clipboard_update',
    eventId: Crypto.randomUUID(),
    sourceDeviceId: DEVICE_ID,
    source: 'android',
    text,
    timestamp: Date.now(),
  };

  let response: Response;
  try {
    response = await fetchWithTimeout(buildUrl(macAddress, '/clipboard'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('aborted') || msg.includes('timeout')) {
      return { status: 'error', message: 'Request timed out (5s) - is Mac reachable?' };
    }
    return { status: 'error', message: `Network error: ${msg}` };
  }

  if (!response.ok) {
    return { status: 'error', message: `Server returned ${response.status}` };
  }

  const json = (await response.json()) as ApiResponse;
  return json;
}

export async function checkHealth(macAddress: string): Promise<HealthResponse> {
  let response: Response;
  try {
    response = await fetchWithTimeout(buildUrl(macAddress, '/health'), {
      method: 'GET',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('aborted') || msg.includes('timeout')) {
      return { status: 'error', device: 'Timed out (5s)' };
    }
    return { status: 'error', device: `Network error: ${msg}` };
  }

  if (!response.ok) {
    return { status: 'error', device: `HTTP ${response.status}` };
  }

  return (await response.json()) as HealthResponse;
}
