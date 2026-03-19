import { useEffect, useMemo, useState } from 'react';
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
const TENANT_ID = 'demo-tenant';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error('API request failed');
  return res.json();
}

export function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [arcaConfig, setArcaConfig] = useState<ArcaConfig>({
    enabled: false,
    mock: true,
    cuit: '',
    ptoVta: '1',
    wsfeUrl: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
    token: '',
    sign: ''
  });
  const [savingArca, setSavingArca] = useState(false);

  const stats = useMemo(() => {
    const online = devices.filter(d => d.status === 'online').length;
    const critical = devices.filter(d => d.status === 'critical' || d.status === 'offline').length;
    return { total: devices.length, online, critical, alerts: alerts.filter(a => a.status === 'open').length };
  }, [devices, alerts]);

  const loadAll = async () => {
    const [d, a, o, i] = await Promise.all([
      getJson<Device[]>(`/devices?tenantId=${TENANT_ID}`),
      getJson<Alert[]>(`/alerts?tenantId=${TENANT_ID}`),
      getJson<WorkOrder[]>(`/work-orders?tenantId=${TENANT_ID}`),
      getJson<Invoice[]>(`/billing/invoices?tenantId=${TENANT_ID}`)
    ]);
    setDevices(d);
    setAlerts(a);
    setOrders(o);
    setInvoices(i);

    const arca = await getJson<ArcaConfig>(`/billing/arca-config?tenantId=${TENANT_ID}`);
    setArcaConfig(arca);
  };

  useEffect(() => {
    void loadAll();
    const socket = io(SOCKET_URL);
    socket.emit('tenant:join', TENANT_ID);
    socket.on('devices:updated', () => void loadAll());
    socket.on('alerts:updated', () => void loadAll());
    socket.on('work-orders:updated', () => void loadAll());
    socket.on('telemetry:new', () => void loadAll());
    return () => {
      socket.disconnect();
    };
  }, []);

  const pumpCommand = async (deviceId: string, cmd: 'pump_on' | 'pump_off') => {
    await fetch(`${API_URL}/devices/${deviceId}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd })
    });
  };

  const closeOrder = async (id: string) => {
    await fetch(`${API_URL}/work-orders/${id}/close`, { method: 'PATCH' });
    await loadAll();
  };

  const saveArcaConfig = async () => {
    setSavingArca(true);
    try {
      await fetch(`${API_URL}/billing/arca-config?tenantId=${TENANT_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(arcaConfig)
      });
      await loadAll();
    } finally {
      setSavingArca(false);
    }
  };

  const markerColor = (status: Device['status']) => {
    if (status === 'critical' || status === 'offline') return '#e11d48';
    if (status === 'warning') return '#f59e0b';
    return '#22c55e';
  };

  return (
    <main className="layout">
      <header className="hero">
        <h1>AgroSentinel</h1>
        <p>Monitoreo IoT de tanques de agua con ESP32 en tiempo real</p>
      </header>

      <section className="cards-grid">
        <div className="card"><h3>Dispositivos</h3><strong>{stats.total}</strong></div>
        <div className="card"><h3>Online</h3><strong>{stats.online}</strong></div>
        <div className="card"><h3>Criticos</h3><strong>{stats.critical}</strong></div>
        <div className="card"><h3>Alertas Abiertas</h3><strong>{stats.alerts}</strong></div>
      </section>

      <section className="panel">
        <h2>Dashboard de Dispositivos</h2>
        <div className="devices-grid">
          {devices.map(d => (
            <article key={d._id} className="device-card">
              <div className="row-between">
                <h3>{d.name}</h3>
                <span className={`badge ${d.status}`}>{d.status}</span>
              </div>
              <p>ID: {d.deviceId}</p>
              <p>Nivel: {d.levelPct}%</p>
              <p>Reserva: {d.reserveLiters} L</p>
              <p>Bomba: {d.pumpOn ? 'Encendida' : 'Apagada'}</p>
              <div className="actions">
                <button onClick={() => void pumpCommand(d.deviceId, 'pump_on')}>Encender bomba</button>
                <button className="secondary" onClick={() => void pumpCommand(d.deviceId, 'pump_off')}>Apagar bomba</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="map-panel panel">
        <h2>Mapa de Dispositivos</h2>
        <MapContainer center={[-34.62, -58.43]} zoom={10} style={{ height: '340px', borderRadius: '16px' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {devices.map(d => (
            <CircleMarker key={d._id} center={[d.location.lat, d.location.lng]} radius={11} pathOptions={{ color: markerColor(d.status), fillOpacity: 0.8 }}>
              <Popup>
                <strong>{d.name}</strong><br />
                Estado: {d.status}<br />Nivel: {d.levelPct}%
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </section>

      <section className="grid-2">
        <div className="panel">
          <h2>Alertas</h2>
          {alerts.map(a => (
            <div className="list-item" key={a._id}>
              <strong>{a.deviceId}</strong>
              <span>{a.message}</span>
              <span className={`badge ${a.status === 'open' ? 'critical' : 'online'}`}>{a.status}</span>
            </div>
          ))}
        </div>

        <div className="panel">
          <h2>Ordenes de Trabajo</h2>
          {orders.map(o => (
            <div className="list-item" key={o._id}>
              <strong>{o.title}</strong>
              <span>{o.description}</span>
              <div className="row-between">
                <span className={`badge ${o.status === 'closed' ? 'online' : o.status === 'in_progress' ? 'warning' : 'critical'}`}>{o.status}</span>
                {o.status !== 'closed' && <button onClick={() => void closeOrder(o._id)}>Cerrar</button>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Facturacion (ARCA)</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Periodo</th><th>Monto</th><th>Estado</th><th>CAE</th><th>Comprobante</th></tr>
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

      <section className="panel">
        <h2>Configuracion ARCA</h2>
        <p className="muted">Configura homologacion/produccion de facturacion electronica para este tenant.</p>
        <div className="form-grid">
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
            <span>Modo Mock</span>
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

        <div className="actions">
          <button onClick={() => void saveArcaConfig()} disabled={savingArca}>
            {savingArca ? 'Guardando...' : 'Guardar configuracion ARCA'}
          </button>
        </div>
      </section>
    </main>
  );
}
