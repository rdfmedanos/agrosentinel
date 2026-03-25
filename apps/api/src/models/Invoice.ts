import { Schema, model } from 'mongoose';
import type { ArcaEnvironment } from '../config/env.js';

const invoiceSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    period: { type: String, required: true },
    amountArs: { type: Number, required: true },
    status: { type: String, enum: ['draft', 'issued', 'paid'], default: 'issued' },
    
    // Tipo de comprobante: A, B, C, M
    tipo: { type: String, enum: ['A', 'B', 'C', 'M'], required: true },
    puntoVenta: { type: Number, required: true },
    numero: { type: Number, required: true },
    
    // Entorno donde se generó
    environment: { 
      type: String, 
      enum: ['mock', 'homologacion', 'produccion'] as ArcaEnvironment[],
      required: true 
    },
    
    // Cliente
    cliente: {
      tipoDoc: { type: Number, enum: [80, 96, 99], required: true },
      nroDoc: { type: String, required: true },
      nombre: { type: String, required: true },
      condicionIva: { type: String, required: true },
      direccion: { type: String, default: '' }
    },
    
    // ARCA Response
    cae: { type: String },
    caeDueDate: { type: String },
    cbteNro: { type: Number },
    cbteTipo: { type: Number, default: 6 },
    arcaResult: { type: String, default: 'A' },
    arcaErrors: { type: [Object], default: [] },
    
    // XMLs para auditoría
    xmlRequest: { type: String },
    xmlResponse: { type: String },
    
    // PDF
    pdfPath: { type: String },
    
    // Estado
    estado: { 
      type: String, 
      enum: ['borrador', 'pendiente', 'autorizado', 'rechazado', 'anulado'],
      default: 'pendiente' 
    }
  },
  { timestamps: true }
);

invoiceSchema.index({ tenantId: 1, period: 1 }, { unique: true });
invoiceSchema.index({ tenantId: 1, tipo: 1, puntoVenta: 1, numero: 1 }, { unique: true });

export const InvoiceModel = model('Invoice', invoiceSchema);
