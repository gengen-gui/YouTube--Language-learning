import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env.JWT_SECRET || 'please-change-this-secret';
const TOKEN_TTL = '30d';

export interface AuthedRequest extends Request {
  userId?: number;
}

export function signToken(userId: number): string {
  return jwt.sign({ uid: userId }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function authRequired(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { uid: number };
    req.userId = payload.uid;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
