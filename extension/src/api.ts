// Shared storage + API helpers for the extension (content script & popup).

export interface Settings {
  token: string | null;
  email: string | null;
  apiBase: string;
  targetLang: string;
}

const DEFAULTS: Settings = {
  token: null,
  email: null,
  apiBase: 'http://localhost:8787',
  targetLang: 'zh-CN',
};

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored } as Settings;
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
}

export function onSettingsChanged(cb: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener(async (_changes, area) => {
    if (area === 'local') cb(await getSettings());
  });
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { apiBase, token } = await getSettings();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const resp = await fetch(`${apiBase}${path}`, { ...init, headers });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((data as any).error || `HTTP ${resp.status}`);
  return data as T;
}

export interface VocabItem {
  id: number;
  text: string;
  translation: string | null;
  target_lang: string;
  source_lang: string | null;
  video_id: string | null;
  video_title: string | null;
  start_time: number | null;
  created_at: number;
}

export const Api = {
  register: (email: string, password: string) =>
    api<{ token: string; user: { id: number; email: string } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  login: (email: string, password: string) =>
    api<{ token: string; user: { id: number; email: string } }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  translatePreview: (text: string, targetLang: string) =>
    api<{ translation: string; sourceLang: string }>('/api/translate', {
      method: 'POST',
      body: JSON.stringify({ text, targetLang }),
    }),

  addVocab: (payload: {
    text: string;
    targetLang: string;
    videoId?: string;
    videoTitle?: string;
    startTime?: number;
  }) => api<{ item: VocabItem }>('/api/vocab', { method: 'POST', body: JSON.stringify(payload) }),

  listVocab: (videoId?: string) =>
    api<{ items: VocabItem[] }>(`/api/vocab${videoId ? `?videoId=${encodeURIComponent(videoId)}` : ''}`),
};
