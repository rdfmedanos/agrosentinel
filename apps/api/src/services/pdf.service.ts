import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const ARCA_LOGO_URL = 'https://neofactura.com.ar/uploads/logo-arca.jpg';
let arcaLogoCache: Promise<Buffer | null> | null = null;

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
  if (typeof dateStr === 'string') {
    const ymd = dateStr.trim();
    if (/^\d{8}$/.test(ymd)) {
      const y = ymd.slice(0, 4);
      const m = ymd.slice(4, 6);
      const d = ymd.slice(6, 8);
      return `${d}/${m}/${y}`;
    }
  }
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${d}/${m}/${y}`;
}

function formatDateYMD(dateStr: string | Date | undefined): string {
  if (!dateStr) return '';
  if (typeof dateStr === 'string') {
    const ymd = dateStr.trim();
    if (/^\d{8}$/.test(ymd)) {
      return ymd;
    }
  }
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
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

async function getArcaLogoBuffer(): Promise<Buffer | null> {
  if (!arcaLogoCache) {
    arcaLogoCache = (async () => {
      try {
        const response = await fetch(ARCA_LOGO_URL);
        if (!response.ok) return null;
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } catch {
        return null;
      }
    })();
  }
  return arcaLogoCache;
}

export async function generateInvoicePDF(invoice: InvoiceData, sellerInfo?: InvoiceData['seller']): Promise<PDFKit.PDFDocument> {
  const doc = new PDFDocument({ margin: 14, size: [841.89, 1190.55], layout: 'portrait' });

  const leftMargin = 14;
  const pageWidth = doc.page.width - leftMargin * 2;
  const contentRight = leftMargin + pageWidth;

  const fechaEmision = invoice.fechaEmision || (invoice.createdAt ? formatDate(invoice.createdAt) : formatDate(new Date()));
  const fechaEmisionIso = `${fechaEmision.split('/')[2]}-${fechaEmision.split('/')[1]}-${fechaEmision.split('/')[0]}`;
  const fechaVencimiento = invoice.fechaVencimiento || formatDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
  const fechaVencimientoCAE = invoice.caeDueDate ? formatDate(invoice.caeDueDate) : fechaVencimiento;
  const moneda = invoice.moneda || 'ARS';
  const condicionPago = invoice.condicionPago || 'Pago inmediato';

  const ptoVta = String(invoice.puntoVenta || invoice.ptoVta || 1).padStart(5, '0');
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

  const subtotalNeto = items.reduce((sum, item) => {
    const base = item.cantidad * item.precioUnitario;
    return sum + base * (1 - item.descuento / 100);
  }, 0);

  const ivaPorAlicuota: Record<number, number> = {};
  items.forEach((item) => {
    const neto = item.cantidad * item.precioUnitario * (1 - item.descuento / 100);
    const iva = neto * (item.alicuotaIva / 100);
    ivaPorAlicuota[item.alicuotaIva] = (ivaPorAlicuota[item.alicuotaIva] || 0) + iva;
  });

  const totalIva = Object.values(ivaPorAlicuota).reduce((sum, iva) => sum + iva, 0);
  const totalFinal = subtotalNeto + totalIva;

  const seller = sellerInfo || invoice.seller;
  const cli = invoice.cliente;
  const tipoDocCli = cli?.tipoDoc ? tipoDocMap[cli.tipoDoc] || String(cli.tipoDoc) : 'CUIT';
  const nroDocCli = cli?.nroDoc || '-';

  let y = 14;

  doc.roundedRect(leftMargin, y, pageWidth, 72, 8).lineWidth(0.9).stroke('#444444');
  const centerColW = 90;
  const centerX = leftMargin + (pageWidth - centerColW) / 2;
  const leftColW = centerX - leftMargin;
  const rightX = centerX + centerColW;
  const rightColW = contentRight - rightX;

  doc.font('Helvetica-Bold').fontSize(11).fillColor('#444444');
  doc.text(sanitizeText(seller?.companyName || 'AgroSentinel'), leftMargin + 12, y + 16, { width: leftColW - 24 });
  const inscriptionW = 74;
  const inscriptionX = centerX - inscriptionW - 8;
  doc.font('Helvetica').fontSize(8);
  doc.text('Comprobante', inscriptionX, y + 16, { width: inscriptionW, align: 'center' });
  doc.text('electronico', inscriptionX, y + 30, { width: inscriptionW, align: 'center' });

  doc.rect(centerX, y, centerColW, 58).lineWidth(0.3).stroke('#DDDDDD');
  const tipoLetra = invoice.tipo || 'A';
  doc.font('Helvetica-Bold').fontSize(48).fillColor('#111111');
  const letraW = doc.widthOfString(tipoLetra);
  const letraH = doc.currentLineHeight();
  const letraX = centerX + (centerColW - letraW) / 2;
  const letraY = y + (58 - letraH) / 2;
  doc.text(tipoLetra, letraX, letraY, { lineBreak: false });
  doc.font('Helvetica').fontSize(10).fillColor('#222222');
  doc.text(`cod. ${tipoData.codigo === '001' ? '1' : tipoData.codigo}`, centerX, y + 56, { width: centerColW, align: 'center' });

  doc.font('Helvetica-Bold').fontSize(17).text(`${tipoData.nombre}S ${invoice.tipo || 'A'}`, rightX + 12, y + 3, { width: rightColW - 24 });
  doc.font('Helvetica').fontSize(9);
  doc.text(`Fecha: ${fechaEmision}`, rightX + 12, y + 28, { width: rightColW - 24 });
  doc.text(`FA-${invoice.tipo || 'A'} ${invoiceNumber}`, rightX + 12, y + 45, { width: rightColW - 24 });
  doc.fontSize(7).text(`Tipo de Documento ${tipoData.nombre}S ${invoice.tipo || 'A'}`, rightX + 12, y + 60, { width: rightColW - 24 });

  y += 82;
  doc.roundedRect(leftMargin, y, pageWidth, 20, 8).lineWidth(0.8).stroke('#444444');
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111');
  doc.text('Fecha Vto:', leftMargin + 10, y + 5);
  doc.font('Helvetica').text(fechaVencimiento, leftMargin + 65, y + 5);

  y += 32;
  doc.roundedRect(leftMargin, y, pageWidth, 110, 8).lineWidth(0.8).stroke('#444444');
  doc.font('Helvetica-Bold').fontSize(14).text(sanitizeText(seller?.companyName || 'AgroSentinel'), leftMargin + 12, y + 10);
  doc.font('Helvetica').fontSize(11);
  doc.text(sanitizeText(seller?.companyName || 'AgroSentinel'), leftMargin + 12, y + 32);
  doc.text(sanitizeText(seller?.address || '-'), leftMargin + 12, y + 54);
  doc.text(`${sanitizeText(seller?.city || '')} ${sanitizeText(seller?.province || '')}`.trim() || '-', leftMargin + 12, y + 76);
  doc.text('Argentina', leftMargin + 12, y + 98);

  const rightInfoX = leftMargin + 390;
  doc.font('Helvetica-Bold').fontSize(12);
  doc.text('CUIT', rightInfoX, y + 32);
  doc.font('Helvetica').text(`${sanitizeText(seller?.taxId || '-')} - ${sanitizeText(seller?.ivaCondition || '-')}`, rightInfoX + 34, y + 32);
  doc.font('Helvetica-Bold').text('Ingresos Brutos:', rightInfoX, y + 63);
  doc.font('Helvetica').text(sanitizeText(seller?.ingresosBrutos || sanitizeText(seller?.taxId || '-')), rightInfoX + 95, y + 63);
  doc.font('Helvetica-Bold').text('Inicio de actividades:', rightInfoX, y + 84);
  doc.font('Helvetica').text(sanitizeText(seller?.inicioActividades || '-'), rightInfoX + 118, y + 84);

  y += 124;
  doc.roundedRect(leftMargin, y, pageWidth, 95, 8).lineWidth(0.8).stroke('#444444');
  doc.font('Helvetica-Bold').fontSize(12).text('Cliente', leftMargin + 12, y + 10);
  doc.font('Helvetica').fontSize(12).text(sanitizeText(cli?.nombre) || 'CONSUMIDOR FINAL', leftMargin + 165, y + 10);
  doc.text(sanitizeText(cli?.direccion || '-'), leftMargin + 165, y + 34);
  doc.text('Argentina', leftMargin + 165, y + 58);
  doc.font('Helvetica-Bold').text(`${tipoDocCli}:`, leftMargin + 420, y + 10);
  doc.font('Helvetica').text(nroDocCli, leftMargin + 460, y + 10);
  doc.font('Helvetica-Bold').text('Condicion de IVA', leftMargin + 420, y + 34);
  doc.font('Helvetica').text(sanitizeText(cli?.condicionIva) || 'Consumidor Final', leftMargin + 525, y + 34);

  y += 120;
  doc.font('Helvetica-Bold').fontSize(11).text('Moneda:', leftMargin + 12, y);
  doc.font('Helvetica').text(moneda, leftMargin + 12, y + 20);

  y += 44;
  const colCode = 70;
  const colDesc = 190;
  const colDoc = 120;
  const colQty = 70;
  const colUnit = 95;
  const colDisc = 70;
  const colIva = 85;
  const colTotal = pageWidth - (colCode + colDesc + colDoc + colQty + colUnit + colDisc + colIva);

  const xCode = leftMargin;
  const xDesc = xCode + colCode;
  const xDoc = xDesc + colDesc;
  const xQty = xDoc + colDoc;
  const xUnit = xQty + colQty;
  const xDisc = xUnit + colUnit;
  const xIva = xDisc + colDisc;
  const xTotal = xIva + colIva;

  doc.lineWidth(0.6).strokeColor('#B5BDC6').moveTo(leftMargin, y).lineTo(contentRight, y).stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#1B1F23');
  doc.text('Codigo', xCode + 10, y + 12, { width: colCode - 20 });
  doc.text('Descripcion', xDesc + 8, y + 12, { width: colDesc - 16 });
  doc.text('Documento Origen', xDoc + 8, y + 12, { width: colDoc - 16 });
  doc.text('Cantidad', xQty + 6, y + 12, { width: colQty - 12, align: 'right' });
  doc.text('Precio Unitario', xUnit + 6, y + 12, { width: colUnit - 12, align: 'right' });
  doc.text('Desc.(%)', xDisc + 6, y + 12, { width: colDisc - 12, align: 'right' });
  doc.text('Alicuota IVA', xIva + 6, y + 12, { width: colIva - 12, align: 'right' });
  doc.text('Monto Final', xTotal + 6, y + 12, { width: colTotal - 12, align: 'right' });
  doc.lineWidth(0.6).strokeColor('#B5BDC6').moveTo(leftMargin, y + 34).lineTo(contentRight, y + 34).stroke();

  y += 42;
  items.forEach((item) => {
    const neto = item.cantidad * item.precioUnitario * (1 - item.descuento / 100);
    const iva = neto * (item.alicuotaIva / 100);
    const totalItem = neto + iva;
    doc.font('Helvetica').fontSize(10).fillColor('#1B1F23');
    doc.text(sanitizeText(item.codigo), xCode + 8, y, { width: colCode - 16 });
    doc.text(sanitizeText(item.descripcion), xDesc + 8, y, { width: colDesc - 16 });
    doc.text('', xDoc + 8, y, { width: colDoc - 16 });
    doc.text(item.cantidad.toFixed(2), xQty + 6, y, { width: colQty - 12, align: 'right' });
    doc.text(formatCurrency(item.precioUnitario), xUnit + 6, y, { width: colUnit - 12, align: 'right' });
    doc.text(item.descuento.toFixed(2), xDisc + 6, y, { width: colDisc - 12, align: 'right' });
    doc.text(`IVA ${item.alicuotaIva.toFixed(0)}%`, xIva + 6, y, { width: colIva - 12, align: 'right' });
    doc.text(`$ ${formatCurrency(totalItem)}`, xTotal + 6, y, { width: colTotal - 12, align: 'right' });
    y += 26;
  });

  const totalsX = contentRight - 245;
  const totalsW = 235;
  const iva21 = ivaPorAlicuota[21] || 0;

  doc.lineWidth(0.9).strokeColor('#111111').moveTo(totalsX, y + 8).lineTo(contentRight - 8, y + 8).stroke();
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#222222');
  doc.text('Subtotal', totalsX + 8, y + 24);
  doc.text(`$ ${formatCurrency(subtotalNeto)}`, totalsX + 120, y + 24, { width: totalsW - 130, align: 'right' });

  doc.lineWidth(0.6).strokeColor('#D2D8DE').moveTo(totalsX + 8, y + 50).lineTo(contentRight - 8, y + 50).stroke();
  doc.font('Helvetica-Bold').fontSize(11).text('Impuesto', totalsX + 8, y + 62);
  doc.text('Base', totalsX + 105, y + 62, { width: 50, align: 'right' });
  doc.text('Monto', totalsX + 165, y + 62, { width: 55, align: 'right' });
  doc.lineWidth(0.6).strokeColor('#D2D8DE').moveTo(totalsX + 8, y + 84).lineTo(contentRight - 8, y + 84).stroke();
  doc.font('Helvetica').fontSize(11);
  doc.text('IVA 21%', totalsX + 8, y + 96);
  doc.text(`$ ${formatCurrency(subtotalNeto)}`, totalsX + 84, y + 96, { width: 74, align: 'right' });
  doc.text(`$ ${formatCurrency(iva21)}`, totalsX + 160, y + 96, { width: 60, align: 'right' });

  doc.lineWidth(0.9).strokeColor('#111111').moveTo(totalsX, y + 130).lineTo(contentRight - 8, y + 130).stroke();
  doc.font('Helvetica-Bold').fontSize(13).text('Total', totalsX + 8, y + 144);
  doc.text(`$ ${formatCurrency(totalFinal)}`, totalsX + 120, y + 144, { width: totalsW - 130, align: 'right' });

  doc.font('Helvetica').fontSize(11).fillColor('#222222').text(`Plazo de pago: ${condicionPago}`, leftMargin + 10, y + 208);

  const footerY = doc.page.height - 225;
  const footerH = 210;
  const qrSize = 120;
  const qrX = leftMargin + 14;
  const qrY = footerY + 14;

  doc.rect(leftMargin, footerY, pageWidth, footerH).lineWidth(0.8).stroke('#444444');

  if (invoice.cae) {
    try {
      const qrData = {
        ver: 1,
        fecha: fechaEmisionIso,
        cuit: Number((seller?.taxId || '0').replace(/-/g, '')),
        ptoVta: Number(ptoVta),
        tipoCmp: Number(tipoData.codigo),
        nroCmp: Number(cbteNro),
        importe: totalFinal,
        moneda,
        ctz: 1,
        tipoDocRec: Number(cli?.tipoDoc || 99),
        nroDocRec: Number((cli?.nroDoc || '0').replace(/-/g, '')),
        tipoCodAut: 'E',
        codAuth: Number(invoice.cae)
      };

      const qrBuffer = await generateQRCode(qrData);
      doc.image(qrBuffer, qrX, qrY, { width: qrSize });
    } catch (qrError) {
      console.error('Error generating QR:', qrError);
      doc.rect(qrX, qrY, qrSize, qrSize).stroke('#777777');
    }
  }

  const logoSize = Math.floor(qrSize / 2);
  const logoBuffer = await getArcaLogoBuffer();
  const leftLabelY = qrY + qrSize + 8;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#111111').text('Codigo QR ARCA', qrX, leftLabelY, { width: qrSize, align: 'center' });

  const footerTextX = qrX + qrSize + 26;
  const footerTextW = contentRight - footerTextX - 12;
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111111');
  doc.text(`CAE: ${sanitizeText(invoice.cae || '-')}`, footerTextX, footerY + 30, { width: footerTextW, align: 'right' });
  doc.text(`Fecha Vencimiento CAE: ${fechaVencimientoCAE || '-'}`, footerTextX, footerY + 56, { width: footerTextW, align: 'right' });

  const qrLegendX = footerTextX;
  const qrLegendW = Math.max(220, Math.min(340, footerTextW));
  const qrLegendY = footerY + 94;
  const rightLogoX = qrLegendX;
  const rightLogoY = qrLegendY - logoSize - 6;
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, rightLogoX, rightLogoY, { fit: [logoSize, logoSize] });
    } catch {
      // no-op if logo can't be rendered
    }
  }
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#111111');
  doc.text('Comprobante Autorizado', qrLegendX, qrLegendY, { width: qrLegendW, align: 'left' });
  doc.font('Helvetica').fontSize(7).fillColor('#333333');
  doc.text('Comprobante electronico autorizado por AFIP. Esta Administracion Federal no se responsabiliza por los datos ingresados en el detalle de la operacion.', qrLegendX, qrLegendY + 18, { width: qrLegendW, align: 'left' });

  return doc;
}
