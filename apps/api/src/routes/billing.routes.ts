import { Router } from 'express';
import { z } from 'zod';
import { requireCompanyAdmin, resolveTenantFromRequest } from '../auth/auth.js';
import { CompanyInfoModel } from '../models/CompanyInfo.js';
import { InvoiceModel } from '../models/Invoice.js';
import { PlanModel } from '../models/Plan.js';
import { TenantConfigModel } from '../models/TenantConfig.js';
import { getArcaEnvironment, getEffectiveArcaConfig, setArcaEnvironment, authorizeInvoiceMock, authorizeInvoiceWithArca } from '../services/arca.service.js';
import { generateMonthlyInvoices } from '../services/billing.service.js';
import { generateInvoicePDF } from '../services/pdf.service.js';
import {
  generatePrivateKey,
  generateCSR,
  validateCertificate,
  generateP12,
  saveCertificateData,
  loadCertificateData,
  getCertificateFiles,
  deleteCertificateData
} from '../services/certificate.service.js';
import type { ArcaEnvironment } from '../config/env.js';

export const billingRouter = Router();

// ============ PLANES ============

billingRouter.get('/plans', async (_, res) => {
  const plans = await PlanModel.find({}).sort({ monthlyPriceArs: 1 });
  res.json(plans);
});

const updatePlanSchema = z.object({
  name: z.string().min(1),
  monthlyPriceArs: z.number().min(0),
  maxDevices: z.number().min(1),
  features: z.array(z.string()),
  active: z.boolean()
});

billingRouter.put('/plans/:id', requireCompanyAdmin, async (req, res) => {
  const data = updatePlanSchema.parse(req.body);
  const plan = await PlanModel.findByIdAndUpdate(
    req.params.id,
    data,
    { new: true }
  );
  if (!plan) {
    res.status(404).json({ error: 'Plan no encontrado' });
    return;
  }
  res.json(plan);
});

// ============ ENTORNO ARCA ============

billingRouter.get('/arca/environment', requireCompanyAdmin, async (_, res) => {
  res.json({ environment: getArcaEnvironment() });
});

billingRouter.put('/arca/environment', requireCompanyAdmin, async (req, res) => {
  const { environment } = z.object({
    environment: z.enum(['mock', 'homologacion', 'produccion'])
  }).parse(req.body);
  
  setArcaEnvironment(environment as ArcaEnvironment);
  res.json({ environment: getArcaEnvironment() });
});

billingRouter.get('/arca/status', requireCompanyAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantFromRequest(req);
    const config = await getEffectiveArcaConfig(tenantId);
    
    let status = {
      environment: config.environment,
      enabled: config.enabled,
      mock: config.mock,
      hasCredentials: !!(config.token && config.sign),
      hasCertificate: !!(config.certPath && config.certPassword),
      wsfeUrl: config.wsfeUrl,
      wsaaUrl: config.wsaaUrl,
      status: 'unknown' as 'ok' | 'warning' | 'error',
      message: ''
    };
    
    if (config.mock || config.environment === 'mock') {
      status.status = 'ok';
      status.message = 'Modo mock activo - Simulación enabled';
    } else if (!config.token || !config.sign) {
      status.status = 'error';
      status.message = 'Faltan credenciales (TOKEN/SIGN) - Configure en ARCA_TOKEN y ARCA_SIGN';
    } else {
      status.status = 'ok';
      status.message = 'Configuración lista para conectar';
    }
    
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Error al verificar estado', details: String(error) });
  }
});

