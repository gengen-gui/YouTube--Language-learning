import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { vocabRouter } from './routes/vocab.js';
import { translateRouter } from './routes/translate.js';
import { captionsRouter } from './routes/captions.js';

const app = express();

// Allow the extension (chrome-extension://) and the website to call the API.
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Friendly root so visiting the bare domain doesn't show "Cannot GET /".
app.get('/', (_req, res) =>
  res.type('text/plain').send('YT Lingo API is running. See /api/health'),
);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api/vocab', vocabRouter);
app.use('/api/translate', translateRouter);
app.use('/api/captions', captionsRouter);

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`[yt-lingo] API listening on http://localhost:${PORT}`);
});
