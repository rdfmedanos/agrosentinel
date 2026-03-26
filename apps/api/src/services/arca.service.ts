import { randomInt } from 'node:crypto';
import forge from 'node-forge';
import fs from 'node:fs';
import path from 'node:path';
import { env, type ArcaEnvironment } from '../config/env.js';
import { TenantConfigModel } from '../models/TenantConfig.js';
import { loadCertificateData } from './certificate.service.js';

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

export type ArcaTokenInfo = {
  uniqueId: string | null;
  generationTime: string | null;
  expirationTime: string | null;
  service: string | null;
  source: 'sso' | 'loginTicketResponse' | 'unknown';
  rawXml?: string;
};

export type ArcaInvoiceRequest = {
  amountArs: number;
  period: string;
  tipo?: 'A' | 'B' | 'C' | 'M';
  clienteTipoDoc?: number;
  clienteNroDoc?: string;
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

type InvoiceAmounts = {
  impTotal: number;
  impNeto: number;
  impIva: number;
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

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseEpochSeconds(value: string | null): string | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function parseTagValue(xml: string, tag: string): string | null {
  return extractTag(xml, tag);
}

function normalizeWsaaUrl(url?: string): string {
  const raw = (url || '').trim();
  if (!raw) return raw;
  if (raw.includes('/wsaa/services/LoginCms')) {
    return raw.replace('/wsaa/services/LoginCms', '/ws/services/LoginCms');
  }
  return raw;
}

function normalizeWsfeUrl(url?: string): string {
  const raw = (url || '').trim();
  if (!raw) return raw;
  return raw.replace(/\?WSDL$/i, '').replace(/\?wsdl$/i, '');
}

export function getArcaTokenInfo(token?: string): ArcaTokenInfo | null {
  if (!token || !token.trim()) return null;
  let xml = '';
  try {
    xml = Buffer.from(token, 'base64').toString('utf8');
  } catch {
    return {
      uniqueId: null,
      generationTime: null,
      expirationTime: null,
      service: null,
      source: 'unknown'
    };
  }

  const trimmed = xml.trim();
  if (!trimmed.startsWith('<')) {
    return {
      uniqueId: null,
      generationTime: null,
      expirationTime: null,
      service: null,
      source: 'unknown'
    };
  }

  const uniqueIdAttr = trimmed.match(/unique_id="([^"]+)"/i)?.[1] || null;
  const genAttr = trimmed.match(/gen_time="([^"]+)"/i)?.[1] || null;
  const expAttr = trimmed.match(/exp_time="([^"]+)"/i)?.[1] || null;
  const ssoService = trimmed.match(/service="([^"]+)"/i)?.[1] || null;

  if (uniqueIdAttr || genAttr || expAttr || trimmed.includes('<sso')) {
    return {
      uniqueId: uniqueIdAttr,
      generationTime: parseEpochSeconds(genAttr),
      expirationTime: parseEpochSeconds(expAttr),
      service: ssoService,
      source: 'sso',
      rawXml: trimmed
    };
  }

  const generationTime = parseTagValue(trimmed, 'generationTime');
  const expirationTime = parseTagValue(trimmed, 'expirationTime');
  const uniqueId = parseTagValue(trimmed, 'uniqueId');
  const service = parseTagValue(trimmed, 'service');

  return {
    uniqueId,
    generationTime,
    expirationTime,
    service,
    source: 'loginTicketResponse',
    rawXml: trimmed
  };
}

export function isArcaTokenExpired(token?: string): boolean {
  const info = getArcaTokenInfo(token);
  if (!info?.expirationTime) return false;
  const exp = new Date(info.expirationTime).getTime();
  if (!Number.isFinite(exp)) return false;
  return Date.now() >= exp;
}

