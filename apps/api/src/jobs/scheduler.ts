import cron from 'node-cron';
import { logger } from '../config/logger.js';
import { checkOfflineDevices } from '../services/alert.service.js';
import { generateMonthlyInvoices } from '../services/billing.service.js';

export function startSchedulers() {
  setInterval(async () => {
    await checkOfflineDevices();
  }, 5000);

  cron.schedule('0 3 1 * *', async () => {
    await generateMonthlyInvoices();
    logger.info('Monthly invoices generated');
  });
}
