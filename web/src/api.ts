// API client for the website. Uses same backend as the extension.
// In dev, Vite proxies /api -> http://localhost:8787.

const API_BASE = import.meta.env.VITE_API_BASE || '';

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

export interface Cue {
  start: number;
  end: number;
  text: string;
}

function token(): string | null {
  return localStorage.getItem('ytlingo_token');
}

export function saveAuth(tok: string, email: string) {
  localStorage.setItem('ytlingo_token', tok);
  localStorage.setItem('ytlingo_email', email);
}

export function clearAuth() {
  localStorage.removeItem('ytlingo_token');
  localStorage.removeItem('ytlingo_email');
}

export function currentEmail(): string | null {
  return localStorage.getItem('ytlingo_email');
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  const tok = token();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const resp = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((data as any).error || `HTTP ${resp.status}`);
  return data as T;
}

export const Api = {
  register: (email: string, password: string) =>
    req<{ token: string; user: { email: string } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string) =>
    req<{ token: string; user: { email: string } }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  listVocab: () => req<{ items: VocabItem[] }>('/api/vocab'),
  addVocab: (payload: {
    text: string;
    targetLang: string;
    videoId?: string;
    videoTitle?: string;
    startTime?: number;
  }) => req<{ item: VocabItem }>('/api/vocab', { method: 'POST', body: JSON.stringify(payload) }),
  retranslate: (id: number, targetLang: string) =>
    req<{ item: VocabItem }>(`/api/vocab/${id}/translate`, {
      method: 'PATCH',
      body: JSON.stringify({ targetLang }),
    }),
  removeVocab: (id: number) => req<{ deleted: number }>(`/api/vocab/${id}`, { method: 'DELETE' }),
  captions: (video: string, lang = 'en') =>
    req<{ videoId: string; title: string; lang: string; trackName: string; cues: Cue[] }>(
      `/api/captions?video=${encodeURIComponent(video)}&lang=${lang}`,
    ),
};

export const LANGS: Record<string, string> = {
  'zh-CN': '中文(简体)',
  'zh-TW': '中文(繁體)',
  ja: '日本語',
  ko: '한국어',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  en: 'English',
};
