import { Router } from 'express';
import { requireAuth, requireCompanyAdmin } from '../auth/auth.js';
import { SystemConfigModel } from '../models/SystemConfig.js';
import { loadConfig } from '../services/alert.service.js';

export const configRouter = Router();

const DEFAULT_CONFIG = [
  { key: 'DEVICE_OFFLINE_SECONDS', value: '30', description: 'Segundos sin heartbeat para marcar dispositivo como offline' },
  { key: 'CRITICAL_LEVEL_PCT', value: '20', description: 'Porcentaje minimo de nivel para alerta critica' },
  { key: 'AUTH_JWT_EXPIRES', value: '12h', description: 'Tiempo de expiracion del token JWT' },
  { key: 'TELEGRAM_ENABLED', value: 'false', description: 'Habilitar notificaciones por Telegram' },
  { key: 'TELEGRAM_BOT_TOKEN', value: '', description: 'Token del bot de Telegram' },
  { key: 'TELEGRAM_CHAT_ID', value: '', description: 'Chat ID de Telegram para recibir alertas' }
];

configRouter.get('/', requireAuth, requireCompanyAdmin, async (req, res) => {
  try {
    console.log('Loading system config...');
    
    const configs = await SystemConfigModel.find().lean();
    
    const result = DEFAULT_CONFIG.map(defaultCfg => {
      const existing = configs.find(c => c.key === defaultCfg.key);
      if (existing && existing.value) {
        return { key: existing.key, value: existing.value, description: existing.description };
      }
      return defaultCfg;
    });
    
    console.log('Returning configs:', result);
    res.json(result);
  } catch (error: any) {
    console.error('Error loading config:', error.message, error.stack);
    res.json(DEFAULT_CONFIG);
  }
});

configRouter.put('/:key', requireAuth, requireCompanyAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    
    const config = await SystemConfigModel.findOneAndUpdate(
      { key },
      { value, updatedAt: new Date() },
      { new: true, upsert: true }
    );
    
    await loadConfig();
    
    res.json(config);
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ error: 'Error al actualizar configuración' });
  }
});
