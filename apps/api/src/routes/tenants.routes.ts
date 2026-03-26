import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { TenantConfigModel } from '../models/TenantConfig.js';
import { requireCompanyAdmin } from '../auth/auth.js';

const createTenantSchema = z.object({
  companyName: z.string().min(1),
  contactName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  planId: z.string().optional(),
  taxId: z.string().optional(),
  ivaCondition: z.enum(['Responsable Inscripto', 'Monotributista', 'Exento', 'Consumidor Final']).optional()
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
    .populate('planId', 'name')
    .select('_id tenantId companyName contactName email phone address active createdAt taxId ivaCondition')
    .sort({ createdAt: -1 });
  const result = tenants.map(t => ({
    _id: t._id,
    tenantId: t.tenantId,
    companyName: t.companyName,
    contactName: t.contactName,
    email: t.email,
    phone: t.phone,
    address: t.address,
    active: t.active,
    createdAt: t.createdAt,
    planId: (t.planId as unknown as { _id: string })?._id || null,
    planName: (t.planId as unknown as { name: string })?.name || null,
    taxId: t.taxId,
    ivaCondition: t.ivaCondition
  }));
  res.json(result);
});

tenantsRouter.post('/', requireCompanyAdmin, async (req, res) => {
  const data = createTenantSchema.parse(req.body);

  let tenantId = generateTenantId(data.companyName);
  let attempts = 0;

  while (await TenantConfigModel.findOne({ tenantId }) && attempts < 5) {
    tenantId = generateTenantId(data.companyName);
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
    planId: data.planId || null,
    taxId: data.taxId ?? '',
    ivaCondition: data.ivaCondition ?? 'Consumidor Final'
  });

  res.status(201).json({ id: String(created._id), tenantId: created.tenantId, companyName: created.companyName });
});

tenantsRouter.put('/:id', requireCompanyAdmin, async (req, res) => {
  const data = createTenantSchema.parse(req.body);
  const updateData: Record<string, unknown> = {
    companyName: data.companyName,
    contactName: data.contactName ?? '',
    email: data.email ?? '',
    phone: data.phone ?? '',
    address: data.address ?? '',
    taxId: data.taxId ?? '',
    ivaCondition: data.ivaCondition ?? 'Consumidor Final'
  };
  
  if (data.planId && data.planId.trim() !== '') {
    updateData.planId = new Types.ObjectId(data.planId);
  } else {
    updateData.planId = null;
  }

  const updated = await TenantConfigModel.findByIdAndUpdate(
    req.params.id,
    updateData,
    { new: true }
  );
  if (!updated) {
    res.status(404).json({ error: 'Cliente no encontrado' });
    return;
  }
  res.json(updated);
});
