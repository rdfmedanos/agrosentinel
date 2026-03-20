import { Schema, model } from 'mongoose';

const tenantConfigSchema = new Schema(
  {
    tenantId: { type: String, required: true, unique: true, index: true },
    companyName: { type: String, required: true },
    contactName: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    address: { type: String, default: '' },
    planId: { type: Schema.Types.ObjectId, ref: 'Plan', default: null },
    active: { type: Boolean, default: true },
    arca: {
      enabled: { type: Boolean, default: false },
      mock: { type: Boolean, default: true },
      cuit: { type: String, default: '' },
      ptoVta: { type: String, default: '1' },
      wsfeUrl: { type: String, default: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx' },
      token: { type: String, default: '' },
      sign: { type: String, default: '' },
      environment: { type: String, enum: ['homo', 'prod'], default: 'homo' }
    }
  },
  { timestamps: true }
);

export const TenantConfigModel = model('TenantConfig', tenantConfigSchema);
