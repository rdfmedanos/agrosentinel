import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireCompanyAdmin, signAuthToken } from '../auth/auth.js';
import { UserModel } from '../models/User.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(6),
  newPassword: z.string().min(8)
});

const resetPasswordSchema = z.object({
  userId: z.string().min(1),
  newPassword: z.string().min(8)
});

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['owner', 'operator', 'technician']),
  tenantId: z.string().min(1),
  password: z.string().min(8)
});

const listUsersSchema = z.object({
  tenantId: z.string().min(1).optional()
});

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const data = loginSchema.parse(req.body);
  const user = await UserModel.findOne({ email: data.email.toLowerCase().trim() });
  if (!user) {
    res.status(401).json({ error: 'Credenciales invalidas' });
    return;
  }

  const passwordMatches = await bcrypt.compare(data.password, user.passwordHash);
  if (!passwordMatches) {
    res.status(401).json({ error: 'Credenciales invalidas' });
    return;
  }

  const token = signAuthToken({
    sub: String(user._id),
    email: user.email,
    role: user.role,
    tenantId: user.tenantId
  });

  res.json({
    token,
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      mustChangePassword: Boolean(user.mustChangePassword)
    }
  });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await UserModel.findById(req.auth?.sub);
  if (!user) {
    res.status(401).json({ error: 'Sesion invalida' });
    return;
  }

  res.json({
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    mustChangePassword: Boolean(user.mustChangePassword)
  });
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const data = changePasswordSchema.parse(req.body);
  const user = await UserModel.findById(req.auth?.sub);
  if (!user) {
    res.status(404).json({ error: 'Usuario no encontrado' });
    return;
  }

  const currentMatches = await bcrypt.compare(data.currentPassword, user.passwordHash);
  if (!currentMatches) {
    res.status(401).json({ error: 'Contrasena actual invalida' });
    return;
  }

  user.passwordHash = await bcrypt.hash(data.newPassword, 10);
  user.mustChangePassword = false;
  await user.save();

  res.json({ status: 'ok' });
});

authRouter.post('/admin/create-user', requireAuth, requireCompanyAdmin, async (req, res) => {
  const data = createUserSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(data.password, 10);
  const created = await UserModel.create({
    name: data.name,
    email: data.email.toLowerCase().trim(),
    role: data.role,
    tenantId: data.tenantId,
    passwordHash,
    mustChangePassword: true
  });

  res.status(201).json({ id: String(created._id) });
});

authRouter.get('/admin/users', requireAuth, requireCompanyAdmin, async (req, res) => {
  const parsed = listUsersSchema.parse(req.query);
  const filter = parsed.tenantId ? { tenantId: parsed.tenantId } : {};
  const users = await UserModel.find(filter)
    .select('_id name email role tenantId mustChangePassword')
    .sort({ createdAt: -1 });
  res.json(
    users.map(user => ({
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      mustChangePassword: Boolean(user.mustChangePassword)
    }))
  );
});

authRouter.post('/admin/reset-password', requireAuth, requireCompanyAdmin, async (req, res) => {
  const data = resetPasswordSchema.parse(req.body);
  const user = await UserModel.findById(data.userId);
  if (!user) {
    res.status(404).json({ error: 'Usuario no encontrado' });
    return;
  }

  user.passwordHash = await bcrypt.hash(data.newPassword, 10);
  user.mustChangePassword = true;
  await user.save();
  res.json({ status: 'ok' });
});
