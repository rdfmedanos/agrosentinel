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

  const ownerPasswordHash = await bcrypt.hash('Cliente123!', 10);
  const owner = await UserModel.findOneAndUpdate(
    { email: 'owner@agrosentinel.com' },
    {
      $setOnInsert: {
        name: 'Establecimiento Demo',
        email: 'owner@agrosentinel.com',
        role: 'owner',
        tenantId: 'demo-tenant',
        planId: (await PlanModel.findOne({ name: 'Starter' }))?._id,
        mustChangePassword: true
      },
      $set: { passwordHash: ownerPasswordHash }
    },
    { upsert: true, new: true }
  );

  const companyAdminPasswordHash = await bcrypt.hash('Empresa123!', 10);
  const companyAdmin = await UserModel.findOneAndUpdate(
    { email: 'admin@agrosentinel.com' },
    {
      $setOnInsert: {
        name: 'Administrador AgroSentinel',
        email: 'admin@agrosentinel.com',
        role: 'company_admin',
        tenantId: 'agrosentinel-company',
        mustChangePassword: true
      },
      $set: { passwordHash: companyAdminPasswordHash }
    },
    { upsert: true, new: true }
  );

  const devices = await DeviceModel.countDocuments({ tenantId: 'demo-tenant' });
  if (devices === 0) {
    await DeviceModel.insertMany([
      {
        tenantId: 'demo-tenant',
        deviceId: 'ESP32-DEMO-001',
        name: 'Dispositivo Demo',
        location: { lat: -34.61, lng: -58.39, address: 'Dirección demo' },
        levelPct: 50,
        reserveLiters: 5000,
        pumpOn: false,
        status: 'online',
        lastHeartbeatAt: new Date()
      }
    ]);
  }
}
