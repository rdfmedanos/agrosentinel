import { Schema, model } from 'mongoose';
import path from 'path';
import fs from 'fs';

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
    taxId: { type: String, default: '' },
    ivaCondition: { 
      type: String, 
      enum: ['Responsable Inscripto', 'Monotributista', 'Exento', 'Consumidor Final'],
      default: 'Consumidor Final'
    },
    arca: {
      enabled: { type: Boolean, default: false },
      mock: { type: Boolean, default: true },
      cuit: { type: String, default: '' },
      ptoVta: { type: String, default: '1' },
      wsfeUrl: { type: String, default: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx' },
      wsaaUrl: { type: String, default: 'https://wsaahomo.afip.gov.ar/wsaa/services/LoginCms' },
      token: { type: String, default: '' },
      sign: { type: String, default: '' },
      certPath: { type: String, default: '' },
      certPassword: { type: String, default: '' },
      environment: { type: String, enum: ['mock', 'homo', 'prod'], default: 'mock' }
    }
  },
  { timestamps: true }
);

export const TenantConfigModel = model('TenantConfig', tenantConfigSchema);

export function getCertStorageDir(): string {
  const dir = process.env.CERT_STORAGE_DIR || path.join(process.cwd(), 'certs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