billingRouter.post('/arca/test', requireCompanyAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantFromRequest(req);
    const config = await getEffectiveArcaConfig(tenantId);
    
    if (config.mock || config.environment === 'mock') {
      const mockResult = authorizeInvoiceMock({ amountArs: 1000, period: '2024-01' });
      res.json({ 
        success: true, 
        environment: 'mock',
        message: 'Mock: CAE simulado generado correctamente',
        cae: mockResult.cae
      });
      return;
    }
    
    if (!config.token || !config.sign) {
      res.status(400).json({ 
        success: false, 
        error: 'Credenciales no configuradas',
        hint: 'Configure ARCA_TOKEN y ARCA_SIGN en variables de entorno'
      });
      return;
    }
    
    res.json({ 
      success: true, 
      environment: config.environment,
      message: 'Credenciales configuradas (verifique en producción)'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ============ CONFIGURACIÓN ARCA ============

billingRouter.get('/arca-config', async (req, res) => {
  const tenantId = resolveTenantFromRequest(req);
  const config = await getEffectiveArcaConfig(tenantId);
  res.json(config);
});

const arcaConfigSchema = z.object({
  enabled: z.boolean(),
  mock: z.boolean(),
  cuit: z.string().min(11).max(11),
  ptoVta: z.string().min(1),
  token: z.string().optional().default(''),
  sign: z.string().optional().default(''),
  certPassword: z.string().optional().default('')
});

billingRouter.put('/arca-config', async (req, res) => {
  const tenantId = resolveTenantFromRequest(req);
  const data = arcaConfigSchema.parse(req.body);

  const config = await TenantConfigModel.findOneAndUpdate(
    { tenantId },
    {
      tenantId,
      'arca.enabled': data.enabled,
      'arca.mock': data.mock,
      'arca.cuit': data.cuit,
      'arca.ptoVta': data.ptoVta,
      'arca.token': data.token || '',
      'arca.sign': data.sign || '',
      'arca.certPassword': data.certPassword || '',
      'arca.environment': getArcaEnvironment() === 'produccion' ? 'prod' : 'homo'
    },
    { upsert: true, new: true }
  );

  res.json(config);
});

// ============ FACTURAS ============

billingRouter.get('/invoices', async (req, res) => {
  const tenantId = resolveTenantFromRequest(req);
  const { status, tipo } = req.query;
  
  const filter: any = { tenantId };
  if (status) filter.estado = status;
  if (tipo) filter.tipo = tipo;
  
  const invoices = await InvoiceModel.find(filter).sort({ createdAt: -1 });
  res.json(invoices);
});

billingRouter.get('/invoices/:id', async (req, res) => {
  const invoice = await InvoiceModel.findById(req.params.id);
  if (!invoice) {
    res.status(404).json({ error: 'Factura no encontrada' });
    return;
  }
  res.json(invoice);
});

const createInvoiceSchema = z.object({
  tipo: z.enum(['A', 'B', 'C', 'M']),
  cliente: z.object({
    tipoDoc: z.number(),
    nroDoc: z.string(),
    nombre: z.string().min(1),
    condicionIva: z.string(),
    direccion: z.string().optional().default('')
  }),
  period: z.string().min(1),
  amountArs: z.number().min(0)
});

billingRouter.post('/invoices', requireCompanyAdmin, async (req, res) => {
  try {
    console.log('[INVOICE] Creating invoice, body:', req.body);
    const tenantId = resolveTenantFromRequest(req);
    console.log('[INVOICE] Tenant ID:', tenantId);
    
    let data;
    try {
      data = createInvoiceSchema.parse(req.body);
      console.log('[INVOICE] Parsed data:', data);
    } catch (parseError) {
      console.error('[INVOICE] Schema parse error:', parseError);
      res.status(400).json({ error: 'Datos inválidos', details: parseError instanceof z.ZodError ? parseError.errors : String(parseError) });
      return;
    }
    
    console.log('[INVOICE] Getting ARCA config...');
    const config = await getEffectiveArcaConfig(tenantId);
    console.log('[INVOICE] ARCA config:', config);
    
    const ptoVta = Number(config.ptoVta) || 1;
    const environment = config.environment || 'mock';
    
    console.log('[INVOICE] Finding last invoice for tenant:', tenantId, 'tipo:', data.tipo, 'ptoVta:', ptoVta);
    const lastInvoice = await InvoiceModel.findOne({ tenantId, tipo: data.tipo, puntoVenta: ptoVta })
      .sort({ numero: -1 });
    const nextNumero = lastInvoice ? lastInvoice.numero + 1 : 1;
    console.log('[INVOICE] Next invoice number:', nextNumero);
    
    console.log('[INVOICE] Creating invoice in database...');
    const invoice = await InvoiceModel.create({
      tenantId,
      userId: req.auth?.sub,
      period: data.period,
      amountArs: data.amountArs,
      tipo: data.tipo,
      puntoVenta: ptoVta,
      numero: nextNumero,
      environment: environment as 'mock' | 'homologacion' | 'produccion',
      cliente: data.cliente,
      estado: 'pendiente'
    });
    console.log('[INVOICE] Invoice created:', invoice._id);
    
    res.status(201).json(invoice);
  } catch (error) {
    console.error('[INVOICE] Error creating invoice:', error);
    res.status(500).json({ error: 'Error al crear factura', details: String(error) });
  }
});

billingRouter.post('/invoices/:id/authorize', requireCompanyAdmin, async (req, res) => {
  try {
    const invoice = await InvoiceModel.findById(req.params.id);
    if (!invoice) {
      res.status(404).json({ error: 'Factura no encontrada' });
      return;
    }
    
    if (invoice.estado !== 'pendiente') {
      res.status(400).json({ error: 'La factura ya fue procesada' });
      return;
    }
    
    const arcaResult = await authorizeInvoiceWithArca(invoice.tenantId, {
      amountArs: invoice.amountArs,
      period: invoice.period,
      tipo: invoice.tipo as 'A' | 'B' | 'C' | 'M'
    });

    invoice.cae = arcaResult.cae;
    invoice.caeDueDate = arcaResult.caeDueDate;
    invoice.cbteNro = arcaResult.cbteNro;
    invoice.cbteTipo = arcaResult.cbteTipo;
    invoice.puntoVenta = Number(arcaResult.ptoVta) || invoice.puntoVenta;
    invoice.numero = arcaResult.cbteNro;
    invoice.arcaResult = arcaResult.result;
    invoice.set('arcaErrors', (arcaResult.errors || []) as any);
    invoice.estado = 'autorizado';
    await invoice.save();

    res.json({ success: true, invoice });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============ EMPRESA ============

billingRouter.get('/provinces', async (req, res) => {
  const provinces = [
    'Buenos Aires',
    'Ciudad Autónoma de Buenos Aires',
    'Catamarca',
    'Chaco',
    'Chubut',
    'Córdoba',
    'Corrientes',
    'Entre Ríos',
    'Formosa',
    'Jujuy',
    'La Pampa',
    'La Rioja',
    'Mendoza',
    'Misiones',
    'Neuquén',
    'Río Negro',
    'Salta',
    'San Juan',
    'San Luis',
    'Santa Cruz',
    'Santa Fe',
    'Santiago del Estero',
    'Tierra del Fuego',
    'Tucumán'
  ];
  res.json(provinces);
});

billingRouter.get('/cities/:province', async (req, res) => {
  const { province } = req.params;
  
  const citiesByProvince: Record<string, string[]> = {
    'Buenos Aires': [
      'La Plata', 'Mar del Plata', 'Bahía Blanca', 'Tandil', 'Vicente López',
      'Avellaneda', 'Lomas de Zamora', 'Lanús', 'General San Martín', 'Quilmes',
      'Berazategui', 'Escobar', 'Ezeiza', 'Florencio Varela', 'General Perón',
      'Hurlingham', 'Ituzaingó', 'José C. Paz', 'Malvinas Argentinas', 'Merlo',
      'Moreno', 'Morón', 'Néstor Kirchner', 'Pilcomayo', 'San Fernando',
      'San Isidro', 'San Miguel', 'Tigre', 'Tres de Febrero', 'Tulúm'
    ],
    'Ciudad Autónoma de Buenos Aires': [
      'Agronomía', 'Almagro', 'Balvanera', 'Barracas', 'Belgrano', 'Boca',
      'Boedo', 'Caballito', 'Chacarita', 'Coghlan', 'Colegiales', 'Constitución',
      'Flores', 'Floresta', 'La Paternal', 'Liniers', 'Mataderos', 'Monte Castro',
      'Montserrat', 'Nueva Pompeya', 'Núñez', 'Palermo', 'Parque Avellaneda',
      'Parque Chacabuco', 'Parque Chas', 'Parque Patricios', 'Puerto Madero',
      'Recoleta', 'Retiro', 'Saavedra', 'San Cristóbal', 'San Nicolás',
      'San Telmo', ' Vélez Sarsfield', 'Versailles', 'Villa Crespo', 'Villa del Parque',
      'Villa Devoto', 'Villa General Mitre', 'Villa Lugano', 'Villa Luro',
      'Villa Real', 'Villa Riachuelo', 'Villa Santa Rita', 'Villa Soldati', 'Villa Urquiza'
    ],
    'Córdoba': [
      'Córdoba Capital', 'Villa María', 'Río Cuarto', 'San Francisco', 'Villa Carlos Paz',
      'Alta Gracia', 'Jesús María', 'Cosquín', 'La Falda', 'Capilla del Monte',
      'Mina Clavero', 'Villa Dolores', 'Santa Rosa de Calamuchita', 'Embalse',
      'La Carlota', 'Bell Ville', 'Villa Nueva', 'Justiniano Posse', 'Marcos Juárez',
      'Leones', 'Los Surgentes', 'Corral de Bustos', 'Cruz del Eje', 'Deán Funes'
    ],
    'Santa Fe': [
      'Rosario', 'Santa Fe Capital', 'Venado Tuerto', 'Rafaela', 'Santo Tomé',
      'Villa Constitución', 'Casilda', 'San Lorenzo', 'Granadero Baigorria', 'Funes',
      'Roldán', 'Pérez', 'Arroyo Seco', 'Cañada de Gómez', 'Carcarañá',
      'Gálvez', 'Coronda', 'Santo Domingo', 'San Javier', 'Reconquista',
      'Avellaneda', 'Esperanza', 'Sunchales', 'Tostado', 'Ceres'
    ],
    'Mendoza': [
      'Mendoza Capital', 'Godoy Cruz', 'Las Heras', 'Guaymallén', 'Maipú',
      'Luján de Cuyo', 'San Rafael', 'General Alvear', 'Tunuyán', 'Tupungato',
      'San Martín', 'Rivadavia', 'Junín', 'Santa Rosa', 'La Paz',
      'Malargüe', 'San Carlos', 'Lavalle', 'Palmira', 'Eugenio Bustos'
    ],
    'Tucumán': [
      'San Miguel de Tucumán', 'Yerba Buena', 'Tafí Viejo', 'Banda del Río Salí',
      'Alderetes', 'Concepción', 'Monteros', 'Aguilares', 'Famaillá',
      'Lules', 'La Cocha', 'Graneros', 'Simoca', 'Burruyacú', 'Trancas'
    ],
    'Entre Ríos': [
      'Paraná', 'Concordia', 'Gualeguaychú', 'Concepción del Uruguay', 'La Paz',
      'Villaguay', 'Federación', 'Federal', 'San Salvador', 'Diamante',
      'La Paz', 'Nogoyá', 'Victoria', 'Rosario del Tala', 'Villaguay'
    ],
    'Salta': [
      'Salta Capital', 'San Ramón de la Nueva Orán', 'Aguaray', 'Cachi',
      'Cafayate', 'Campo Quijano', 'El Carril', 'El Quevar', 'Guachipas',
      'Iruya', 'La Poma', 'Los Toldos', 'Molinos', 'Payogastilla',
      'Rivadavia', 'Rosario de la Frontera', 'Rosario de Lerma', 'San Antonio de los Cobres',
      'Santa Victoria', 'Tartagal', 'Tilcara', 'Yacuiba'
    ],
    'Chaco': [
      'Resistencia', 'Presidencia Roque Sáenz Peña', 'Villa Ángela', 'San Bernardo',
      'Juan José Castelli', 'Villa Río Bermejito', 'General José de San Martín',
      'Charata', 'Las Breñas', 'Coronel Du Graty', 'Hermoso Campo', 'Itín',
      'La Clotilde', 'La Tigra', 'Machagai', 'Makallé', 'Misión Nueva Pompeya',
      'Pampa del Indio', 'Pampa del Zorro', 'Puerto Eva Perón', 'Puerto Tirol',
      'Quitilipi', 'Samuhú', 'Taco Pozo', 'Villa Berthet'
    ],
    'Corrientes': [
      'Corrientes Capital', 'Goya', 'Bella Vista', 'Santo Tomé', 'Paso de los Libres',
      'Curuzú Cuatiá', 'Mercedes', 'Monte Caseros', 'Yatay', 'Ituzaingó',
      'Esquina', 'Santo Domingo', 'San Lorenzo', 'San Miguel', 'San Roque',
      'Itatí', 'Santa Ana', 'Concepción', 'Mburucuyá', 'Saladas'
    ],
    'Misiones': [
      'Posadas', 'Oberá', 'Eldorado', 'Puerto Iguazú', 'Leandro N. Alem',
      'Apóstoles', 'San Vicente', 'Jardín América', 'El Soberbio', 'Bernardo de Irigoyen',
      'Puerto Rico', 'Aristóbulo del Valle', 'San Antonio', 'Villa La Angostura',
      'San Javier', 'San Pedro', 'Dos de Mayo', 'Campo Grande', 'Mojón Grande'
    ],
    'Santiago del Estero': [
      'Santiago del Estero Capital', 'La Banda', 'Termas de Río Hondo', 'Añatuya',
      'Frías', 'La Paz', 'Lozano', 'Pampa de los Guanacos', 'Quimilí', 'San Pablo',
      'Santiago del Estero', 'Tintina', 'Villa Ojo de Agua', 'Los Telares', 'Selva'
    ],
    'San Juan': [
      'San Juan Capital', 'Rawson', 'Chimbas', 'Santa Lucía', 'Pocito',
      'Caucete', 'San Martín', 'Albardón', 'Rivadavia', '25 de Mayo',
      'Jáchal', 'Iglesia', 'Calingasta', 'Ullum', 'Zonda', 'Sarmiento',
      'Angaco', 'Valle Fértil', '9 de Julio', '20 de Junio'
    ],
    'Río Negro': [
      'Viedma', 'Bariloche', 'General Roca', 'Cipolletti', 'Neuquén',
      'Río Colorado', 'Villa Regina', 'San Carlos de Bariloche', 'El Bolsón', 'Sierra Grande',
      'Ingeniero Jacobacci', 'Los Menucos', 'Maquinchao', 'Valcheta', 'Chimpay',
      'Choele Choel', 'Luis Belderrain', 'Darwin', 'Fortaleza', 'Lamarque'
    ],
    'Neuquén': [
      'Neuquén Capital', 'Plottier', 'Centenario', 'Cutral Có', 'Zapala',
      'San Martín de los Andes', 'Junín de los Andes', 'Chos Malal', 'Loncopué',
      'Las Lajas', 'Añelo', 'Huinganco', 'Los Miches', 'Mariano Moreno',
      'Paso Aguerre', 'Pichi Mahuida', 'Picún Leufú', 'Río Colorado', 'Vista Alegre'
    ],
    'Catamarca': [
      'San Fernando del Valle de Catamarca', 'Ambato', 'Antofagasta de la Sierra',
      'Belén', 'La Paz', 'Santa María', 'Santa Rosa', 'Tinogasta',
      'Andalgalá', 'Fiambalá', 'Los Altos', 'Puerta de San José', 'Recreo',
      'San Antonio', 'Saujil', 'Tuíz', 'Valle Viejo'
    ],
    'Chubut': [
      'Rawson', 'Trelew', 'Puerto Madryn', 'Comodoro Rivadavia', 'Esquel',
      'Gobernación', 'Gaiman', 'Dolavon', 'Río Mayo', 'Sarmiento',
      'Puerto Pirámide', 'Laguna Grande', 'El Maitén', 'Lago Puelo', 'Epuyén',
      'Corcovado', 'Gastre', 'Languiñeo', 'Paso de los Indios', 'Tehuelches'
    ],
    'Formosa': [
      'Formosa Capital', 'Clorinda', 'Las Lomitas', 'Ingeniero Juarez', 'El Colorado',
      'Pirané', 'Fontana', 'Villafañe', 'Ingeniero Guillermo N. Juárez', 'Misión San Martín',
      'Estanislao del Campo', 'Laguna Yema', 'Pozo del Tigre', 'San Martín II', 'Subteniente Perín',
      'Bartolomé de las Casas', 'Buena Vista', 'Colonia Pastoril', 'Gran Guardia', 'La Primavera'
    ],
    'Jujuy': [
      'San Salvador de Jujuy', 'Palpalá', 'San Pedro de Jujuy', 'La Quiaca', 'Humahuaca',
      'Tilcara', 'Perico', 'El Carmen', 'Palma Sola', 'Mina Pirita',
      'Abreo', 'Arrayanal', 'Bermejillo', 'Caimancito', 'Calilegua',
      'Cangrejillos', 'Cápac Pukú', 'Casira', 'Catua', 'Cieneguilla'
    ],
    'La Pampa': [
      'Santa Rosa', 'General Pico', 'Toay', '25 de Mayo', 'Victorica',
      'Eduardo Castex', 'General Acha', 'Realicó', 'Carlos Pellegrini', 'Parera',
      'Alta Italia', 'Anguil', 'Arata', 'Bernardo Larroude', 'Ceballos',
      'Chacharramendi', 'Colonia Baron', 'Conhello', 'Dorila', 'Embajador Martini'
    ],
    'La Rioja': [
      'La Rioja Capital', 'Chilecito', 'Aimogasta', 'Tamcales', 'Villa Bustos',
      'Villa Sanagasta', 'Famatina', 'Chamical', 'Chepes', 'Villa Unión',
      'Villa Mazán', 'Anillaco', 'San Juan de la Punta', 'Olta', 'Malanzán',
      'Milagro', 'Náquera', 'Nonogasta', 'Patquía', 'Punta de los Llanos'
    ],
    'San Luis': [
      'San Luis Capital', 'Villa Mercedes', 'Merlo', 'La Punta', 'Juana Koslay',
      'Potrero de los Funes', 'El Trapiche', 'El Volcán', 'Salto de la Querencia',
      'Los Cerrillos', 'Balde', 'Bagual', 'Cañada de los Ranchos', 'Cerro de la Cruz',
      'Desaguadero', 'El Durazno', 'El Totoral', 'Juan J. Paso', 'La Calera'
    ],
    'Santa Cruz': [
      'Río Gallegos', 'Caleta Olivia', 'Puerto San Julián', 'Puerto Santa Cruz', 'Las Heras',
      'Gobernación', 'Los Antiguos', 'Perito Moreno', '28 de Noviembre', 'Puerto Deseado',
      'Puerto Madryn', 'Río Turbio', 'Veintiocho de Mayo', 'Comandante Luis Piedra Buena',
      'El Calafate', 'El Chaltén', 'Gobernador Gregores', 'Lago Posadas', 'Lago Buenos Aires'
    ],
    'Tierra del Fuego': [
      'Ushuaia', 'Río Grande', 'Tolhuin', 'Puerto Almanza', 'Lago Fagnano',
      'Cerro Castor', 'Estancia Las Hijas', 'Puerto Harberton', 'San Sebastián', 'Valles'
    ]
  };
  
  const cities = citiesByProvince[province] || [];
  res.json(cities);
});

billingRouter.get('/company-info', requireCompanyAdmin, async (_, res) => {
  let info = await CompanyInfoModel.findOne();
  if (!info) {
    info = await CompanyInfoModel.create({});
  }
  res.json(info);
});

const companyInfoSchema = z.object({
  companyName: z.string(),
  contactName: z.string(),
  email: z.string().email(),
  phone: z.string(),
  address: z.string(),
  taxId: z.string(),
  ivaCondition: z.string(),
  province: z.string(),
  city: z.string()
});

billingRouter.put('/company-info', requireCompanyAdmin, async (req, res) => {
  const data = companyInfoSchema.parse(req.body);
  const info = await CompanyInfoModel.findOneAndUpdate(
    {},
    data,
    { upsert: true, new: true }
  );
  res.json(info);
});

// ============ GENERACIÓN MENSUAL ============

billingRouter.post('/run-monthly', requireCompanyAdmin, async (_, res) => {
  await generateMonthlyInvoices();
  res.json({ status: 'ok' });
});

// ============ PDF ============

billingRouter.get('/invoices/:id/pdf', async (req, res) => {
  try {
    const invoice = await InvoiceModel.findById(req.params.id);
    if (!invoice) {
      res.status(404).json({ error: 'Factura no encontrada' });
      return;
    }

    const companyInfo = await CompanyInfoModel.findOne();
    const sellerInfo = companyInfo ? {
      companyName: companyInfo.companyName || 'AgroSentinel',
      taxId: companyInfo.taxId || '',
      address: companyInfo.address || '',
      ivaCondition: companyInfo.ivaCondition || '',
      phone: companyInfo.phone
    } : {
      companyName: 'AgroSentinel',
      taxId: '',
      address: '',
      ivaCondition: ''
    };

    const invoiceData = {
      ...invoice.toObject(),
      _id: invoice._id.toString(),
      fechaEmision: invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString('es-AR') : new Date().toLocaleDateString('es-AR'),
      fechaVencimiento: invoice.caeDueDate || '-',
      moneda: 'PES',
      condicionPago: 'CONTADO'
    };

    const doc = await generateInvoicePDF(invoiceData, sellerInfo);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="factura-${invoice.tipo}-${invoice.numero?.toString().padStart(8, '0') || '00000000'}.pdf"`);

    doc.pipe(res);
    doc.end();
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ error: 'Error al generar PDF' });
  }
});

// ============ CERTIFICADO ARCA ============

import multer from 'multer';
import path from 'path';
import fs from 'fs';

const certStorageDir = process.env.CERT_STORAGE_DIR || path.join(process.cwd(), 'certs');
if (!fs.existsSync(certStorageDir)) {
  fs.mkdirSync(certStorageDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, certStorageDir);
  },
  filename: (req, file, cb) => {
    const tenantId = resolveTenantFromRequest(req);
    const ext = path.extname(file.originalname);
    cb(null, `cert-${tenantId}${ext}`);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.p12', '.pfx'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos .p12 o .pfx'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

billingRouter.post('/arca/upload-cert', requireCompanyAdmin, upload.single('certificate'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No se recibió ningún archivo' });
      return;
    }

    const tenantId = resolveTenantFromRequest(req);
    const certPath = req.file.path;

    await TenantConfigModel.findOneAndUpdate(
      { tenantId },
      { 'arca.certPath': certPath }
    );

    res.json({ success: true, message: 'Certificado subido correctamente', certPath });
  } catch (error) {
    console.error('Error uploading certificate:', error);
    res.status(500).json({ error: 'Error al subir el certificado' });
  }
});

billingRouter.get('/arca/cert-status', requireCompanyAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantFromRequest(req);
    const config = await TenantConfigModel.findOne({ tenantId });

    const certPath = config?.arca?.certPath;
    const hasCert = certPath && fs.existsSync(certPath);
    const certFileName = certPath ? path.basename(certPath) : null;

    res.json({
      hasCertificate: hasCert,
      certFileName,
      certPath: hasCert ? certFileName : null,
      hasPassword: !!(config?.arca?.certPassword),
      message: hasCert ? 'Certificado cargado' : 'Sin certificado'
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al verificar certificado' });
  }
});

billingRouter.delete('/arca/cert', requireCompanyAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantFromRequest(req);
    const config = await TenantConfigModel.findOne({ tenantId });

    if (config?.arca?.certPath && fs.existsSync(config.arca.certPath)) {
      fs.unlinkSync(config.arca.certPath);
    }

    await TenantConfigModel.findOneAndUpdate(
      { tenantId },
      { 'arca.certPath': '', 'arca.certPassword': '' }
    );

    res.json({ success: true, message: 'Certificado eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar certificado' });
  }
});

// ============ GENERADOR DE CERTIFICADOS ARCA ============

const csrDataSchema = z.object({
  companyName: z.string().trim().min(1),
  taxId: z.preprocess(
    value => typeof value === 'string' ? value.replace(/\D/g, '') : value,
    z.string().length(11, 'El CUIT debe tener 11 digitos')
  ),
  province: z.string().trim().min(1),
  city: z.string().trim().min(1),
  environment: z.enum(['homologacion', 'produccion'])
});

billingRouter.post('/certificate/generate', requireCompanyAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantFromRequest(req);
    const data = csrDataSchema.parse(req.body);

    const privateKey = generatePrivateKey();
    const csr = generateCSR(privateKey, data);

    const certData = {
      tenantId,
      privateKey,
      csr,
      environment: data.environment as 'homologacion' | 'produccion',
      createdAt: new Date().toISOString(),
      companyName: data.companyName,
      taxId: data.taxId
    };

    saveCertificateData(tenantId, certData);

    res.json({
      success: true,
      message: 'Clave privada y CSR generados correctamente',
      csrPreview: csr.substring(0, 100) + '...'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues[0]?.message || 'Datos invalidos para generar el CSR' });
      return;
    }
    console.error('Error generating certificate:', error);
    res.status(500).json({ error: 'Error al generar certificado' });
  }
});

billingRouter.get('/certificate/status', requireCompanyAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantFromRequest(req);
    const certData = loadCertificateData(tenantId);

    if (!certData) {
      res.json({
        hasPrivateKey: false,
        hasCsr: false,
        hasCertificate: false,
        environment: null,
        createdAt: null
      });
      return;
    }

    res.json({
      hasPrivateKey: !!certData.privateKey,
      hasCsr: !!certData.csr,
      hasCertificate: !!certData.certificate,
      environment: certData.environment,
      createdAt: certData.createdAt,
      companyName: certData.companyName,
      taxId: certData.taxId
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener estado del certificado' });
  }
});

billingRouter.get('/certificate/download/:type', requireCompanyAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantFromRequest(req);
    const { type } = req.params;

    if (!['key', 'csr'].includes(type)) {
      res.status(400).json({ error: 'Tipo de archivo inválido' });
      return;
    }

    const files = getCertificateFiles(tenantId);

    if (type === 'key' && files.privateKey) {
      res.setHeader('Content-Type', 'application/x-pem-file');
      res.setHeader('Content-Disposition', `attachment; filename="private.key"`);
      res.send(files.privateKey);
      return;
    }

    if (type === 'csr' && files.csr) {
      res.setHeader('Content-Type', 'application/x-pem-file');
      res.setHeader('Content-Disposition', `attachment; filename="request.csr"`);
      res.send(files.csr);
      return;
    }

    res.status(404).json({ error: 'Archivo no encontrado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al descargar archivo' });
  }
});

billingRouter.post('/certificate/upload-crt', requireCompanyAdmin, upload.single('certificate'), async (req, res) => {
  try {
    const tenantId = resolveTenantFromRequest(req);
    const certData = loadCertificateData(tenantId);

    if (!certData || !certData.privateKey || !certData.csr) {
      res.status(400).json({ error: 'Primero debe generar la clave privada y el CSR' });
      return;
    }

    const certificatePem = req.file
      ? req.file.buffer.toString('utf8')
      : typeof req.body?.certificatePem === 'string'
        ? req.body.certificatePem.trim()
        : '';

    if (!certificatePem) {
      res.status(400).json({ error: 'Debe subir un archivo CRT o pegar el contenido PEM del certificado' });
      return;
    }

    const isValid = validateCertificate(certificatePem, certData.privateKey, certData.csr);

    if (!isValid) {
      res.status(400).json({ 
        error: 'El certificado no corresponde al CSR generado',
        hint: 'Asegurese de subir el certificado correcto generado por ARCA para este CSR'
      });
      return;
    }

    certData.certificate = certificatePem;
    saveCertificateData(tenantId, certData);

    res.json({ success: true, message: 'Certificado cargado y validado correctamente' });
  } catch (error) {
    console.error('Error uploading certificate:', error);
    res.status(500).json({ error: 'Error al procesar el certificado' });
  }
});

billingRouter.post('/certificate/generate-p12', requireCompanyAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantFromRequest(req);
    const { password } = req.body;

    if (!password || password.length < 6) {
      res.status(400).json({ error: 'La contrasena debe tener al menos 6 caracteres' });
      return;
    }

    const certData = loadCertificateData(tenantId);

    if (!certData || !certData.privateKey || !certData.certificate) {
      res.status(400).json({ error: 'Debe generar el certificado y cargar el CRT de ARCA primero' });
      return;
    }

    const p12Buffer = generateP12(certData.privateKey, certData.certificate, password);

    res.setHeader('Content-Type', 'application/x-pkcs12');
    res.setHeader('Content-Disposition', `attachment; filename="certificate.p12"`);
    res.send(p12Buffer);
  } catch (error) {
    console.error('Error generating P12:', error);
    res.status(500).json({ error: 'Error al generar archivo P12' });
  }
});

billingRouter.delete('/certificate', requireCompanyAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantFromRequest(req);
    deleteCertificateData(tenantId);
    res.json({ success: true, message: 'Certificados eliminados correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar certificados' });
  }
});

billingRouter.get('/certificate/csr', requireCompanyAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantFromRequest(req);
    const certData = loadCertificateData(tenantId);

    if (!certData || !certData.csr) {
      res.status(404).json({ error: 'CSR no encontrado. Genere primero la clave privada y CSR.' });
      return;
    }

    res.json({ csr: certData.csr });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener CSR' });
  }
});
