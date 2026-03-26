import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import type { UserRole } from '../models/User.js';

export type AuthClaims = {
  sub: string;
  email: string;
  role: UserRole;
  tenantId: string;
};

export function signAuthToken(claims: AuthClaims): string {
  return jwt.sign(claims, env.authJwtSecret, {
    expiresIn: env.authJwtExpires as jwt.SignOptions['expiresIn']
  });
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const [scheme, token] = authHeader.split(' ');
    if (scheme === 'Bearer' && token) return token;
  }
  const queryToken = req.query.token;
  if (typeof queryToken === 'string') return queryToken;
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const payload = jwt.verify(token, env.authJwtSecret) as AuthClaims;
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function requireCompanyAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth || req.auth.role !== 'company_admin') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

export function resolveTenantFromRequest(req: Request): string {
  const queryTenant = typeof req.query.tenantId === 'string' ? req.query.tenantId : '';
  if (req.auth?.role === 'company_admin') {
    return queryTenant || req.auth?.tenantId || 'demo-tenant';
  }
  return req.auth?.tenantId || queryTenant || 'demo-tenant';
}
