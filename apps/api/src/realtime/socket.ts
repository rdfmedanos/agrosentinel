import { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env.js';

let io: Server;

export function initSocket(server: HttpServer) {
  io = new Server(server, {
    cors: {
      origin: env.corsOrigin,
      credentials: true
    }
  });

  io.on('connection', socket => {
    socket.on('tenant:join', (tenantId: string) => socket.join(`tenant:${tenantId}`));
  });

  return io;
}

export function emitTenant(tenantId: string, event: string, payload: unknown) {
  if (!io) return;
  io.to(`tenant:${tenantId}`).emit(event, payload);
}
