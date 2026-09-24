import { Capacitor } from '@capacitor/core';

const STORAGE_KEY = 'juku.app.apiBaseUrl';
// Deployment-specific addresses must be supplied through build-time
// environment or the in-app server settings, never committed to the repo.
export const PRODUCTION_API_BASE_URL = import.meta.env.VITE_PRODUCTION_API_BASE_URL?.trim() || '';

function isLoopbackUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1';
  } catch {
    return false;
  }
}

export async function getDefaultApiBaseUrl(): Promise<string> {
  try {
    const response = await fetch('/config.json', { cache: 'no-store' });
    const config = (await response.json()) as { apiBaseUrl?: string };
    if (config.apiBaseUrl?.trim()) return config.apiBaseUrl.trim();
  } catch {
    // Static hosting may not provide runtime config; fall back to Vite env.
  }
  return import.meta.env.VITE_API_BASE_URL?.trim() || (import.meta.env.DEV ? '' : PRODUCTION_API_BASE_URL);
}

export function requestBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/$/, '');
  if (import.meta.env.DEV && PRODUCTION_API_BASE_URL && normalized === PRODUCTION_API_BASE_URL) return '/__juku_remote';
  return normalized;
}

export function savedApiBaseUrl(): string {
  const saved = localStorage.getItem(STORAGE_KEY)?.trim() || '';
  // A desktop development URL is not reachable from a physical phone. Avoid
  // silently sending the APK to the phone's own localhost after an earlier
  // local preview; users can still enter a LAN address explicitly in Settings.
  if (Capacitor.isNativePlatform() && saved && isLoopbackUrl(saved)) return '';
  return saved;
}

export function saveApiBaseUrl(value: string): void {
  localStorage.setItem(STORAGE_KEY, value.trim().replace(/\/$/, ''));
}

export function clearApiBaseUrl(): void {
  localStorage.removeItem(STORAGE_KEY);
}
