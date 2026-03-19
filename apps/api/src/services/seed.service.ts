import bcrypt from 'bcryptjs';
import { DeviceModel } from '../models/Device.js';
import { PlanModel } from '../models/Plan.js';
import { UserModel } from '../models/User.js';

export async function seedInitialData() {
  const plans = await PlanModel.countDocuments();
  if (plans === 0) {
    await PlanModel.insertMany([
      { name: 'Starter', monthlyPriceArs: 25000, maxDevices: 5, features: ['Alertas', 'Mapa', 'Soporte email'] },
      { name: 'Growth', monthlyPriceArs: 65000, maxDevices: 20, features: ['Ordenes trabajo', 'Facturacion', 'API'] },
      { name: 'Enterprise', monthlyPriceArs: 150000, maxDevices: 9999, features: ['SLA dedicado', 'Multi-sede', 'SSO'] }
    ]);
  }

  const owner = await UserModel.findOne({ email: 'owner@agrosentinel.com' });
  const ownerPasswordHash = await bcrypt.hash('Cliente123!', 10);
  if (!owner) {
    const starter = await PlanModel.findOne({ name: 'Starter' });
    await UserModel.create({
      name: 'Establecimiento Demo',
      email: 'owner@agrosentinel.com',
      role: 'owner',
      tenantId: 'demo-tenant',
      planId: starter?._id,
      passwordHash: ownerPasswordHash,
      mustChangePassword: true
    });
  } else if (!owner.passwordHash) {
    owner.passwordHash = ownerPasswordHash;
    owner.mustChangePassword = true;
    await owner.save();
  }

  const companyAdmin = await UserModel.findOne({ email: 'admin@agrosentinel.com' });
  const companyAdminPasswordHash = await bcrypt.hash('Empresa123!', 10);
  if (!companyAdmin) {
    await UserModel.create({
      name: 'Administrador AgroSentinel',
      email: 'admin@agrosentinel.com',
      role: 'company_admin',
      tenantId: 'agrosentinel-company',
      passwordHash: companyAdminPasswordHash,
      mustChangePassword: true
    });
  } else if (!companyAdmin.passwordHash) {
    companyAdmin.passwordHash = companyAdminPasswordHash;
    companyAdmin.mustChangePassword = true;
    await companyAdmin.save();
  }

  const devices = await DeviceModel.countDocuments({ tenantId: 'demo-tenant' });
  if (devices === 0) {
    await DeviceModel.insertMany([
      {
        tenantId: 'demo-tenant',
        deviceId: 'ESP32-NORTE-001',
        name: 'Tanque Norte',
        location: { lat: -34.61, lng: -58.39, address: 'Lote Norte' },
        levelPct: 74,
        reserveLiters: 7400,
        pumpOn: false,
        status: 'online',
        lastHeartbeatAt: new Date()
      },
      {
        tenantId: 'demo-tenant',
        deviceId: 'ESP32-SUR-002',
        name: 'Tanque Sur',
        location: { lat: -34.66, lng: -58.47, address: 'Lote Sur' },
        levelPct: 18,
        reserveLiters: 1800,
        pumpOn: true,
        status: 'critical',
        lastHeartbeatAt: new Date()
      }
    ]);
  }
}
