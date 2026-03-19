import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { io } from 'socket.io-client';
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';

type Device = {
  _id: string;
  deviceId: string;
  name: string;
  levelPct: number;
  reserveLiters: number;
  pumpOn: boolean;
  status: 'online' | 'warning' | 'critical' | 'offline';
  location: { lat: number; lng: number; address: string };
  lastHeartbeatAt?: string;
};

type Alert = {
  _id: string;
  deviceId: string;
  message: string;
  type: 'offline' | 'critical_level';
  status: 'open' | 'resolved';
};

type WorkOrder = {
  _id: string;
  deviceId: string;
  title: string;
  status: 'open' | 'in_progress' | 'closed';
  description: string;
};

type Invoice = {
  _id: string;
  period: string;
  amountArs: number;
  status: 'draft' | 'issued' | 'paid';
  arca?: { cae?: string; cbteNro?: number };
};

type Plan = {
  _id: string;
  name: string;
  monthlyPriceArs: number;
  maxDevices: number;
};

type ArcaConfig = {
  enabled: boolean;
  mock: boolean;
  cuit: string;
  ptoVta: string;
  wsfeUrl: string;
  token?: string;
  sign?: string;
};

const API_URL = import.meta.env.VITE_API_URL ?? '/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? window.location.origin;
const DEFAULT_TENANT_ID = 'demo-tenant';

const highlights = [
  {
    title: 'Sensores en tiempo real',
    description: 'Nivel, reserva y estado de bomba con latencia minima desde cada punto de agua.'
  },
  {
    title: 'Alertas accionables',
    description: 'Deteccion de criticidad y desconexion con reglas operativas y ordenes de trabajo automaticas.'
  },
  {
    title: 'Facturacion preparada',
    description: 'Estructura ARCA lista para operar por tenant sin romper la simpleza del flujo diario.'
  }
];

const flow = [
  'ESP32 transmite heartbeat y telemetria por MQTT.',
  'La API clasifica riesgo, dispara alertas y sincroniza panel.',
  'Operaciones responde con comandos remotos y trazabilidad completa.'
];

const metrics = [
  { label: 'Disponibilidad supervisada', value: '24/7' },
  { label: 'Tiempo de deteccion', value: '< 60 s' },
  { label: 'Contexto por evento', value: '100 %' }
];

const emptyArcaConfig: ArcaConfig = {
  enabled: false,
  mock: true,
  cuit: '',
  ptoVta: '1',
  wsfeUrl: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  token: '',
  sign: ''
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error('API request failed');
  return res.json();
}

async function putJson(path: string, body: unknown) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('API request failed');
}

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('API request failed');
}

function markerColor(status: Device['status']) {
  if (status === 'critical' || status === 'offline') return '#e11d48';
  if (status === 'warning') return '#f59e0b';
  return '#22c55e';
}

