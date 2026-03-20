import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'operator' | 'technician' | 'company_admin';
  tenantId: string;
  mustChangePassword: boolean;
};

type TenantClient = {
  _id: string;
  tenantId: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  active: boolean;
  createdAt: string;
};

type AuthSession = {
  token: string;
  user: AuthUser;
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

function authHeaders(token?: string, json = false): HeadersInit {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function getJson<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error('API request failed');
  return res.json();
}

async function putJson(path: string, body: unknown, token?: string) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'PUT',
    headers: authHeaders(token, true),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('API request failed');
}

async function postJson(path: string, body: unknown, token?: string) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('API request failed');
  return res;
}

async function patchJson(path: string, body: unknown, token?: string) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'PATCH',
    headers: authHeaders(token, true),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('API request failed');
  return res;
}

function loadStoredSession(): AuthSession | null {
  const raw = localStorage.getItem('agrosentinel_session');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

function saveSession(session: AuthSession | null) {
  if (!session) {
    localStorage.removeItem('agrosentinel_session');
    return;
  }
  localStorage.setItem('agrosentinel_session', JSON.stringify(session));
}

function markerColor(status: Device['status']) {
  if (status === 'critical' || status === 'offline') return '#e11d48';
  if (status === 'warning') return '#f59e0b';
  return '#22c55e';
}

function LandingPage() {
  return (
    <div className="landing-outer">
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
          <a className="lp-btn lp-btn-primary" href="#impacto">
            Ver impacto
          </a>
          <a className="lp-btn lp-btn-ghost" href="#flujo">
            Explorar flujo tecnico
          </a>
          <a className="lp-btn lp-btn-ghost" href="/panel-cliente">
            Ingresar al panel cliente
          </a>
          <a className="lp-btn lp-btn-ghost" href="/admin-empresa">
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
          <a className="lp-btn lp-btn-primary" href="mailto:rdfmedanos@yahoo.com.ar">
            Solicitar implementacion
          </a>
          <a className="lp-btn lp-btn-ghost" href="/panel-cliente">
            Acceso panel cliente
          </a>
          <a className="lp-btn lp-btn-ghost" href="/admin-empresa">
            Acceso admin empresa
          </a>
        </div>
      </section>
    </main>
    </div>
  );
}

function LoginPanel(props: {
  title: string;
  allowedRoles: AuthUser['role'][];
  onAuthenticated: (session: AuthSession) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await postJson('/auth/login', { email, password });
      const session = (await res.json()) as AuthSession;
      if (!props.allowedRoles.includes(session.user.role)) {
        setError('Este usuario no tiene acceso a esta seccion');
        return;
      }
      props.onAuthenticated(session);
    } catch {
      setError('Credenciales invalidas');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>{props.title}</h1>
        <p>Ingresar con email y contrasena.</p>
        <label>
          <span>Email</span>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="usuario@dominio.com" />
        </label>
        <label>
          <span>Contrasena</span>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="********" />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button onClick={() => void submit()} disabled={loading || !email || !password}>
          {loading ? 'Ingresando...' : 'Ingresar'}
        </button>
      </section>
    </main>
  );
}

function PasswordSection(props: { token: string; mustChangePassword: boolean }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');

  const save = async () => {
    setMessage('');
    try {
      await postJson('/auth/change-password', { currentPassword, newPassword }, props.token);
      setCurrentPassword('');
      setNewPassword('');
      setMessage('Contrasena actualizada correctamente');
    } catch {
      setMessage('No se pudo actualizar la contrasena');
    }
  };

  return (
    <section className="admin-panel">
      <h2>Gestion de contrasena</h2>
      {props.mustChangePassword && <p className="auth-warning">Debes cambiar la contrasena inicial.</p>}
      <div className="admin-form-grid">
        <label>
          <span>Contrasena actual</span>
          <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
        </label>
        <label>
          <span>Nueva contrasena</span>
          <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
        </label>
      </div>
      <div className="admin-actions">
        <button onClick={() => void save()} disabled={!currentPassword || !newPassword}>
          Cambiar contrasena
        </button>
      </div>
      {message && <p className="auth-message">{message}</p>}
    </section>
  );
}

function ClientPanel(props: { session: AuthSession; onLogout: () => void }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
    const token = props.session.token;
    const tenantId = props.session.user.tenantId;
    try {
      const [d, a, o, i] = await Promise.all([
        getJson<Device[]>(`/devices?tenantId=${tenantId}`, token),
        getJson<Alert[]>(`/alerts?tenantId=${tenantId}`, token),
        getJson<WorkOrder[]>(`/work-orders?tenantId=${tenantId}`, token),
        getJson<Invoice[]>(`/billing/invoices?tenantId=${tenantId}`, token)
      ]);
      setDevices(d);
      setAlerts(a);
      setOrders(o);
      setInvoices(i);

      const arca = await getJson<ArcaConfig>(`/billing/arca-config?tenantId=${tenantId}`, token);
      setArcaConfig(arca);
    } catch (err) {
      console.error('Error loading client data:', err);
    }
  };

  useEffect(() => {
    void loadAll();
    const socket = io(SOCKET_URL, {
      auth: { token: props.session.token }
    });
    socket.emit('tenant:join', props.session.user.tenantId);
    socket.on('devices:updated', () => void loadAll());
    socket.on('alerts:updated', () => void loadAll());
    socket.on('work-orders:updated', () => void loadAll());
    socket.on('telemetry:new', () => void loadAll());
    return () => {
      socket.disconnect();
    };
  }, [props.session.token, props.session.user.tenantId]);

  const pumpCommand = async (deviceId: string, cmd: 'pump_on' | 'pump_off') => {
    await postJson(`/devices/${deviceId}/command`, { cmd }, props.session.token);
  };

  const closeOrder = async (id: string) => {
    await patchJson(`/work-orders/${id}/close`, {}, props.session.token);
    await loadAll();
  };

  const saveArcaConfig = async () => {
    setSavingArca(true);
    try {
      await putJson(`/billing/arca-config?tenantId=${props.session.user.tenantId}`, arcaConfig, props.session.token);
      await loadAll();
    } finally {
      setSavingArca(false);
    }
  };

  return (
    <div className={`wrapper ${sidebarCollapsed ? 'sidebar-collapse' : ''}`} style={{ minHeight: '100vh', backgroundColor: '#f4f6f9' }}>
      {/* Navbar */}
      <nav className="main-header navbar navbar-expand navbar-white navbar-light">
        <ul className="navbar-nav">
          <li className="nav-item">
            <button className="nav-link" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
              <i className="fas fa-bars"></i>
            </button>
          </li>
          <li className="nav-item d-none d-sm-inline-block">
            <a href="/" className="nav-link text-muted">Web Principal</a>
          </li>
        </ul>

        <ul className="navbar-nav ml-auto">
          <li className="nav-item">
            <button onClick={props.onLogout} className="nav-link">
              <i className="fas fa-sign-out-alt"></i> Salir
            </button>
          </li>
        </ul>
      </nav>

      {/* Sidebar */}
      <aside className="main-sidebar sidebar-dark-primary elevation-4">
        <div className="brand-link text-center pt-3 pb-3">
          <span className="brand-text font-weight-bold h4">AgroSentinel</span>
        </div>
        <div className="sidebar">
          <nav className="mt-4">
            <ul className="nav nav-pills nav-sidebar flex-column" role="menu">
              <li className="nav-header">MONITOREO</li>
              <li className="nav-item">
                <a href="#" className="nav-link active">
                  <i className="nav-icon fas fa-tachometer-alt"></i>
                  <p>Dashboard</p>
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </aside>

      {/* Content Wrapper */}
      <div className="content-wrapper">
        <section className="content-header">
          <div className="container-fluid">
            <div className="row mb-2">
              <div className="col-sm-6">
                <h1 className="m-0 text-dark">Operación AgroSentinel</h1>
              </div>
              <div className="col-sm-6 text-right">
                <span className="badge badge-success shadow-sm">Panel Cliente</span>
              </div>
            </div>
          </div>
        </section>

        <section className="content">
          <div className="container-fluid">
            {/* Small boxes (Stat box) */}
            <div className="row">
              <div className="col-lg-3 col-6">
                <div className="small-box bg-info shadow-sm">
                  <div className="inner">
                    <h3>{stats.total}</h3>
                    <p>Dispositivos</p>
                  </div>
                  <div className="icon"><i className="fas fa-microchip"></i></div>
                </div>
              </div>
              <div className="col-lg-3 col-6">
                <div className="small-box bg-success shadow-sm">
                  <div className="inner">
                    <h3>{stats.online}</h3>
                    <p>Online</p>
                  </div>
                  <div className="icon"><i className="fas fa-signal"></i></div>
                </div>
              </div>
              <div className="col-lg-3 col-6">
                <div className="small-box bg-danger shadow-sm">
                  <div className="inner">
                    <h3>{stats.critical}</h3>
                    <p>Críticos</p>
                  </div>
                  <div className="icon"><i className="fas fa-exclamation-triangle"></i></div>
                </div>
              </div>
              <div className="col-lg-3 col-6">
                <div className="small-box bg-warning shadow-sm">
                  <div className="inner">
                    <h3>{stats.alerts}</h3>
                    <p>Alertas Abiertas</p>
                  </div>
                  <div className="icon"><i className="fas fa-bell"></i></div>
                </div>
              </div>
            </div>

            {/* Devices & Map */}
            <div className="row">
              <div className="col-12">
                <div className="card shadow-sm border-0">
                  <div className="card-header bg-white">
                    <h3 className="card-title font-weight-bold"><i className="fas fa-map-marked-alt mr-2"></i>Mapa de Dispositivos</h3>
                  </div>
                  <div className="card-body p-0">
                    <MapContainer center={[-34.62, -58.43]} zoom={10} style={{ height: '380px', width: '100%' }}>
                      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                      {devices.map(d => (
                        <CircleMarker
                          key={d._id}
                          center={[d.location.lat, d.location.lng]}
                          radius={11}
                          pathOptions={{ color: markerColor(d.status), fillOpacity: 0.8 }}
                        >
                          <Popup>
                            <div className="p-1">
                              <h6 className="font-weight-bold mb-1">{d.name}</h6>
                              <p className="mb-0 small">Estado: <span className={`badge ${d.status === 'online' ? 'badge-success' : 'badge-danger'}`}>{d.status}</span></p>
                              <p className="mb-0 small">Nivel: <strong>{d.levelPct}%</strong></p>
                            </div>
                          </Popup>
                        </CircleMarker>
                      ))}
                    </MapContainer>
                  </div>
                </div>
              </div>
            </div>

            <div className="row mt-4">
              <div className="col-md-8">
                <div className="card shadow-sm border-0">
                  <div className="card-header bg-white">
                    <h3 className="card-title font-weight-bold"><i className="fas fa-list mr-2"></i>Estado de Sensores</h3>
                  </div>
                  <div className="card-body p-0">
                    <div className="table-responsive">
                      <table className="table table-hover m-0">
                        <thead className="bg-light">
                          <tr><th>Sensor</th><th>Nivel</th><th>Bomba</th><th>Estado</th><th className="text-right">Acciones</th></tr>
                        </thead>
                        <tbody>
                          {devices.map(d => (
                            <tr key={d._id}>
                              <td>
                                <div className="font-weight-bold">{d.name}</div>
                                <div className="small text-muted">{d.deviceId}</div>
                              </td>
                              <td className="align-middle">
                                <div className="progress progress-xs" style={{ width: '80px' }}>
                                  <div className={`progress-bar ${d.levelPct < 20 ? 'bg-danger' : d.levelPct < 50 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${d.levelPct}%` }}></div>
                                </div>
                                <span className="small font-weight-bold">{d.levelPct}%</span>
                              </td>
                              <td className="align-middle">
                                <span className={`badge ${d.pumpOn ? 'badge-info' : 'badge-light'}`}>{d.pumpOn ? 'Encendida' : 'Apagada'}</span>
                              </td>
                              <td className="align-middle">
                                <span className={`badge ${d.status === 'online' ? 'badge-success' : 'badge-danger'}`}>{d.status}</span>
                              </td>
                              <td className="text-right align-middle">
                                <div className="btn-group">
                                  <button className="btn btn-xs btn-outline-primary" onClick={() => void pumpCommand(d.deviceId, 'pump_on')}>ON</button>
                                  <button className="btn btn-xs btn-outline-secondary" onClick={() => void pumpCommand(d.deviceId, 'pump_off')}>OFF</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
              <div className="col-md-4">
                 <div className="card shadow-sm border-0">
                  <div className="card-header bg-white">
                    <h3 className="card-title font-weight-bold"><i className="fas fa-exclamation-circle mr-2"></i>Notificaciones</h3>
                  </div>
                  <div className="card-body p-0" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    <ul className="list-group list-group-flush">
                      {alerts.map(a => (
                        <li key={a._id} className="list-group-item px-3 py-2 border-0 mb-1 rounded mx-2 bg-light">
                          <div className="d-flex justify-content-between">
                            <span className="small font-weight-bold">{a.deviceId}</span>
                            <span className={`badge badge-pill ${a.status === 'open' ? 'badge-danger' : 'badge-light'}`}>{a.status}</span>
                          </div>
                          <div className="small text-dark mt-1">{a.message}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            <div className="row mt-4">
              <div className="col-md-6">
                <div className="card shadow-sm border-0">
                  <div className="card-header bg-white">
                    <h3 className="card-title font-weight-bold"><i className="fas fa-tools mr-2"></i>Órdenes de Trabajo</h3>
                  </div>
                  <div className="card-body p-3">
                    {orders.map(o => (
                      <div className="border rounded p-2 mb-2 bg-white shadow-none" key={o._id}>
                        <div className="d-flex justify-content-between align-items-start">
                          <h6 className="font-weight-bold mb-1">{o.title}</h6>
                          <span className={`badge ${o.status === 'closed' ? 'badge-success' : o.status === 'in_progress' ? 'badge-warning' : 'badge-danger'}`}>{o.status}</span>
                        </div>
                        <p className="small text-muted mb-2">{o.description}</p>
                        {o.status !== 'closed' && <button className="btn btn-xs btn-block btn-outline-success" onClick={() => void closeOrder(o._id)}>Cerrar Orden</button>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="col-md-6">
                <div className="card shadow-sm border-0">
                  <div className="card-header bg-white">
                    <h3 className="card-title font-weight-bold"><i className="fas fa-file-invoice mr-2"></i>Facturación ARCA</h3>
                  </div>
                  <div className="card-body p-0">
                    <table className="table table-sm m-0">
                      <thead><tr><th>Período</th><th>Monto</th><th>Estado</th></tr></thead>
                      <tbody>
                        {invoices.map(inv => (
                          <tr key={inv._id}>
                            <td>{inv.period}</td>
                            <td>${inv.amountArs.toLocaleString('es-AR')}</td>
                            <td><span className={`badge ${inv.status === 'paid' ? 'badge-success' : 'badge-warning'}`}>{inv.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="card shadow-sm mt-3 border-0">
                  <div className="card-body p-3">
                    <PasswordSection token={props.session.token} mustChangePassword={props.session.user.mustChangePassword} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <footer className="main-footer text-center small text-muted">
        <strong>AgroSentinel &copy; 2026</strong>
      </footer>
    </div>
  );
}

type AdminSection = 'dashboard' | 'clientes' | 'dispositivos' | 'usuarios' | 'facturacion' | 'arca' | 'notificaciones' | 'reportes' | 'actividad';

function CompanyAdminPanel(props: { session: AuthSession; onLogout: () => void }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [operacionOpen, setOperacionOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<AdminSection>('dashboard');
  const [tenantId, setTenantId] = useState(DEFAULT_TENANT_ID);
  const [tenantInput, setTenantInput] = useState(DEFAULT_TENANT_ID);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<TenantClient[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [loadingClients, setLoadingClients] = useState(false);
  const clientDropdownRef = useRef<HTMLDivElement>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [arcaConfig, setArcaConfig] = useState<ArcaConfig>(emptyArcaConfig);
  const [savingArca, setSavingArca] = useState(false);
  const [creatingDevice, setCreatingDevice] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [newDevice, setNewDevice] = useState({ deviceId: '', name: '', lat: '-34.62', lng: '-58.43', address: '' });
  const [newUser, setNewUser] = useState({
    name: '',
    email: '',
    role: 'owner' as 'owner' | 'operator' | 'technician',
    password: 'Cliente123!'
  });
  const [resetPassword, setResetPassword] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [showAddClient, setShowAddClient] = useState(false);
  const [creatingClient, setCreatingClient] = useState(false);
  const [newClient, setNewClient] = useState({
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    address: '',
    planId: ''
  });

  const loadClients = useCallback(async () => {
    setLoadingClients(true);
    try {
      const data = await getJson<TenantClient[]>('/tenants', props.session.token);
      setClients(data);
    } catch {
      console.error('Error loading clients');
    } finally {
      setLoadingClients(false);
    }
  }, [props.session.token]);

  const loadCompanyData = useCallback(async (targetTenant: string) => {
    const token = props.session.token;
    try {
      const [p, d, i, arca, tenantUsers, a] = await Promise.all([
        getJson<Plan[]>('/billing/plans', token),
        getJson<Device[]>(`/devices?tenantId=${targetTenant}`, token),
        getJson<Invoice[]>(`/billing/invoices?tenantId=${targetTenant}`, token),
        getJson<ArcaConfig>(`/billing/arca-config?tenantId=${targetTenant}`, token),
        getJson<AuthUser[]>(`/auth/admin/users?tenantId=${targetTenant}`, token),
        getJson<Alert[]>(`/alerts?tenantId=${targetTenant}`, token)
      ]);
      setPlans(p);
      setDevices(d);
      setInvoices(i);
      setArcaConfig(arca);
      setUsers(tenantUsers);
      setAlerts(a);
    } catch (err) {
      console.error('Error loading company data:', err);
    }
  }, [props.session.token]);

  useEffect(() => {
    void loadCompanyData(tenantId);
  }, [tenantId, loadCompanyData]);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(e.target as Node)) {
        setClientSearch('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const setSection = (section: AdminSection) => {
    setActiveSection(section);
    setOperacionOpen(['clientes', 'dispositivos', 'usuarios', 'notificaciones'].includes(section));
    setConfigOpen(['facturacion', 'arca', 'reportes'].includes(section));
  };

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
      }, props.session.token);
      setNewDevice({ deviceId: '', name: '', lat: '-34.62', lng: '-58.43', address: '' });
      await loadCompanyData(tenantId);
    } finally {
      setCreatingDevice(false);
    }
  };

  const saveArcaConfig = async () => {
    setSavingArca(true);
    try {
      await putJson(`/billing/arca-config?tenantId=${tenantId}`, arcaConfig, props.session.token);
      await loadCompanyData(tenantId);
    } finally {
      setSavingArca(false);
    }
  };

  const createUser = async () => {
    setCreatingUser(true);
    try {
      await postJson(
        '/auth/admin/create-user',
        { name: newUser.name, email: newUser.email, role: newUser.role, tenantId, password: newUser.password },
        props.session.token
      );
      setNewUser({ name: '', email: '', role: 'owner', password: 'Cliente123!' });
      await loadCompanyData(tenantId);
    } finally {
      setCreatingUser(false);
    }
  };

  const resetUserPassword = async () => {
    if (!selectedUserId || !resetPassword) return;
    await postJson('/auth/admin/reset-password', { userId: selectedUserId, newPassword: resetPassword }, props.session.token);
    setResetPassword('');
    await loadCompanyData(tenantId);
  };

  const stats = useMemo(() => ({
    total: devices.length,
    online: devices.filter(d => d.status === 'online').length,
    offline: devices.filter(d => d.status === 'offline' || d.status === 'critical').length,
    alerts: alerts.filter(a => a.status === 'open').length,
    users: users.length,
    tenants: clients.length
  }), [devices, alerts, users, clients]);

  const sectionTitle = () => {
    const map: Record<AdminSection, string> = {
      dashboard: 'Dashboard',
      clientes: 'Clientes',
      dispositivos: 'Dispositivos',
      usuarios: 'Usuarios',
      facturacion: 'Facturación y Planes',
      arca: 'Configuración ARCA',
      notificaciones: 'Notificaciones',
      reportes: 'Reportes',
      actividad: 'Actividad'
    };
    return map[activeSection];
  };

  return (
    <div className={`wrapper ${sidebarCollapsed ? 'sidebar-collapse' : ''}`} style={{ minHeight: '100vh', backgroundColor: '#f4f6f9' }}>
      <nav className="main-header navbar navbar-expand navbar-white navbar-light border-bottom">
        <ul className="navbar-nav">
          <li className="nav-item">
            <a className="nav-link" data-widget="pushmenu" href="#" onClick={e => { e.preventDefault(); setSidebarCollapsed(!sidebarCollapsed); }}>
              <i className="fas fa-bars"></i>
            </a>
          </li>
          <li className="nav-item d-none d-md-inline-block">
            <a href="/" className="nav-link"><i className="fas fa-home"></i> Web Principal</a>
          </li>
          <li className="nav-item d-none d-md-inline-block">
            <a href="/panel-cliente" className="nav-link"><i className="fas fa-warehouse"></i> Panel Cliente</a>
          </li>
        </ul>
        <ul className="navbar-nav ml-auto">
          <li className="nav-item dropdown">
            <a className="nav-link dropdown-toggle" data-toggle="dropdown" href="#">
              <i className="far fa-user-circle"></i>
              <span className="d-none d-md-inline ml-1 text-sm">{props.session.user.name}</span>
            </a>
            <div className="dropdown-menu dropdown-menu-lg dropdown-menu-right">
              <a href="#" className="dropdown-item">
                <i className="fas fa-user mr-2"></i> {props.session.user.name}
              </a>
              <div className="dropdown-divider"></div>
              <a href="#" className="dropdown-item">
                <i className="fas fa-envelope mr-2"></i> {props.session.user.email}
              </a>
              <div className="dropdown-divider"></div>
              <a href="#" className="dropdown-item text-danger" onClick={e => { e.preventDefault(); props.onLogout(); }}>
                <i className="fas fa-sign-out-alt mr-2"></i> Cerrar sesión
              </a>
            </div>
          </li>
          <li className="nav-item">
            <a className="nav-link" data-widget="fullscreen" href="#" onClick={e => e.preventDefault()}>
              <i className="fas fa-expand-arrows-alt"></i>
            </a>
          </li>
        </ul>
      </nav>

      <aside className="main-sidebar sidebar-dark-primary elevation-4" style={{ position: 'fixed', top: 0, bottom: 0, overflowX: 'hidden', zIndex: 1031 }}>
        <a href="/" className="brand-link text-center py-2">
          <span className="brand-text font-weight-bold h4 text-white">AgroSentinel</span>
        </a>
        <div className="sidebar">
          <div className="user-panel mt-3 pb-3 mb-3 d-flex">
            <div className="image">
              <i className="fas fa-user-circle text-white" style={{ fontSize: '2rem' }}></i>
            </div>
            <div className="info">
              <a href="#" className="d-block text-white font-weight-bold">{props.session.user.name}</a>
              <span className="text-white-50 small text-uppercase">{props.session.user.role.replace('_', ' ')}</span>
            </div>
          </div>
          <nav className="mt-2">
            <ul className="nav nav-pills nav-sidebar flex-column nav-child-indent" role="menu">
              <li className="nav-item">
                <a href="#" className={`nav-link ${activeSection === 'dashboard' ? 'active' : ''}`}
                  onClick={e => { e.preventDefault(); setSection('dashboard'); }}>
                  <i className="nav-icon fas fa-tachometer-alt"></i><p>Dashboard</p>
                </a>
              </li>

              <li className="nav-item has-treeview">
                <a href="#" className="nav-link"
                  onClick={e => { e.preventDefault(); setSection('clientes'); }}>
                  <i className="nav-icon fas fa-cogs"></i>
                  <p>Operación <i className={`right fas fa-angle-left ${operacionOpen ? 'fa-rotate-90' : ''}`}></i></p>
                </a>
                <ul className={`nav nav-treeview ${operacionOpen ? 'd-block' : ''}`}>
                  <li className="nav-item" style={{ marginLeft: '1rem' }}>
                    <a href="#" className={`nav-link ${activeSection === 'clientes' ? 'active' : ''}`}
                      onClick={e => { e.preventDefault(); setSection('clientes'); }}>
                      <i className="far fa-circle nav-icon"></i><p>Clientes</p>
                    </a>
                  </li>
                  <li className="nav-item" style={{ marginLeft: '1rem' }}>
                    <a href="#" className={`nav-link ${activeSection === 'dispositivos' ? 'active' : ''}`}
                      onClick={e => { e.preventDefault(); setSection('dispositivos'); }}>
                      <i className="far fa-circle nav-icon"></i><p>Dispositivos</p>
                    </a>
                  </li>
                  <li className="nav-item" style={{ marginLeft: '1rem' }}>
                    <a href="#" className={`nav-link ${activeSection === 'usuarios' ? 'active' : ''}`}
                      onClick={e => { e.preventDefault(); setSection('usuarios'); }}>
                      <i className="far fa-circle nav-icon"></i><p>Usuarios</p>
                    </a>
                  </li>
                  <li className="nav-item" style={{ marginLeft: '1rem' }}>
                    <a href="#" className={`nav-link ${activeSection === 'notificaciones' ? 'active' : ''}`}
                      onClick={e => { e.preventDefault(); setSection('notificaciones'); }}>
                      <i className="far fa-circle nav-icon"></i><p>Notificaciones</p>
                    </a>
                  </li>
                </ul>
              </li>

              <li className="nav-item has-treeview">
                <a href="#" className="nav-link"
                  onClick={e => { e.preventDefault(); setSection('facturacion'); }}>
                  <i className="nav-icon fas fa-cog"></i>
                  <p>Configuración <i className={`right fas fa-angle-left ${configOpen ? 'fa-rotate-90' : ''}`}></i></p>
                </a>
                <ul className={`nav nav-treeview ${configOpen ? 'd-block' : ''}`}>
                  <li className="nav-item" style={{ marginLeft: '1rem' }}>
                    <a href="#" className={`nav-link ${activeSection === 'facturacion' ? 'active' : ''}`}
                      onClick={e => { e.preventDefault(); setSection('facturacion'); }}>
                      <i className="far fa-circle nav-icon"></i><p>Facturación y Planes</p>
                    </a>
                  </li>
                  <li className="nav-item" style={{ marginLeft: '1rem' }}>
                    <a href="#" className={`nav-link ${activeSection === 'arca' ? 'active' : ''}`}
                      onClick={e => { e.preventDefault(); setSection('arca'); }}>
                      <i className="far fa-circle nav-icon"></i><p>Configuración ARCA</p>
                    </a>
                  </li>
                  <li className="nav-item" style={{ marginLeft: '1rem' }}>
                    <a href="#" className={`nav-link ${activeSection === 'reportes' ? 'active' : ''}`}
                      onClick={e => { e.preventDefault(); setSection('reportes'); }}>
                      <i className="far fa-circle nav-icon"></i><p>Reportes</p>
                    </a>
                  </li>
                </ul>
              </li>

              <li className="nav-item">
                <a href="#" className={`nav-link ${activeSection === 'actividad' ? 'active' : ''}`}
                  onClick={e => { e.preventDefault(); setSection('actividad'); }}>
                  <i className="nav-icon fas fa-history"></i><p>Actividad</p>
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </aside>

      <div className="content-wrapper" style={{ marginLeft: sidebarCollapsed ? '0' : '250px', transition: 'margin-left 0.2s', minHeight: 'calc(100vh - 57px - 52px)' }}>
        <section className="content-header border-bottom py-2">
          <div className="container-fluid">
            <div className="row">
              <div className="col-sm-6">
                <h1 className="m-0 text-dark" style={{ fontSize: '1.5rem', fontWeight: '600' }}>{sectionTitle()}</h1>
              </div>
              <div className="col-sm-6">
                <ol className="breadcrumb float-sm-right mb-0" style={{ background: 'transparent' }}>
                  <li className="breadcrumb-item">
                    <a href="#" onClick={e => { e.preventDefault(); setSection('dashboard'); }}><i className="fas fa-home"></i></a>
                  </li>
                  <li className="breadcrumb-item active">{sectionTitle()}</li>
                </ol>
              </div>
            </div>
          </div>
        </section>

        <section className="content">
          <div className="container-fluid">

            {activeSection === 'dashboard' && (
              <>
                <div className="row">
                  <div className="col-lg-3 col-6">
                    <div className="small-box bg-info shadow-sm">
                      <div className="inner"><h3>{stats.tenants}</h3><p>Clientes Activos</p></div>
                      <div className="icon"><i className="fas fa-building"></i></div>
                    </div>
                  </div>
                  <div className="col-lg-3 col-6">
                    <div className="small-box bg-primary shadow-sm">
                      <div className="inner"><h3>{stats.total}</h3><p>Dispositivos Totales</p></div>
                      <div className="icon"><i className="fas fa-microchip"></i></div>
                    </div>
                  </div>
                  <div className="col-lg-3 col-6">
                    <div className="small-box bg-success shadow-sm">
                      <div className="inner"><h3>{stats.online}</h3><p>Online</p></div>
                      <div className="icon"><i className="fas fa-signal"></i></div>
                    </div>
                  </div>
                  <div className="col-lg-3 col-6">
                    <div className="small-box bg-danger shadow-sm">
                      <div className="inner"><h3>{stats.offline}</h3><p>Offline / Críticos</p></div>
                      <div className="icon"><i className="fas fa-exclamation-triangle"></i></div>
                    </div>
                  </div>
                </div>
                <div className="row">
                  <div className="col-lg-4 col-6">
                    <div className="small-box bg-warning shadow-sm">
                      <div className="inner"><h3>{stats.alerts}</h3><p>Alertas Abiertas</p></div>
                      <div className="icon"><i className="fas fa-bell"></i></div>
                    </div>
                  </div>
                  <div className="col-lg-4 col-6">
                    <div className="small-box bg-secondary shadow-sm">
                      <div className="inner"><h3>{stats.users}</h3><p>Usuarios Totales</p></div>
                      <div className="icon"><i className="fas fa-users"></i></div>
                    </div>
                  </div>
                  <div className="col-lg-4 col-6">
                    <div className="small-box bg-indigo shadow-sm">
                      <div className="inner"><h3>{invoices.length}</h3><p>Facturas Registradas</p></div>
                      <div className="icon"><i className="fas fa-file-invoice-dollar"></i></div>
                    </div>
                  </div>
                </div>
                <div className="row">
                  <div className="col-md-8">
                    <div className="card shadow-sm border-0">
                      <div className="card-header bg-white"><h3 className="card-title font-weight-bold"><i className="fas fa-microchip mr-2"></i>Estado de Dispositivos</h3></div>
                      <div className="card-body p-0">
                        <table className="table table-hover m-0">
                          <thead className="bg-light"><tr><th>Nombre</th><th>Device ID</th><th>Nivel</th><th>Estado</th><th>Dirección</th></tr></thead>
                          <tbody>
                            {devices.map(d => (
                              <tr key={d._id}>
                                <td className="font-weight-bold">{d.name}</td>
                                <td className="small text-muted">{d.deviceId}</td>
                                <td><span className={`badge ${d.levelPct < 20 ? 'badge-danger' : d.levelPct < 50 ? 'badge-warning' : 'badge-success'}`}>{d.levelPct}%</span></td>
                                <td><span className={`badge ${d.status === 'online' ? 'badge-success' : 'badge-danger'}`}>{d.status}</span></td>
                                <td className="small">{d.location.address}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-4">
                    <div className="card shadow-sm border-0">
                      <div className="card-header bg-white"><h3 className="card-title font-weight-bold"><i className="fas fa-bell mr-2"></i>Alertas Recientes</h3></div>
                      <div className="card-body p-0" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                        {alerts.filter(a => a.status === 'open').length === 0 ? (
                          <p className="text-center text-muted p-3 small">Sin alertas abiertas</p>
                        ) : (
                          <ul className="list-group list-group-flush">
                            {alerts.filter(a => a.status === 'open').slice(0, 10).map(a => (
                              <li key={a._id} className="list-group-item border-0 px-3 py-2">
                                <div className="d-flex justify-content-between">
                                  <span className="font-weight-bold small">{a.deviceId}</span>
                                  <span className={`badge badge-pill ${a.type === 'critical_level' ? 'badge-danger' : 'badge-secondary'}`}>{a.type}</span>
                                </div>
                                <p className="small mb-0 text-muted">{a.message}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {activeSection === 'clientes' && (
              <div className="row">
                <div className="col-12">
                  <div className="card card-outline card-primary shadow-sm">
                    <div className="card-header border-0 d-flex justify-content-between align-items-center">
                      <h3 className="card-title text-primary font-weight-bold mb-0"><i className="fas fa-building mr-2"></i>Clientes</h3>
                      <button className="btn btn-success btn-sm" onClick={() => setShowAddClient(true)}>
                        <i className="fas fa-plus mr-1"></i>Agregar Cliente
                      </button>
                    </div>
                    <div className="card-body">
                      <div ref={clientDropdownRef} style={{ position: 'relative', maxWidth: '600px' }}>
                        <div className="input-group">
                          <div className="input-group-prepend">
                            <span className="input-group-text"><i className="fas fa-search"></i></span>
                          </div>
                          <input
                            className="form-control"
                            value={clientSearch}
                            onChange={e => setClientSearch(e.target.value)}
                            placeholder={clients.find(c => c.tenantId === tenantId)?.companyName || 'Escribí para buscar un cliente...'}
                          />
                          {clientSearch && (
                            <div className="input-group-append">
                              <button className="btn btn-default" onClick={() => setClientSearch('')}>
                                <i className="fas fa-times"></i>
                              </button>
                            </div>
                          )}
                        </div>
                        {clientSearch && (
                          <div
                            className="list-group shadow-sm"
                            style={{
                              position: 'absolute',
                              top: '100%',
                              left: 0,
                              right: 0,
                              zIndex: 1050,
                              maxHeight: '260px',
                              overflowY: 'auto',
                              marginTop: '2px',
                              borderRadius: '4px'
                            }}
                          >
                            {loadingClients ? (
                              <div className="list-group-item text-center text-muted py-3">
                                <i className="fas fa-spinner fa-spin"></i> Cargando...
                              </div>
                            ) : clients
                                .filter(c =>
                                  c.companyName.toLowerCase().includes(clientSearch.toLowerCase()) ||
                                  c.email.toLowerCase().includes(clientSearch.toLowerCase()) ||
                                  c.tenantId.toLowerCase().includes(clientSearch.toLowerCase()) ||
                                  (c.contactName && c.contactName.toLowerCase().includes(clientSearch.toLowerCase()))
                                ).length === 0 ? (
                              <div className="list-group-item text-center text-muted py-3">
                                <i className="fas fa-search mr-2"></i>No se encontraron clientes
                              </div>
                            ) : (
                              clients
                                .filter(c =>
                                  c.companyName.toLowerCase().includes(clientSearch.toLowerCase()) ||
                                  c.email.toLowerCase().includes(clientSearch.toLowerCase()) ||
                                  c.tenantId.toLowerCase().includes(clientSearch.toLowerCase()) ||
                                  (c.contactName && c.contactName.toLowerCase().includes(clientSearch.toLowerCase()))
                                )
                                .map(c => (
                                  <div
                                    key={c._id}
                                    className={`list-group-item list-group-item-action d-flex justify-content-between align-items-center ${tenantId === c.tenantId ? 'active' : ''}`}
                                    onClick={() => { setTenantId(c.tenantId); setTenantInput(c.tenantId); setClientSearch(''); }}
                                    style={{ cursor: 'pointer' }}
                                  >
                                    <div>
                                      <div className="font-weight-bold">{c.companyName}</div>
                                      <div className="small">
                                        <span className="text-muted">{c.contactName || 'Sin contacto'}</span>
                                        {c.email && <><span className="mx-1">·</span><span className="text-muted">{c.email}</span></>}
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <div className="small text-muted">{c.tenantId}</div>
                                      {tenantId === c.tenantId && <span className="badge badge-success mt-1"><i className="fas fa-check mr-1"></i>Seleccionado</span>}
                                    </div>
                                  </div>
                                ))
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="card shadow-sm border-0 mt-3">
                    <div className="card-header bg-white">
                      <h3 className="card-title font-weight-bold"><i className="fas fa-list mr-2"></i>Resumen del Cliente</h3>
                    </div>
                    <div className="card-body">
                      <div className="row">
                        <div className="col-md-3"><div className="text-center p-3 border rounded"><div className="text-muted small">Dispositivos</div><div className="h4 font-weight-bold text-primary">{stats.total}</div></div></div>
                        <div className="col-md-3"><div className="text-center p-3 border rounded"><div className="text-muted small">Online</div><div className="h4 font-weight-bold text-success">{stats.online}</div></div></div>
                        <div className="col-md-3"><div className="text-center p-3 border rounded"><div className="text-muted small">Alertas</div><div className="h4 font-weight-bold text-danger">{stats.alerts}</div></div></div>
                        <div className="col-md-3"><div className="text-center p-3 border rounded"><div className="text-muted small">Usuarios</div><div className="h4 font-weight-bold text-info">{stats.users}</div></div></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'dispositivos' && (
              <div className="row">
                <div className="col-12">
                  <div className="card shadow-sm border-0">
                    <div className="card-header bg-white">
                      <h3 className="card-title font-weight-bold"><i className="fas fa-plus-circle mr-2 text-success"></i>Agregar Dispositivo</h3>
                    </div>
                    <div className="card-body">
                      <div className="row">
                        <div className="col-md-3"><div className="form-group"><label className="small font-weight-bold">Device ID</label><input className="form-control" value={newDevice.deviceId} onChange={e => setNewDevice(p => ({ ...p, deviceId: e.target.value }))} placeholder="ESP32-001" /></div></div>
                        <div className="col-md-3"><div className="form-group"><label className="small font-weight-bold">Nombre</label><input className="form-control" value={newDevice.name} onChange={e => setNewDevice(p => ({ ...p, name: e.target.value }))} placeholder="Tanque Principal" /></div></div>
                        <div className="col-md-3"><div className="form-group"><label className="small font-weight-bold">Dirección</label><input className="form-control" value={newDevice.address} onChange={e => setNewDevice(p => ({ ...p, address: e.target.value }))} placeholder="Ruta 2 km 45" /></div></div>
                        <div className="col-md-2 d-flex align-items-end"><button className="btn btn-success btn-block font-weight-bold" onClick={() => void createDevice()} disabled={creatingDevice}>{creatingDevice ? '...' : 'Vincular'}</button></div>
                      </div>
                    </div>
                  </div>
                  <div className="card shadow-sm border-0 mt-3">
                    <div className="card-header bg-white"><h3 className="card-title font-weight-bold"><i className="fas fa-microchip mr-2"></i>Dispositivos Registrados ({devices.length})</h3></div>
                    <div className="card-body p-0">
                      <div className="table-responsive">
                        <table className="table table-hover m-0">
                          <thead className="bg-light"><tr><th>Nombre</th><th>Device ID</th><th>Dirección</th><th>Nivel</th><th>Bomba</th><th>Estado</th></tr></thead>
                          <tbody>
                            {devices.map(d => (
                              <tr key={d._id}>
                                <td className="font-weight-bold">{d.name}</td>
                                <td className="small text-muted">{d.deviceId}</td>
                                <td className="small">{d.location.address}</td>
                                <td>
                                  <div className="d-flex align-items-center">
                                    <div className="progress progress-xs mr-2" style={{ width: '60px' }}>
                                      <div className={`progress-bar ${d.levelPct < 20 ? 'bg-danger' : d.levelPct < 50 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${d.levelPct}%` }}></div>
                                    </div>
                                    <span className="small font-weight-bold">{d.levelPct}%</span>
                                  </div>
                                </td>
                                <td><span className={`badge ${d.pumpOn ? 'badge-info' : 'badge-light'}`}>{d.pumpOn ? 'ON' : 'OFF'}</span></td>
                                <td><span className={`badge ${d.status === 'online' ? 'badge-success' : d.status === 'warning' ? 'badge-warning' : 'badge-danger'}`}>{d.status}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'usuarios' && (
              <div className="row">
                <div className="col-md-4">
                  <div className="card shadow-sm border-0">
                    <div className="card-header bg-white"><h3 className="card-title font-weight-bold"><i className="fas fa-user-plus mr-2 text-success"></i>Crear Usuario</h3></div>
                    <div className="card-body">
                      <div className="form-group"><label className="small font-weight-bold">Nombre</label><input className="form-control" value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} placeholder="Juan Perez" /></div>
                      <div className="form-group"><label className="small font-weight-bold">Email</label><input className="form-control" type="email" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} placeholder="juan@cliente.com" /></div>
                      <div className="form-group"><label className="small font-weight-bold">Rol</label>
                        <select className="form-control" value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value as 'owner' | 'operator' | 'technician' }))}>
                          <option value="owner">Owner</option><option value="operator">Operator</option><option value="technician">Technician</option>
                        </select>
                      </div>
                      <div className="form-group"><label className="small font-weight-bold">Contraseña</label><input className="form-control" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} /></div>
                      <button className="btn btn-success btn-block font-weight-bold" onClick={() => void createUser()} disabled={creatingUser}>{creatingUser ? '...' : 'Crear Usuario'}</button>
                    </div>
                  </div>
                  <div className="card shadow-sm border-0 mt-3">
                    <div className="card-header bg-white"><h3 className="card-title font-weight-bold"><i className="fas fa-key mr-2 text-warning"></i>Resetear Contraseña</h3></div>
                    <div className="card-body">
                      <div className="form-group"><label className="small font-weight-bold">Usuario</label>
                        <select className="form-control" value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}>
                          <option value="">Seleccionar...</option>{users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
                        </select>
                      </div>
                      <div className="form-group"><label className="small font-weight-bold">Nueva Contraseña</label><input className="form-control" value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="Nueva contrasena" /></div>
                      <button className="btn btn-warning btn-block font-weight-bold" onClick={() => void resetUserPassword()} disabled={!selectedUserId || !resetPassword}>Resetear</button>
                    </div>
                  </div>
                </div>
                <div className="col-md-8">
                  <div className="card shadow-sm border-0">
                    <div className="card-header bg-white"><h3 className="card-title font-weight-bold"><i className="fas fa-users mr-2"></i>Usuarios ({users.length})</h3></div>
                    <div className="card-body p-0">
                      <div className="table-responsive">
                        <table className="table table-hover m-0">
                          <thead className="bg-light"><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Tenant</th></tr></thead>
                          <tbody>
                            {users.map(u => (
                              <tr key={u.id}>
                                <td className="font-weight-bold">{u.name}</td>
                                <td className="small text-muted">{u.email}</td>
                                <td><span className="badge badge-primary">{u.role}</span></td>
                                <td>{u.mustChangePassword ? <span className="badge badge-warning"><i className="fas fa-exclamation-triangle mr-1"></i>Pendiente</span> : <span className="badge badge-success">OK</span>}</td>
                                <td className="small text-muted">{u.tenantId}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'facturacion' && (
              <div className="row">
                <div className="col-md-6">
                  <div className="card shadow-sm border-0">
                    <div className="card-header bg-white"><h3 className="card-title font-weight-bold"><i className="fas fa-tags mr-2 text-info"></i>Planes Disponibles</h3></div>
                    <div className="card-body p-0">
                      <table className="table m-0">
                        <thead className="bg-light"><tr><th>Plan</th><th>Dispositivos Max.</th><th>Precio Mensual</th></tr></thead>
                        <tbody>{plans.map(p => (
                          <tr key={p._id}>
                            <td className="font-weight-bold">{p.name}</td>
                            <td>{p.maxDevices}</td>
                            <td className="text-primary font-weight-bold">${p.monthlyPriceArs.toLocaleString('es-AR')}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </div>
                </div>
                <div className="col-md-6">
                  <div className="card shadow-sm border-0">
                    <div className="card-header bg-white"><h3 className="card-title font-weight-bold"><i className="fas fa-file-invoice-dollar mr-2 text-success"></i>Historial de Facturación</h3></div>
                    <div className="card-body p-0">
                      <table className="table m-0">
                        <thead className="bg-light"><tr><th>Período</th><th>Monto</th><th>CAE</th><th>Estado</th></tr></thead>
                        <tbody>{invoices.map(i => (
                          <tr key={i._id}>
                            <td className="font-weight-bold">{i.period}</td>
                            <td>${i.amountArs.toLocaleString('es-AR')}</td>
                            <td className="small text-muted">{i.arca?.cae || '—'}</td>
                            <td><span className={`badge ${i.status === 'paid' ? 'badge-success' : i.status === 'issued' ? 'badge-info' : 'badge-secondary'}`}>{i.status}</span></td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'arca' && (
              <div className="row">
                <div className="col-md-8">
                  <div className="card shadow-sm border-0">
                    <div className="card-header bg-danger">
                      <h3 className="card-title font-weight-bold text-white"><i className="fas fa-shield-alt mr-2"></i>Configuración ARCA / AFIP</h3>
                    </div>
                    <div className="card-body">
                      <div className="row">
                        <div className="col-md-6">
                          <div className="form-group"><label className="small font-weight-bold">CUIT</label><input className="form-control" value={arcaConfig.cuit} onChange={e => setArcaConfig(p => ({ ...p, cuit: e.target.value }))} placeholder="30712345678" /></div>
                        </div>
                        <div className="col-md-6">
                          <div className="form-group"><label className="small font-weight-bold">Punto de Venta</label><input className="form-control" value={arcaConfig.ptoVta} onChange={e => setArcaConfig(p => ({ ...p, ptoVta: e.target.value }))} /></div>
                        </div>
                        <div className="col-md-6">
                          <div className="form-group"><label className="small font-weight-bold">WSFE URL</label><input className="form-control" value={arcaConfig.wsfeUrl} onChange={e => setArcaConfig(p => ({ ...p, wsfeUrl: e.target.value }))} /></div>
                        </div>
                        <div className="col-md-6">
                          <div className="form-group"><label className="small font-weight-bold">Token</label><input className="form-control" value={arcaConfig.token || ''} onChange={e => setArcaConfig(p => ({ ...p, token: e.target.value }))} /></div>
                        </div>
                        <div className="col-md-6">
                          <div className="form-group"><label className="small font-weight-bold">Sign</label><input className="form-control" value={arcaConfig.sign || ''} onChange={e => setArcaConfig(p => ({ ...p, sign: e.target.value }))} /></div>
                        </div>
                        <div className="col-md-6">
                          <div className="form-group mt-4">
                            <div className="custom-control custom-switch">
                              <input type="checkbox" className="custom-control-input" id="arcaEnabled" checked={arcaConfig.enabled} onChange={e => setArcaConfig(p => ({ ...p, enabled: e.target.checked }))} />
                              <label className="custom-control-label font-weight-bold" htmlFor="arcaEnabled">Habilitar Facturación ARCA</label>
                            </div>
                            <div className="custom-control custom-switch mt-2">
                              <input type="checkbox" className="custom-control-input" id="arcaMock" checked={arcaConfig.mock} onChange={e => setArcaConfig(p => ({ ...p, mock: e.target.checked }))} />
                              <label className="custom-control-label" htmlFor="arcaMock">Modo Mock (pruebas)</label>
                            </div>
                          </div>
                        </div>
                        <div className="col-12 mt-3">
                          <button className="btn btn-danger font-weight-bold" onClick={() => void saveArcaConfig()} disabled={savingArca}>{savingArca ? 'Guardando...' : 'Guardar Configuración'}</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-md-4">
                  <div className="card shadow-sm border-0">
                    <div className="card-header bg-white"><h3 className="card-title font-weight-bold"><i className="fas fa-key mr-2 text-warning"></i>Mi Contraseña</h3></div>
                    <div className="card-body">
                      <PasswordSection token={props.session.token} mustChangePassword={props.session.user.mustChangePassword} />
                    </div>
                  </div>
                  <div className="card shadow-sm border-0 mt-3">
                    <div className="card-header bg-white"><h3 className="card-title font-weight-bold"><i className="fas fa-info-circle mr-2 text-info"></i>Datos Actuales</h3></div>
                    <div className="card-body small">
                      <p className="mb-1"><strong>CUIT:</strong> {arcaConfig.cuit || '—'}</p>
                      <p className="mb-1"><strong>Pto. Vta:</strong> {arcaConfig.ptoVta}</p>
                      <p className="mb-1"><strong>Habilitado:</strong> <span className={`badge ${arcaConfig.enabled ? 'badge-success' : 'badge-secondary'}`}>{arcaConfig.enabled ? 'Sí' : 'No'}</span></p>
                      <p className="mb-0"><strong>Modo Mock:</strong> <span className={`badge ${arcaConfig.mock ? 'badge-warning' : 'badge-success'}`}>{arcaConfig.mock ? 'Sí' : 'No'}</span></p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'notificaciones' && (
              <div className="row">
                <div className="col-12">
                  <div className="card shadow-sm border-0">
                    <div className="card-header bg-white"><h3 className="card-title font-weight-bold"><i className="fas fa-bell mr-2 text-warning"></i>Notificaciones y Alertas ({alerts.length})</h3></div>
                    <div className="card-body p-0">
                      {alerts.length === 0 ? (
                        <p className="text-center text-muted p-4">Sin notificaciones registradas</p>
                      ) : (
                        <table className="table table-hover m-0">
                          <thead className="bg-light"><tr><th>Dispositivo</th><th>Tipo</th><th>Mensaje</th><th>Estado</th></tr></thead>
                          <tbody>{alerts.map(a => (
                            <tr key={a._id}>
                              <td className="font-weight-bold">{a.deviceId}</td>
                              <td><span className={`badge ${a.type === 'critical_level' ? 'badge-danger' : 'badge-secondary'}`}>{a.type}</span></td>
                              <td>{a.message}</td>
                              <td><span className={`badge ${a.status === 'open' ? 'badge-danger' : 'badge-success'}`}>{a.status}</span></td>
                            </tr>
                          ))}</tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'reportes' && (
              <div className="row">
                <div className="col-md-6">
                  <div className="card shadow-sm border-0">
                    <div className="card-header bg-white"><h3 className="card-title font-weight-bold"><i className="fas fa-chart-bar mr-2 text-info"></i>Resumen Operativo</h3></div>
                    <div className="card-body">
                      <div className="border rounded p-3 mb-3">
                        <div className="d-flex justify-content-between mb-2"><span>Dispositivos Totales</span><span className="font-weight-bold">{stats.total}</span></div>
                        <div className="d-flex justify-content-between mb-2"><span>Online</span><span className="font-weight-bold text-success">{stats.online}</span></div>
                        <div className="d-flex justify-content-between mb-2"><span>Offline/Críticos</span><span className="font-weight-bold text-danger">{stats.offline}</span></div>
                        <div className="d-flex justify-content-between"><span>Alertas Abiertas</span><span className="font-weight-bold text-warning">{stats.alerts}</span></div>
                      </div>
                      <div className="border rounded p-3">
                        <div className="d-flex justify-content-between mb-2"><span>Clientes</span><span className="font-weight-bold">{stats.tenants}</span></div>
                        <div className="d-flex justify-content-between mb-2"><span>Usuarios</span><span className="font-weight-bold">{stats.users}</span></div>
                        <div className="d-flex justify-content-between"><span>Facturas</span><span className="font-weight-bold">{invoices.length}</span></div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-md-6">
                  <div className="card shadow-sm border-0">
                    <div className="card-header bg-white"><h3 className="card-title font-weight-bold"><i className="fas fa-chart-pie mr-2 text-primary"></i>Estado de Dispositivos</h3></div>
                    <div className="card-body text-center">
                      <div className="h1 font-weight-bold text-success">{stats.online}</div>
                      <div className="text-muted small">Dispositivos Online</div>
                      <div className="progress mt-3" style={{ height: '10px' }}>
                        <div className="progress-bar bg-success" style={{ width: stats.total > 0 ? `${(stats.online / stats.total) * 100}%` : '0%' }}></div>
                        <div className="progress-bar bg-danger" style={{ width: stats.total > 0 ? `${(stats.offline / stats.total) * 100}%` : '0%' }}></div>
                      </div>
                      <div className="d-flex justify-content-between mt-1 small text-muted">
                        <span>Online</span><span>Offline/Críticos</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'actividad' && (
              <div className="row">
                <div className="col-12">
                  <div className="card shadow-sm border-0">
                    <div className="card-header bg-white"><h3 className="card-title font-weight-bold"><i className="fas fa-history mr-2 text-secondary"></i>Registro de Actividad</h3></div>
                    <div className="card-body p-0">
                      <table className="table table-hover m-0">
                        <thead className="bg-light"><tr><th>Fecha</th><th>Evento</th><th>Detalle</th></tr></thead>
                        <tbody>
                          {[
                            { date: new Date().toLocaleString('es-AR'), event: 'Acceso', detail: `Login exitoso: ${props.session.user.email}` },
                            { date: new Date().toLocaleString('es-AR'), event: 'Sesión', detail: `Rol: ${props.session.user.role} | Tenant: ${props.session.user.tenantId}` },
                            { date: new Date().toLocaleString('es-AR'), event: 'Dispositivos', detail: `${stats.total} dispositivos cargados para ${tenantId}` },
                            { date: new Date().toLocaleString('es-AR'), event: 'Alertas', detail: `${stats.alerts} alertas abiertas` },
                          ].map((row, i) => (
                            <tr key={i}>
                              <td className="small text-muted">{row.date}</td>
                              <td><span className="badge badge-info">{row.event}</span></td>
                              <td className="small">{row.detail}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        </section>
      </div>

      {showAddClient && (
        <div className="modal-backdrop-custom" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={e => { if ((e.target as HTMLElement) === e.currentTarget) setShowAddClient(false); }}>
          <div className="modal-dialog modal-dialog-centered" style={{ width: '100%', maxWidth: '600px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', margin: '1rem' }}>
            <div className="modal-content" style={{ display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
              <div className="modal-header bg-primary text-white">
                <h5 className="modal-title"><i className="fas fa-building mr-2"></i>Agregar Nuevo Cliente</h5>
                <button type="button" className="close text-white" onClick={() => setShowAddClient(false)}>
                  <span>&times;</span>
                </button>
              </div>
              <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
                <div className="form-group">
                  <label className="small font-weight-bold">Nombre de la Empresa *</label>
                  <input className="form-control" value={newClient.companyName}
                    onChange={e => setNewClient(p => ({ ...p, companyName: e.target.value }))}
                    placeholder="Estancia Don Juan" />
                </div>
                <div className="row">
                  <div className="col-md-6">
                    <div className="form-group">
                      <label className="small font-weight-bold">Nombre del Contacto</label>
                      <input className="form-control" value={newClient.contactName}
                        onChange={e => setNewClient(p => ({ ...p, contactName: e.target.value }))}
                        placeholder="Juan Perez" />
                    </div>
                  </div>
                  <div className="col-md-6">
                    <div className="form-group">
                      <label className="small font-weight-bold">Teléfono</label>
                      <input className="form-control" value={newClient.phone}
                        onChange={e => setNewClient(p => ({ ...p, phone: e.target.value }))}
                        placeholder="+54 9 11 1234-5678" />
                    </div>
                  </div>
                </div>
                <div className="form-group">
                  <label className="small font-weight-bold">Email de Contacto *</label>
                  <input className="form-control" type="email" value={newClient.email}
                    onChange={e => setNewClient(p => ({ ...p, email: e.target.value }))}
                    placeholder="contacto@estancia.com" />
                </div>
                <div className="form-group">
                  <label className="small font-weight-bold">Dirección</label>
                  <input className="form-control" value={newClient.address}
                    onChange={e => setNewClient(p => ({ ...p, address: e.target.value }))}
                    placeholder="Ruta 2 km 45, Pcia. de Buenos Aires" />
                </div>
                <div className="form-group">
                  <label className="small font-weight-bold">Plan</label>
                  <select className="form-control" value={newClient.planId}
                    onChange={e => setNewClient(p => ({ ...p, planId: e.target.value }))}>
                    <option value="">Seleccionar plan...</option>
                    {plans.map(p => <option key={p._id} value={p._id}>{p.name} - ${p.monthlyPriceArs.toLocaleString('es-AR')}/mes</option>)}
                  </select>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-default" onClick={() => setShowAddClient(false)}>Cancelar</button>
                <button type="button" className="btn btn-success"
                  disabled={!newClient.companyName || !newClient.email || creatingClient}
                  onClick={async () => {
                    setCreatingClient(true);
                    try {
                      const res = await postJson('/tenants', {
                        companyName: newClient.companyName,
                        contactName: newClient.contactName,
                        email: newClient.email,
                        phone: newClient.phone,
                        address: newClient.address,
                        planId: newClient.planId || undefined
                      }, props.session.token);
                      const data = await res.json() as { tenantId: string };
                      setShowAddClient(false);
                      setNewClient({ companyName: '', contactName: '', email: '', phone: '', address: '', planId: '' });
                      setTenantId(data.tenantId);
                      setTenantInput(data.tenantId);
                      void loadClients();
                    } catch {
                      alert('Error al crear el cliente');
                    } finally {
                      setCreatingClient(false);
                    }
                  }}>
                  {creatingClient ? 'Creando...' : <><i className="fas fa-check mr-1"></i>Crear Cliente</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="main-footer" style={{ marginLeft: sidebarCollapsed ? '0' : '250px', transition: 'margin-left 0.2s' }}>
        <div className="float-right d-none d-sm-inline-block">
          <strong>AgroSentinel Enterprise</strong> &copy; 2026
        </div>
        <strong>Plataforma de monitoreo IoT para aguadas rurales</strong>
      </footer>
    </div>
  );
}

export function App() {
  const appMode = import.meta.env.VITE_APP_MODE ?? 'public';
  const path = window.location.pathname;
  const isClientPanel = path.startsWith('/panel') || path.startsWith('/panel-cliente');
  const isCompanyPanel = path.startsWith('/admin-empresa') || path.startsWith('/empresa');
  const [session, setSession] = useState<AuthSession | null>(() => loadStoredSession());

  const login = (next: AuthSession) => {
    setSession(next);
    saveSession(next);
  };

  const logout = () => {
    setSession(null);
    saveSession(null);
  };

  useEffect(() => {
    const current = loadStoredSession();
    if (!current?.token) return;
    void getJson<AuthUser>('/auth/me', current.token).catch(() => {
      setSession(null);
      saveSession(null);
    });
  }, []);

  if (isCompanyPanel || appMode === 'company') {
    if (!session) {
      return (
        <LoginPanel
          title="Ingreso administracion empresa"
          allowedRoles={['company_admin']}
          onAuthenticated={login}
        />
      );
    }
    if (session.user.role !== 'company_admin') {
      return (
        <LoginPanel
          title="Acceso denegado para este usuario"
          allowedRoles={['company_admin']}
          onAuthenticated={login}
        />
      );
    }
    return <CompanyAdminPanel session={session} onLogout={logout} />;
  }

  if (isClientPanel) {
    if (!session) {
      return (
        <LoginPanel
          title="Ingreso panel cliente"
          allowedRoles={['owner', 'operator', 'technician']}
          onAuthenticated={login}
        />
      );
    }
    if (session.user.role === 'company_admin') {
      return (
        <LoginPanel
          title="Este acceso es solo para usuarios de cliente"
          allowedRoles={['owner', 'operator', 'technician']}
          onAuthenticated={login}
        />
      );
    }
    return <ClientPanel session={session} onLogout={logout} />;
  }

  return <LandingPage />;
}
