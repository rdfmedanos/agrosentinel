import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireCompanyAdmin, signAuthToken } from '../auth/auth.js';
import { UserModel } from '../models/User.js';
import { TenantConfigModel } from '../models/TenantConfig.js';
import { env } from '../config/env.js';

async function sendPasswordResetEmail(email: string, resetToken: string) {
  const resetUrl = `${env.appUrl}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
  
  if (env.smtpHost && env.smtpUser && env.smtpPass) {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: {
        user: env.smtpUser,
        pass: env.smtpPass
      }
    });
    
    await transporter.sendMail({
      from: env.emailFrom,
      to: email,
      subject: 'Recuperar contraseña - AgroSentinel',
      html: `
        <h2>Recuperar contraseña</h2>
        <p>Has solicitado recuperar tu contraseña en AgroSentinel.</p>
        <p>Haz clic en el siguiente enlace para crear una nueva contraseña:</p>
        <a href="${resetUrl}" style="padding: 10px 20px; background: #4CAF50; color: white; text-decoration: none; border-radius: 5px;">Recuperar contraseña</a>
        <p>O copia y pega este enlace en tu navegador:</p>
        <p>${resetUrl}</p>
        <p>Este enlace expire en 1 hora.</p>
        <p>Si no solicitaste esto, ignora este correo.</p>
      `
    });
  } else {
    console.log(`[DEV] Password reset link for ${email}: ${resetUrl}`);
  }
}

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
  const email = data.email.toLowerCase().trim();

  let user = await UserModel.findOne({ email });
  let isClientLogin = false;
  let clientTenantId = '';

  if (!user) {
    const tenant = await TenantConfigModel.findOne({ clientUsername: email });
    if (tenant && tenant.clientPasswordHash) {
      const passwordMatches = await bcrypt.compare(data.password, tenant.clientPasswordHash);
      if (!passwordMatches) {
        res.status(401).json({ error: 'Credenciales invalidas' });
        return;
      }
      isClientLogin = true;
      clientTenantId = tenant.tenantId;
      const fakeId = `client-${tenant._id}`;
      const token = signAuthToken({
        sub: fakeId,
        email: tenant.clientUsername,
        role: 'client',
        tenantId: clientTenantId
      });
      res.json({
        token,
        user: {
          id: fakeId,
          name: tenant.companyName,
          email: tenant.clientUsername,
          role: 'client',
          tenantId: clientTenantId,
          mustChangePassword: Boolean(tenant.clientMustChangePassword)
        }
      });
      return;
    }
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
  try {
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
  } catch (err: any) {
    if (err?.name === 'CastError') {
      res.status(401).json({ error: 'Sesion invalida' });
      return;
    }
    throw err;
  }
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const data = changePasswordSchema.parse(req.body);
  try {
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
  } catch (err: any) {
    if (err?.name === 'CastError') {
      res.status(401).json({ error: 'Sesion invalida' });
      return;
    }
    throw err;
  }
});

authRouter.post('/change-password-first', requireAuth, async (req, res) => {
  const data = z.object({ newPassword: z.string().min(8) }).parse(req.body);
  try {
    const user = await UserModel.findById(req.auth?.sub);
    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    user.passwordHash = await bcrypt.hash(data.newPassword, 10);
    user.mustChangePassword = false;
    await user.save();

    res.json({ status: 'ok' });
  } catch (err: any) {
    if (err?.name === 'CastError') {
      res.status(401).json({ error: 'Sesion invalida' });
      return;
    }
    throw err;
  }
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

authRouter.post('/admin/delete-user', requireAuth, requireCompanyAdmin, async (req, res) => {
  const { userId } = z.object({ userId: z.string().min(1) }).parse(req.body);

  const user = await UserModel.findById(userId);
  if (!user) {
    res.status(404).json({ error: 'Usuario no encontrado' });
    return;
  }

  if (user.role === 'company_admin') {
    res.status(400).json({ error: 'No se puede eliminar usuarios company_admin' });
    return;
  }

  await UserModel.findByIdAndDelete(userId);
  res.json({ status: 'ok' });
});

authRouter.post('/forgot-password', async (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  
  const user = await UserModel.findOne({ email: email.toLowerCase().trim() });
  if (!user) {
    res.json({ message: 'Si el correo existe, recibirás un enlace para recuperar tu contraseña' });
    return;
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  user.resetToken = resetToken;
  user.resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000);
  await user.save();

  await sendPasswordResetEmail(user.email, resetToken);
  
  res.json({ message: 'Si el correo existe, recibirás un enlace para recuperar tu contraseña' });
});

authRouter.post('/reset-password', async (req, res) => {
  const { token, email, newPassword } = z.object({
    token: z.string().min(1),
    email: z.string().email(),
    newPassword: z.string().min(8)
  }).parse(req.body);

  const user = await UserModel.findOne({ 
    email: email.toLowerCase().trim(),
    resetToken: token,
    resetTokenExpires: { $gt: new Date() }
  });

  if (!user) {
    res.status(400).json({ error: 'Token invalido o expirado' });
    return;
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.resetToken = undefined;
  user.resetTokenExpires = undefined;
  user.mustChangePassword = false;
  await user.save();

  res.json({ message: 'Contrasena actualizada correctamente' });
});
