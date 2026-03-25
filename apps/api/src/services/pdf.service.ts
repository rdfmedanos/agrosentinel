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
    .replace(/[Ñ]/g, 'N');
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr: string | Date | undefined): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${d}/${m}/${y}`;
}

const tipoDocMap: Record<number, string> = {
  80: 'CUIT',
  86: 'CUIL',
  96: 'DNI',
  99: 'Sin identificar'
};

const tipoComprobanteMap: Record<string, { codigo: string; nombre: string }> = {
  A: { codigo: '001', nombre: 'FACTURA' },
  B: { codigo: '006', nombre: 'FACTURA' },
  C: { codigo: '011', nombre: 'FACTURA' }
};

async function generateQRCode(data: object): Promise<Buffer> {
  const base64 = Buffer.from(JSON.stringify(data)).toString('base64');
  const url = `https://www.afip.gob.ar/fe/qr/?p=${base64}`;
  return await QRCode.toBuffer(url, { width: 80, margin: 0 });
}

export async function generateInvoicePDF(invoice: InvoiceData, sellerInfo?: InvoiceData['seller']): Promise<PDFKit.PDFDocument> {
  const doc = new PDFDocument({ margin: 20, size: 'A4' });
  
  const pageWidth = doc.page.width - 40;
  const leftMargin = 20;
  
  const fechaEmision = invoice.fechaEmision || (invoice.createdAt ? formatDate(invoice.createdAt) : formatDate(new Date()));
  const fechaVencimiento = invoice.fechaVencimiento || formatDate(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000));
  const moneda = invoice.moneda || 'PES';
  const condicionPago = invoice.condicionPago || 'CONTADO';
  
  const ptoVta = String(invoice.ptoVta || 1).padStart(4, '0');
  const cbteNro = String(invoice.cbteNro || 0).padStart(8, '0');
  
  const tipoData = tipoComprobanteMap[invoice.tipo] || { codigo: '006', nombre: 'FACTURA' };
  
  const items = invoice.items || [
    {
      codigo: 'SERV-001',
      descripcion: `Servicio de Monitoreo IoT - ${invoice.period || 'Periodo'}`,
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
  
  let currentY = 15;
  
  doc.rect(leftMargin, currentY, pageWidth, 60).stroke();
  
  doc.fontSize(10).font('Helvetica-Bold');
  doc.text(sanitizeText(sellerInfo?.companyName || invoice.seller?.companyName || 'AGROSENTINEL'), leftMargin + 10, currentY + 8);
  doc.fontSize(8).font('Helvetica');
  doc.text(`CUIT: ${sanitizeText(sellerInfo?.taxId || invoice.seller?.taxId || '')}`, leftMargin + 10, currentY + 22);
  doc.text(`Condicion frente al IVA: ${sanitizeText(sellerInfo?.ivaCondition || invoice.seller?.ivaCondition || '')}`, leftMargin + 10, currentY + 33);
  doc.text(`Domicilio: ${sanitizeText(sellerInfo?.address || invoice.seller?.address || '')}`, leftMargin + 10, currentY + 44);
  doc.text(`Telefono: ${sanitizeText(sellerInfo?.phone || invoice.seller?.phone || '')}`, leftMargin + 280, currentY + 22);
  if (sellerInfo?.ingresosBrutos || invoice.seller?.ingresosBrutos) {
    doc.text(`Ing. Brutos: ${sanitizeText(sellerInfo?.ingresosBrutos || invoice.seller?.ingresosBrutos)}`, leftMargin + 280, currentY + 33);
  }
  if (sellerInfo?.inicioActividades || invoice.seller?.inicioActividades) {
    doc.text(`Inicio Actividades: ${sanitizeText(sellerInfo?.inicioActividades || invoice.seller?.inicioActividades)}`, leftMargin + 280, currentY + 44);
  }
  
  currentY += 65;
  
  doc.rect(leftMargin, currentY, pageWidth, 45).stroke();
  
  doc.fontSize(16).font('Helvetica-Bold').text(`${tipoData.nombre} ${invoice.tipo}`, leftMargin + 10, currentY + 5, { width: 200 });
  doc.fontSize(10).font('Helvetica');
  doc.text(`Nro: ${ptoVta}-${cbteNro}`, leftMargin + 10, currentY + 28);
  
  doc.fontSize(8).text('Fecha de Emision:', leftMargin + 200, currentY + 8);
  doc.fontSize(9).font('Helvetica-Bold').text(fechaEmision, leftMargin + 200, currentY + 18);
  
  doc.fontSize(8).text('Fecha de Vto:', leftMargin + 280, currentY + 8);
  doc.fontSize(9).font('Helvetica-Bold').text(fechaVencimiento, leftMargin + 280, currentY + 18);
  
  doc.fontSize(8).text('Cod. Doc. Fiscal:', leftMargin + 380, currentY + 8);
  doc.fontSize(9).text(tipoData.codigo, leftMargin + 380, currentY + 18);
  
  doc.fontSize(8).text('Punto de Venta:', leftMargin + 450, currentY + 8);
  doc.fontSize(9).text(ptoVta, leftMargin + 450, currentY + 18);
  
  doc.fontSize(8).font('Helvetica');
  doc.text('Nro. Comprobante:', leftMargin + 500, currentY + 8);
  doc.fontSize(9).font('Helvetica-Bold').text(cbteNro, leftMargin + 500, currentY + 18);
  
  currentY += 50;
  
  doc.rect(leftMargin, currentY, pageWidth, 55).stroke();
  doc.fontSize(8).font('Helvetica-Bold').text('DATOS DEL RECEPTOR', leftMargin + 10, currentY + 5);
  
  const cli = invoice.cliente;
  const tipoDocCli = cli?.tipoDoc ? tipoDocMap[cli.tipoDoc] || String(cli.tipoDoc) : '-';
  const nroDocCli = cli?.nroDoc || '-';
  
  doc.fontSize(9).font('Helvetica-Bold').text(sanitizeText(cli?.nombre) || 'CONSUMIDOR FINAL', leftMargin + 10, currentY + 20);
  doc.fontSize(8).font('Helvetica');
  doc.text(`${tipoDocCli}: ${nroDocCli}`, leftMargin + 10, currentY + 34);
  doc.text(`Condicion IVA: ${sanitizeText(cli?.condicionIva) || 'Consumidor Final'}`, leftMargin + 200, currentY + 20);
  doc.text(`Domicilio: ${sanitizeText(cli?.direccion) || '-'}`, leftMargin + 200, currentY + 34);
  
  currentY += 60;
  
  doc.rect(leftMargin, currentY, pageWidth, 22).fillAndStroke('#333333', '#000');
  doc.fillColor('#FFF');
  doc.fontSize(7).font('Helvetica-Bold');
  const headerY = currentY + 7;
  doc.text('CODIGO', leftMargin + 5, headerY, { width: 60 });
  doc.text('DESCRIPCION', leftMargin + 70, headerY, { width: 180 });
  doc.text('CANTIDAD', leftMargin + 255, headerY, { width: 50, align: 'center' });
  doc.text('UNIDAD', leftMargin + 305, headerY, { width: 50, align: 'center' });
  doc.text('PRECIO UNIT.', leftMargin + 355, headerY, { width: 70, align: 'right' });
  doc.text('%DTO.', leftMargin + 425, headerY, { width: 40, align: 'right' });
  doc.text('SUBTOTAL', leftMargin + 465, headerY, { width: 60, align: 'right' });
  doc.text('IVA', leftMargin + 525, headerY, { width: 40, align: 'right' });
  
  currentY += 22;
  doc.fillColor('#000');
  
  items.forEach((item, index) => {
    const subtotalItem = item.cantidad * item.precioUnitario * (1 - item.descuento / 100);
    const ivaItem = subtotalItem * (item.alicuotaIva / 100);
    const rowHeight = 18;
    
    if (index % 2 === 0) {
      doc.rect(leftMargin, currentY, pageWidth, rowHeight).fill('#F8F8F8');
      doc.fillColor('#000');
    }
    
    doc.fontSize(7).font('Helvetica');
    doc.text(sanitizeText(item.codigo), leftMargin + 5, currentY + 5, { width: 60 });
    doc.text(sanitizeText(item.descripcion), leftMargin + 70, currentY + 5, { width: 180 });
    doc.text(String(item.cantidad), leftMargin + 255, currentY + 5, { width: 50, align: 'center' });
    doc.text('U', leftMargin + 305, currentY + 5, { width: 50, align: 'center' });
    doc.text(`$${formatCurrency(item.precioUnitario)}`, leftMargin + 355, currentY + 5, { width: 65, align: 'right' });
    doc.text(`${item.descuento}%`, leftMargin + 425, currentY + 5, { width: 35, align: 'right' });
    doc.text(`$${formatCurrency(subtotalItem)}`, leftMargin + 465, currentY + 5, { width: 55, align: 'right' });
    doc.text(`${item.alicuotaIva}%`, leftMargin + 525, currentY + 5, { width: 35, align: 'right' });
    
    currentY += rowHeight;
  });
  
  currentY += 5;
  
  const totalsY = currentY;
  
  doc.moveTo(leftMargin + 400, currentY).lineTo(pageWidth - 5, currentY).stroke();
  currentY += 5;
  
  doc.fontSize(8).font('Helvetica');
  doc.text('Subtotal:', leftMargin + 400, currentY);
  doc.font('Helvetica-Bold').text(`$${formatCurrency(subtotalBruto)}`, leftMargin + 480, currentY, { width: 85, align: 'right' });
  currentY += 14;
  
  if (totalDescuentos > 0) {
    doc.font('Helvetica').text('Descuentos:', leftMargin + 400, currentY);
    doc.font('Helvetica-Bold').fillColor('#C00000').text(`-$${formatCurrency(totalDescuentos)}`, leftMargin + 480, currentY, { width: 85, align: 'right' });
    doc.fillColor('#000');
    currentY += 14;
  }
  
  if (invoice.tipo === 'A') {
    Object.entries(ivaPorAlicuota).forEach(([alicuota, iva]) => {
      if (iva > 0) {
        doc.font('Helvetica').text(`IVA ${alicuota}%:`, leftMargin + 400, currentY);
        doc.font('Helvetica-Bold').text(`$${formatCurrency(iva)}`, leftMargin + 480, currentY, { width: 85, align: 'right' });
        currentY += 14;
      }
    });
  }
  
  currentY += 5;
  doc.moveTo(leftMargin + 400, currentY).lineTo(pageWidth - 5, currentY).stroke();
  currentY += 5;
  
  doc.rect(leftMargin + 400, currentY, 170, 22).fillAndStroke('#333333', '#000');
  doc.fillColor('#FFF');
  doc.fontSize(9).font('Helvetica-Bold').text('TOTAL:', leftMargin + 410, currentY + 6);
  doc.fontSize(12).text(`$${formatCurrency(totalFinal)}`, leftMargin + 410, currentY + 8, { width: 150, align: 'right' });
  doc.fillColor('#000');
  
  currentY += 30;
  
  doc.fontSize(7).font('Helvetica');
  doc.text(`Moneda: ${moneda}  |  Condicion de Venta: ${condicionPago}`, leftMargin + 5, currentY);
  
  currentY += 20;
  
  doc.rect(leftMargin, currentY, pageWidth, 55).stroke();
  doc.fontSize(8).font('Helvetica-Bold').text('DATOS ADICIONALES', leftMargin + 10, currentY + 5);
  
  if (invoice.cae) {
    doc.fontSize(8).font('Helvetica-Bold').text('CAE:', leftMargin + 10, currentY + 20);
    doc.fontSize(10).text(sanitizeText(invoice.cae), leftMargin + 40, currentY + 18);
    
    doc.fontSize(8).text('Fecha Vto. CAE:', leftMargin + 200, currentY + 20);
    doc.fontSize(10).text(sanitizeText(invoice.caeDueDate) || '-', leftMargin + 280, currentY + 18);
    
    if (invoice.arcaResult) {
      const resultText = invoice.arcaResult === 'A' ? 'APROBADO' : 'RECHAZADO';
      const resultColor = invoice.arcaResult === 'A' ? '#008000' : '#C00000';
      doc.fontSize(8).text('Resultado:', leftMargin + 400, currentY + 20);
      doc.fontSize(10).fillColor(resultColor).text(resultText, leftMargin + 460, currentY + 18);
      doc.fillColor('#000');
    }
  }
  
  if (invoice.cae) {
    try {
      const qrData = {
        ver: 1,
        fecha: fechaEmision.split('/').reverse().join('-'),
        cuit: Number((sellerInfo?.taxId || invoice.seller?.taxId || '0').replace(/-/g, '')),
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
      doc.image(qrBuffer, pageWidth - 90, currentY - 5, { width: 75 });
    } catch (qrError) {
      console.error('Error generating QR:', qrError);
    }
  }
  
  currentY += 65;
  
  doc.fontSize(6).font('Helvetica').fillColor('#666666');
  doc.text('Documento generado por AgroSentinel - Sistema de Monitoreo IoT', leftMargin + 5, currentY, { width: pageWidth - 100, align: 'center' });
  doc.fillColor('#000');
  
  return doc;
}
