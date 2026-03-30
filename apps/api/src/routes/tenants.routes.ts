import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { TenantConfigModel } from '../models/TenantConfig.js';
import { UserModel } from '../models/User.js';
import { requireCompanyAdmin, requireAuth } from '../auth/auth.js';

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

  const generatedPassword = crypto.randomBytes(6).toString('hex');
  const passwordHash = await bcrypt.hash(generatedPassword, 10);
  
  const clientUser = await UserModel.create({
    name: data.contactName || data.companyName,
    email: (data.email || `${tenantId}@agrosentinel.local`).toLowerCase().trim(),
    role: 'owner',
    tenantId: created.tenantId,
    passwordHash,
    mustChangePassword: true
  });

  res.status(201).json({ 
    id: String(created._id), 
    tenantId: created.tenantId, 
    companyName: created.companyName,
    clientEmail: clientUser.email,
    clientPassword: generatedPassword
  });
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

  const existingUser = await UserModel.findOne({ tenantId: updated.tenantId, role: 'owner' });
  if (!existingUser) {
    const newPassword = crypto.randomBytes(6).toString('hex');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await UserModel.create({
      name: updated.contactName || updated.companyName,
      email: (updated.email || `${updated.tenantId}@agrosentinel.local`).toLowerCase().trim(),
      role: 'owner',
      tenantId: updated.tenantId,
      passwordHash,
      mustChangePassword: true
    });
  }

  res.json(updated);
});

const updateTenantDataSchema = z.object({
  companyName: z.string().min(1).optional(),
  contactName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  taxId: z.string().optional(),
  ivaCondition: z.enum(['Responsable Inscripto', 'Monotributista', 'Exento', 'Consumidor Final']).optional()
});

tenantsRouter.put('/me', requireAuth, async (req, res) => {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) {
    res.status(400).json({ error: 'No tenant associated with user' });
    return;
  }

  const data = updateTenantDataSchema.parse(req.body);
  const updateData: Record<string, unknown> = {};

  if (data.companyName !== undefined) updateData.companyName = data.companyName;
  if (data.contactName !== undefined) updateData.contactName = data.contactName;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.taxId !== undefined) updateData.taxId = data.taxId;
  if (data.ivaCondition !== undefined) updateData.ivaCondition = data.ivaCondition;

  const updated = await TenantConfigModel.findOneAndUpdate(
    { tenantId },
    updateData,
    { new: true }
  );

  if (!updated) {
    res.status(404).json({ error: 'Cliente no encontrado' });
    return;
  }

  res.json({
    tenantId: updated.tenantId,
    companyName: updated.companyName,
    contactName: updated.contactName,
    email: updated.email,
    phone: updated.phone,
    address: updated.address,
    taxId: updated.taxId,
    ivaCondition: updated.ivaCondition
  });
});

tenantsRouter.post('/:id/reset-password', requireCompanyAdmin, async (req, res) => {
  const tenant = await TenantConfigModel.findById(req.params.id);
  if (!tenant) {
    res.status(404).json({ error: 'Cliente no encontrado' });
    return;
  }

  const user = await UserModel.findOne({ tenantId: tenant.tenantId, role: 'owner' });
  if (!user) {
    res.status(404).json({ error: 'El cliente no tiene usuario asociado. Se creara al guardar los datos del cliente.' });
    return;
  }

  const newPassword = crypto.randomBytes(6).toString('hex');
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.mustChangePassword = true;
  await user.save();

  res.json({ email: user.email, newPassword });
});

tenantsRouter.get('/me', requireAuth, async (req, res) => {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) {
    res.status(400).json({ error: 'No tenant associated with user' });
    return;
  }

  const tenant = await TenantConfigModel.findOne({ tenantId }).select('tenantId companyName contactName email phone address taxId ivaCondition');
  if (!tenant) {
    res.status(404).json({ error: 'Cliente no encontrado' });
    return;
  }

  res.json(tenant);
});
