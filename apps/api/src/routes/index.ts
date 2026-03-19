import { Router } from 'express';
import { alertsRouter } from './alerts.routes.js';
import { billingRouter } from './billing.routes.js';
import { devicesRouter } from './devices.routes.js';
import { workOrdersRouter } from './workOrders.routes.js';

export const apiRouter = Router();

apiRouter.get('/health', (_, res) => {
  res.json({ status: 'ok', service: 'agrosentinel-api' });
});

apiRouter.use('/devices', devicesRouter);
apiRouter.use('/alerts', alertsRouter);
apiRouter.use('/work-orders', workOrdersRouter);
apiRouter.use('/billing', billingRouter);
