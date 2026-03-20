import { Router } from 'express';
import { z } from 'zod';
import { TenantConfigModel } from '../models/TenantConfig.js';
import { requireCompanyAdmin } from '../auth/auth.js';

const createTenantSchema = z.object({
  companyName: z.string().min(1),
  contactName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  planId: z.string().optional()
});

function generateTenantId(companyName: string): string {
  const base = companyName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 30);
  const suffix = Math.random().toString(36).substring(2, 7);
  return `${base}-${suffix}`;
}

export const tenantsRouter = Router();

tenantsRouter.get('/', async (req, res) => {
  const tenants = await TenantConfigModel.find()
    .select('_id tenantId companyName contactName email phone address active createdAt')
    .sort({ createdAt: -1 });
  res.json(tenants);
});

tenantsRouter.post('/', requireCompanyAdmin, async (req, res) => {
  const data = createTenantSchema.parse(req.body);

  const tenantId = generateTenantId(data.companyName);
  let attempts = 0;

  while (await TenantConfigModel.findOne({ tenantId }) && attempts < 5) {
    attempts++;
  }

  if (attempts >= 5) {
    res.status(500).json({ error: 'No se pudo generar un ID único para el cliente' });
    return;
  }

  const created = await TenantConfigModel.create({
    tenantId,
    companyName: data.companyName,
    contactName: data.contactName ?? '',
    email: data.email ?? '',
    phone: data.phone ?? '',
    address: data.address ?? '',
    planId: data.planId || null
  });

  res.status(201).json({ id: String(created._id), tenantId: created.tenantId, companyName: created.companyName });
});
