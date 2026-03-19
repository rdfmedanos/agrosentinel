import { AlertModel } from '../models/Alert.js';
import { WorkOrderModel } from '../models/WorkOrder.js';
import { emitTenant } from '../realtime/socket.js';

export async function createWorkOrderFromAlert(alertId: string) {
  const alert = await AlertModel.findById(alertId);
  if (!alert) return null;

  const existing = await WorkOrderModel.findOne({ alertId: alert._id, status: { $ne: 'closed' } });
  if (existing) return existing;

  const workOrder = await WorkOrderModel.create({
    tenantId: alert.tenantId,
    deviceId: alert.deviceId,
    alertId: alert._id,
    title: `Atender alerta ${alert.type}`,
    description: alert.message,
    openedAt: new Date()
  });

  emitTenant(alert.tenantId, 'work-orders:updated', workOrder);
  return workOrder;
}

export async function closeWorkOrder(orderId: string) {
  const order = await WorkOrderModel.findByIdAndUpdate(
    orderId,
    { status: 'closed', closedAt: new Date() },
    { new: true }
  );

  if (!order) return null;
  await AlertModel.findByIdAndUpdate(order.alertId, { status: 'resolved', resolvedAt: new Date() });
  emitTenant(order.tenantId, 'work-orders:updated', order);
  return order;
}
