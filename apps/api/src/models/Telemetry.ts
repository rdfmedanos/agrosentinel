import { Schema, model } from 'mongoose';

const telemetrySchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    deviceId: { type: String, required: true, index: true },
    levelPct: { type: Number, required: true },
    reserveLiters: { type: Number, required: true },
    pumpOn: { type: Boolean, required: true },
    ts: { type: Date, required: true }
  },
  { timestamps: true }
);

telemetrySchema.index({ deviceId: 1, ts: -1 });

export const TelemetryModel = model('Telemetry', telemetrySchema);
