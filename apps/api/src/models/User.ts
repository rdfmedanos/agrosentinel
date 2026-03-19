import { Schema, model } from 'mongoose';

export type UserRole = 'owner' | 'operator' | 'technician';

const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    role: { type: String, enum: ['owner', 'operator', 'technician'], default: 'owner' },
    tenantId: { type: String, required: true },
    planId: { type: Schema.Types.ObjectId, ref: 'Plan' }
  },
  { timestamps: true }
);

export const UserModel = model('User', userSchema);
