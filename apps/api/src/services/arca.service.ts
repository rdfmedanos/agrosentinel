import { randomInt } from 'node:crypto';
import { env, type ArcaEnvironment } from '../config/env.js';
import { TenantConfigModel } from '../models/TenantConfig.js';

function getCurrentArcaEnvironment(): ArcaEnvironment {
  const runtime = process.env.ARCA_ENVIRONMENT as ArcaEnvironment | undefined;
  return runtime || env.arcaEnvironment;
}

export type ArcaAuth = {
  token: string;
  sign: string;
  cuit: number;
};

export type EffectiveArcaConfig = {
  environment: ArcaEnvironment;
  enabled: boolean;
  mock: boolean;
  cuit: string;
  ptoVta: string;
  wsfeUrl: string;
  wsaaUrl: string;
  token?: string;
  sign?: string;
  certPath?: string;
  certPassword?: string;
};

export type ArcaInvoiceRequest = {
  amountArs: number;
  period: string;
  tipo?: 'A' | 'B' | 'C' | 'M';
};

export type ArcaInvoiceResult = {
  cae: string;
  caeDueDate: string;
  cbteNro: number;
  cbteTipo: number;
  ptoVta: string;
  result: string;
  errors?: { code: string; msg: string }[];
};

function toYyyymmdd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}>([^<]+)</${tag}>`);
  const match = xml.match(regex);
  return match?.[1] ?? null;
}

function extractErrors(xml: string): { code: string; msg: string }[] {
  const errors: { code: string; msg: string }[] = [];
  const codeMatch = xml.match(/<Code>(\d+)<\/Code>/g);
  const msgMatch = xml.match(/<Msg>([^<]+)<\/Msg>/g);
  
  if (codeMatch && msgMatch) {
    for (let i = 0; i < codeMatch.length; i++) {
      const code = codeMatch[i].replace(/<\/?Code>/g, '');
      const msg = msgMatch[i] ? msgMatch[i].replace(/<\/?Msg>/g, '') : '';
      errors.push({ code, msg });
    }
  }
  
  return errors;
}

function mapTipoToCbteTipo(tipo: ArcaInvoiceRequest['tipo']): number {
  switch (tipo) {
    case 'A':
      return 1;
    case 'B':
      return 6;
    case 'C':
      return 11;
    case 'M':
      return 51;
    default:
      return 6;
  }
}

function getAuth(config: EffectiveArcaConfig): ArcaAuth {
  const token = config.token?.trim();
  const sign = config.sign?.trim();
  if (!token || !sign) {
    throw new Error('ARCA_TOKEN y ARCA_SIGN son obligatorios cuando el entorno no es mock');
  }
  return {
    token,
    sign,
    cuit: Number(config.cuit)
  };
}

function getUrls(env: ArcaEnvironment) {
  if (env === 'produccion') {
    return { wsaaUrl: 'https://wsaa.afip.gov.ar/ws/services/LoginCms', wsfeUrl: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx' };
  }
  return { wsaaUrl: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms', wsfeUrl: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx' };
}

async function soapCall(config: EffectiveArcaConfig, action: string, body: string): Promise<string> {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    ${body}
  </soap:Body>
</soap:Envelope>`;

  const response = await fetch(config.wsfeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `"http://ar.gov.afip.dif.FEV1/${action}"`
    },
    body: envelope
  });

  const xml = await response.text();
  if (!response.ok) {
    throw new Error(`ARCA HTTP ${response.status}: ${xml.slice(0, 500)}`);
  }
  return xml;
}

async function getLastVoucherNumber(config: EffectiveArcaConfig, auth: ArcaAuth, ptoVta: number, cbteTipo: number): Promise<number> {
  const urls = getUrls(config.environment);
  const xml = await soapCall(
    { ...config, wsfeUrl: urls.wsfeUrl },
    'FECompUltimoAutorizado',
    `<FECompUltimoAutorizado xmlns="http://ar.gov.afip.dif.FEV1/">
      <Auth>
        <Token>${auth.token}</Token>
        <Sign>${auth.sign}</Sign>
        <Cuit>${auth.cuit}</Cuit>
      </Auth>
      <PtoVta>${ptoVta}</PtoVta>
      <CbteTipo>${cbteTipo}</CbteTipo>
    </FECompUltimoAutorizado>`
  );

  const cbteNro = extractTag(xml, 'CbteNro');
  return cbteNro ? Number(cbteNro) : 0;
}

