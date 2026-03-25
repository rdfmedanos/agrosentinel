import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export interface InvoiceItem {
  codigo: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  descuento: number;
  alicuotaIva: number;
}

export interface InvoiceData {
  _id: string;
  tipo: string;
  ptoVta?: number | string;
  cbteNro?: number | null;
  period: string;
  amountArs: number;
  cae?: string | null;
  caeDueDate?: string | null;
  fechaEmision?: string;
  fechaVencimiento?: string;
  moneda?: string;
  condicionPago?: string;
  cliente?: {
    nombre?: string;
    tipoDoc?: number;
    nroDoc?: string;
    condicionIva?: string;
    direccion?: string;
  } | null;
  seller?: {
    companyName?: string;
    taxId?: string;
    address?: string;
    ivaCondition?: string;
    ingresosBrutos?: string;
    inicioActividades?: string;
    phone?: string;
  };
  items?: InvoiceItem[];
  createdAt?: string | Date;
  arcaResult?: string;
}

function sanitizeText(text: string | undefined | null): string {
  if (!text) return '-';
  return String(text)
    .replace(/[áàäâ]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u')
    .replace(/[ñ]/g, 'n')
    .replace(/[ÁÀÄÂ]/g, 'A')
    .replace(/[ÉÈËÊ]/g, 'E')
    .replace(/[ÍÌÏÎ]/g, 'I')
    .replace(/[ÓÒÖÔ]/g, 'O')
    .replace(/[ÚÙÜÛ]/g, 'U')
    .replace(/[Ñ]/g, 'N')
    .replace(/[¿?¡!]/g, '')
    .replace(/[''']/g, "'")
    .replace(/[""]/g, '"');
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr: string | Date | undefined): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('es-AR');
}

const tipoDocMap: Record<number, string> = {
  80: 'CUIT',
  86: 'CUIL',
  96: 'DNI',
  99: 'Sin identificar'
};

const tipoComprobanteMap: Record<string, { codigo: string; nombre: string }> = {
  A: { codigo: '1', nombre: 'FACTURA A' },
  B: { codigo: '6', nombre: 'FACTURA B' },
  C: { codigo: '11', nombre: 'FACTURA C' }
};

const alicuotaMap: Record<number, string> = {
  0: '0%',
  10.5: '10.5%',
  21: '21%',
  27: '27%'
};

async function generateQRCode(data: object): Promise<Buffer> {
  const base64 = Buffer.from(JSON.stringify(data)).toString('base64');
  const url = `https://www.afip.gob.ar/fe/qr/?p=${base64}`;
  return await QRCode.toBuffer(url, { width: 100, margin: 1 });
}

export async function generateInvoicePDF(invoice: InvoiceData, sellerInfo?: InvoiceData['seller']): Promise<PDFKit.PDFDocument> {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const pageWidth = doc.page.width - 80;
  
  const fechaEmision = invoice.fechaEmision || (invoice.createdAt ? formatDate(invoice.createdAt) : formatDate(new Date()));
  const fechaVencimiento = invoice.fechaVencimiento || '-';
  const moneda = invoice.moneda || 'PES';
  const condicionPago = invoice.condicionPago || 'CONTADO';
  
  const ptoVta = String(invoice.ptoVta || 1).padStart(5, '0');
  const cbteNro = String(invoice.cbteNro || 0).padStart(8, '0');
  
  const tipoData = tipoComprobanteMap[invoice.tipo] || { codigo: '6', nombre: `FACTURA ${invoice.tipo}` };
  
  const items = invoice.items || [
    {
      codigo: 'SERV-001',
      descripcion: `Servicio de monitoreo IoT - ${invoice.period || 'Periodo'}`,
      cantidad: 1,
      precioUnitario: invoice.amountArs,
      descuento: 0,
      alicuotaIva: invoice.tipo === 'A' ? 21 : 0
    }
  ];
  
  const subtotalBruto = items.reduce((sum, item) => {
    const subtotal = item.cantidad * item.precioUnitario;
    const descuento = subtotal * (item.descuento / 100);
    return sum + subtotal - descuento;
  }, 0);
  
  const totalDescuentos = items.reduce((sum, item) => {
    const subtotal = item.cantidad * item.precioUnitario;
    return sum + subtotal * (item.descuento / 100);
  }, 0);
  
  const ivaPorAlicuota: Record<number, number> = {};
  items.forEach(item => {
    const subtotal = item.cantidad * item.precioUnitario * (1 - item.descuento / 100);
    const iva = subtotal * (item.alicuotaIva / 100);
    ivaPorAlicuota[item.alicuotaIva] = (ivaPorAlicuota[item.alicuotaIva] || 0) + iva;
  });
  
  const totalIva = Object.values(ivaPorAlicuota).reduce((sum, iva) => sum + iva, 0);
  const totalFinal = invoice.tipo === 'A' ? subtotalBruto + totalIva : subtotalBruto;

  const leftCol = 40;
  const rightCol = pageWidth - 180;
  let currentY = 40;
  
  doc.rect(leftCol, currentY, pageWidth, 80).stroke();
  
  doc.fontSize(8).font('Helvetica').text('PUNTO DE VENTA', leftCol + 10, currentY + 10);
  doc.fontSize(20).font('Helvetica-Bold').text(ptoVta, leftCol + 10, currentY + 20);
  
  doc.fontSize(8).font('Helvetica').text('COMP. NRO', leftCol + 80, currentY + 10);
  doc.fontSize(16).font('Helvetica-Bold').text(cbteNro, leftCol + 80, currentY + 20);
  
  doc.fontSize(8).font('Helvetica').text('FECHA', leftCol + 160, currentY + 10);
  doc.fontSize(12).font('Helvetica-Bold').text(fechaEmision, leftCol + 160, currentY + 20);
  
  doc.fontSize(8).font('Helvetica').text('TIPO', rightCol + 10, currentY + 10);
  doc.fontSize(16).font('Helvetica-Bold').text(tipoData.nombre, rightCol + 10, currentY + 20);
  
  doc.fontSize(8).font('Helvetica').text('COD. AFIP', rightCol + 10, currentY + 40);
  doc.fontSize(10).font('Helvetica').text(tipoData.codigo, rightCol + 10, currentY + 50);
  
  doc.fontSize(8).font('Helvetica').text('NRO. COMPROBANTE', rightCol + 60, currentY + 40);
  doc.fontSize(10).font('Helvetica-Bold').text(`${ptoVta}-${cbteNro}`, rightCol + 60, currentY + 50);
  
  currentY += 90;
  
  const emisorBoxHeight = sellerInfo ? 110 : 60;
  doc.rect(leftCol, currentY, pageWidth, emisorBoxHeight).stroke();
  
  doc.fontSize(8).font('Helvetica-Bold').text('EMISOR', leftCol + 10, currentY + 8);
  doc.fontSize(10).font('Helvetica-Bold').text(sanitizeText(sellerInfo?.companyName || invoice.seller?.companyName || 'AgroSentinel'), leftCol + 10, currentY + 18);
  
  if (sellerInfo || invoice.seller) {
    const s = sellerInfo || invoice.seller!;
    doc.fontSize(8).font('Helvetica').text(`CUIT: ${sanitizeText(s.taxId || '')}`, leftCol + 10, currentY + 35);
    doc.fontSize(8).font('Helvetica').text(`Condicion IVA: ${sanitizeText(s.ivaCondition || '')}`, leftCol + 10, currentY + 48);
    doc.fontSize(8).font('Helvetica').text(`Domicilio: ${sanitizeText(s.address || '')}`, leftCol + 10, currentY + 61);
    if (s.ingresosBrutos) {
      doc.fontSize(8).font('Helvetica').text(`Ing. Brutos: ${sanitizeText(s.ingresosBrutos)}`, leftCol + 10, currentY + 74);
    }
    if (s.inicioActividades) {
      doc.fontSize(8).font('Helvetica').text(`Inicio Act.: ${sanitizeText(s.inicioActividades)}`, leftCol + 10, currentY + 87);
    }
  }
  
  doc.fontSize(8).font('Helvetica-Bold').text('CAE', rightCol + 10, currentY + 8);
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text(sanitizeText(invoice.cae) || '-', rightCol + 10, currentY + 18);
  
  doc.fontSize(8).font('Helvetica').text(`Vto. CAE: ${sanitizeText(invoice.caeDueDate) || '-'}`, rightCol + 10, currentY + 35);
  
  if (invoice.arcaResult) {
    const resultColor = invoice.arcaResult === 'A' ? '#008000' : '#FF0000';
    doc.fontSize(8).font('Helvetica-Bold').fillColor(resultColor).text(`Resultado: ${invoice.arcaResult}`, rightCol + 10, currentY + 48);
    doc.fillColor('#000');
  }
  
  currentY += emisorBoxHeight + 10;
  
  doc.rect(leftCol, currentY, pageWidth, 60).stroke();
  doc.fontSize(8).font('Helvetica-Bold').text('CLIENTE', leftCol + 10, currentY + 8);
  
  const cli = invoice.cliente;
  const tipoDocCli = cli?.tipoDoc ? tipoDocMap[cli.tipoDoc] || String(cli.tipoDoc) : '-';
  const nroDocCli = cli?.nroDoc || '-';
  
  doc.fontSize(9).font('Helvetica-Bold').text(sanitizeText(cli?.nombre) || '-', leftCol + 10, currentY + 18);
  doc.fontSize(8).font('Helvetica').text(`${tipoDocCli}: ${nroDocCli}`, leftCol + 10, currentY + 32);
  doc.fontSize(8).font('Helvetica').text(`Condicion IVA: ${sanitizeText(cli?.condicionIva) || '-'}`, leftCol + 10, currentY + 45);
  doc.fontSize(8).font('Helvetica').text(`Direccion: ${sanitizeText(cli?.direccion) || '-'}`, leftCol + 200, currentY + 18);
  
  currentY += 70;
  
  doc.rect(leftCol, currentY, pageWidth, 30).fillAndStroke('#f0f0f0', '#000');
  doc.fillColor('#000');
  const headerY = currentY + 10;
  doc.fontSize(8).font('Helvetica-Bold').text('CODIGO', leftCol + 5, headerY);
  doc.text('DESCRIPCION', leftCol + 60, headerY);
  doc.text('CANT.', leftCol + 230, headerY);
  doc.text('P.UNIT.', leftCol + 270, headerY);
  doc.text('DTO.', leftCol + 320, headerY);
  doc.text('IVA', leftCol + 355, headerY);
  doc.text('SUBTOTAL', leftCol + 410, headerY);
  
  currentY += 30;
  
  let itemsY = currentY;
  items.forEach((item, index) => {
    const subtotalItem = item.cantidad * item.precioUnitario * (1 - item.descuento / 100);
    const ivaItem = subtotalItem * (item.alicuotaIva / 100);
    
    if (index % 2 === 0) {
      doc.rect(leftCol, itemsY, pageWidth, 20).fill('#fafafa');
      doc.fillColor('#000');
    }
    
    doc.fontSize(8).font('Helvetica').text(sanitizeText(item.codigo), leftCol + 5, itemsY + 6);
    doc.text(sanitizeText(item.descripcion), leftCol + 60, itemsY + 6, { width: 165 });
    doc.text(String(item.cantidad), leftCol + 235, itemsY + 6, { width: 30, align: 'right' });
    doc.text(`$${formatCurrency(item.precioUnitario)}`, leftCol + 270, itemsY + 6, { width: 40, align: 'right' });
    doc.text(`${item.descuento}%`, leftCol + 320, itemsY + 6, { width: 30, align: 'right' });
    doc.text(alicuotaMap[item.alicuotaIva] || `${item.alicuotaIva}%`, leftCol + 355, itemsY + 6, { width: 45, align: 'right' });
    doc.font('Helvetica-Bold').text(`$${formatCurrency(subtotalItem + ivaItem)}`, leftCol + 410, itemsY + 6, { width: 80, align: 'right' });
    doc.font('Helvetica');
    
    itemsY += 20;
  });
  
  currentY = itemsY + 10;
  
  doc.moveTo(leftCol + 380, currentY).lineTo(pageWidth, currentY).stroke();
  currentY += 10;
  
  doc.fontSize(8).font('Helvetica').text('Subtotal:', leftCol + 300, currentY);
  doc.font('Helvetica-Bold').text(`$${formatCurrency(subtotalBruto)}`, leftCol + 410, currentY, { width: 80, align: 'right' });
  currentY += 15;
  
  if (totalDescuentos > 0) {
    doc.fontSize(8).font('Helvetica').text('Descuentos:', leftCol + 300, currentY);
    doc.font('Helvetica-Bold').text(`-$${formatCurrency(totalDescuentos)}`, leftCol + 410, currentY, { width: 80, align: 'right' });
    currentY += 15;
  }
  
  if (invoice.tipo === 'A') {
    Object.entries(ivaPorAlicuota).forEach(([alicuota, iva]) => {
      if (iva > 0) {
        doc.fontSize(8).font('Helvetica').text(`IVA ${alicuota}%:`, leftCol + 300, currentY);
        doc.font('Helvetica-Bold').text(`$${formatCurrency(iva)}`, leftCol + 410, currentY, { width: 80, align: 'right' });
        currentY += 15;
      }
    });
  }
  
  doc.moveTo(leftCol + 380, currentY).lineTo(pageWidth, currentY).stroke();
  currentY += 5;
  
  doc.rect(leftCol + 380, currentY, pageWidth - 380, 30).fillAndStroke('#333', '#000');
  doc.fillColor('#FFF');
  doc.fontSize(10).font('Helvetica-Bold').text('TOTAL:', leftCol + 390, currentY + 8);
  doc.fontSize(14).text(`$${formatCurrency(totalFinal)}`, leftCol + 390, currentY + 18, { width: 130, align: 'right' });
  doc.fillColor('#000');
  
  currentY += 40;
  
  doc.fontSize(8).font('Helvetica').text(`Moneda: ${moneda}`, leftCol + 10, currentY);
  doc.text(`Condicion de Pago: ${condicionPago}`, leftCol + 150, currentY);
  
  currentY += 20;
  
  doc.moveTo(leftCol, currentY).lineTo(pageWidth, currentY).stroke();
  currentY += 10;
  
  doc.fontSize(7).font('Helvetica').text('Documento generado por AgroSentinel - Sistema de Monitoreo IoT', leftCol + 10, currentY);
  
  if (invoice.cae) {
    try {
      const qrData = {
        ver: 1,
        fecha: fechaEmision.split('/').reverse().join('-'),
        cuit: Number(sellerInfo?.taxId?.replace(/-/g, '') || invoice.seller?.taxId?.replace(/-/g, '') || '0'),
        ptoVta: Number(ptoVta),
        tipoCmp: Number(tipoData.codigo),
        nroCmp: Number(cbteNro),
        importe: totalFinal,
        moneda: moneda,
        ctz: 1,
        tipoDocRec: Number(cli?.tipoDoc || 99),
        nroDocRec: Number((cli?.nroDoc || '0').replace(/-/g, '')),
        tipoCodAut: 'E',
        codAuth: Number(invoice.cae)
      };
      
      const qrBuffer = await generateQRCode(qrData);
      doc.image(qrBuffer, pageWidth - 110, currentY, { width: 80 });
      
      doc.fontSize(6).font('Helvetica').text('QR AFIP', pageWidth - 110, currentY + 85, { width: 80, align: 'center' });
    } catch (qrError) {
      console.error('Error generating QR:', qrError);
    }
  }
  
  return doc;
}

export function generateInvoicePDFSync(invoice: InvoiceData, sellerInfo?: InvoiceData['seller']): PDFKit.PDFDocument {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  return doc;
}
