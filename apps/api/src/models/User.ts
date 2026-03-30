import { Schema, model } from 'mongoose';

export type UserRole = 'owner' | 'operator' | 'technician' | 'company_admin' | 'client';

const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    role: { type: String, enum: ['owner', 'operator', 'technician', 'company_admin', 'client'], default: 'owner' },
    tenantId: { type: String, required: true },
    planId: { type: Schema.Types.ObjectId, ref: 'Plan' },
    passwordHash: { type: String, required: true },
    mustChangePassword: { type: Boolean, default: false },
    resetToken: { type: String },
    resetTokenExpires: { type: Date }
  },
  { timestamps: true }
);

export const UserModel = model('User', userSchema);
