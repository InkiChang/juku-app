const STORAGE_KEY = 'juku.app.apiBaseUrl';

export async function getDefaultApiBaseUrl(): Promise<string> {
  try {
    const response = await fetch('/config.json', { cache: 'no-store' });
    const config = (await response.json()) as { apiBaseUrl?: string };
    if (config.apiBaseUrl?.trim()) return config.apiBaseUrl.trim();
  } catch {
    // Static hosting may not provide runtime config; fall back to Vite env.
  }
  return import.meta.env.VITE_API_BASE_URL?.trim() || (import.meta.env.DEV ? '' : 'https://juku.inkicheng.top:10086');
}

export function savedApiBaseUrl(): string {
  return localStorage.getItem(STORAGE_KEY)?.trim() || '';
}

export function saveApiBaseUrl(value: string): void {
  localStorage.setItem(STORAGE_KEY, value.trim().replace(/\/$/, ''));
}

export function clearApiBaseUrl(): void {
  localStorage.removeItem(STORAGE_KEY);
}
