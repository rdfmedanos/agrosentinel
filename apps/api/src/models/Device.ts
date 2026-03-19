import { Schema, model } from 'mongoose';

export type DeviceStatus = 'online' | 'warning' | 'critical' | 'offline';

const deviceSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    deviceId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
      address: { type: String, default: '' }
    },
    reserveLiters: { type: Number, default: 0 },
    levelPct: { type: Number, default: 0 },
    pumpOn: { type: Boolean, default: false },
    lastHeartbeatAt: { type: Date },
    status: {
      type: String,
      enum: ['online', 'warning', 'critical', 'offline'],
      default: 'offline'
    }
  },
  { timestamps: true }
);

export const DeviceModel = model('Device', deviceSchema);
