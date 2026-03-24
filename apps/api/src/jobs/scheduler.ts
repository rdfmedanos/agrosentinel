import cron from 'node-cron';
import { logger } from '../config/logger.js';
import { checkOfflineDevices } from '../services/alert.service.js';
import { generateMonthlyInvoices } from '../services/billing.service.js';

export function startSchedulers() {
  cron.schedule('*/10 * * * *', async () => {
    await checkOfflineDevices();
  });

  cron.schedule('0 3 1 * *', async () => {
    await generateMonthlyInvoices();
    logger.info('Monthly invoices generated');
  });
}
