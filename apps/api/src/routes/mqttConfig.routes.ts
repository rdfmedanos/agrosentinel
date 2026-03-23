import { Router } from 'express';
import { resolveTenantFromRequest } from '../auth/auth.js';
import { MqttConfigModel } from '../models/MqttConfig.js';

export const mqttConfigRouter = Router();

mqttConfigRouter.get('/', async (req, res) => {
  const tenantId = resolveTenantFromRequest(req);
  if (!tenantId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const config = await MqttConfigModel.findOne({ tenantId });
  if (!config) {
    res.json({ host: 'localhost', port: 1883, username: '', password: '' });
    return;
  }
  res.json({ host: config.host, port: config.port, username: config.username, password: config.password });
});

mqttConfigRouter.put('/', async (req, res) => {
  const tenantId = resolveTenantFromRequest(req);
  if (!tenantId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { host, port, username, password } = req.body;
  
  await MqttConfigModel.findOneAndUpdate(
    { tenantId },
    { host, port, username, password },
    { upsert: true, new: true }
  );
  
  res.json({ status: 'saved' });
});
