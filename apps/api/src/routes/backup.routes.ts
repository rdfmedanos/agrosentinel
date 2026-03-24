import { Router } from 'express';
import { requireAuth, requireCompanyAdmin, resolveTenantFromRequest } from '../auth/auth.js';
import { TenantConfigModel } from '../models/TenantConfig.js';
import { DeviceModel } from '../models/Device.js';

export const backupRouter = Router();

backupRouter.get('/export', requireAuth, requireCompanyAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantFromRequest(req);
    const allClients = await TenantConfigModel.find().lean();
    const allDevices = await DeviceModel.find({ pending: false }).lean();
    
    console.log('resolveTenantFromRequest:', tenantId);
    console.log('All tenants:', allClients.map(c => c.tenantId));
    console.log('All devices tenants:', allDevices.map(d => d.tenantId));
    
    if (!tenantId) {
      res.json({ clients: allClients, devices: allDevices, debug: 'no tenantId, returning all' });
      return;
    }

    const clients = await TenantConfigModel.find({ tenantId }).lean();
    const devices = await DeviceModel.find({ tenantId, pending: false }).lean();

    const exportClients = clients.map(c => ({
      tenantId: c.tenantId,
      companyName: c.companyName,
      contactName: c.contactName,
      email: c.email,
      phone: c.phone,
      address: c.address
    }));

    const exportDevices = devices.map(d => ({
      deviceId: d.deviceId,
      tenantId: d.tenantId,
      name: d.name,
      location: d.location,
      status: d.status,
      configNivelMin: d.configNivelMin,
      configNivelMax: d.configNivelMax,
      configAlertaBaja: d.configAlertaBaja,
      configModoAuto: d.configModoAuto
    }));

    res.json({ clients: exportClients, devices: exportDevices });
  } catch (error) {
    console.error('Error exporting backup:', error);
    res.status(500).json({ error: 'Error al exportar backup' });
  }
});

backupRouter.post('/import', requireAuth, requireCompanyAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantFromRequest(req);
    if (!tenantId) {
      res.status(400).json({ error: 'Tenant no encontrado' });
      return;
    }

    const { clients, devices } = req.body as { clients?: unknown[]; devices?: unknown[] };

    if (clients && Array.isArray(clients)) {
      for (const client of clients) {
        const c = client as { tenantId?: string; companyName?: string; contactName?: string; email?: string; phone?: string; address?: string };
        if (c.tenantId === tenantId) {
          await TenantConfigModel.findOneAndUpdate(
            { tenantId: c.tenantId, companyName: c.companyName },
            { $set: c },
            { upsert: true }
          );
        }
      }
    }

    if (devices && Array.isArray(devices)) {
      for (const device of devices) {
        const d = device as { deviceId?: string; tenantId?: string; name?: string; location?: { lat?: number; lng?: number; address?: string } };
        if (d.tenantId === tenantId) {
          await DeviceModel.findOneAndUpdate(
            { deviceId: d.deviceId },
            { 
              $set: { 
                name: d.name, 
                location: d.location, 
                tenantId: d.tenantId,
                pending: false,
                status: 'offline'
              } 
            },
            { upsert: true }
          );
        }
      }
    }

    res.json({ status: 'ok', message: 'Backup restaurado exitosamente' });
  } catch (error) {
    console.error('Error importing backup:', error);
    res.status(500).json({ error: 'Error al restaurar backup' });
  }
});
