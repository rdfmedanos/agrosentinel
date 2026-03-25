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
  return await QRCode.toBuffer(url, { width: 120, margin: 1, errorCorrectionLevel: 'M' });
}

export async function generateInvoicePDF(invoice: InvoiceData, sellerInfo?: InvoiceData['seller']): Promise<PDFKit.PDFDocument> {
  const doc = new PDFDocument({ margin: 30, size: 'A4' });
  
  const pageWidth = doc.page.width - 60;
  const leftMargin = 30;
  
  const fechaEmision = invoice.fechaEmision || (invoice.createdAt ? formatDate(invoice.createdAt) : formatDate(new Date()));
  const fechaEmisionYMD = invoice.createdAt ? formatDateYMD(invoice.createdAt) : formatDateYMD(new Date());
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
  const contentRight = leftMargin + pageWidth;
  
  const headerHeight = 120;
  const emisorWidth = 275;
  const tipoWidth = 80;
  const datosWidth = pageWidth - emisorWidth - tipoWidth;
  
  doc.rect(leftMargin, currentY, pageWidth, headerHeight).lineWidth(0.8).stroke('#444444');
  doc.rect(leftMargin, currentY, emisorWidth, headerHeight).lineWidth(0.5).stroke('#666666');
  doc.rect(leftMargin + emisorWidth, currentY, tipoWidth, headerHeight).lineWidth(0.5).stroke('#666666');
  doc.rect(leftMargin + emisorWidth + tipoWidth, currentY, datosWidth, headerHeight).lineWidth(0.5).stroke('#666666');
  
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#000000');
  doc.text(sanitizeText(seller?.companyName || 'EMPRESA'), leftMargin + 10, currentY + 8, { width: emisorWidth - 20 });
  
  doc.fontSize(8).font('Helvetica');
  const sellerLocation = `${sanitizeText(seller?.city || '')}${seller?.city && seller?.province ? ', ' : ''}${sanitizeText(seller?.province || '')}${(seller?.city || seller?.province) ? ', ' : ''}Argentina`;
  doc.text(`Razon Social: ${sanitizeText(seller?.companyName || 'EMPRESA')}`, leftMargin + 10, currentY + 30, { width: emisorWidth - 20 });
  doc.text(`Direccion: ${sanitizeText(seller?.address || '-')}`, leftMargin + 10, currentY + 43, { width: emisorWidth - 20 });
  doc.text(`Localidad: ${sellerLocation}`, leftMargin + 10, currentY + 56, { width: emisorWidth - 20 });
  doc.text(`CUIT: ${sanitizeText(seller?.taxId || '-')}`, leftMargin + 10, currentY + 69, { width: emisorWidth - 20 });
  doc.text(`Condicion IVA: ${sanitizeText(seller?.ivaCondition || '-')}`, leftMargin + 10, currentY + 82, { width: emisorWidth - 20 });
  if (seller?.phone) {
    doc.text(`Telefono: ${sanitizeText(seller.phone)}`, leftMargin + 10, currentY + 95, { width: emisorWidth - 20 });
  }
  
  const tipoX = leftMargin + emisorWidth;
  doc.fontSize(36).font('Helvetica-Bold').text(invoice.tipo || 'B', tipoX, currentY + 18, { width: tipoWidth, align: 'center' });
  doc.fontSize(8).font('Helvetica-Bold').text(`Cod. ${tipoData.codigo}`, tipoX, currentY + 58, { width: tipoWidth, align: 'center' });
  doc.fontSize(14).font('Helvetica-Bold').text('FACTURA', tipoX, currentY + 78, { width: tipoWidth, align: 'center' });
  
  const datosX = leftMargin + emisorWidth + tipoWidth + 10;
  doc.fontSize(9).font('Helvetica-Bold').text('Nro. Comprobante:', datosX, currentY + 20);
  doc.fontSize(10).text(invoiceNumber, datosX + 100, currentY + 20);
  doc.fontSize(9).font('Helvetica-Bold').text('Fecha:', datosX, currentY + 38);
  doc.fontSize(10).font('Helvetica').text(fechaEmision, datosX + 100, currentY + 38);
  doc.fontSize(9).font('Helvetica-Bold').text('CAE:', datosX, currentY + 56);
  doc.fontSize(10).font('Helvetica').text(sanitizeText(invoice.cae || '-'), datosX + 100, currentY + 56);
  doc.fontSize(9).font('Helvetica-Bold').text('Vto. CAE:', datosX, currentY + 74);
  doc.fontSize(10).font('Helvetica').text(invoice.caeDueDate ? formatDate(invoice.caeDueDate) : formatDate(fechaVencimientoYMD), datosX + 100, currentY + 74);
  
  currentY += headerHeight + 10;
  
  const tipoDocCli = cli?.tipoDoc ? tipoDocMap[cli.tipoDoc] || String(cli.tipoDoc) : 'CUIT';
  const nroDocCli = cli?.nroDoc || '-';
  const clientHeight = 70;
  
  doc.rect(leftMargin, currentY, pageWidth, clientHeight).lineWidth(0.8).stroke('#555555');
  doc.fontSize(9).font('Helvetica-Bold').text('DATOS DEL CLIENTE', leftMargin + 10, currentY + 8);
  doc.fontSize(8).font('Helvetica').text(`Razon Social: ${sanitizeText(cli?.nombre) || 'CONSUMIDOR FINAL'}`, leftMargin + 10, currentY + 24);
  doc.text(`${tipoDocCli}: ${nroDocCli}`, leftMargin + 10, currentY + 38);
  doc.text(`Condicion IVA: ${sanitizeText(cli?.condicionIva) || 'Consumidor Final'}`, leftMargin + 220, currentY + 24);
  doc.text(`Direccion: ${sanitizeText(cli?.direccion || '-')}`, leftMargin + 220, currentY + 38, { width: 300 });
  doc.text(`Condicion de Venta: ${condicionPago}`, leftMargin + 10, currentY + 52);
  doc.text(`Fecha de Vencimiento: ${fechaVencimiento}`, leftMargin + 220, currentY + 52);
  
  currentY += clientHeight + 10;
  
  const colCode = 55;
  const colDesc = 180;
  const colQty = 45;
  const colPrice = 85;
  const colDisc = 55;
  const colIva = 45;
  const colTotal = 70;
  const tableHeaderHeight = 20;
  const rowHeight = 19;
  
  doc.rect(leftMargin, currentY, pageWidth, tableHeaderHeight).fillAndStroke('#EFEFEF', '#777777');
  doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold');
  
  const xCode = leftMargin;
  const xDesc = xCode + colCode;
  const xQty = xDesc + colDesc;
  const xPrice = xQty + colQty;
  const xDisc = xPrice + colPrice;
  const xIva = xDisc + colDisc;
  const xTotal = xIva + colIva;
  
  doc.text('Codigo', xCode + 4, currentY + 6, { width: colCode - 8 });
  doc.text('Descripcion', xDesc + 4, currentY + 6, { width: colDesc - 8 });
  doc.text('Cantidad', xQty + 2, currentY + 6, { width: colQty - 4, align: 'right' });
  doc.text('Precio Unitario', xPrice + 2, currentY + 6, { width: colPrice - 4, align: 'right' });
  doc.text('Desc %', xDisc + 2, currentY + 6, { width: colDisc - 4, align: 'right' });
  doc.text('IVA', xIva + 2, currentY + 6, { width: colIva - 4, align: 'right' });
  doc.text('Total', xTotal + 2, currentY + 6, { width: colTotal - 4, align: 'right' });
  
  currentY += tableHeaderHeight;
  
  items.forEach((item, index) => {
    const netoItem = item.cantidad * item.precioUnitario * (1 - item.descuento / 100);
    const ivaItem = netoItem * (item.alicuotaIva / 100);
    const totalItem = netoItem + ivaItem;
    
    const bgColor = index % 2 === 0 ? '#FFFFFF' : '#FAFAFA';
    doc.rect(leftMargin, currentY, pageWidth, rowHeight).fillAndStroke(bgColor, '#DDDDDD');
    
    doc.fillColor('#000000').fontSize(8).font('Helvetica');
    doc.text(sanitizeText(item.codigo), xCode + 4, currentY + 6, { width: colCode - 8 });
    doc.text(sanitizeText(item.descripcion), xDesc + 4, currentY + 6, { width: colDesc - 8 });
    doc.text(String(item.cantidad), xQty + 2, currentY + 6, { width: colQty - 4, align: 'right' });
    doc.text(`$ ${formatCurrency(item.precioUnitario)}`, xPrice + 2, currentY + 6, { width: colPrice - 4, align: 'right' });
    doc.text(`${item.descuento.toFixed(2)}`, xDisc + 2, currentY + 6, { width: colDisc - 4, align: 'right' });
    doc.text(`${item.alicuotaIva.toFixed(2)}%`, xIva + 2, currentY + 6, { width: colIva - 4, align: 'right' });
    doc.text(`$ ${formatCurrency(totalItem)}`, xTotal + 2, currentY + 6, { width: colTotal - 4, align: 'right' });
    
    currentY += rowHeight;
  });
  
  const tableBottom = currentY;
  doc.lineWidth(0.6).strokeColor('#777777');
  doc.rect(leftMargin, tableBottom - (tableHeaderHeight + items.length * rowHeight), pageWidth, tableHeaderHeight + items.length * rowHeight).stroke();
  doc.moveTo(xDesc, tableBottom - (tableHeaderHeight + items.length * rowHeight)).lineTo(xDesc, tableBottom).stroke();
  doc.moveTo(xQty, tableBottom - (tableHeaderHeight + items.length * rowHeight)).lineTo(xQty, tableBottom).stroke();
  doc.moveTo(xPrice, tableBottom - (tableHeaderHeight + items.length * rowHeight)).lineTo(xPrice, tableBottom).stroke();
  doc.moveTo(xDisc, tableBottom - (tableHeaderHeight + items.length * rowHeight)).lineTo(xDisc, tableBottom).stroke();
  doc.moveTo(xIva, tableBottom - (tableHeaderHeight + items.length * rowHeight)).lineTo(xIva, tableBottom).stroke();
  doc.moveTo(xTotal, tableBottom - (tableHeaderHeight + items.length * rowHeight)).lineTo(xTotal, tableBottom).stroke();
  
  currentY += 12;
  
  const iva21 = ivaPorAlicuota[21] || 0;
  const totalsBoxWidth = 200;
  const totalsBoxHeight = 72;
  const totalsX = contentRight - totalsBoxWidth;
  
  doc.rect(totalsX, currentY, totalsBoxWidth, totalsBoxHeight).lineWidth(0.8).stroke('#555555');
  doc.fontSize(9).font('Helvetica').fillColor('#000000');
  doc.text('Subtotal', totalsX + 10, currentY + 10);
  doc.text(`$ ${formatCurrency(subtotalBruto)}`, totalsX + 95, currentY + 10, { width: 95, align: 'right' });
  doc.text('IVA (21%)', totalsX + 10, currentY + 28);
  doc.text(`$ ${formatCurrency(iva21)}`, totalsX + 95, currentY + 28, { width: 95, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(11);
  doc.text('TOTAL FINAL', totalsX + 10, currentY + 48);
  doc.text(`$ ${formatCurrency(totalFinal)}`, totalsX + 95, currentY + 47, { width: 95, align: 'right' });
  
  const qrAreaY = currentY + totalsBoxHeight + 14;
  const qrX = contentRight - 120;
  
  if (invoice.cae) {
    try {
      const qrData = {
        ver: 1,
        fecha: fechaEmisionYMD,
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
      doc.image(qrBuffer, qrX, qrAreaY, { width: 120 });
    } catch (qrError) {
      console.error('Error generating QR:', qrError);
      doc.rect(qrX, qrAreaY, 120, 120).lineWidth(0.5).stroke('#777777');
    }
  }
  
  doc.fontSize(8).font('Helvetica-Bold').text('Comprobante autorizado por AFIP', qrX - 25, qrAreaY + 125, { width: 170, align: 'center' });
  
  const footerY = doc.page.height - 42;
  doc.lineWidth(0.5).strokeColor('#BBBBBB').moveTo(leftMargin, footerY - 8).lineTo(contentRight, footerY - 8).stroke();
  doc.fontSize(7).font('Helvetica').fillColor('#444444');
  doc.text('Comprobante electronico autorizado por AFIP. Esta Administracion Federal no se responsabiliza por los datos ingresados en el detalle de la operacion.', leftMargin, footerY, { width: pageWidth, align: 'center' });
  
  return doc;
}
