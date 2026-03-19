import { Schema, model } from 'mongoose';

const workOrderSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    deviceId: { type: String, required: true },
    alertId: { type: Schema.Types.ObjectId, ref: 'Alert', required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    assignedTechnicianId: { type: Schema.Types.ObjectId, ref: 'User' },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'closed'],
      default: 'open'
    },
    openedAt: { type: Date, required: true },
    closedAt: { type: Date }
  },
  { timestamps: true }
);

export const WorkOrderModel = model('WorkOrder', workOrderSchema);
