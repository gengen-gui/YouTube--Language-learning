import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { dbGet, dbRun, type UserRow } from '../db.js';
import { signToken } from '../auth.js';

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

authRouter.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!EMAIL_RE.test(email || '') || typeof password !== 'string' || password.length < 6) {
    res.status(400).json({ error: 'Valid email and password (min 6 chars) required' });
    return;
  }
  const existing = await dbGet<{ id: number }>('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = await dbRun(
    'INSERT INTO users (email, password, created_at) VALUES ($1, $2, $3) RETURNING id',
    [email, hash, Date.now()],
  );
  const token = signToken(info.lastInsertRowid);
  res.json({ token, user: { id: info.lastInsertRowid, email } });
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = await dbGet<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
  if (!user || !bcrypt.compareSync(password || '', user.password)) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }
  const token = signToken(user.id);
  res.json({ token, user: { id: user.id, email: user.email } });
});
