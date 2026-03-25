import { Router } from 'express';
import { z } from 'zod';
import { requireCompanyAdmin, resolveTenantFromRequest } from '../auth/auth.js';
import { CompanyInfoModel } from '../models/CompanyInfo.js';
import { InvoiceModel } from '../models/Invoice.js';
import { PlanModel } from '../models/Plan.js';
import { TenantConfigModel } from '../models/TenantConfig.js';
import { getArcaEnvironment, getEffectiveArcaConfig, setArcaEnvironment, authorizeInvoiceMock } from '../services/arca.service.js';
import { generateMonthlyInvoices } from '../services/billing.service.js';
import { generateInvoicePDF } from '../services/pdf.service.js';
import type { ArcaEnvironment } from '../config/env.js';

export const billingRouter = Router();

// ============ PLANES ============

billingRouter.get('/plans', async (_, res) => {
  const plans = await PlanModel.find({}).sort({ monthlyPriceArs: 1 });
  res.json(plans);
});

const updatePlanSchema = z.object({
  name: z.string().min(1),
  monthlyPriceArs: z.number().min(0),
  maxDevices: z.number().min(1),
  features: z.array(z.string()),
  active: z.boolean()
});

billingRouter.put('/plans/:id', requireCompanyAdmin, async (req, res) => {
  const data = updatePlanSchema.parse(req.body);
  const plan = await PlanModel.findByIdAndUpdate(
    req.params.id,
    data,
    { new: true }
  );
  if (!plan) {
    res.status(404).json({ error: 'Plan no encontrado' });
    return;
  }
  res.json(plan);
});

// ============ ENTORNO ARCA ============

billingRouter.get('/arca/environment', requireCompanyAdmin, async (_, res) => {
  res.json({ environment: getArcaEnvironment() });
});

billingRouter.put('/arca/environment', requireCompanyAdmin, async (req, res) => {
  const { environment } = z.object({
    environment: z.enum(['mock', 'homologacion', 'produccion'])
  }).parse(req.body);
  
  setArcaEnvironment(environment as ArcaEnvironment);
  res.json({ environment: getArcaEnvironment() });
});

billingRouter.get('/arca/status', requireCompanyAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantFromRequest(req);
    const config = await getEffectiveArcaConfig(tenantId);
    
    let status = {
      environment: config.environment,
      enabled: config.enabled,
      mock: config.mock,
      hasCredentials: !!(config.token && config.sign),
      hasCertificate: !!(config.certPath && config.certPassword),
      wsfeUrl: config.wsfeUrl,
      wsaaUrl: config.wsaaUrl,
      status: 'unknown' as 'ok' | 'warning' | 'error',
      message: ''
    };
    
    if (config.mock || config.environment === 'mock') {
      status.status = 'ok';
      status.message = 'Modo mock activo - Simulación enabled';
    } else if (!config.token || !config.sign) {
      status.status = 'error';
      status.message = 'Faltan credenciales (TOKEN/SIGN) - Configure en ARCA_TOKEN y ARCA_SIGN';
    } else {
      status.status = 'ok';
      status.message = 'Configuración lista para conectar';
    }
    
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Error al verificar estado', details: String(error) });
  }
});

