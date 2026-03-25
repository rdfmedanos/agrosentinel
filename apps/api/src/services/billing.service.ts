import { authorizeInvoiceWithArca } from './arca.service.js';
import { InvoiceModel } from '../models/Invoice.js';
import { PlanModel } from '../models/Plan.js';
import { UserModel } from '../models/User.js';

function periodNow() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export async function generateMonthlyInvoices() {
  const period = periodNow();
  const owners = await UserModel.find({ role: 'owner' }).populate('planId');

  for (const user of owners) {
    const existing = await InvoiceModel.findOne({ tenantId: user.tenantId, period });
    if (existing) continue;

    const plan = user.planId
      ? await PlanModel.findById(user.planId)
      : await PlanModel.findOne({ name: 'Starter', active: true });
    const amountArs = plan?.monthlyPriceArs ?? 0;

    const arca = await authorizeInvoiceWithArca(user.tenantId, {
      amountArs,
      period
    });

    await InvoiceModel.create({
      tenantId: user.tenantId,
      userId: user._id,
      period,
      amountArs,
      status: 'issued',
      tipo: 'B',
      puntoVenta: 1,
      numero: 1,
      environment: 'mock',
      cae: arca.cae,
      caeDueDate: arca.caeDueDate,
      cbteNro: arca.cbteNro,
      cbteTipo: arca.cbteTipo,
      arcaResult: arca.result,
      estado: 'autorizado'
    });
  }
}
