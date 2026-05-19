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

// WebSocket protocol messages

export interface HelloMessage {
  type: 'hello';
  sourceDeviceId: string;
  deviceName: string;
  protocolVersion: number;
}

export interface HelloAckMessage {
  type: 'hello_ack';
  sourceDeviceId: string;
  protocolVersion: number;
}

export interface PingMessage {
  type: 'ping';
  timestamp: number;
}

export interface PongMessage {
  type: 'pong';
  timestamp: number;
}

export type WsIncomingMessage =
  | HelloAckMessage
  | PingMessage
  | ClipboardUpdateMessage
  | { type: string; [key: string]: unknown };
