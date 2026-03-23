import { Router } from 'express';
import { MqttConfigModel } from '../models/MqttConfig.js';
import { reloadMqtt } from '../services/mqtt.service.js';

export const mqttConfigRouter = Router();

mqttConfigRouter.get('/', async (_req, res) => {
  const tenantId = 'global';

  const config = await MqttConfigModel.findOne({ tenantId });
  if (!config) {
    res.json({ host: 'localhost', port: 1883, username: '', password: '' });
    return;
  }
  res.json({ host: config.host, port: config.port, username: config.username, password: config.password });
});

mqttConfigRouter.put('/', async (req, res) => {
  const tenantId = 'global';
  const { host, port, username, password } = req.body;
  
  await MqttConfigModel.findOneAndUpdate(
    { tenantId },
    { host, port, username, password },
    { upsert: true, new: true }
  );
  
  void reloadMqtt();
  
  res.json({ status: 'saved' });
});
