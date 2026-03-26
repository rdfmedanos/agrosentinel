import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';
import { InvoiceModel } from '../models/Invoice.js';

export async function connectDb() {
  await mongoose.connect(env.mongoUri);

  try {
    await InvoiceModel.collection.dropIndex('tenantId_1_tipo_1_puntoVenta_1_numero_1');
    logger.info('Removed legacy invoice unique index');
  } catch {
    // no-op: index may not exist
  }

  await InvoiceModel.syncIndexes();
  logger.info('MongoDB connected');
}