export async function authorizeInvoiceReal(config: EffectiveArcaConfig, req: ArcaInvoiceRequest): Promise<ArcaInvoiceResult> {
  const auth = getAuth(config);
  const ptoVta = Number(config.ptoVta);
  const cbteTipo = mapTipoToCbteTipo(req.tipo);
  const today = toYyyymmdd(new Date());
  const urls = getUrls(config.environment);
  
  const last = await getLastVoucherNumber(config, auth, ptoVta, cbteTipo);
  const nextNro = last + 1;

  const xmlRequest = `<FECAESolicitar xmlns="http://ar.gov.afip.dif.FEV1/">
    <Auth>
      <Token>${auth.token}</Token>
      <Sign>${auth.sign}</Sign>
      <Cuit>${auth.cuit}</Cuit>
    </Auth>
    <FeCAEReq>
      <FeCabReq>
        <CantReg>1</CantReg>
        <PtoVta>${ptoVta}</PtoVta>
        <CbteTipo>${cbteTipo}</CbteTipo>
      </FeCabReq>
      <FeDetReq>
        <FECAEDetRequest>
          <Concepto>2</Concepto>
          <DocTipo>99</DocTipo>
          <DocNro>0</DocNro>
          <CbteDesde>${nextNro}</CbteDesde>
          <CbteHasta>${nextNro}</CbteHasta>
          <CbteFch>${today}</CbteFch>
          <ImpTotal>${req.amountArs.toFixed(2)}</ImpTotal>
          <ImpTotConc>0.00</ImpTotConc>
          <ImpNeto>${req.amountArs.toFixed(2)}</ImpNeto>
          <ImpOpEx>0.00</ImpOpEx>
          <ImpIVA>0.00</ImpIVA>
          <ImpTrib>0.00</ImpTrib>
          <MonId>PES</MonId>
          <MonCotiz>1</MonCotiz>
          <FchServDesde>${today}</FchServDesde>
          <FchServHasta>${today}</FchServHasta>
          <FchVtoPago>${today}</FchVtoPago>
        </FECAEDetRequest>
      </FeDetReq>
    </FeCAEReq>
  </FECAESolicitar>`;

  const xmlResponse = await soapCall({ ...config, wsfeUrl: urls.wsfeUrl }, 'FECAESolicitar', xmlRequest);

  const result = extractTag(xmlResponse, 'Resultado') ?? 'R';
  const cae = extractTag(xmlResponse, 'CAE');
  const caeDueDate = extractTag(xmlResponse, 'CAEFchVto');
  const errors = extractErrors(xmlResponse);
  
  if (result !== 'A' || !cae || !caeDueDate) {
    throw new Error(`ARCA rechazo comprobante: ${errors.map(e => `${e.code}: ${e.msg}`).join(', ') || 'Sin detalle'}`);
  }

  return {
    cae,
    caeDueDate,
    cbteNro: nextNro,
    cbteTipo,
    ptoVta: config.ptoVta,
    result,
    errors
  };
}

export function authorizeInvoiceMock(req: ArcaInvoiceRequest): ArcaInvoiceResult {
  const now = Date.now().toString();
  const cae = now.slice(-8) + String(randomInt(100000, 999999));
  const due = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');
  return {
    cae,
    caeDueDate: due,
    cbteNro: randomInt(1000, 99999),
    cbteTipo: mapTipoToCbteTipo(req.tipo),
    ptoVta: '1',
    result: 'A'
  };
}

export async function getEffectiveArcaConfig(tenantId: string): Promise<EffectiveArcaConfig> {
  const tenantConfig = await TenantConfigModel.findOne({ tenantId });
  
  const arcaConfig = tenantConfig?.arca;
  const currentEnvironment = getCurrentArcaEnvironment();
  const tenantEnvironment: ArcaEnvironment | undefined =
    arcaConfig?.environment === 'prod'
      ? 'produccion'
      : arcaConfig?.environment === 'homo'
        ? 'homologacion'
        : arcaConfig?.environment === 'mock'
          ? 'mock'
          : undefined;
  const selectedEnvironment = tenantEnvironment || currentEnvironment;
  const isMock = !arcaConfig?.enabled || arcaConfig?.mock || selectedEnvironment === 'mock';
  const environment = isMock ? 'mock' : selectedEnvironment;
  const urls = getUrls(environment);
  
  return {
    environment,
    enabled: arcaConfig?.enabled ?? env.arcaEnabled ?? false,
    mock: isMock,
    cuit: arcaConfig?.cuit || env.arcaCuit,
    ptoVta: arcaConfig?.ptoVta || env.arcaPtoVta,
    wsfeUrl: arcaConfig?.wsfeUrl || urls.wsfeUrl,
    wsaaUrl: arcaConfig?.wsaaUrl || urls.wsaaUrl,
    token: arcaConfig?.token || env.arcaToken,
    sign: arcaConfig?.sign || env.arcaSign,
    certPath: arcaConfig?.certPath || env.arcaCertPath,
    certPassword: arcaConfig?.certPassword || env.arcaCertPassword
  };
}

export async function authorizeInvoiceWithArca(tenantId: string, req: ArcaInvoiceRequest): Promise<ArcaInvoiceResult> {
  const config = await getEffectiveArcaConfig(tenantId);
  if (config.mock || config.environment === 'mock') {
    return {
      ...authorizeInvoiceMock(req),
      ptoVta: config.ptoVta
    };
  }
  return authorizeInvoiceReal(config, req);
}

export function getArcaEnvironment(): ArcaEnvironment {
  return getCurrentArcaEnvironment();
}

export function setArcaEnvironment(env: ArcaEnvironment): void {
  process.env.ARCA_ENVIRONMENT = env;
}
