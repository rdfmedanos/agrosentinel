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

type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'operator' | 'technician' | 'company_admin';
  tenantId: string;
  mustChangePassword: boolean;
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
            <button className="nav-link btn" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
              <i className="fas fa-bars"></i>
            </button>
          </li>
          <li className="nav-item d-none d-sm-inline-block">
            <a href="/" className="nav-link text-muted">Web Principal</a>
          </li>
        </ul>

        <ul className="navbar-nav ml-auto">
          <li className="nav-item">
            <button onClick={props.onLogout} className="btn nav-link">
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

function CompanyAdminPanel(props: { session: AuthSession; onLogout: () => void }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [tenantId, setTenantId] = useState(DEFAULT_TENANT_ID);
  const [tenantInput, setTenantInput] = useState(DEFAULT_TENANT_ID);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
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

  const loadCompanyData = async (targetTenant: string) => {
    const token = props.session.token;
    try {
      const [p, d, i, arca, tenantUsers] = await Promise.all([
        getJson<Plan[]>('/billing/plans', token),
        getJson<Device[]>(`/devices?tenantId=${targetTenant}`, token),
        getJson<Invoice[]>(`/billing/invoices?tenantId=${targetTenant}`, token),
        getJson<ArcaConfig>(`/billing/arca-config?tenantId=${targetTenant}`, token),
        getJson<AuthUser[]>(`/auth/admin/users?tenantId=${targetTenant}`, token)
      ]);

      setPlans(p);
      setDevices(d);
      setInvoices(i);
      setArcaConfig(arca);
      setUsers(tenantUsers);
    } catch (err) {
      console.error('Error loading company data:', err);
    }
  };

  useEffect(() => {
    void loadCompanyData(tenantId);
  }, [tenantId, props.session.token]);

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
        {
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
          tenantId,
          password: newUser.password
        },
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

  return (
    <div className={`wrapper ${sidebarCollapsed ? 'sidebar-collapse' : ''}`} style={{ minHeight: '100vh', backgroundColor: '#f4f6f9' }}>
      {/* Navbar */}
      <nav className="main-header navbar navbar-expand navbar-white navbar-light">
        <ul className="navbar-nav">
          <li className="nav-item">
            <button className="nav-link btn" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
              <i className="fas fa-bars"></i>
            </button>
          </li>
          <li className="nav-item d-none d-sm-inline-block">
            <a href="/" className="nav-link text-muted">Web Principal</a>
          </li>
          <li className="nav-item d-none d-sm-inline-block">
            <a href="/panel-cliente" className="nav-link text-muted">Panel Cliente</a>
          </li>
        </ul>

        <ul className="navbar-nav ml-auto">
          <li className="nav-item">
            <button onClick={props.onLogout} className="btn nav-link">
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
              <li className="nav-header">ADMINISTRACIÓN</li>
              <li className="nav-item">
                <a href="#" className="nav-link active">
                  <i className="nav-icon fas fa-building"></i>
                  <p>Consola Central</p>
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
                <h1 className="m-0 text-dark">Consola Central</h1>
              </div>
              <div className="col-sm-6 text-right">
                <span className="badge badge-info shadow-sm">Modo Admin Empresa</span>
              </div>
            </div>
          </div>
        </section>

        <section className="content">
          <div className="container-fluid">
            {/* Tenant Switcher */}
            <div className="card card-outline card-primary shadow-sm mb-4">
              <div className="card-header border-0">
                <h3 className="card-title text-primary font-weight-bold"><i className="fas fa-search mr-2"></i>Selección de Tenant Cliente</h3>
              </div>
              <div className="card-body">
                <div className="row align-items-center">
                  <div className="col-md-6">
                    <div className="input-group">
                      <input
                        className="form-control"
                        value={tenantInput}
                        onChange={e => setTenantInput(e.target.value)}
                        placeholder="Ej: tenant-123"
                      />
                      <div className="input-group-append">
                        <button className="btn btn-primary" onClick={() => setTenantId(tenantInput)}>
                           Cargar Datos
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-6 text-md-right mt-3 mt-md-0">
                    <p className="mb-0 text-muted">Viendo: <span className="font-weight-bold text-dark">{tenantId}</span></p>
                  </div>
                </div>
              </div>
            </div>

            <div className="row">
              {/* Billing Info */}
              <div className="col-lg-12">
                <div className="card shadow-sm border-0">
                  <div className="card-header bg-white">
                    <h3 className="card-title font-weight-bold"><i className="fas fa-file-invoice-dollar mr-2"></i>Facturación y Planes</h3>
                  </div>
                  <div className="card-body">
                    <div className="row">
                      <div className="col-md-6 border-right">
                        <h6 className="text-muted text-uppercase mb-3 small font-weight-bold">Planes Contratados</h6>
                        <div className="list-group list-group-flush shadow-sm rounded">
                           {plans.map(p => (
                             <div key={p._id} className="list-group-item d-flex justify-content-between align-items-center">
                               {p.name}
                               <span className="badge badge-pill badge-info">${p.monthlyPriceArs.toLocaleString('es-AR')}</span>
                             </div>
                           ))}
                        </div>
                      </div>
                      <div className="col-md-6 pl-md-4">
                        <h6 className="text-muted text-uppercase mb-3 small font-weight-bold">Historial de Pagos</h6>
                        <div className="list-group list-group-flush shadow-sm rounded">
                           {invoices.map(i => (
                             <div key={i._id} className="list-group-item d-flex justify-content-between align-items-center">
                               {i.period}
                               <span className={`badge ${i.status === 'paid' ? 'badge-success' : 'badge-warning'}`}>{i.status}</span>
                             </div>
                           ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Devices Management */}
            <div className="card shadow-sm mt-4 border-0">
              <div className="card-header bg-white">
                <h3 className="card-title font-weight-bold"><i className="fas fa-microchip mr-2"></i>Gestión de Sensores</h3>
              </div>
              <div className="card-body">
                <div className="row mb-4">
                  <div className="col-md-3">
                    <div className="form-group mb-0">
                      <label className="small font-weight-bold">Device ID</label>
                      <input className="form-control" value={newDevice.deviceId} onChange={e => setNewDevice(p => ({ ...p, deviceId: e.target.value }))} placeholder="ESP32-..." />
                    </div>
                  </div>
                  <div className="col-md-3">
                    <div className="form-group mb-0">
                      <label className="small font-weight-bold">Nombre</label>
                      <input className="form-control" value={newDevice.name} onChange={e => setNewDevice(p => ({ ...p, name: e.target.value }))} placeholder="Tanque Principal" />
                    </div>
                  </div>
                  <div className="col-md-4">
                    <div className="form-group mb-0">
                      <label className="small font-weight-bold">Dirección</label>
                      <input className="form-control" value={newDevice.address} onChange={e => setNewDevice(p => ({ ...p, address: e.target.value }))} placeholder="Ruta 2 km 45" />
                    </div>
                  </div>
                  <div className="col-md-2 d-flex align-items-end">
                    <button className="btn btn-success btn-block font-weight-bold" onClick={() => void createDevice()} disabled={creatingDevice}>
                       {creatingDevice ? '...' : 'Vincular'}
                    </button>
                  </div>
                </div>

                <div className="row">
                  {devices.map(d => (
                    <div key={d._id} className="col-md-3 col-sm-6 mb-3">
                      <div className="info-box shadow-none border m-0 h-100">
                        <span className="info-box-icon bg-light"><i className="fas fa-broadcast-tower text-muted"></i></span>
                        <div className="info-box-content">
                          <span className="info-box-text font-weight-bold">{d.name}</span>
                          <span className="info-box-number small text-muted">{d.deviceId}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Users & ARCA */}
            <div className="row mt-4 mb-5">
              <div className="col-md-8">
                <div className="card shadow-sm border-0 h-100">
                  <div className="card-header bg-white">
                    <h3 className="card-title font-weight-bold"><i className="fas fa-users mr-2"></i>Usuarios del Cliente</h3>
                  </div>
                  <div className="card-body p-0">
                    <div className="table-responsive">
                      <table className="table table-hover table-sm m-0">
                        <thead className="bg-light">
                          <tr><th>Email</th><th>Rol</th><th>Estatus</th></tr>
                        </thead>
                        <tbody>
                          {users.map(u => (
                            <tr key={u.id}>
                              <td>{u.email}</td>
                              <td><span className="badge badge-light border">{u.role}</span></td>
                              <td>{u.mustChangePassword ? <span className="text-warning small"><i className="fas fa-exclamation-triangle mr-1"></i>Pendiente</span> : <span className="text-success small">OK</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
              <div className="col-md-4">
                <div className="card shadow-sm border-0 h-100">
                  <div className="card-header bg-white">
                    <h3 className="card-title font-weight-bold"><i className="fas fa-shield-alt mr-2"></i>Configuración ARCA</h3>
                  </div>
                  <div className="card-body">
                    <div className="form-group font-weight-bold small">
                      <label>CUIT Asociado</label>
                      <input className="form-control" value={arcaConfig.cuit} onChange={e => setArcaConfig(p => ({ ...p, cuit: e.target.value }))} />
                    </div>
                    <div className="form-group font-weight-bold small">
                      <label>Punto de Venta</label>
                      <input className="form-control" value={arcaConfig.ptoVta} onChange={e => setArcaConfig(p => ({ ...p, ptoVta: e.target.value }))} />
                    </div>
                    <button className="btn btn-danger btn-block font-weight-bold mt-2" onClick={() => void saveArcaConfig()} disabled={savingArca}>
                       {savingArca ? '...' : 'Actualizar Datos Fiscales'}
                    </button>
                    <hr />
                    <PasswordSection token={props.session.token} mustChangePassword={props.session.user.mustChangePassword} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <footer className="main-footer text-center small text-muted">
        <strong>AgroSentinel Enterprise &copy; 2026</strong>
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
