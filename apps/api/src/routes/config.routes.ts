import { Router } from 'express';
import { requireAuth, requireCompanyAdmin } from '../auth/auth.js';
import { SystemConfigModel } from '../models/SystemConfig.js';
import { loadConfig } from '../services/alert.service.js';

export const configRouter = Router();

const DEFAULT_CONFIG = [
  { key: 'DEVICE_OFFLINE_SECONDS', value: '5', description: 'Segundos sin heartbeat para marcar dispositivo como offline' },
  { key: 'CRITICAL_LEVEL_PCT', value: '20', description: 'Porcentaje minimo de nivel para alerta critica' },
  { key: 'AUTH_JWT_EXPIRES', value: '12h', description: 'Tiempo de expiracion del token JWT' },
  { key: 'TELEGRAM_ENABLED', value: 'false', description: 'Habilitar notificaciones por Telegram' },
  { key: 'TELEGRAM_BOT_TOKEN', value: '', description: 'Token del bot de Telegram' },
  { key: 'TELEGRAM_CHAT_ID', value: '', description: 'Chat ID de Telegram para recibir alertas' }
];

configRouter.get('/', requireAuth, requireCompanyAdmin, async (req, res) => {
  try {
    console.log('Loading system config...');
    console.log('SystemConfigModel:', SystemConfigModel?.collection?.name);
    let configs = await SystemConfigModel.find().lean();
    console.log('Found configs:', configs.length);
    
    for (const defaultCfg of DEFAULT_CONFIG) {
      if (!configs.find(c => c.key === defaultCfg.key)) {
        await SystemConfigModel.create(defaultCfg);
      }
    }
    
    configs = await SystemConfigModel.find().lean();
    console.log('Returning configs:', configs);
    res.json(configs);
  } catch (error: any) {
    console.error('Error loading config:', error.message, error.stack);
    res.status(500).json({ error: 'Error al cargar configuración: ' + error.message });
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
