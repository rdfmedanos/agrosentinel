import forge from 'node-forge';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export interface CertificateData {
  tenantId: string;
  privateKey: string;
  csr: string;
  certificate?: string;
  environment: 'homologacion' | 'produccion';
  createdAt: string;
  companyName: string;
  taxId: string;
}

export interface CsrData {
  companyName: string;
  taxId: string;
  province: string;
  city: string;
}

const serviceDir = path.dirname(fileURLToPath(import.meta.url));
const defaultCertStorageDir = path.resolve(serviceDir, '../../certs');
const certStorageDir = process.env.CERT_STORAGE_DIR || defaultCertStorageDir;
const legacyCertStorageDir = path.resolve(process.cwd(), 'certs');

function getTenantDirs(tenantId: string): string[] {
  const primary = path.join(certStorageDir, tenantId);
  const legacy = path.join(legacyCertStorageDir, tenantId);
  return legacy === primary ? [primary] : [primary, legacy];
}

function readFirstExistingFile(tenantId: string, fileName: string): { value?: string; path?: string } {
  const dirs = getTenantDirs(tenantId);
  for (const dir of dirs) {
    const filePath = path.join(dir, fileName);
    if (fs.existsSync(filePath)) {
      return { value: fs.readFileSync(filePath, 'utf8'), path: filePath };
    }
  }
  return {};
}

function readFirstExistingBuffer(tenantId: string, fileName: string): Buffer | undefined {
  const dirs = getTenantDirs(tenantId);
  for (const dir of dirs) {
    const filePath = path.join(dir, fileName);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath);
    }
  }
  return undefined;
}

function ensureCertDir(tenantId: string): string {
  const dir = path.join(certStorageDir, tenantId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function generatePrivateKey(): string {
  const keypair = forge.pki.rsa.generateKeyPair(2048);
  const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);
  return privateKeyPem;
}

export function generateCSR(privateKeyPem: string, csrData: CsrData): string {
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem) as forge.pki.rsa.PrivateKey;

  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);

  csr.setSubject([
    {
      name: 'countryName',
      value: 'AR'
    },
    {
      name: 'stateOrProvinceName',
      value: csrData.province
    },
    {
      name: 'localityName',
      value: csrData.city
    },
    {
      name: 'organizationName',
      value: csrData.companyName
    },
    {
      name: 'serialNumber',
      value: `CUIT ${csrData.taxId}`
    },
    {
      name: 'commonName',
      value: `AFIP ${csrData.taxId} - ${csrData.companyName}`
    }
  ]);

  csr.sign(privateKey, forge.md.sha256.create());

  if (!csr.verify()) {
    throw new Error('El CSR generado es invalido');
  }

  const csrPem = forge.pki.certificationRequestToPem(csr);
  return csrPem;
}

export function validateCertificate(certificatePem: string, privateKeyPem: string, csrPem: string): boolean {
  try {
    const cert = forge.pki.certificateFromPem(certificatePem);
    const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
    
    const csr = forge.pki.certificationRequestFromPem(csrPem);
    
    const publicKeyFromCert = cert.publicKey as forge.pki.rsa.PublicKey;
    const publicKeyFromCsr = csr.publicKey as forge.pki.rsa.PublicKey;
    
    const publicKeyCertPem = forge.pki.publicKeyToPem(publicKeyFromCert);
    const publicKeyCsrPem = forge.pki.publicKeyToPem(publicKeyFromCsr);
    
    return publicKeyCertPem === publicKeyCsrPem;
  } catch (error) {
    console.error('Certificate validation error:', error);
    return false;
  }
}

export function generateP12(
  privateKeyPem: string,
  certificatePem: string,
  password: string
): Buffer {
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const cert = forge.pki.certificateFromPem(certificatePem);
  
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    privateKey,
    [cert],
    password,
    { algorithm: '3des' }
  );
  
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  return Buffer.from(p12Der, 'binary');
}

export function saveCertificateData(tenantId: string, data: CertificateData): void {
  const dir = ensureCertDir(tenantId);
  
  fs.writeFileSync(path.join(dir, 'private.key'), data.privateKey, 'utf8');
  fs.writeFileSync(path.join(dir, 'request.csr'), data.csr, 'utf8');
  
  if (data.certificate) {
    fs.writeFileSync(path.join(dir, 'certificate.crt'), data.certificate, 'utf8');
  }
  
  const metadata = {
    tenantId: data.tenantId,
    environment: data.environment,
    companyName: data.companyName,
    taxId: data.taxId,
    createdAt: data.createdAt,
    hasCertificate: !!data.certificate
  };
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
}

export function loadCertificateData(tenantId: string): CertificateData | null {
  const privateKeyData = readFirstExistingFile(tenantId, 'private.key');
  const csrData = readFirstExistingFile(tenantId, 'request.csr');
  const certificateData = readFirstExistingFile(tenantId, 'certificate.crt');

  const privateKey = privateKeyData.value || '';
  const csr = csrData.value || '';
  const certificate = certificateData.value;

  if (!privateKey && !csr && !certificate) {
    return null;
  }

  const metadataData = readFirstExistingFile(tenantId, 'metadata.json');
  const metadata = metadataData.value
    ? JSON.parse(metadataData.value)
    : null;

  const fallbackCreatedAt = (() => {
    if (csrData.path && fs.existsSync(csrData.path)) return fs.statSync(csrData.path).mtime.toISOString();
    if (privateKeyData.path && fs.existsSync(privateKeyData.path)) return fs.statSync(privateKeyData.path).mtime.toISOString();
    if (certificateData.path && fs.existsSync(certificateData.path)) return fs.statSync(certificateData.path).mtime.toISOString();
    return new Date().toISOString();
  })();
  
  return {
    tenantId: metadata?.tenantId || tenantId,
    privateKey,
    csr,
    certificate,
    environment: metadata?.environment || 'homologacion',
    createdAt: metadata?.createdAt || fallbackCreatedAt,
    companyName: metadata?.companyName || '',
    taxId: metadata?.taxId || ''
  };
}

export function getCertificateFiles(tenantId: string): {
  privateKey?: Buffer;
  csr?: Buffer;
  certificate?: Buffer;
} {
  return {
    privateKey: readFirstExistingBuffer(tenantId, 'private.key'),
    csr: readFirstExistingBuffer(tenantId, 'request.csr'),
    certificate: readFirstExistingBuffer(tenantId, 'certificate.crt')
  };
}

export function deleteCertificateData(tenantId: string): void {
  getTenantDirs(tenantId).forEach(dir => {
    if (!fs.existsSync(dir)) {
      return;
    }
    const files = ['private.key', 'request.csr', 'certificate.crt', 'metadata.json'];
    files.forEach(file => {
      const filePath = path.join(dir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  });
}
