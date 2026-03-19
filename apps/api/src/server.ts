import { createServer } from 'node:http';
import { app } from './app.js';
import { connectDb } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { startSchedulers } from './jobs/scheduler.js';
import { initSocket } from './realtime/socket.js';
import { initMqtt } from './services/mqtt.service.js';
import { seedInitialData } from './services/seed.service.js';

async function start() {
  await connectDb();
  await seedInitialData();

  const server = createServer(app);
  initSocket(server);
  initMqtt();
  startSchedulers();

  server.listen(env.port, () => {
    logger.info(`AgroSentinel API listening on ${env.port}`);
  });
}

start().catch(error => {
  logger.error({ error }, 'Failed to start API');
  process.exit(1);
});
