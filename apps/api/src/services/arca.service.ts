import { randomInt } from 'node:crypto';
import { env } from '../config/env.js';
import { TenantConfigModel } from '../models/TenantConfig.js';

type ArcaAuth = {
  token: string;
  sign: string;
  cuit: number;
};

type EffectiveArcaConfig = {
  enabled: boolean;
  mock: boolean;
  cuit: string;
  ptoVta: string;
  wsfeUrl: string;
  token?: string;
  sign?: string;
};

export type ArcaInvoiceRequest = {
  amountArs: number;
  period: string;
};

export type ArcaInvoiceResult = {
  cae: string;
  caeDueDate: string;
  cbteNro: number;
  cbteTipo: number;
  ptoVta: string;
  result: string;
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

function getAuth(config: EffectiveArcaConfig): ArcaAuth {
  const token = config.token?.trim();
  const sign = config.sign?.trim();
  if (!token || !sign) {
    throw new Error('ARCA_TOKEN y ARCA_SIGN son obligatorios cuando ARCA_ENABLED=true y ARCA_MOCK=false');
  }

  return {
    token,
    sign,
    cuit: Number(config.cuit)
  };
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
  const xml = await soapCall(
    config,
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

async function authorizeInvoiceReal(config: EffectiveArcaConfig, req: ArcaInvoiceRequest): Promise<ArcaInvoiceResult> {
  const auth = getAuth(config);
  const ptoVta = Number(config.ptoVta);
  const cbteTipo = 6;
  const today = toYyyymmdd(new Date());
  const last = await getLastVoucherNumber(config, auth, ptoVta, cbteTipo);
  const nextNro = last + 1;

  const xml = await soapCall(
    config,
    'FECAESolicitar',
    `<FECAESolicitar xmlns="http://ar.gov.afip.dif.FEV1/">
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
    </FECAESolicitar>`
  );

  const result = extractTag(xml, 'Resultado') ?? 'R';
  const cae = extractTag(xml, 'CAE');
  const caeDueDate = extractTag(xml, 'CAEFchVto');
  if (result !== 'A' || !cae || !caeDueDate) {
    const errCode = extractTag(xml, 'Code');
    const errMsg = extractTag(xml, 'Msg');
    throw new Error(`ARCA rechazo comprobante (${errCode ?? 'N/A'}): ${errMsg ?? 'Sin detalle'}`);
  }

  return {
    cae,
    caeDueDate,
    cbteNro: nextNro,
    cbteTipo,
    ptoVta: config.ptoVta,
    result
  };
}

function authorizeInvoiceMock(config: EffectiveArcaConfig, req: ArcaInvoiceRequest): ArcaInvoiceResult {
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
    cbteTipo: 6,
    ptoVta: config.ptoVta,
    result: 'A'
  };
}

export async function getEffectiveArcaConfig(tenantId: string): Promise<EffectiveArcaConfig> {
  const tenantConfig = await TenantConfigModel.findOne({ tenantId });
  if (!tenantConfig) {
    return {
      enabled: env.arcaEnabled,
      mock: env.arcaMock,
      cuit: env.arcaCuit,
      ptoVta: env.arcaPtoVta,
      wsfeUrl: env.arcaWsfeUrl,
      token: env.arcaToken,
      sign: env.arcaSign
    };
  }

  return {
    enabled: tenantConfig.arca.enabled,
    mock: tenantConfig.arca.mock,
    cuit: tenantConfig.arca.cuit || env.arcaCuit,
    ptoVta: tenantConfig.arca.ptoVta || env.arcaPtoVta,
    wsfeUrl: tenantConfig.arca.wsfeUrl || env.arcaWsfeUrl,
    token: tenantConfig.arca.token || env.arcaToken,
    sign: tenantConfig.arca.sign || env.arcaSign
  };
}

export async function authorizeInvoiceWithArca(tenantId: string, req: ArcaInvoiceRequest): Promise<ArcaInvoiceResult> {
  const config = await getEffectiveArcaConfig(tenantId);
  if (!config.enabled || config.mock) {
    return authorizeInvoiceMock(config, req);
  }
  return authorizeInvoiceReal(config, req);
}
