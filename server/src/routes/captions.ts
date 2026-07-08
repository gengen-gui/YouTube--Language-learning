import { Router } from 'express';

export const captionsRouter = Router();

interface Cue {
  start: number;
  end: number;
  text: string;
}

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/** Extract the videoId from a raw id or a YouTube URL. */
function parseVideoId(input: string): string | null {
  if (VIDEO_ID_RE.test(input)) return input;
  try {
    const u = new URL(input);
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.slice(1);
      return VIDEO_ID_RE.test(id) ? id : null;
    }
    const v = u.searchParams.get('v');
    if (v && VIDEO_ID_RE.test(v)) return v;
  } catch {
    /* not a url */
  }
  return null;
}

// Public InnerTube key used by the YouTube web client. This is not a secret;
// it is embedded in every youtube.com page. Server-side calls to the player
// endpoint are far more reliable than scraping the watch page HTML.
const INNERTUBE_KEY = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';

async function fetchPlayerResponse(videoId: string): Promise<any | null> {
  // 1) Preferred: InnerTube player API (ANDROID client avoids most bot checks).
  try {
    const resp = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: '19.09.37',
              androidSdkVersion: 30,
              hl: 'en',
              gl: 'US',
            },
          },
        }),
      },
    );
    if (resp.ok) {
      const json = (await resp.json()) as any;
      if (json?.captions) return json;
    }
  } catch {
    /* fall through to HTML scraping */
  }

  // 2) Fallback: scrape the watch page HTML.
  try {
    const watch = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'CONSENT=YES+1',
      },
    });
    const html = await watch.text();
    return extractPlayerResponse(html);
  } catch {
    return null;
  }
}

function extractPlayerResponse(html: string): any | null {
  const marker = 'ytInitialPlayerResponse';
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const braceStart = html.indexOf('{', idx);
  if (braceStart === -1) return null;
  // Walk braces to find the matching closing brace.
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(braceStart, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

// GET /api/captions?video=<id or url>&lang=en
captionsRouter.get('/', async (req, res) => {
  const raw = String(req.query.video || '');
  const preferLang = String(req.query.lang || 'en');
  const videoId = parseVideoId(raw);
  if (!videoId) {
    res.status(400).json({ error: 'Invalid YouTube video id or URL' });
    return;
  }

  try {
    const pr = await fetchPlayerResponse(videoId);
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (!tracks.length) {
      res.status(404).json({ error: 'No captions found for this video' });
      return;
    }

    const human = tracks.filter((t: any) => t.kind !== 'asr');
    const pool = human.length ? human : tracks;
    const track =
      pool.find((t: any) => (t.languageCode || '').startsWith(preferLang)) || pool[0];

    const url = new URL(track.baseUrl);
    url.searchParams.set('fmt', 'json3');
    const capResp = await fetch(url.toString(), { headers: { 'User-Agent': BROWSER_UA } });
    const body = await capResp.text();

    // YouTube increasingly returns an empty body for caption requests coming
    // from data-center IPs (poToken-gated). Detect this and report clearly so
    // the client can guide the user to the browser extension instead.
    if (!body.trim()) {
      res.status(424).json({
        error: 'CAPTIONS_BLOCKED',
        message:
          'YouTube blocked server-side caption download for this video. Use the browser extension on the video page to capture captions.',
        videoId,
        title: pr?.videoDetails?.title || '',
      });
      return;
    }

    let data: any;
    try {
      data = JSON.parse(body);
    } catch {
      res.status(424).json({
        error: 'CAPTIONS_BLOCKED',
        message:
          'YouTube returned an unreadable caption response. Use the browser extension to capture captions.',
        videoId,
      });
      return;
    }

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
      cues.push({ start, end: start + (ev.dDurationMs || 0) / 1000, text });
    }

    res.json({
      videoId,
      title: pr?.videoDetails?.title || '',
      lang: track.languageCode,
      trackName: track?.name?.simpleText || track?.name?.runs?.[0]?.text || track.languageCode,
      cues,
    });
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch captions from YouTube' });
  }
});
