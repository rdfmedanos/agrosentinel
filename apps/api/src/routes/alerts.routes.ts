import { Router } from 'express';
import { resolveTenantFromRequest } from '../auth/auth.js';
import { AlertModel } from '../models/Alert.js';

export const alertsRouter = Router();

alertsRouter.get('/', async (req, res) => {
  const tenantId = resolveTenantFromRequest(req);
  const alerts = await AlertModel.find({ tenantId }).sort({ createdAt: -1 }).limit(200);
  res.json(alerts);
});