function buildLoginTicketRequest(service: string): string {
  const now = new Date();
  const generationTime = new Date(now.getTime() - 60_000).toISOString();
  const expirationTime = new Date(now.getTime() + 10 * 60_000).toISOString();
  const uniqueId = Math.floor(now.getTime() / 1000);
  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${generationTime}</generationTime>
    <expirationTime>${expirationTime}</expirationTime>
  </header>
  <service>${service}</service>
</loginTicketRequest>`;
}

function signCmsBase64(xml: string, certificatePem: string, privateKeyPem: string): string {
  const cert = forge.pki.certificateFromPem(certificatePem);
  const key = forge.pki.privateKeyFromPem(privateKeyPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(xml, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date().toUTCString() }
    ]
  });
  p7.sign({ detached: false });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return Buffer.from(der, 'binary').toString('base64');
}

async function loginCms(wsaaUrl: string, cmsBase64: string): Promise<{ token: string; sign: string }> {
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cmsBase64}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  const response = await fetch(wsaaUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '""'
    },
    body: envelope
  });

  const xml = await response.text();
  if (!response.ok) {
    throw new Error(`WSAA HTTP ${response.status}: ${xml.slice(0, 400)}`);
  }

  const loginReturnMatch = xml.match(/<loginCmsReturn>([\s\S]*?)<\/loginCmsReturn>/);
  if (!loginReturnMatch?.[1]) {
    throw new Error('WSAA no devolvio loginCmsReturn');
  }
  const taXml = decodeXmlEntities(loginReturnMatch[1]);
  const token = extractTag(taXml, 'token');
  const sign = extractTag(taXml, 'sign');
  if (!token || !sign) {
    throw new Error('WSAA devolvio respuesta sin token/sign');
  }
  return { token, sign };
}

function extractSigningMaterialFromP12(p12Path: string, password: string): { certificatePem: string; privateKeyPem: string } {
  const absolutePath = path.isAbsolute(p12Path) ? p12Path : path.resolve(process.cwd(), p12Path);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`No existe el certificado P12 en ${absolutePath}`);
  }

  const p12Buffer = fs.readFileSync(absolutePath);
  const p12Der = forge.util.createBuffer(p12Buffer.toString('binary'));
  const asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password || '');

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];

  const keyBag = keyBags[0];
  const certBag = certBags[0];
  if (!keyBag?.key || !certBag?.cert) {
    throw new Error('No se pudo extraer clave privada/certificado desde el P12');
  }

  return {
    privateKeyPem: forge.pki.privateKeyToPem(keyBag.key),
    certificatePem: forge.pki.certificateToPem(certBag.cert)
  };
}

function getSigningMaterial(tenantId: string, config: EffectiveArcaConfig): { certificatePem: string; privateKeyPem: string } {
  const certData = loadCertificateData(tenantId);
  if (certData?.certificate && certData.privateKey) {
    return {
      certificatePem: certData.certificate,
      privateKeyPem: certData.privateKey
    };
  }

  if (config.certPath) {
    return extractSigningMaterialFromP12(config.certPath, config.certPassword || '');
  }

  throw new Error('Falta certificado: suba CRT/KEY en la pestana Certificado o configure ARCA_CERT_PATH/ARCA_CERT_PASSWORD');
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

function getInvoiceAmounts(tipo: ArcaInvoiceRequest['tipo'], total: number): InvoiceAmounts {
  if (tipo === 'A' || tipo === 'B' || tipo === 'M') {
    const impNeto = Number((total / 1.21).toFixed(2));
    const impIva = Number((total - impNeto).toFixed(2));
    return { impTotal: total, impNeto, impIva };
  }
  return { impTotal: total, impNeto: total, impIva: 0 };
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
  const amounts = getInvoiceAmounts(req.tipo, req.amountArs);
  const docTipo = req.clienteTipoDoc ?? 99;
  const docNro = Number(req.clienteNroDoc || '0') || 0;
  const ivaNode = amounts.impIva > 0
    ? `<Iva>
            <AlicIva>
              <Id>5</Id>
              <BaseImp>${amounts.impNeto.toFixed(2)}</BaseImp>
              <Importe>${amounts.impIva.toFixed(2)}</Importe>
            </AlicIva>
          </Iva>`
    : '';
  
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
          <DocTipo>${docTipo}</DocTipo>
          <DocNro>${docNro}</DocNro>
          <CbteDesde>${nextNro}</CbteDesde>
          <CbteHasta>${nextNro}</CbteHasta>
          <CbteFch>${today}</CbteFch>
          <ImpTotal>${amounts.impTotal.toFixed(2)}</ImpTotal>
          <ImpTotConc>0.00</ImpTotConc>
          <ImpNeto>${amounts.impNeto.toFixed(2)}</ImpNeto>
          <ImpOpEx>0.00</ImpOpEx>
          <ImpIVA>${amounts.impIva.toFixed(2)}</ImpIVA>
          <ImpTrib>0.00</ImpTrib>
          <MonId>PES</MonId>
          <MonCotiz>1</MonCotiz>
          <FchServDesde>${today}</FchServDesde>
          <FchServHasta>${today}</FchServHasta>
          <FchVtoPago>${today}</FchVtoPago>
          ${ivaNode}
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

export async function probeArcaConnection(config: EffectiveArcaConfig): Promise<{ ok: boolean; message: string; lastVoucher?: number }> {
  if (config.mock || config.environment === 'mock') {
    return {
      ok: true,
      message: 'Modo mock activo'
    };
  }

  try {
    const auth = getAuth(config);
    const lastVoucher = await getLastVoucherNumber(config, auth, Number(config.ptoVta), 6);
    return {
      ok: true,
      message: 'Conexion exitosa con ARCA WSFE',
      lastVoucher
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Error desconocido al conectar con ARCA'
    };
  }
}

export async function getLastAuthorizedVoucher(config: EffectiveArcaConfig, tipo: ArcaInvoiceRequest['tipo']): Promise<number | null> {
  if (config.mock || config.environment === 'mock') {
    return null;
  }
  const auth = getAuth(config);
  const cbteTipo = mapTipoToCbteTipo(tipo);
  return getLastVoucherNumber(config, auth, Number(config.ptoVta), cbteTipo);
}

export async function refreshArcaCredentials(tenantId: string): Promise<{ token: string; sign: string }> {
  const config = await getEffectiveArcaConfig(tenantId);
  if (config.mock || config.environment === 'mock') {
    throw new Error('No se generan credenciales en modo mock');
  }

  const material = getSigningMaterial(tenantId, config);

  const tra = buildLoginTicketRequest('wsfe');
  const cms = signCmsBase64(tra, material.certificatePem, material.privateKeyPem);
  const { token, sign } = await loginCms(normalizeWsaaUrl(config.wsaaUrl), cms);

  await TenantConfigModel.findOneAndUpdate(
    { tenantId },
    {
      tenantId,
      'arca.token': token,
      'arca.sign': sign
    },
    { upsert: true, new: true }
  );

  return { token, sign };
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
  const wsfeUrl = normalizeWsfeUrl(arcaConfig?.wsfeUrl || urls.wsfeUrl);
  const wsaaUrl = normalizeWsaaUrl(arcaConfig?.wsaaUrl || urls.wsaaUrl);
  
  return {
    environment,
    enabled: arcaConfig?.enabled ?? env.arcaEnabled ?? false,
    mock: isMock,
    cuit: arcaConfig?.cuit || env.arcaCuit,
    ptoVta: arcaConfig?.ptoVta || env.arcaPtoVta,
    wsfeUrl,
    wsaaUrl,
    token: arcaConfig?.token || env.arcaToken,
    sign: arcaConfig?.sign || env.arcaSign,
    certPath: arcaConfig?.certPath || env.arcaCertPath,
    certPassword: arcaConfig?.certPassword || env.arcaCertPassword
  };
}

export async function authorizeInvoiceWithArca(tenantId: string, req: ArcaInvoiceRequest): Promise<ArcaInvoiceResult> {
  let config = await getEffectiveArcaConfig(tenantId);
  const expired = isArcaTokenExpired(config.token);
  if (!config.mock && config.environment !== 'mock' && (!config.token || !config.sign || expired)) {
    await refreshArcaCredentials(tenantId);
    config = await getEffectiveArcaConfig(tenantId);
  }
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
