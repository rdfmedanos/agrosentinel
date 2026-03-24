import { Router } from 'express';
import { requireAuth, requireCompanyAdmin } from '../auth/auth.js';
import { TenantConfigModel } from '../models/TenantConfig.js';
import { DeviceModel } from '../models/Device.js';
import { logger } from '../config/logger.js';

export const backupRouter = Router();

backupRouter.get('/export', requireAuth, requireCompanyAdmin, async (req, res) => {
  try {
    const tenantId = req.auth?.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: 'Tenant no encontrado' });
      return;
    }

    const clients = await TenantConfigModel.find({ tenantId }).lean();
    const devices = await DeviceModel.find({ tenantId, pending: false }).lean();

    res.json({ clients, devices });
  } catch (error) {
    logger.error({ error }, 'Error exporting backup');
    res.status(500).json({ error: 'Error al exportar backup' });
  }
});

backupRouter.post('/import', requireAuth, requireCompanyAdmin, async (req, res) => {
  try {
    const tenantId = req.auth?.tenantId;
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
    logger.error({ error }, 'Error importing backup');
    res.status(500).json({ error: 'Error al restaurar backup' });
  }
});
