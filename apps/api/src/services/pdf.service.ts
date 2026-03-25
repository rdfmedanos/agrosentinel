import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export interface InvoiceItem {
  codigo: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  descuento: number;
  alicuotaIva: number;
  unidad?: string;
}

export interface InvoiceData {
  _id: string;
  tipo: string;
  ptoVta?: number | string;
  cbteNro?: number | null;
  puntoVenta?: number | string;
  numero?: number;
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
    province?: string;
    city?: string;
  };
  items?: InvoiceItem[];
  createdAt?: string | Date;
  arcaResult?: string;
}

function sanitizeText(text: string | undefined | null): string {
  if (!text) return '';
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
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${d}/${m}/${y}`;
}

function formatDateYMD(dateStr: string | Date | undefined): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
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
  C: { codigo: '011', nombre: 'FACTURA' },
  M: { codigo: '051', nombre: 'NOTA DE CREDITO' }
};

async function generateQRCode(data: object): Promise<Buffer> {
  const base64 = Buffer.from(JSON.stringify(data)).toString('base64');
  const url = `https://www.afip.gob.ar/fe/qr/?p=${base64}`;
  return await QRCode.toBuffer(url, { width: 70, margin: 1, errorCorrectionLevel: 'M' });
}

export async function generateInvoicePDF(invoice: InvoiceData, sellerInfo?: InvoiceData['seller']): Promise<PDFKit.PDFDocument> {
  const doc = new PDFDocument({ margin: 30, size: 'A4' });
  
  const pageWidth = doc.page.width - 60;
  const leftMargin = 30;
  
  const fechaEmision = invoice.fechaEmision || (invoice.createdAt ? formatDate(invoice.createdAt) : formatDate(new Date()));
  const fechaVencimiento = invoice.fechaVencimiento || formatDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
  const fechaVencimientoYMD = invoice.caeDueDate ? formatDateYMD(invoice.caeDueDate) : formatDateYMD(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
  const moneda = invoice.moneda || 'PES';
  const condicionPago = invoice.condicionPago || 'CONTADO';
  
  const ptoVta = String(invoice.puntoVenta || invoice.ptoVta || 1).padStart(4, '0');
  const cbteNro = String(invoice.cbteNro || invoice.numero || 0).padStart(8, '0');
  const invoiceNumber = `${ptoVta}-${cbteNro}`;
  
  const tipoData = tipoComprobanteMap[invoice.tipo] || { codigo: '006', nombre: 'FACTURA' };
  
  const items = invoice.items || [
    {
      codigo: 'SERV-001',
      descripcion: `Servicio de Monitoreo IoT - ${invoice.period || 'Periodo'}`,
      cantidad: 1,
      precioUnitario: invoice.amountArs,
      descuento: 0,
      alicuotaIva: invoice.tipo === 'A' ? 21 : 0,
      unidad: 'U'
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
  
  const seller = sellerInfo || invoice.seller;
  const cli = invoice.cliente;
  
  let currentY = 20;
  
  const leftBoxWidth = pageWidth - 170;
  const rightBoxWidth = 150;
  
  doc.rect(leftMargin, currentY, leftBoxWidth, 100).stroke();
  
  doc.fontSize(16).font('Helvetica-Bold');
  doc.text(sanitizeText(seller?.companyName || 'EMPRESA'), leftMargin + 10, currentY + 8, { width: 300 });
  
  doc.fontSize(8).font('Helvetica');
  if (seller?.taxId) {
    doc.text(`C.U.I.T.: ${sanitizeText(seller.taxId)}`, leftMargin + 10, currentY + 26);
  }
  if (seller?.ivaCondition) {
    doc.text(`Condicion frente al IVA: ${sanitizeText(seller.ivaCondition)}`, leftMargin + 10, currentY + 38);
  }
  const addressText = `${sanitizeText(seller?.address || '')}${seller?.city ? ', ' + seller.city : ''}${seller?.province ? ', ' + seller.province : ''}`;
  if (addressText.trim()) {
    doc.text(`Domicilio: ${addressText}`, leftMargin + 10, currentY + 50);
  }
  if (seller?.phone) {
    doc.text(`Tel: ${sanitizeText(seller.phone)}`, leftMargin + 10, currentY + 62);
  }
  if (seller?.ingresosBrutos) {
    doc.text(`Ingresos Brutos: ${sanitizeText(seller.ingresosBrutos)}`, leftMargin + 200, currentY + 26);
  }
  if (seller?.inicioActividades) {
    doc.text(`Inicio de Actividades: ${sanitizeText(seller.inicioActividades)}`, leftMargin + 200, currentY + 38);
  }
  
  doc.rect(leftMargin + leftBoxWidth, currentY, rightBoxWidth, 100).stroke();
  doc.fontSize(20).font('Helvetica-Bold').fillColor('#333');
  doc.text(`${tipoData.nombre} ${invoice.tipo}`, leftMargin + leftBoxWidth + 10, currentY + 12, { width: 130 });
  doc.fontSize(9).font('Helvetica').fillColor('#000');
  doc.text(`Punto de Venta: ${ptoVta}`, leftMargin + leftBoxWidth + 10, currentY + 42);
  doc.text(`Comp. Nro: ${cbteNro}`, leftMargin + leftBoxWidth + 10, currentY + 56);
  doc.text(`Fecha de Emision: ${fechaEmision}`, leftMargin + leftBoxWidth + 10, currentY + 70);
  
  currentY += 105;
  
  doc.rect(leftMargin, currentY, pageWidth, 70).stroke();
  
  const tipoDocCli = cli?.tipoDoc ? tipoDocMap[cli.tipoDoc] || String(cli.tipoDoc) : '-';
  const nroDocCli = cli?.nroDoc || '-';
  
  doc.fontSize(9).font('Helvetica-Bold').text('DATOS DEL COMPRADOR', leftMargin + 10, currentY + 8);
  
  doc.fontSize(9).font('Helvetica-Bold').text('Señor/A:', leftMargin + 10, currentY + 24);
  doc.fontSize(10).text(sanitizeText(cli?.nombre) || 'CONSUMIDOR FINAL', leftMargin + 70, currentY + 22);
  
  doc.fontSize(8).font('Helvetica');
  doc.text(`${tipoDocCli}: ${nroDocCli}`, leftMargin + 10, currentY + 38);
  
  doc.text(`Condicion frente al IVA: ${sanitizeText(cli?.condicionIva) || 'Consumidor Final'}`, leftMargin + 160, currentY + 24);
  
  if (cli?.direccion) {
    doc.text(`Domicilio: ${sanitizeText(cli.direccion)}`, leftMargin + 160, currentY + 38);
  }
  
  doc.text(`Fecha de Vto. Pago: ${fechaVencimiento}`, leftMargin + 10, currentY + 54);
  doc.text(`Condicion de Venta: ${condicionPago}`, leftMargin + 160, currentY + 54);
  
  currentY += 75;
  
  doc.rect(leftMargin, currentY, pageWidth, 20).fillAndStroke('#4472C4', '#2F5496');
  doc.fillColor('#FFF');
  doc.fontSize(8).font('Helvetica-Bold');
  const headerY = currentY + 6;
  doc.text('CODIGO', leftMargin + 5, headerY, { width: 65 });
  doc.text('DESCRIPCION', leftMargin + 75, headerY, { width: 170 });
  doc.text('CANTIDAD', leftMargin + 250, headerY, { width: 45, align: 'center' });
  doc.text('UNIDAD', leftMargin + 298, headerY, { width: 45, align: 'center' });
  doc.text('PRECIO UNIT.', leftMargin + 345, headerY, { width: 70, align: 'right' });
  doc.text('%DTO.', leftMargin + 415, headerY, { width: 40, align: 'right' });
  doc.text('SUBTOTAL', leftMargin + 455, headerY, { width: 60, align: 'right' });
  doc.text('IVA', leftMargin + 515, headerY, { width: 35, align: 'right' });
  
  currentY += 20;
  doc.fillColor('#000');
  
  items.forEach((item, index) => {
    const subtotalItem = item.cantidad * item.precioUnitario * (1 - item.descuento / 100);
    const ivaItem = subtotalItem * (item.alicuotaIva / 100);
    const rowHeight = 18;
    
    if (index % 2 === 0) {
      doc.rect(leftMargin, currentY, pageWidth, rowHeight).fill('#F5F5F5');
      doc.fillColor('#000');
    }
    
    doc.fontSize(7.5).font('Helvetica');
    doc.text(sanitizeText(item.codigo), leftMargin + 5, currentY + 5, { width: 65 });
    doc.text(sanitizeText(item.descripcion), leftMargin + 75, currentY + 5, { width: 170 });
    doc.text(String(item.cantidad), leftMargin + 250, currentY + 5, { width: 45, align: 'center' });
    doc.text(item.unidad || 'U', leftMargin + 298, currentY + 5, { width: 45, align: 'center' });
    doc.text(`$${formatCurrency(item.precioUnitario)}`, leftMargin + 345, currentY + 5, { width: 65, align: 'right' });
    doc.text(`${item.descuento}%`, leftMargin + 415, currentY + 5, { width: 35, align: 'right' });
    doc.text(`$${formatCurrency(subtotalItem)}`, leftMargin + 455, currentY + 5, { width: 55, align: 'right' });
    doc.text(`${item.alicuotaIva}%`, leftMargin + 515, currentY + 5, { width: 30, align: 'right' });
    
    currentY += rowHeight;
  });
  
  const tableEndY = currentY;
  doc.moveTo(leftMargin, tableEndY).lineTo(pageWidth, tableEndY).stroke();
  
  currentY += 8;
  
  const rightColX = pageWidth - 165;
  const rightColWidth = 160;
  
  doc.fontSize(8).font('Helvetica');
  doc.text('Subtotal:', rightColX, currentY);
  doc.font('Helvetica-Bold').text(`$${formatCurrency(subtotalBruto)}`, rightColX + 80, currentY, { width: 75, align: 'right' });
  currentY += 13;
  
  if (totalDescuentos > 0) {
    doc.font('Helvetica').text('Descuentos:', rightColX, currentY);
    doc.font('Helvetica-Bold').fillColor('#C00000').text(`-$${formatCurrency(totalDescuentos)}`, rightColX + 80, currentY, { width: 75, align: 'right' });
    doc.fillColor('#000');
    currentY += 13;
  }
  
  if (invoice.tipo === 'A') {
    Object.entries(ivaPorAlicuota).forEach(([alicuota, iva]) => {
      if (iva > 0) {
        doc.font('Helvetica').text(`IVA ${alicuota}%:`, rightColX, currentY);
        doc.font('Helvetica-Bold').text(`$${formatCurrency(iva)}`, rightColX + 80, currentY, { width: 75, align: 'right' });
        currentY += 13;
      }
    });
  }
  
  currentY += 3;
  doc.moveTo(rightColX, currentY).lineTo(pageWidth, currentY).stroke();
  currentY += 5;
  
  doc.rect(rightColX, currentY, rightColWidth, 25).fillAndStroke('#4472C4', '#2F5496');
  doc.fillColor('#FFF');
  doc.fontSize(10).font('Helvetica-Bold').text('IMPORTE TOTAL:', rightColX + 5, currentY + 5);
  doc.fontSize(13).text(`$${formatCurrency(totalFinal)}`, rightColX + 5, currentY + 8, { width: 145, align: 'right' });
  doc.fillColor('#000');
  
  currentY += 35;
  
  doc.rect(leftMargin, currentY, pageWidth, 55).stroke();
  
  doc.fontSize(8).font('Helvetica');
  doc.text(`Condicion de Venta: ${condicionPago}`, leftMargin + 10, currentY + 8);
  doc.text(`Moneda: ${moneda}`, leftMargin + 10, currentY + 22);
  doc.text(`Tipo de Cambio: 1,000`, leftMargin + 10, currentY + 36);
  if (invoice.period) {
    doc.text(`Periodo: ${invoice.period}`, leftMargin + 10, currentY + 50);
  }
  
  if (invoice.cae) {
    doc.fontSize(8).font('Helvetica-Bold').text('CAE:', leftMargin + 200, currentY + 8);
    doc.fontSize(11).text(sanitizeText(invoice.cae), leftMargin + 240, currentY + 6);
    
    doc.fontSize(8).text('Fecha de Vto. CAE:', leftMargin + 200, currentY + 22);
    doc.fontSize(10).text(invoice.caeDueDate ? formatDate(invoice.caeDueDate) : formatDate(fechaVencimientoYMD), leftMargin + 300, currentY + 20);
    
    try {
      const qrData = {
        ver: 1,
        fecha: formatDateYMD(fechaEmision),
        cuit: Number((seller?.taxId || '0').replace(/-/g, '')),
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
      doc.image(qrBuffer, pageWidth - 85, currentY + 5, { width: 60 });
    } catch (qrError) {
      console.error('Error generating QR:', qrError);
    }
  }
  
  currentY += 60;
  
  return doc;
}
