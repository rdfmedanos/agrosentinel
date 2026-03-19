import { Schema, model } from 'mongoose';

export type AlertType = 'offline' | 'critical_level';

const alertSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    deviceId: { type: String, required: true, index: true },
    type: { type: String, enum: ['offline', 'critical_level'], required: true },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
    message: { type: String, required: true },
    openedAt: { type: Date, required: true },
    resolvedAt: { type: Date }
  },
  { timestamps: true }
);

export const AlertModel = model('Alert', alertSchema);
