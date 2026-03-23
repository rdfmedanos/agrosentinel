import { z } from 'zod';
import { DeviceModel } from '../models/Device.js';
import { TelemetryModel } from '../models/Telemetry.js';
import { emitTenant } from '../realtime/socket.js';
import { evaluateDeviceCriticalLevel, resolveAlert } from './alert.service.js';

export const telemetrySchema = z.object({
  levelPct: z.number().min(0).max(100),
  reserveLiters: z.number().min(0),
  pumpOn: z.boolean(),
  ts: z.string().datetime().optional()
});

export async function upsertHeartbeat(deviceId: string) {
  const device = await DeviceModel.findOne({ deviceId });
  if (!device) return null;

  if (device.pending) {
    await DeviceModel.updateOne(
      { deviceId },
      { lastHeartbeatAt: new Date(), lastSeenAt: new Date(), status: 'online' }
    );
    return null;
  }

  const updated = await DeviceModel.findOneAndUpdate(
    { deviceId },
    { lastHeartbeatAt: new Date(), status: 'online' },
    { new: true }
  );

  if (device.tenantId && updated) {
    await resolveAlert(device.tenantId, device.deviceId, 'offline');
    emitTenant(device.tenantId, 'devices:updated', updated);
  }
  return updated;
}

export async function ingestTelemetry(deviceId: string, payload: unknown) {
  const device = await DeviceModel.findOne({ deviceId });
  if (!device) throw new Error(`Device ${deviceId} not registered`);
  if (device.pending) return;

  const data = telemetrySchema.parse(payload);

  const ts = data.ts ? new Date(data.ts) : new Date();
  await TelemetryModel.create({
    tenantId: device.tenantId,
    deviceId,
    levelPct: data.levelPct,
    reserveLiters: data.reserveLiters,
    pumpOn: data.pumpOn,
    ts
  });

  device.levelPct = data.levelPct;
  device.reserveLiters = data.reserveLiters;
  device.pumpOn = data.pumpOn;
  device.lastHeartbeatAt = new Date();
  device.status = data.levelPct <= 20 ? 'critical' : 'online';
  await device.save();

  if (device.tenantId) {
    await evaluateDeviceCriticalLevel(device.deviceId);
    emitTenant(device.tenantId, 'telemetry:new', { deviceId, ...data });
    emitTenant(device.tenantId, 'devices:updated', device);
  }
}
