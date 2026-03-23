import { Schema, model } from 'mongoose';

const mqttConfigSchema = new Schema({
  tenantId: { type: String, required: true, unique: true },
  host: { type: String, default: 'localhost' },
  port: { type: Number, default: 1883 },
  username: { type: String, default: '' },
  password: { type: String, default: '' }
}, { timestamps: true });

export const MqttConfigModel = model('MqttConfig', mqttConfigSchema);
