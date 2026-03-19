import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { resolveTenantFromRequest } from '../auth/auth.js';
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
  const tenantId = resolveTenantFromRequest(req);
  const devices = await DeviceModel.find({ tenantId }).sort({ updatedAt: -1 });
  res.json(devices);
});

devicesRouter.post('/', async (req, res) => {
  const data = createSchema.parse(req.body);
  const tenantId = req.auth?.role === 'company_admin' ? data.tenantId : req.auth?.tenantId;
  if (!tenantId) {
    res.status(403).json({ error: 'Tenant no permitido' });
    return;
  }

  const device = await DeviceModel.create({
    tenantId,
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
