import { Schema, model } from 'mongoose';

const planSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    monthlyPriceArs: { type: Number, required: true },
    maxDevices: { type: Number, required: true },
    features: [{ type: String }],
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export const PlanModel = model('Plan', planSchema);
