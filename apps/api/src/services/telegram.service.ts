import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getConfig } from './alert.service.js';

export async function sendTelegramMessage(message: string): Promise<boolean> {
  const enabled = process.env.TELEGRAM_ENABLED === 'true' || getConfig('TELEGRAM_ENABLED', 'false') === 'true';
  const botToken = process.env.TELEGRAM_BOT_TOKEN || getConfig('TELEGRAM_BOT_TOKEN', '');
  const chatId = process.env.TELEGRAM_CHAT_ID || getConfig('TELEGRAM_CHAT_ID', '');
  
  logger.info(`Telegram config check - enabled: ${enabled}, hasToken: ${!!botToken}, hasChatId: ${!!chatId}`);
  
  if (!enabled) {
    logger.warn('Telegram notifications are disabled (TELEGRAM_ENABLED != true)');
    return false;
  }
  
  if (!botToken || !chatId) {
    logger.warn(`Telegram not configured - token: ${!!botToken}, chatId: ${!!chatId}`);
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    logger.info(`Sending Telegram message to chat ${chatId}`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      })
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error({ error, status: response.status }, 'Telegram API error');
      return false;
    }

    const result = await response.json();
    logger.info({ result }, 'Telegram notification sent successfully');
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to send Telegram notification');
    return false;
  }
}

export function formatAlertMessage(type: string, deviceName: string, details?: string): string {
  const emoji = getAlertEmoji(type);
  const title = getAlertTitle(type);
  
  let message = `<b>${emoji} ${title}</b>\n`;
  message += `📱 Dispositivo: <b>${deviceName}</b>\n`;
  
  if (details) {
    message += `📋 Detalle: ${details}\n`;
  }
  
  message += `⏰ ${new Date().toLocaleString('es-AR')}`;
  
  return message;
}

function getAlertEmoji(type: string): string {
  switch (type) {
    case 'offline': return '🔴';
    case 'online': return '🟢';
    case 'critical_level': return '⚠️';
    case 'warning': return '🟡';
    default: return 'ℹ️';
  }
}

function getAlertTitle(type: string): string {
  switch (type) {
    case 'offline': return 'DISPOSITIVO OFFLINE';
    case 'online': return 'DISPOSITIVO ONLINE';
    case 'critical_level': return 'NIVEL CRÍTICO';
    case 'warning': return 'ADVERTENCIA';
    default: return 'NOTIFICACIÓN';
  }
}
