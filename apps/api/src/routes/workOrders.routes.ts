import { Router } from 'express';
import { z } from 'zod';
import { resolveTenantFromRequest } from '../auth/auth.js';
import { WorkOrderModel } from '../models/WorkOrder.js';
import { closeWorkOrder } from '../services/workOrder.service.js';

export const workOrdersRouter = Router();

workOrdersRouter.get('/', async (req, res) => {
  const tenantId = resolveTenantFromRequest(req);
  const orders = await WorkOrderModel.find({ tenantId }).sort({ createdAt: -1 });
  res.json(orders);
});

workOrdersRouter.patch('/:id/assign', async (req, res) => {
  const technicianId = z.string().min(1).parse(req.body?.technicianId);
  const order = await WorkOrderModel.findByIdAndUpdate(
    req.params.id,
    { assignedTechnicianId: technicianId, status: 'in_progress' },
    { new: true }
  );
  res.json(order);
});

workOrdersRouter.patch('/:id/close', async (req, res) => {
  const order = await closeWorkOrder(req.params.id);
  res.json(order);
});
