import { Router } from 'express';
import { z } from 'zod';
import { requireCompanyAdmin, resolveTenantFromRequest } from '../auth/auth.js';
import { InvoiceModel } from '../models/Invoice.js';
import { PlanModel } from '../models/Plan.js';
import { TenantConfigModel } from '../models/TenantConfig.js';
import { getEffectiveArcaConfig } from '../services/arca.service.js';
import { generateMonthlyInvoices } from '../services/billing.service.js';

export const billingRouter = Router();

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

billingRouter.get('/invoices', async (req, res) => {
  const tenantId = resolveTenantFromRequest(req);
  const invoices = await InvoiceModel.find({ tenantId }).sort({ createdAt: -1 });
  res.json(invoices);
});

billingRouter.post('/run-monthly', requireCompanyAdmin, async (_, res) => {
  await generateMonthlyInvoices();
  res.json({ status: 'ok' });
});

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
  wsfeUrl: z.string().url(),
  token: z.string().optional().default(''),
  sign: z.string().optional().default('')
});

billingRouter.put('/arca-config', async (req, res) => {
  const tenantId = resolveTenantFromRequest(req);
  const data = arcaConfigSchema.parse(req.body);

  const config = await TenantConfigModel.findOneAndUpdate(
    { tenantId },
    {
      tenantId,
      arca: {
        enabled: data.enabled,
        mock: data.mock,
        cuit: data.cuit,
        ptoVta: data.ptoVta,
        wsfeUrl: data.wsfeUrl,
        token: data.token,
        sign: data.sign,
        environment: data.wsfeUrl.includes('wswhomo') ? 'homo' : 'prod'
      }
    },
    { upsert: true, new: true }
  );

  res.json(config);
});
