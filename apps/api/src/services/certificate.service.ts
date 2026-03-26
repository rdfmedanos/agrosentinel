import forge from 'node-forge';
import fs from 'fs';
import path from 'path';

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

const certStorageDir = process.env.CERT_STORAGE_DIR || path.join(process.cwd(), 'certs');

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
  const dir = path.join(certStorageDir, tenantId);
  
  if (!fs.existsSync(dir)) {
    return null;
  }
  
  const metadataPath = path.join(dir, 'metadata.json');
  if (!fs.existsSync(metadataPath)) {
    return null;
  }
  
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  
  const privateKeyPath = path.join(dir, 'private.key');
  const csrPath = path.join(dir, 'request.csr');
  const certPath = path.join(dir, 'certificate.crt');
  
  return {
    tenantId: metadata.tenantId,
    privateKey: fs.existsSync(privateKeyPath) ? fs.readFileSync(privateKeyPath, 'utf8') : '',
    csr: fs.existsSync(csrPath) ? fs.readFileSync(csrPath, 'utf8') : '',
    certificate: fs.existsSync(certPath) ? fs.readFileSync(certPath, 'utf8') : undefined,
    environment: metadata.environment,
    createdAt: metadata.createdAt,
    companyName: metadata.companyName,
    taxId: metadata.taxId
  };
}

export function getCertificateFiles(tenantId: string): {
  privateKey?: Buffer;
  csr?: Buffer;
  certificate?: Buffer;
} {
  const dir = path.join(certStorageDir, tenantId);
  
  return {
    privateKey: fs.existsSync(path.join(dir, 'private.key')) 
      ? fs.readFileSync(path.join(dir, 'private.key')) 
      : undefined,
    csr: fs.existsSync(path.join(dir, 'request.csr')) 
      ? fs.readFileSync(path.join(dir, 'request.csr')) 
      : undefined,
    certificate: fs.existsSync(path.join(dir, 'certificate.crt')) 
      ? fs.readFileSync(path.join(dir, 'certificate.crt')) 
      : undefined
  };
}

export function deleteCertificateData(tenantId: string): void {
  const dir = path.join(certStorageDir, tenantId);
  
  if (fs.existsSync(dir)) {
    const files = ['private.key', 'request.csr', 'certificate.crt', 'metadata.json'];
    files.forEach(file => {
      const filePath = path.join(dir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
    fs.rmdirSync(dir);
  }
}
