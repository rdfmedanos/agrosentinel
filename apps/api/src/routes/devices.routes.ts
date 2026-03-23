import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { resolveTenantFromRequest, requireCompanyAdmin } from '../auth/auth.js';
import { DeviceModel } from '../models/Device.js';
import { UserModel } from '../models/User.js';
import { publishDeviceCommand } from '../services/mqtt.service.js';

const createSchema = z.object({
  tenantId: z.string().min(1),
  deviceId: z.string().min(1),
  name: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  address: z.string().optional()
});

const assignSchema = z.object({
  device_id: z.string().min(1),
  user_id: z.string().min(1)
});

export const devicesRouter = Router();

devicesRouter.get('/', async (req, res) => {
  const { all } = req.query;
  let devices;
  if (all === 'true' && req.auth?.role === 'company_admin') {
    devices = await DeviceModel.find().sort({ updatedAt: -1 });
  } else {
    const tenantId = resolveTenantFromRequest(req);
    devices = await DeviceModel.find({ tenantId }).sort({ updatedAt: -1 });
  }
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

devicesRouter.patch('/:id', async (req, res) => {
  const { lat, lng, name, address, userId, tenantId } = req.body;
  const updateData: Record<string, unknown> = {};
  if (lat !== undefined && lng !== undefined) {
    updateData['location.lat'] = lat;
    updateData['location.lng'] = lng;
  }
  if (name !== undefined) updateData.name = name;
  if (address !== undefined) updateData['location.address'] = address;
  if (userId !== undefined) updateData.userId = userId;
  if (tenantId !== undefined) updateData.tenantId = tenantId;

  const device = await DeviceModel.findByIdAndUpdate(req.params.id, updateData, { new: true });
  if (!device) {
    res.status(404).json({ error: 'Dispositivo no encontrado' });
    return;
  }
  res.json(device);
});

devicesRouter.get('/pending', requireCompanyAdmin, async (req, res) => {
  const pendingDevices = await DeviceModel.find({ pending: true })
    .select('deviceId status lastSeenAt lastHeartbeatAt createdAt')
    .sort({ createdAt: -1 });
  
  res.json(
    pendingDevices.map(d => ({
      device_id: d.deviceId,
      status: d.status,
      last_seen: d.lastSeenAt?.getTime() ?? d.lastHeartbeatAt?.getTime() ?? d.createdAt?.getTime(),
      created_at: d.createdAt?.getTime()
    }))
  );
});

devicesRouter.post('/assign', requireCompanyAdmin, async (req, res) => {
  const data = assignSchema.parse(req.body);
  
  const user = await UserModel.findById(data.user_id);
  if (!user) {
    res.status(404).json({ error: 'Usuario no encontrado' });
    return;
  }

  const device = await DeviceModel.findOne({ deviceId: data.device_id });
  if (!device) {
    res.status(404).json({ error: 'Dispositivo no encontrado' });
    return;
  }

  device.userId = data.user_id;
  device.tenantId = user.tenantId;
  device.pending = false;
  device.status = device.status === 'offline' ? 'offline' : 'online';
  await device.save();

  res.json({ status: 'assigned', device_id: device.deviceId, user_id: data.user_id });
});

devicesRouter.get('/users', requireCompanyAdmin, async (req, res) => {
  const { tenantId } = req.query;
  const filter = tenantId ? { tenantId: String(tenantId) } : {};
  
  const users = await UserModel.find(filter)
    .select('_id name email role tenantId')
    .sort({ name: 1 });
  
  res.json(
    users.map(u => ({
      id: String(u._id),
      name: u.name,
      email: u.email,
      role: u.role,
      tenantId: u.tenantId
    }))
  );
});
