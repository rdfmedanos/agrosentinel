import { Router } from 'express';
import { resolveTenantFromRequest, requireAuth, requireCompanyAdmin } from '../auth/auth.js';
import { AlertModel } from '../models/Alert.js';
import { sendTelegramMessage } from '../services/telegram.service.js';

export const alertsRouter = Router();

alertsRouter.get('/', async (req, res) => {
  const tenantId = resolveTenantFromRequest(req);
  const alerts = await AlertModel.find({ tenantId }).sort({ createdAt: -1 }).limit(200);
  res.json(alerts);
});

alertsRouter.delete('/:id', requireAuth, requireCompanyAdmin, async (req, res) => {
  const alert = await AlertModel.findByIdAndDelete(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alerta no encontrada' });
  res.json({ success: true });
});

alertsRouter.post('/test-telegram', requireAuth, requireCompanyAdmin, async (req, res) => {
  const { message } = req.body;
  try {
    const sent = await sendTelegramMessage(message || '🧪 Prueba de AgroSentinel');
    if (sent) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'No se pudo enviar el mensaje. Revisa los logs del servidor.' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error al enviar mensaje de prueba' });
  }
});
