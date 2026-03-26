import { Schema, model } from 'mongoose';

const systemConfigSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, required: true },
  description: { type: String },
  updatedAt: { type: Date, default: Date.now }
});

export const SystemConfigModel = model('SystemConfig', systemConfigSchema);
