import { Router } from 'express';
import { AlertModel } from '../models/Alert.js';

export const alertsRouter = Router();

alertsRouter.get('/', async (req, res) => {
  const tenantId = String(req.query.tenantId ?? 'demo-tenant');
  const alerts = await AlertModel.find({ tenantId }).sort({ createdAt: -1 }).limit(200);
  res.json(alerts);
});
