import { Schema, model } from 'mongoose';

const invoiceSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    period: { type: String, required: true },
    amountArs: { type: Number, required: true },
    status: { type: String, enum: ['draft', 'issued', 'paid'], default: 'issued' },
    arca: {
      cae: { type: String },
      caeDueDate: { type: String },
      ptoVta: { type: String },
      cbteNro: { type: Number },
      cbteTipo: { type: Number, default: 6 },
      result: { type: String, default: 'A' }
    }
  },
  { timestamps: true }
);

invoiceSchema.index({ tenantId: 1, period: 1 }, { unique: true });

export const InvoiceModel = model('Invoice', invoiceSchema);
