/**
 * Translation service.
 *
 * Currently uses the free, public Google Translate web endpoint (no API key).
 * This is meant for the "free first" phase. To upgrade to a paid, higher-quality
 * provider (DeepL / OpenAI / Tencent), implement a new function with the same
 * signature and switch `translate` to call it — the rest of the app is unaffected.
 */

export interface TranslateResult {
  translation: string;
  sourceLang: string;
}

const GOOGLE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

export async function translate(
  text: string,
  targetLang: string,
  sourceLang = 'auto',
): Promise<TranslateResult> {
  const clean = (text || '').trim();
  if (!clean) return { translation: '', sourceLang };

  const params = new URLSearchParams({
    client: 'gtx',
    sl: sourceLang,
    tl: targetLang,
    dt: 't',
    q: clean,
  });

  const url = `${GOOGLE_ENDPOINT}?${params.toString()}`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    },
  });

  if (!resp.ok) {
    throw new Error(`Translate provider returned ${resp.status}`);
  }

  // Response shape: [[["translated","original",...], ...], ..., "detectedSourceLang", ...]
  const data = (await resp.json()) as any;
  const segments: string[] = Array.isArray(data?.[0])
    ? data[0].map((seg: any) => (Array.isArray(seg) ? seg[0] : '')).filter(Boolean)
    : [];
  const detected: string = typeof data?.[2] === 'string' ? data[2] : sourceLang;

  return { translation: segments.join(''), sourceLang: detected };
}
