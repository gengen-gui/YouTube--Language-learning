import { Router, type Response } from 'express';
import { dbGet, dbAll, dbRun, type VocabRow } from '../db.js';
import { authRequired, type AuthedRequest } from '../auth.js';
import { translate } from '../translate.js';

export const vocabRouter = Router();
vocabRouter.use(authRequired);

// List current user's vocab, optionally filtered by video_id
vocabRouter.get('/', async (req: AuthedRequest, res: Response) => {
  const videoId = req.query.videoId as string | undefined;
  const rows = videoId
    ? await dbAll<VocabRow>(
        'SELECT * FROM vocab WHERE user_id = $1 AND video_id = $2 ORDER BY created_at DESC',
        [req.userId, videoId],
      )
    : await dbAll<VocabRow>('SELECT * FROM vocab WHERE user_id = $1 ORDER BY created_at DESC', [
        req.userId,
      ]);
  res.json({ items: rows });
});

// Add a sentence to the vocab book. Translates on save (cached).
vocabRouter.post('/', async (req: AuthedRequest, res: Response) => {
  const {
    text,
    targetLang = 'zh-CN',
    sourceLang,
    videoId,
    videoTitle,
    startTime,
  } = req.body || {};

  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  let translation = '';
  let detectedSource = sourceLang || null;
  try {
    const r = await translate(text, targetLang, sourceLang || 'auto');
    translation = r.translation;
    detectedSource = r.sourceLang;
  } catch (e) {
    // Save even if translation fails; can be re-translated later.
    translation = '';
  }

  const info = await dbRun(
    `INSERT INTO vocab
      (user_id, text, translation, target_lang, source_lang, video_id, video_title, start_time, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      req.userId,
      text.trim(),
      translation,
      targetLang,
      detectedSource,
      videoId || null,
      videoTitle || null,
      typeof startTime === 'number' ? startTime : null,
      Date.now(),
    ],
  );

  const row = await dbGet<VocabRow>('SELECT * FROM vocab WHERE id = $1', [info.lastInsertRowid]);
  res.json({ item: row });
});

// Re-translate an existing entry to a (possibly new) target language
vocabRouter.patch('/:id/translate', async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const { targetLang } = req.body || {};
  const row = await dbGet<VocabRow>('SELECT * FROM vocab WHERE id = $1 AND user_id = $2', [
    id,
    req.userId,
  ]);
  if (!row) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const tl = targetLang || row.target_lang;
  const r = await translate(row.text, tl, row.source_lang || 'auto');
  await dbRun('UPDATE vocab SET translation = $1, target_lang = $2, source_lang = $3 WHERE id = $4', [
    r.translation,
    tl,
    r.sourceLang,
    id,
  ]);
  const updated = await dbGet<VocabRow>('SELECT * FROM vocab WHERE id = $1', [id]);
  res.json({ item: updated });
});

vocabRouter.delete('/:id', async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const info = await dbRun('DELETE FROM vocab WHERE id = $1 AND user_id = $2', [id, req.userId]);
  res.json({ deleted: info.changes });
});
