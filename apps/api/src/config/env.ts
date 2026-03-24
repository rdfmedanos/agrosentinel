import dotenv from 'dotenv';

dotenv.config();

export const env = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/agrosentinel',
  mqttUrl: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
  mqttUsername: process.env.MQTT_USERNAME,
  mqttPassword: process.env.MQTT_PASSWORD,
  deviceOfflineSeconds: Number(process.env.DEVICE_OFFLINE_SECONDS ?? 5),
  criticalLevelPct: Number(process.env.CRITICAL_LEVEL_PCT ?? 20),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  arcaCuit: process.env.ARCA_CUIT ?? '30712345678',
  arcaPtoVta: process.env.ARCA_PTO_VTA ?? '1',
  arcaEnabled: process.env.ARCA_ENABLED === 'true',
  arcaMock: process.env.ARCA_MOCK !== 'false',
  arcaWsfeUrl: process.env.ARCA_WSFE_URL ?? 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  arcaToken: process.env.ARCA_TOKEN,
  arcaSign: process.env.ARCA_SIGN,
  authJwtSecret: process.env.AUTH_JWT_SECRET ?? 'change_this_secret',
  authJwtExpires: process.env.AUTH_JWT_EXPIRES ?? '12h'
};
