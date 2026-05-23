import { REQUEST_TIMEOUT_MS } from './constants';
import type { ApiResponse, HealthResponse } from './types';

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

  void macAddress;
  return {
    status: 'error',
    message: 'Plain HTTP clipboard sync is disabled. Use encrypted WebSocket sync.',
  };
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
