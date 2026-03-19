import { env } from '../config/env.js';
import { AlertModel } from '../models/Alert.js';
import { DeviceModel } from '../models/Device.js';
import { emitTenant } from '../realtime/socket.js';
import { createWorkOrderFromAlert } from './workOrder.service.js';

export async function openAlert(params: {
  tenantId: string;
  deviceId: string;
  type: 'offline' | 'critical_level';
  message: string;
}) {
  const existing = await AlertModel.findOne({
    tenantId: params.tenantId,
    deviceId: params.deviceId,
    type: params.type,
    status: 'open'
  });
  if (existing) return existing;

  const alert = await AlertModel.create({ ...params, openedAt: new Date() });
  await createWorkOrderFromAlert(String(alert._id));
  emitTenant(params.tenantId, 'alerts:updated', alert);
  return alert;
}

export async function resolveAlert(tenantId: string, deviceId: string, type: 'offline' | 'critical_level') {
  const alert = await AlertModel.findOneAndUpdate(
    { tenantId, deviceId, type, status: 'open' },
    { status: 'resolved', resolvedAt: new Date() },
    { new: true }
  );
  if (alert) emitTenant(tenantId, 'alerts:updated', alert);
}

export async function evaluateDeviceCriticalLevel(deviceId: string) {
  const device = await DeviceModel.findOne({ deviceId });
  if (!device) return;

  if (device.levelPct <= env.criticalLevelPct) {
    await openAlert({
      tenantId: device.tenantId,
      deviceId: device.deviceId,
      type: 'critical_level',
      message: `Nivel critico (${device.levelPct}%). Revisar tanque.`
    });
    await DeviceModel.updateOne({ _id: device._id }, { status: 'critical' });
    emitTenant(device.tenantId, 'devices:updated', { deviceId: device.deviceId, status: 'critical' });
  } else {
    await resolveAlert(device.tenantId, device.deviceId, 'critical_level');
  }
}

export async function checkOfflineDevices() {
  const threshold = new Date(Date.now() - env.deviceOfflineSeconds * 1000);
  const offlineDevices = await DeviceModel.find({
    $or: [{ lastHeartbeatAt: { $lt: threshold } }, { lastHeartbeatAt: { $exists: false } }],
    status: { $ne: 'offline' }
  });

  for (const d of offlineDevices) {
    d.status = 'offline';
    await d.save();

    await openAlert({
      tenantId: d.tenantId,
      deviceId: d.deviceId,
      type: 'offline',
      message: `Dispositivo ${d.name} sin heartbeat` 
    });
    emitTenant(d.tenantId, 'devices:updated', d);
  }
}
