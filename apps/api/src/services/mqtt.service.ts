import mqtt from 'mqtt';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { DeviceModel } from '../models/Device.js';
import { ingestTelemetry, upsertHeartbeat } from './telemetry.service.js';

let mqttClient: mqtt.MqttClient;

export function initMqtt() {
  mqttClient = mqtt.connect(env.mqttUrl, {
    username: env.mqttUsername,
    password: env.mqttPassword
  });

  mqttClient.on('connect', () => {
    logger.info('MQTT connected');
    mqttClient.subscribe('devices/+/#', { qos: 1 });
  });

  mqttClient.on('message', async (topic, payloadBuffer) => {
    try {
      const payloadText = payloadBuffer.toString();
      const payload = payloadText ? JSON.parse(payloadText) : {};
      const parts = topic.split('/');
      const deviceId = parts[1];
      const suffix = parts.slice(2).join('/');

      if (!deviceId || !suffix) return;

      if (suffix === 'heartbeat') {
        await upsertHeartbeat(deviceId);
        return;
      }

      if (suffix === 'telemetry' || suffix === 'status') {
        await ensurePendingDevice(deviceId);
        await ingestTelemetry(deviceId, payload);
      }
    } catch (error) {
      logger.error({ error }, 'MQTT message process error');
    }
  });
}

async function ensurePendingDevice(deviceId: string) {
  const existing = await DeviceModel.findOne({ deviceId });
  if (!existing) {
    await DeviceModel.create({
      deviceId,
      pending: true,
      status: 'offline',
      lastSeenAt: new Date()
    });
    logger.info({ deviceId }, 'Created pending device from MQTT');
  } else if (existing.pending) {
    existing.lastSeenAt = new Date();
    existing.status = 'online';
    await existing.save();
  }
}

export function publishDeviceCommand(deviceId: string, command: { cmd: 'pump_on' | 'pump_off'; requestId: string }) {
  if (!mqttClient) throw new Error('MQTT not initialized');
  mqttClient.publish(`devices/${deviceId}/command`, JSON.stringify(command), { qos: 1 });
}
