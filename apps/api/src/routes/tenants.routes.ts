import { Router } from 'express';
import { z } from 'zod';
import { TenantConfigModel } from '../models/TenantConfig.js';
import { requireCompanyAdmin } from '../auth/auth.js';

const createTenantSchema = z.object({
  tenantId: z.string().min(1),
  companyName: z.string().min(1),
  contactName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  planId: z.string().optional()
});

export const tenantsRouter = Router();

tenantsRouter.get('/', async (req, res) => {
  const tenants = await TenantConfigModel.find()
    .select('_id tenantId companyName contactName email phone address active createdAt')
    .sort({ createdAt: -1 });
  res.json(tenants);
});

tenantsRouter.post('/', requireCompanyAdmin, async (req, res) => {
  const data = createTenantSchema.parse(req.body);

  const existing = await TenantConfigModel.findOne({ tenantId: data.tenantId });
  if (existing) {
    res.status(409).json({ error: 'El tenant ya existe' });
    return;
  }

  const created = await TenantConfigModel.create({
    tenantId: data.tenantId,
    companyName: data.companyName,
    contactName: data.contactName ?? '',
    email: data.email ?? '',
    phone: data.phone ?? '',
    address: data.address ?? '',
    planId: data.planId || null
  });

  res.status(201).json({ id: String(created._id), tenantId: created.tenantId, companyName: created.companyName });
});
