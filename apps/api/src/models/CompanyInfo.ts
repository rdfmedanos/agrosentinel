import { Schema, model } from 'mongoose';

const companyInfoSchema = new Schema({
  companyName: { type: String, default: '' },
  contactName: { type: String, default: '' },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  address: { type: String, default: '' },
  taxId: { type: String, default: '' },
  ivaCondition: { type: String, default: 'Responsable Inscripto' },
  province: { type: String, default: '' },
  city: { type: String, default: '' },
}, { timestamps: true });

export const CompanyInfoModel = model('CompanyInfo', companyInfoSchema);
