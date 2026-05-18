/** Zgodne z shared/message-types.md */
export interface ClipboardUpdateMessage {
  type: 'clipboard_update';
  eventId: string;
  sourceDeviceId: string;
  source: 'android' | 'mac';
  text: string;
  timestamp: number;
}

export interface HealthResponse {
  status: 'ok' | 'error';
  device?: string;
}

export interface ApiResponse {
  status: 'ok' | 'error';
  message?: string;
}
