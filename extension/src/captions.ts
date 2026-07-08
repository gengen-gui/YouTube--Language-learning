// Fetches and parses a YouTube caption track into timed cues.

export interface Cue {
  start: number; // seconds
  end: number; // seconds
  text: string;
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  name?: string;
  kind?: string;
}

/** Pick the best track: prefer human (non-asr), then English, else first. */
export function pickTrack(tracks: CaptionTrack[], preferLang = 'en'): CaptionTrack | null {
  if (!tracks.length) return null;
  const human = tracks.filter((t) => t.kind !== 'asr');
  const pool = human.length ? human : tracks;
  return (
    pool.find((t) => t.languageCode?.startsWith(preferLang)) ||
    pool[0]
  );
}

export async function fetchCues(track: CaptionTrack): Promise<Cue[]> {
  const url = new URL(track.baseUrl);
  url.searchParams.set('fmt', 'json3');
  const resp = await fetch(url.toString(), { credentials: 'include' });
  if (!resp.ok) throw new Error(`caption fetch ${resp.status}`);
  const body = await resp.text();
  if (!body.trim()) {
    throw new Error('YouTube returned empty captions (try refreshing the page)');
  }
  const data = JSON.parse(body) as any;

  const cues: Cue[] = [];
  for (const ev of data.events || []) {
    if (!ev.segs) continue;
    const text = ev.segs
      .map((s: any) => s.utf8 || '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    const start = (ev.tStartMs || 0) / 1000;
    const end = start + (ev.dDurationMs || 0) / 1000;
    cues.push({ start, end, text });
  }
  return cues;
}
