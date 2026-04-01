import { z } from 'zod';
import { DeviceModel } from '../models/Device.js';
import { TelemetryModel } from '../models/Telemetry.js';
import { logger } from '../config/logger.js';
import { emitTenant } from '../realtime/socket.js';
import { evaluateDeviceCriticalLevel, resolveAlert } from './alert.service.js';

export const telemetrySchema = z.object({
  device_id: z.string().optional(),
  nivel: z.number().min(0).max(100).optional(),
  reserva: z.number().min(0).optional(),
  bomba: z.boolean().optional(),
  rssi: z.number().optional(),
  levelPct: z.number().min(0).max(100).optional(),
  reserveLiters: z.number().min(0).optional(),
  pumpOn: z.boolean().optional(),
  ts: z.string().datetime().optional(),
  h: z.number().optional(),
  s: z.number().optional()
});

export async function upsertHeartbeat(deviceId: string) {
  const device = await DeviceModel.findOne({ deviceId });
  if (!device) return null;

  const wasOffline = device.status === 'offline';
  
  if (device.pending) {
    await DeviceModel.updateOne(
      { deviceId },
      { lastHeartbeatAt: new Date(), lastSeenAt: new Date(), status: 'online' }
    );
    return null;
  }

  const updated = await DeviceModel.findOneAndUpdate(
    { deviceId },
    { lastHeartbeatAt: new Date(), lastSeenAt: new Date(), status: 'online' },
    { new: true }
  );

  if (device.tenantId && updated) {
    if (wasOffline) {
      await resolveAlert(device.tenantId, device.deviceId, 'offline');
    }
    emitTenant(device.tenantId, 'devices:updated', updated.toObject());
  }
  return updated;
}

export async function ingestTelemetry(deviceId: string, payload: unknown) {
  const device = await DeviceModel.findOne({ deviceId });
  if (!device) throw new Error(`Device ${deviceId} not registered`);

  const data = telemetrySchema.parse(payload);
  if (data.h !== undefined || data.s !== undefined) {
    logger.info({ deviceId, h: data.h, s: data.s }, 'Received calibration from device');
  }

  const ts = data.ts ? new Date(data.ts) : new Date();
  const levelPct = data.nivel ?? data.levelPct ?? 0;
  const reserveLiters = data.reserva ?? data.reserveLiters ?? 0;
  const pumpOn = data.bomba ?? data.pumpOn ?? false;
  
  const wasOffline = device.status === 'offline';
  
  device.levelPct = levelPct;
  device.reserveLiters = reserveLiters;
  device.pumpOn = pumpOn;
  device.lastHeartbeatAt = new Date();
  device.lastSeenAt = new Date();
  
  if (!device.pending) {
    await TelemetryModel.create({
      tenantId: device.tenantId,
      deviceId,
      levelPct,
      reserveLiters,
      pumpOn,
      ts
    });
    device.status = levelPct <= (device.configAlertaBaja ?? 30) ? 'critical' : 'online';
  }
  
  await device.save();

  if (device.tenantId) {
    emitTenant(device.tenantId, 'telemetry:new', { 
      deviceId, 
      levelPct, 
      reserveLiters, 
      pumpOn,
      status: device.status 
    });
    emitTenant(device.tenantId, 'devices:updated', device.toObject());
    
    if (wasOffline) {
      await resolveAlert(device.tenantId, deviceId, 'offline');
    }
    
    if (!device.pending) {
      await evaluateDeviceCriticalLevel(device.deviceId);
    }
  }
}
