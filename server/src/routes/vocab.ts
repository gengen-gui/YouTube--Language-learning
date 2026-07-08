import { Router, type Response } from 'express';
import { db, type VocabRow } from '../db.js';
import { authRequired, type AuthedRequest } from '../auth.js';
import { translate } from '../translate.js';

export const vocabRouter = Router();
vocabRouter.use(authRequired);

// List current user's vocab, optionally filtered by video_id
vocabRouter.get('/', (req: AuthedRequest, res: Response) => {
  const videoId = req.query.videoId as string | undefined;
  const rows = videoId
    ? db
        .prepare('SELECT * FROM vocab WHERE user_id = ? AND video_id = ? ORDER BY created_at DESC')
        .all(req.userId, videoId)
    : db
        .prepare('SELECT * FROM vocab WHERE user_id = ? ORDER BY created_at DESC')
        .all(req.userId);
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

  const info = db
    .prepare(
      `INSERT INTO vocab
        (user_id, text, translation, target_lang, source_lang, video_id, video_title, start_time, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      req.userId,
      text.trim(),
      translation,
      targetLang,
      detectedSource,
      videoId || null,
      videoTitle || null,
      typeof startTime === 'number' ? startTime : null,
      Date.now(),
    );

  const row = db.prepare('SELECT * FROM vocab WHERE id = ?').get(info.lastInsertRowid) as VocabRow;
  res.json({ item: row });
});

// Re-translate an existing entry to a (possibly new) target language
vocabRouter.patch('/:id/translate', async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const { targetLang } = req.body || {};
  const row = db
    .prepare('SELECT * FROM vocab WHERE id = ? AND user_id = ?')
    .get(id, req.userId) as VocabRow | undefined;
  if (!row) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const tl = targetLang || row.target_lang;
  const r = await translate(row.text, tl, row.source_lang || 'auto');
  db.prepare('UPDATE vocab SET translation = ?, target_lang = ?, source_lang = ? WHERE id = ?').run(
    r.translation,
    tl,
    r.sourceLang,
    id,
  );
  const updated = db.prepare('SELECT * FROM vocab WHERE id = ?').get(id) as VocabRow;
  res.json({ item: updated });
});

vocabRouter.delete('/:id', (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM vocab WHERE id = ? AND user_id = ?').run(id, req.userId);
  res.json({ deleted: info.changes });
});
