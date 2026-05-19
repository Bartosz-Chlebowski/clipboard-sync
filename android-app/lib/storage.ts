import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_MAC_ADDRESS,
  DEFAULT_WS_URL,
  STORAGE_KEY_MAC_ADDRESS,
  STORAGE_KEY_WS_URL,
} from './constants';

export async function getMacAddress(): Promise<string> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY_MAC_ADDRESS);
  return stored ?? DEFAULT_MAC_ADDRESS;
}

export async function saveMacAddress(address: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_MAC_ADDRESS, address.trim());
}

export async function getWsUrl(): Promise<string> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY_WS_URL);
  return stored ?? DEFAULT_WS_URL;
}

export async function saveWsUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_WS_URL, url.trim());
}
