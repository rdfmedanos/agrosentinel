import PDFDocument from 'pdfkit';

interface InvoiceData {
  _id: string;
  tipo: string;
  cbteNro?: number | null;
  period: string;
  amountArs: number;
  cae?: string | null;
  caeDueDate?: string | null;
  arca?: { cae?: string; caeFchVto?: string } | null;
  cliente?: {
    nombre?: string;
    tipoDoc?: number;
    nroDoc?: string;
    condicionIva?: string;
  } | null;
  seller?: {
    companyName?: string;
    taxId?: string;
    address?: string;
    ivaCondition?: string;
  };
  createdAt?: string | Date;
}

const tipoDocMap: Record<number, string> = {
  80: 'CUIT',
  86: 'CUIL',
  96: 'DNI',
  99: 'Sin identificar'
};

const tipoComprobanteMap: Record<string, string> = {
  A: 'FACTURA A',
  B: 'FACTURA B',
  C: 'FACTURA C'
};

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

export function generateInvoicePDF(invoice: InvoiceData, sellerInfo?: {
  companyName: string;
  taxId: string;
  address: string;
  ivaCondition: string;
  phone?: string;
}): PDFKit.PDFDocument {
  const doc = new PDFDocument({ margin: 50 });
  const pageWidth = doc.page.width - 100;

  doc.fontSize(20).font('Helvetica-Bold').text('COMPROBANTE', 50, 50, { align: 'center' });
  doc.moveDown(0.5);

  const tipoCompleto = tipoComprobanteMap[invoice.tipo] || `FACTURA ${invoice.tipo}`;
  doc.fontSize(16).font('Helvetica-Bold').text(tipoCompleto, { align: 'center' });

  if (invoice.cbteNro) {
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica').text(`No. ${String(invoice.cbteNro).padStart(8, '0')}`, { align: 'center' });
  }

  doc.moveDown(1);

  doc.rect(50, doc.y, pageWidth, 120).stroke();
  let boxY = doc.y + 10;

  if (sellerInfo) {
    doc.fontSize(10).font('Helvetica-Bold').text('VENDEDOR:', 60, boxY);
    doc.font('Helvetica').text(sanitizeText(sellerInfo.companyName), 130, boxY);
    boxY += 15;

    doc.font('Helvetica-Bold').text('CUIT:', 60, boxY);
    doc.font('Helvetica').text(sanitizeText(sellerInfo.taxId), 130, boxY);
    boxY += 15;

    doc.font('Helvetica-Bold').text('Cond. IVA:', 60, boxY);
    doc.font('Helvetica').text(sanitizeText(sellerInfo.ivaCondition), 130, boxY);
    boxY += 15;

    doc.font('Helvetica-Bold').text('Direccion:', 60, boxY);
    doc.font('Helvetica').text(sanitizeText(sellerInfo.address), 130, boxY);
    boxY += 15;

    if (sellerInfo.phone) {
      doc.font('Helvetica-Bold').text('Telefono:', 60, boxY);
      doc.font('Helvetica').text(sanitizeText(sellerInfo.phone), 130, boxY);
    }
  }

  doc.y = boxY + 25;

  doc.rect(50, doc.y, pageWidth, 100).stroke();
  boxY = doc.y + 10;

  doc.fontSize(10).font('Helvetica-Bold').text('COMPRADOR:', 60, boxY);
  doc.font('Helvetica').text(sanitizeText(invoice.cliente?.nombre), 130, boxY);
  boxY += 15;

  const tipoDoc = invoice.cliente?.tipoDoc ? tipoDocMap[invoice.cliente.tipoDoc] || String(invoice.cliente.tipoDoc) : '-';
  doc.font('Helvetica-Bold').text('Doc:', 60, boxY);
  doc.font('Helvetica').text(`${tipoDoc} ${sanitizeText(invoice.cliente?.nroDoc)}`, 130, boxY);
  boxY += 15;

  doc.font('Helvetica-Bold').text('Cond. IVA:', 60, boxY);
  doc.font('Helvetica').text(sanitizeText(invoice.cliente?.condicionIva), 130, boxY);

  doc.y = boxY + 25;

  doc.moveDown(1);
  doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
  doc.moveDown(0.5);

  doc.fontSize(10).font('Helvetica-Bold').text('Fecha:', 50, doc.y);
  const fechaStr = invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString('es-AR') : new Date().toLocaleDateString('es-AR');
  doc.font('Helvetica').text(sanitizeText(fechaStr), 100, doc.y - 5);

  doc.font('Helvetica-Bold').text('Periodo:', 250, doc.y);
  doc.font('Helvetica').text(sanitizeText(invoice.period), 310, doc.y - 5);

  doc.moveDown(1.5);

  doc.rect(50, doc.y, pageWidth, 50).stroke();
  doc.fontSize(10).font('Helvetica-Bold');
  doc.text('DETALLE', 60, doc.y + 10);
  doc.text('IMPORTE', 400, doc.y + 10, { width: 100, align: 'right' });

  doc.y += 30;
  doc.font('Helvetica').text(`Servicio de monitoreo IoT - ${sanitizeText(invoice.period)}`, 60, doc.y);
  doc.text(`$${invoice.amountArs.toLocaleString('es-AR')}`, 400, doc.y, { width: 100, align: 'right' });

  doc.y += 20;

  doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
  doc.moveDown(0.5);

  doc.rect(300, doc.y, 250, 40).stroke();
  doc.fontSize(10).font('Helvetica-Bold').text('TOTAL:', 310, doc.y + 10);
  doc.fontSize(14).text(`$${invoice.amountArs.toLocaleString('es-AR')}`, 310, doc.y + 22);

  doc.moveDown(2);

  if (invoice.cae) {
    doc.fontSize(10).font('Helvetica-Bold').text('CAE:', 50, doc.y);
    doc.font('Helvetica').text(sanitizeText(invoice.cae), 90, doc.y);

    if (invoice.caeDueDate) {
      doc.font('Helvetica-Bold').text('Vto. CAE:', 250, doc.y);
      doc.font('Helvetica').text(sanitizeText(invoice.caeDueDate), 310, doc.y);
    }
  }

  doc.moveDown(2);
  doc.fontSize(8).font('Helvetica').fillColor('#666666');
  doc.text('Documento generado por AgroSentinel - Sistema de Monitoreo IoT', 50, doc.page.height - 50, { align: 'center' });

  return doc;
}
