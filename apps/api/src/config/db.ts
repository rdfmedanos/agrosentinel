import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

export async function connectDb() {
  await mongoose.connect(env.mongoUri);
  logger.info('MongoDB connected');
}
