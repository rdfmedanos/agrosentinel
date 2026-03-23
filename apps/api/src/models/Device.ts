import { Schema, model } from 'mongoose';

export type DeviceStatus = 'online' | 'warning' | 'critical' | 'offline';

const deviceSchema = new Schema(
  {
    tenantId: { type: String, index: true },
    deviceId: { type: String, required: true, unique: true },
    name: { type: String },
    userId: { type: String, index: true },
    pending: { type: Boolean, default: true },
    location: {
      lat: { type: Number },
      lng: { type: Number },
      address: { type: String, default: '' }
    },
    reserveLiters: { type: Number, default: 0 },
    levelPct: { type: Number, default: 0 },
    pumpOn: { type: Boolean, default: false },
    lastHeartbeatAt: { type: Date },
    lastSeenAt: { type: Date },
    status: {
      type: String,
      enum: ['online', 'warning', 'critical', 'offline'],
      default: 'offline'
    }
  },
  { timestamps: true }
);

deviceSchema.index({ pending: 1, userId: 1 });
deviceSchema.index({ pending: 1, tenantId: 1 });

export const DeviceModel = model('Device', deviceSchema);
