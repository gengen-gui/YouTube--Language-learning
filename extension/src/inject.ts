// Runs in the PAGE context (main world). It has access to YouTube's internal
// objects (ytInitialData, ytcfg, the player), which the isolated content script
// cannot read. We use them to obtain the full timed transcript reliably and
// relay it to the content script.

interface Cue {
  start: number;
  end: number;
  text: string;
}

let lastVideoId = '';
let liveMode = false;

function post(msg: any) {
  window.postMessage({ source: 'ytlingo-inject', ...msg }, '*');
}

function currentPlayerResponse(): any {
  const w = window as any;
  try {
    const player = document.querySelector('#movie_player') as any;
    if (player && typeof player.getPlayerResponse === 'function') {
      const pr = player.getPlayerResponse();
      if (pr?.videoDetails) return pr;
    }
  } catch {
    /* ignore */
  }
  return w.ytInitialPlayerResponse || null;
}

function hasCaptions(pr: any): boolean {
  const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks) && tracks.length > 0;
}

// Recursively find the transcript params inside ytInitialData.
function findTranscriptParams(obj: any): string | null {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.getTranscriptEndpoint?.params) return obj.getTranscriptEndpoint.params;
  for (const k in obj) {
    const r = findTranscriptParams(obj[k]);
    if (r) return r;
  }
  return null;
}

// Recursively collect transcript segments (robust to layout changes).
function collectSegments(obj: any, out: Cue[]): void {
  if (!obj || typeof obj !== 'object') return;
  if (obj.transcriptSegmentRenderer) {
    const s = obj.transcriptSegmentRenderer;
    const text = (s.snippet?.runs || [])
      .map((r: any) => r.text || '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    const start = Number(s.startMs || 0) / 1000;
    const end = Number(s.endMs || 0) / 1000;
    if (text) out.push({ start, end, text });
    return;
  }
  for (const k in obj) collectSegments(obj[k], out);
}

async function fetchTranscript(): Promise<Cue[] | null> {
  const w = window as any;
  const params = findTranscriptParams(w.ytInitialData);
  const key = w.ytcfg?.get?.('INNERTUBE_API_KEY');
  const context = w.ytcfg?.get?.('INNERTUBE_CONTEXT');
  if (!params || !key || !context) return null;

  try {
    const resp = await fetch(`/youtubei/v1/get_transcript?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ context, params }),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const cues: Cue[] = [];
    collectSegments(json, cues);
    // Fill missing end times with the next segment's start.
    for (let i = 0; i < cues.length; i++) {
      if (!cues[i].end || cues[i].end <= cues[i].start) {
        cues[i].end = cues[i + 1] ? cues[i + 1].start : cues[i].start + 4;
      }
    }
    return cues.length ? cues : null;
  } catch {
    return null;
  }
}

// Best-effort: turn subtitles ON via the player API so the content script can
// scrape the rendered caption text in real time.
function enableCaptions(): void {
  try {
    const player = document.querySelector('#movie_player') as any;
    if (!player) return;
    if (typeof player.loadModule === 'function') player.loadModule('captions');
    if (typeof player.getOption === 'function' && typeof player.setOption === 'function') {
      const tracklist = player.getOption('captions', 'tracklist') || [];
      if (tracklist.length) {
        // Prefer a non-auto English track, else the first available.
        const track =
          tracklist.find((t: any) => (t.languageCode || '').startsWith('en')) || tracklist[0];
        player.setOption('captions', 'track', track);
      }
    }
  } catch {
    /* ignore */
  }
}

async function scan(force = false) {
  const pr = currentPlayerResponse();
  if (!pr) return;
  const videoId = pr?.videoDetails?.videoId;
  const title = pr?.videoDetails?.title;
  if (!videoId) return;
  if (!force && videoId === lastVideoId) return;

  if (!hasCaptions(pr)) {
    lastVideoId = videoId;
    post({ type: 'NO_CAPTIONS', videoId, title });
    return;
  }

  const cues = await fetchTranscript();
  if (cues && cues.length) {
    lastVideoId = videoId;
    post({ type: 'CUES', videoId, title, cues });
    return;
  }

  // Transcript API unavailable -> switch to real-time caption capture.
  lastVideoId = videoId;
  liveMode = true;
  enableCaptions();
  post({ type: 'LIVE', videoId, title });
}

// Initial scan + short polling window for late player init.
void scan(true);
let ticks = 0;
const poll = setInterval(() => {
  void scan();
  if (liveMode) enableCaptions(); // keep retrying until the player is ready
  if (++ticks > 40) clearInterval(poll); // ~20s
}, 500);

window.addEventListener('yt-navigate-finish', () => {
  lastVideoId = '';
  liveMode = false;
  setTimeout(() => void scan(true), 500);
});

window.addEventListener('message', (e) => {
  if (e.source === window && e.data?.source === 'ytlingo-content' && e.data.type === 'REQUEST') {
    void scan(true);
  }
});
