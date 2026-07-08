import { Router } from 'express';
import { translate } from '../translate.js';

export const translateRouter = Router();

// Public, on-the-fly translation (used for preview before saving).
translateRouter.post('/', async (req, res) => {
  const { text, targetLang = 'zh-CN', sourceLang = 'auto' } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  try {
    const r = await translate(text, targetLang, sourceLang);
    res.json(r);
  } catch (e) {
    res.status(502).json({ error: 'Translation provider failed' });
  }
});