billingRouter.post('/arca/test', requireCompanyAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantFromRequest(req);
    const config = await getEffectiveArcaConfig(tenantId);
    
    if (config.mock || config.environment === 'mock') {
      const mockResult = authorizeInvoiceMock({ amountArs: 1000, period: '2024-01' });
      res.json({ 
        success: true, 
        environment: 'mock',
        message: 'Mock: CAE simulado generado correctamente',
        cae: mockResult.cae
      });
      return;
    }
    
    if (!config.token || !config.sign) {
      res.status(400).json({ 
        success: false, 
        error: 'Credenciales no configuradas',
        hint: 'Configure ARCA_TOKEN y ARCA_SIGN en variables de entorno'
      });
      return;
    }
    
    res.json({ 
      success: true, 
      environment: config.environment,
      message: 'Credenciales configuradas (verifique en producción)'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ============ CONFIGURACIÓN ARCA ============

billingRouter.get('/arca-config', async (req, res) => {
  const tenantId = resolveTenantFromRequest(req);
  const config = await getEffectiveArcaConfig(tenantId);
  res.json(config);
});

const arcaConfigSchema = z.object({
  enabled: z.boolean(),
  mock: z.boolean(),
  cuit: z.string().min(11).max(11),
  ptoVta: z.string().min(1),
  token: z.string().optional().default(''),
  sign: z.string().optional().default(''),
  certPassword: z.string().optional().default('')
});

billingRouter.put('/arca-config', async (req, res) => {
  const tenantId = resolveTenantFromRequest(req);
  const data = arcaConfigSchema.parse(req.body);

  const config = await TenantConfigModel.findOneAndUpdate(
    { tenantId },
    {
      tenantId,
      'arca.enabled': data.enabled,
      'arca.mock': data.mock,
      'arca.cuit': data.cuit,
      'arca.ptoVta': data.ptoVta,
      'arca.token': data.token || '',
      'arca.sign': data.sign || '',
      'arca.certPassword': data.certPassword || '',
      'arca.environment': getArcaEnvironment() === 'produccion' ? 'prod' : 'homo'
    },
    { upsert: true, new: true }
  );

  res.json(config);
});

// ============ FACTURAS ============

billingRouter.get('/invoices', async (req, res) => {
  const tenantId = resolveTenantFromRequest(req);
  const { status, tipo } = req.query;
  
  const filter: any = { tenantId };
  if (status) filter.estado = status;
  if (tipo) filter.tipo = tipo;
  
  const invoices = await InvoiceModel.find(filter).sort({ createdAt: -1 });
  res.json(invoices);
});

billingRouter.get('/invoices/:id', async (req, res) => {
  const invoice = await InvoiceModel.findById(req.params.id);
  if (!invoice) {
    res.status(404).json({ error: 'Factura no encontrada' });
    return;
  }
  res.json(invoice);
});

const createInvoiceSchema = z.object({
  tipo: z.enum(['A', 'B', 'C', 'M']),
  cliente: z.object({
    tipoDoc: z.number().min(80).max(99),
    nroDoc: z.string().min(1),
    nombre: z.string().min(1),
    condicionIva: z.string().min(1),
    direccion: z.string().optional().default('')
  }),
  period: z.string().min(1),
  amountArs: z.number().positive()
});

billingRouter.post('/invoices', requireCompanyAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantFromRequest(req);
    const data = createInvoiceSchema.parse(req.body);
    const config = await getEffectiveArcaConfig(tenantId);
    
    // Verificar número de comprobante
    const lastInvoice = await InvoiceModel.findOne({ tenantId, tipo: data.tipo, puntoVenta: Number(config.ptoVta) })
      .sort({ numero: -1 });
    const nextNumero = lastInvoice ? lastInvoice.numero + 1 : 1;
    
    const invoice = await InvoiceModel.create({
      tenantId,
      userId: req.auth?.sub,
      period: data.period,
      amountArs: data.amountArs,
      tipo: data.tipo,
      puntoVenta: Number(config.ptoVta),
      numero: nextNumero,
      environment: config.environment,
      cliente: data.cliente,
      estado: 'pendiente'
    });
    
    res.status(201).json(invoice);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

billingRouter.post('/invoices/:id/authorize', requireCompanyAdmin, async (req, res) => {
  try {
    const invoice = await InvoiceModel.findById(req.params.id);
    if (!invoice) {
      res.status(404).json({ error: 'Factura no encontrada' });
      return;
    }
    
    if (invoice.estado !== 'pendiente') {
      res.status(400).json({ error: 'La factura ya fue procesada' });
      return;
    }
    
    const config = await getEffectiveArcaConfig(invoice.tenantId);
    
    if (config.mock || config.environment === 'mock') {
      const mockResult = authorizeInvoiceMock({ amountArs: invoice.amountArs, period: invoice.period });
      invoice.cae = mockResult.cae;
      invoice.caeDueDate = mockResult.caeDueDate;
      invoice.cbteNro = mockResult.cbteNro;
      invoice.cbteTipo = mockResult.cbteTipo;
      invoice.arcaResult = 'A';
      invoice.estado = 'autorizado';
      await invoice.save();
      res.json({ success: true, invoice });
      return;
    }
    
    // Aquí iría la lógica real de ARCA
    res.status(400).json({ error: 'No implementado - Configure TOKEN y SIGN para ARCA real' });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============ EMPRESA ============

billingRouter.get('/company-info', requireCompanyAdmin, async (_, res) => {
  let info = await CompanyInfoModel.findOne();
  if (!info) {
    info = await CompanyInfoModel.create({});
  }
  res.json(info);
});

const companyInfoSchema = z.object({
  companyName: z.string(),
  contactName: z.string(),
  email: z.string().email(),
  phone: z.string(),
  address: z.string(),
  taxId: z.string(),
  ivaCondition: z.string()
});

billingRouter.put('/company-info', requireCompanyAdmin, async (req, res) => {
  const data = companyInfoSchema.parse(req.body);
  const info = await CompanyInfoModel.findOneAndUpdate(
    {},
    data,
    { upsert: true, new: true }
  );
  res.json(info);
});

// ============ GENERACIÓN MENSUAL ============

billingRouter.post('/run-monthly', requireCompanyAdmin, async (_, res) => {
  await generateMonthlyInvoices();
  res.json({ status: 'ok' });
});

// ============ PDF ============

billingRouter.get('/invoices/:id/pdf', async (req, res) => {
  try {
    const invoice = await InvoiceModel.findById(req.params.id);
    if (!invoice) {
      res.status(404).json({ error: 'Factura no encontrada' });
      return;
    }

    const companyInfo = await CompanyInfoModel.findOne();
    const sellerInfo = companyInfo ? {
      companyName: companyInfo.companyName || 'AgroSentinel',
      taxId: companyInfo.taxId || '',
      address: companyInfo.address || '',
      ivaCondition: companyInfo.ivaCondition || '',
      phone: companyInfo.phone
    } : {
      companyName: 'AgroSentinel',
      taxId: '',
      address: '',
      ivaCondition: ''
    };

    const invoiceData = {
      ...invoice.toObject(),
      _id: invoice._id.toString()
    };

    const doc = generateInvoicePDF(invoiceData, sellerInfo);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="factura-${invoice.tipo}-${invoice.numero?.toString().padStart(8, '0') || '00000000'}.pdf"`);

    doc.pipe(res);
    doc.end();
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ error: 'Error al generar PDF' });
  }
});

// ============ CERTIFICADO ARCA ============

import multer from 'multer';
import path from 'path';
import fs from 'fs';

const certStorageDir = process.env.CERT_STORAGE_DIR || path.join(process.cwd(), 'certs');
if (!fs.existsSync(certStorageDir)) {
  fs.mkdirSync(certStorageDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, certStorageDir);
  },
  filename: (req, file, cb) => {
    const tenantId = resolveTenantFromRequest(req);
    const ext = path.extname(file.originalname);
    cb(null, `cert-${tenantId}${ext}`);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.p12', '.pfx'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos .p12 o .pfx'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

billingRouter.post('/arca/upload-cert', requireCompanyAdmin, upload.single('certificate'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No se recibió ningún archivo' });
      return;
    }

    const tenantId = resolveTenantFromRequest(req);
    const certPath = req.file.path;

    await TenantConfigModel.findOneAndUpdate(
      { tenantId },
      { 'arca.certPath': certPath }
    );

    res.json({ success: true, message: 'Certificado subido correctamente', certPath });
  } catch (error) {
    console.error('Error uploading certificate:', error);
    res.status(500).json({ error: 'Error al subir el certificado' });
  }
});

billingRouter.get('/arca/cert-status', requireCompanyAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantFromRequest(req);
    const config = await TenantConfigModel.findOne({ tenantId });

    const certPath = config?.arca?.certPath;
    const hasCert = certPath && fs.existsSync(certPath);
    const certFileName = certPath ? path.basename(certPath) : null;

    res.json({
      hasCertificate: hasCert,
      certFileName,
      certPath: hasCert ? certFileName : null,
      hasPassword: !!(config?.arca?.certPassword),
      message: hasCert ? 'Certificado cargado' : 'Sin certificado'
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al verificar certificado' });
  }
});

billingRouter.delete('/arca/cert', requireCompanyAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantFromRequest(req);
    const config = await TenantConfigModel.findOne({ tenantId });

    if (config?.arca?.certPath && fs.existsSync(config.arca.certPath)) {
      fs.unlinkSync(config.arca.certPath);
    }

    await TenantConfigModel.findOneAndUpdate(
      { tenantId },
      { 'arca.certPath': '', 'arca.certPassword': '' }
    );

    res.json({ success: true, message: 'Certificado eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar certificado' });
  }
});
