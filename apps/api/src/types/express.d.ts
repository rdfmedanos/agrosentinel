import type { AuthClaims } from '../auth/auth.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthClaims;
    }
  }
}

export {};
