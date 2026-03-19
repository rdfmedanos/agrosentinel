import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { DeviceModel } from '../models/Device.js';
import { publishDeviceCommand } from '../services/mqtt.service.js';

const createSchema = z.object({
  tenantId: z.string().min(1),
  deviceId: z.string().min(1),
  name: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  address: z.string().optional()
});

export const devicesRouter = Router();

devicesRouter.get('/', async (req, res) => {
  const tenantId = String(req.query.tenantId ?? 'demo-tenant');
  const devices = await DeviceModel.find({ tenantId }).sort({ updatedAt: -1 });
  res.json(devices);
});

devicesRouter.post('/', async (req, res) => {
  const data = createSchema.parse(req.body);
  const device = await DeviceModel.create({
    tenantId: data.tenantId,
    deviceId: data.deviceId,
    name: data.name,
    location: { lat: data.lat, lng: data.lng, address: data.address ?? '' }
  });
  res.status(201).json(device);
});

devicesRouter.post('/:deviceId/command', async (req, res) => {
  const command = z.enum(['pump_on', 'pump_off']).parse(req.body?.cmd);
  const requestId = randomUUID();
  publishDeviceCommand(req.params.deviceId, { cmd: command, requestId });
  res.json({ status: 'queued', requestId });
});