function LandingPage() {
  return (
    <main className="landing">
      <div className="atmosphere atmosphere-a" />
      <div className="atmosphere atmosphere-b" />
      <div className="grain" />

      <header className="topbar reveal" style={{ '--delay': '80ms' } as CSSProperties}>
        <span className="brand">AgroSentinel</span>
        <nav>
          <a href="#vision">Vision</a>
          <a href="#flujo">Flujo</a>
          <a href="#impacto">Impacto</a>
          <a href="/panel-cliente">Panel cliente</a>
          <a href="/admin-empresa">Admin empresa</a>
        </nav>
      </header>

      <section className="hero" id="vision">
        <p className="eyebrow reveal" style={{ '--delay': '160ms' } as CSSProperties}>
          Plataforma IoT para aguadas rurales
        </p>
        <h1 className="reveal" style={{ '--delay': '240ms' } as CSSProperties}>
          Control operativo de agua rural con precision visual y respuesta inmediata.
        </h1>
        <p className="lead reveal" style={{ '--delay': '330ms' } as CSSProperties}>
          Disenada para establecimientos que no pueden esperar al siguiente recorrido: cada tanque respira en pantalla,
          cada desvio activa un plan y cada decision queda respaldada por datos.
        </p>

        <div className="hero-actions reveal" style={{ '--delay': '420ms' } as CSSProperties}>
          <a className="btn btn-primary" href="#impacto">
            Ver impacto
          </a>
          <a className="btn btn-ghost" href="#flujo">
            Explorar flujo tecnico
          </a>
          <a className="btn btn-ghost" href="/panel-cliente">
            Ingresar al panel cliente
          </a>
          <a className="btn btn-ghost" href="/admin-empresa">
            Ir a admin empresa
          </a>
        </div>

        <article className="signal-panel reveal" style={{ '--delay': '520ms' } as CSSProperties}>
          <h2>Lectura instantanea de campo</h2>
          <div className="signal-grid">
            {metrics.map(metric => (
              <div key={metric.label} className="signal-item">
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
          <p>Arquitectura modular para escalar sensores, tecnicos y sedes sin perder claridad operativa.</p>
        </article>
      </section>

      <section className="highlight-grid" id="impacto">
        {highlights.map((item, index) => (
          <article
            key={item.title}
            className="highlight-card reveal"
            style={{ '--delay': `${560 + index * 110}ms` } as CSSProperties}
          >
            <h3>{item.title}</h3>
            <p>{item.description}</p>
          </article>
        ))}
      </section>

      <section className="flow" id="flujo">
        <div className="flow-intro reveal" style={{ '--delay': '210ms' } as CSSProperties}>
          <p className="eyebrow">Flujo diagonal</p>
          <h2>Del campo a la decision en tres movimientos precisos.</h2>
        </div>

        <div className="flow-steps">
          {flow.map((step, index) => (
            <article
              key={step}
              className="flow-step reveal"
              style={{ '--delay': `${300 + index * 120}ms` } as CSSProperties}
            >
              <span>0{index + 1}</span>
              <p>{step}</p>
            </article>
          ))}
        </div>

        <aside className="orbital-card reveal" style={{ '--delay': '640ms' } as CSSProperties}>
          <h3>Capas de visibilidad</h3>
          <ul>
            <li>Telemetria historica para trazabilidad de incidentes.</li>
            <li>Alertas y ordenes conectadas al contexto del dispositivo.</li>
            <li>Facturacion mensual integrada al ciclo operativo.</li>
          </ul>
        </aside>
      </section>

      <section className="closing reveal" style={{ '--delay': '220ms' } as CSSProperties}>
        <p>
          AgroSentinel no muestra solo estados: traduce senales rurales en decisiones concretas para que la continuidad
          del agua deje de depender del azar.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary" href="mailto:rdfmedanos@yahoo.com.ar">
            Solicitar implementacion
          </a>
          <a className="btn btn-ghost" href="/panel-cliente">
            Acceso panel cliente
          </a>
          <a className="btn btn-ghost" href="/admin-empresa">
            Acceso admin empresa
          </a>
        </div>
      </section>
    </main>
  );
}

function ClientPanel() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [arcaConfig, setArcaConfig] = useState<ArcaConfig>(emptyArcaConfig);
  const [savingArca, setSavingArca] = useState(false);

  const stats = useMemo(() => {
    const online = devices.filter(d => d.status === 'online').length;
    const critical = devices.filter(d => d.status === 'critical' || d.status === 'offline').length;
    return { total: devices.length, online, critical, alerts: alerts.filter(a => a.status === 'open').length };
  }, [devices, alerts]);

  const loadAll = async () => {
    const [d, a, o, i] = await Promise.all([
      getJson<Device[]>(`/devices?tenantId=${DEFAULT_TENANT_ID}`),
      getJson<Alert[]>(`/alerts?tenantId=${DEFAULT_TENANT_ID}`),
      getJson<WorkOrder[]>(`/work-orders?tenantId=${DEFAULT_TENANT_ID}`),
      getJson<Invoice[]>(`/billing/invoices?tenantId=${DEFAULT_TENANT_ID}`)
    ]);
    setDevices(d);
    setAlerts(a);
    setOrders(o);
    setInvoices(i);

    const arca = await getJson<ArcaConfig>(`/billing/arca-config?tenantId=${DEFAULT_TENANT_ID}`);
    setArcaConfig(arca);
  };

  useEffect(() => {
    void loadAll();
    const socket = io(SOCKET_URL);
    socket.emit('tenant:join', DEFAULT_TENANT_ID);
    socket.on('devices:updated', () => void loadAll());
    socket.on('alerts:updated', () => void loadAll());
    socket.on('work-orders:updated', () => void loadAll());
    socket.on('telemetry:new', () => void loadAll());
    return () => {
      socket.disconnect();
    };
  }, []);

  const pumpCommand = async (deviceId: string, cmd: 'pump_on' | 'pump_off') => {
    await postJson(`/devices/${deviceId}/command`, { cmd });
  };

  const closeOrder = async (id: string) => {
    await fetch(`${API_URL}/work-orders/${id}/close`, { method: 'PATCH' });
    await loadAll();
  };

  const saveArcaConfig = async () => {
    setSavingArca(true);
    try {
      await putJson(`/billing/arca-config?tenantId=${DEFAULT_TENANT_ID}`, arcaConfig);
      await loadAll();
    } finally {
      setSavingArca(false);
    }
  };

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <p className="admin-kicker">Panel cliente</p>
          <h1>Operacion AgroSentinel</h1>
        </div>
        <a className="admin-link" href="/">
          Ver landing
        </a>
        <a className="admin-link" href="/admin-empresa">
          Ir a admin empresa
        </a>
      </header>

      <section className="admin-cards-grid">
        <div className="admin-card">
          <h3>Dispositivos</h3>
          <strong>{stats.total}</strong>
        </div>
        <div className="admin-card">
          <h3>Online</h3>
          <strong>{stats.online}</strong>
        </div>
        <div className="admin-card">
          <h3>Criticos</h3>
          <strong>{stats.critical}</strong>
        </div>
        <div className="admin-card">
          <h3>Alertas abiertas</h3>
          <strong>{stats.alerts}</strong>
        </div>
      </section>

      <section className="admin-panel">
        <h2>Dispositivos</h2>
        <div className="admin-devices-grid">
          {devices.map(d => (
            <article key={d._id} className="admin-device-card">
              <div className="admin-row-between">
                <h3>{d.name}</h3>
                <span className={`admin-badge ${d.status}`}>{d.status}</span>
              </div>
              <p>ID: {d.deviceId}</p>
              <p>Nivel: {d.levelPct}%</p>
              <p>Reserva: {d.reserveLiters} L</p>
              <p>Bomba: {d.pumpOn ? 'Encendida' : 'Apagada'}</p>
              <div className="admin-actions">
                <button onClick={() => void pumpCommand(d.deviceId, 'pump_on')}>Encender bomba</button>
                <button className="admin-secondary" onClick={() => void pumpCommand(d.deviceId, 'pump_off')}>
                  Apagar bomba
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-panel">
        <h2>Mapa de dispositivos</h2>
        <MapContainer center={[-34.62, -58.43]} zoom={10} style={{ height: '340px', borderRadius: '16px' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {devices.map(d => (
            <CircleMarker
              key={d._id}
              center={[d.location.lat, d.location.lng]}
              radius={11}
              pathOptions={{ color: markerColor(d.status), fillOpacity: 0.8 }}
            >
              <Popup>
                <strong>{d.name}</strong>
                <br />
                Estado: {d.status}
                <br />
                Nivel: {d.levelPct}%
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </section>

      <section className="admin-grid-2">
        <div className="admin-panel">
          <h2>Alertas</h2>
          {alerts.map(a => (
            <div className="admin-list-item" key={a._id}>
              <strong>{a.deviceId}</strong>
              <span>{a.message}</span>
              <span className={`admin-badge ${a.status === 'open' ? 'critical' : 'online'}`}>{a.status}</span>
            </div>
          ))}
        </div>

        <div className="admin-panel">
          <h2>Ordenes de trabajo</h2>
          {orders.map(o => (
            <div className="admin-list-item" key={o._id}>
              <strong>{o.title}</strong>
              <span>{o.description}</span>
              <div className="admin-row-between">
                <span
                  className={`admin-badge ${o.status === 'closed' ? 'online' : o.status === 'in_progress' ? 'warning' : 'critical'}`}
                >
                  {o.status}
                </span>
                {o.status !== 'closed' && <button onClick={() => void closeOrder(o._id)}>Cerrar</button>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-panel">
        <h2>Facturacion (ARCA)</h2>
        <div className="admin-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Periodo</th>
                <th>Monto</th>
                <th>Estado</th>
                <th>CAE</th>
                <th>Comprobante</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv._id}>
                  <td>{inv.period}</td>
                  <td>${inv.amountArs.toLocaleString('es-AR')}</td>
                  <td>{inv.status}</td>
                  <td>{inv.arca?.cae ?? '-'}</td>
                  <td>{inv.arca?.cbteNro ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-panel">
        <h2>Configuracion ARCA</h2>
        <div className="admin-form-grid">
          <label>
            <span>Habilitar ARCA</span>
            <select
              value={arcaConfig.enabled ? 'yes' : 'no'}
              onChange={e => setArcaConfig(prev => ({ ...prev, enabled: e.target.value === 'yes' }))}
            >
              <option value="no">No</option>
              <option value="yes">Si</option>
            </select>
          </label>

          <label>
            <span>Modo mock</span>
            <select
              value={arcaConfig.mock ? 'yes' : 'no'}
              onChange={e => setArcaConfig(prev => ({ ...prev, mock: e.target.value === 'yes' }))}
            >
              <option value="yes">Si (pruebas)</option>
              <option value="no">No (real)</option>
            </select>
          </label>

          <label>
            <span>CUIT emisor</span>
            <input
              value={arcaConfig.cuit}
              onChange={e => setArcaConfig(prev => ({ ...prev, cuit: e.target.value }))}
              placeholder="30712345678"
            />
          </label>

          <label>
            <span>Punto de venta</span>
            <input
              value={arcaConfig.ptoVta}
              onChange={e => setArcaConfig(prev => ({ ...prev, ptoVta: e.target.value }))}
              placeholder="1"
            />
          </label>

          <label className="full">
            <span>WSFE URL</span>
            <input
              value={arcaConfig.wsfeUrl}
              onChange={e => setArcaConfig(prev => ({ ...prev, wsfeUrl: e.target.value }))}
              placeholder="https://wswhomo.afip.gov.ar/wsfev1/service.asmx"
            />
          </label>

          <label className="full">
            <span>Token WSAA</span>
            <textarea
              value={arcaConfig.token ?? ''}
              onChange={e => setArcaConfig(prev => ({ ...prev, token: e.target.value }))}
              rows={3}
            />
          </label>

          <label className="full">
            <span>Sign WSAA</span>
            <textarea
              value={arcaConfig.sign ?? ''}
              onChange={e => setArcaConfig(prev => ({ ...prev, sign: e.target.value }))}
              rows={3}
            />
          </label>
        </div>

        <div className="admin-actions">
          <button onClick={() => void saveArcaConfig()} disabled={savingArca}>
            {savingArca ? 'Guardando...' : 'Guardar configuracion ARCA'}
          </button>
        </div>
      </section>
    </main>
  );
}

function CompanyAdminPanel() {
  const [tenantId, setTenantId] = useState(DEFAULT_TENANT_ID);
  const [tenantInput, setTenantInput] = useState(DEFAULT_TENANT_ID);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [arcaConfig, setArcaConfig] = useState<ArcaConfig>(emptyArcaConfig);
  const [savingArca, setSavingArca] = useState(false);
  const [creatingDevice, setCreatingDevice] = useState(false);
  const [newDevice, setNewDevice] = useState({ deviceId: '', name: '', lat: '-34.62', lng: '-58.43', address: '' });

  const loadCompanyData = async (targetTenant: string) => {
    const [p, d, i, arca] = await Promise.all([
      getJson<Plan[]>('/billing/plans'),
      getJson<Device[]>(`/devices?tenantId=${targetTenant}`),
      getJson<Invoice[]>(`/billing/invoices?tenantId=${targetTenant}`),
      getJson<ArcaConfig>(`/billing/arca-config?tenantId=${targetTenant}`)
    ]);

    setPlans(p);
    setDevices(d);
    setInvoices(i);
    setArcaConfig(arca);
  };

  useEffect(() => {
    void loadCompanyData(tenantId);
  }, [tenantId]);

  const createDevice = async () => {
    setCreatingDevice(true);
    try {
      await postJson('/devices', {
        tenantId,
        deviceId: newDevice.deviceId,
        name: newDevice.name,
        lat: Number(newDevice.lat),
        lng: Number(newDevice.lng),
        address: newDevice.address
      });
      setNewDevice({ deviceId: '', name: '', lat: '-34.62', lng: '-58.43', address: '' });
      await loadCompanyData(tenantId);
    } finally {
      setCreatingDevice(false);
    }
  };

  const saveArcaConfig = async () => {
    setSavingArca(true);
    try {
      await putJson(`/billing/arca-config?tenantId=${tenantId}`, arcaConfig);
      await loadCompanyData(tenantId);
    } finally {
      setSavingArca(false);
    }
  };

  return (
    <main className="company-shell">
      <header className="company-header">
        <div>
          <p className="company-kicker">Administracion de empresa</p>
          <h1>Consola central AgroSentinel</h1>
        </div>
        <a className="admin-link" href="/panel-cliente">
          Ver panel cliente
        </a>
      </header>

      <section className="company-panel company-toolbar">
        <div className="company-field">
          <span>Tenant cliente</span>
          <input value={tenantInput} onChange={e => setTenantInput(e.target.value)} placeholder="cliente-a" />
        </div>
        <button onClick={() => setTenantId(tenantInput.trim() || DEFAULT_TENANT_ID)}>Cargar cliente</button>
      </section>

      <section className="company-panel">
        <h2>Planes y facturacion base</h2>
        <div className="company-grid-2">
          <div className="company-list">
            {plans.map(plan => (
              <article key={plan._id} className="company-list-item">
                <strong>{plan.name}</strong>
                <span>${plan.monthlyPriceArs.toLocaleString('es-AR')} / mes</span>
                <span>Max dispositivos: {plan.maxDevices}</span>
              </article>
            ))}
          </div>
          <div className="company-list">
            {invoices.map(inv => (
              <article key={inv._id} className="company-list-item">
                <strong>{inv.period}</strong>
                <span>Monto: ${inv.amountArs.toLocaleString('es-AR')}</span>
                <span>Estado: {inv.status}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="company-panel">
        <h2>Alta de sensores para cliente</h2>
        <div className="company-form-grid">
          <label>
            <span>Device ID</span>
            <input
              value={newDevice.deviceId}
              onChange={e => setNewDevice(prev => ({ ...prev, deviceId: e.target.value }))}
              placeholder="ESP32-CENTRO-001"
            />
          </label>
          <label>
            <span>Nombre</span>
            <input
              value={newDevice.name}
              onChange={e => setNewDevice(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Tanque centro"
            />
          </label>
          <label>
            <span>Lat</span>
            <input value={newDevice.lat} onChange={e => setNewDevice(prev => ({ ...prev, lat: e.target.value }))} />
          </label>
          <label>
            <span>Lng</span>
            <input value={newDevice.lng} onChange={e => setNewDevice(prev => ({ ...prev, lng: e.target.value }))} />
          </label>
          <label className="full">
            <span>Direccion</span>
            <input
              value={newDevice.address}
              onChange={e => setNewDevice(prev => ({ ...prev, address: e.target.value }))}
              placeholder="Lote 2"
            />
          </label>
        </div>
        <div className="company-actions">
          <button onClick={() => void createDevice()} disabled={creatingDevice || !newDevice.deviceId || !newDevice.name}>
            {creatingDevice ? 'Creando...' : 'Crear sensor'}
          </button>
        </div>
      </section>

      <section className="company-panel">
        <h2>Sensores del cliente cargado</h2>
        <div className="company-list">
          {devices.map(d => (
            <article key={d._id} className="company-list-item">
              <strong>{d.name}</strong>
              <span>{d.deviceId}</span>
              <span>Estado: {d.status}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="company-panel">
        <h2>Configuracion ARCA por cliente</h2>
        <div className="company-form-grid">
          <label>
            <span>Habilitar ARCA</span>
            <select
              value={arcaConfig.enabled ? 'yes' : 'no'}
              onChange={e => setArcaConfig(prev => ({ ...prev, enabled: e.target.value === 'yes' }))}
            >
              <option value="no">No</option>
              <option value="yes">Si</option>
            </select>
          </label>
          <label>
            <span>Modo mock</span>
            <select
              value={arcaConfig.mock ? 'yes' : 'no'}
              onChange={e => setArcaConfig(prev => ({ ...prev, mock: e.target.value === 'yes' }))}
            >
              <option value="yes">Si (pruebas)</option>
              <option value="no">No (real)</option>
            </select>
          </label>
          <label>
            <span>CUIT</span>
            <input value={arcaConfig.cuit} onChange={e => setArcaConfig(prev => ({ ...prev, cuit: e.target.value }))} />
          </label>
          <label>
            <span>Punto de venta</span>
            <input value={arcaConfig.ptoVta} onChange={e => setArcaConfig(prev => ({ ...prev, ptoVta: e.target.value }))} />
          </label>
          <label className="full">
            <span>WSFE URL</span>
            <input
              value={arcaConfig.wsfeUrl}
              onChange={e => setArcaConfig(prev => ({ ...prev, wsfeUrl: e.target.value }))}
            />
          </label>
        </div>
        <div className="company-actions">
          <button onClick={() => void saveArcaConfig()} disabled={savingArca}>
            {savingArca ? 'Guardando...' : 'Guardar ARCA cliente'}
          </button>
        </div>
      </section>
    </main>
  );
}

export function App() {
  const appMode = import.meta.env.VITE_APP_MODE ?? 'public';
  const path = window.location.pathname;
  const isClientPanel = path.startsWith('/panel') || path.startsWith('/panel-cliente');
  const isCompanyPanel = path.startsWith('/admin-empresa') || path.startsWith('/empresa');

  if (isCompanyPanel) return <CompanyAdminPanel />;
  if (isClientPanel) return <ClientPanel />;
  if (appMode === 'company') return <CompanyAdminPanel />;
  return <LandingPage />;
}
