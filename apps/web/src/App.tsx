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

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'devices' | 'alerts' | 'billing'>('dashboard');

  return (
    <div className={`wrapper ${sidebarCollapsed ? 'sidebar-collapse' : ''}`} style={{ minHeight: '100vh' }}>
      {/* Navbar */}
      <nav className="main-header navbar navbar-expand navbar-white navbar-light">
        <ul className="navbar-nav">
          <li className="nav-item">
            <button className="nav-link btn btn-link" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
              <i className="fas fa-bars"></i>
            </button>
          </li>
          <li className="nav-item d-none d-sm-inline-block">
            <a href="/" className="nav-link">Inicio</a>
          </li>
        </ul>

        <ul className="navbar-nav ml-auto">
          <li className="nav-item">
            <button className="nav-link btn btn-link" onClick={props.onLogout}>
              <i className="fas fa-sign-out-alt mr-1"></i> Cerrar sesión
            </button>
          </li>
        </ul>
      </nav>

      {/* Main Sidebar */}
      <aside className="main-sidebar sidebar-dark-success elevation-4">
        <a href="#" className="brand-link">
          <span className="brand-text font-weight-light">AgroSentinel <strong>Cliente</strong></span>
        </a>

        <div className="sidebar">
          <div className="user-panel mt-3 pb-3 mb-3 d-flex">
            <div className="info">
              <a href="#" className="d-block">{props.session.user.email}</a>
            </div>
          </div>

          <nav className="mt-2">
            <ul className="nav nav-pills nav-sidebar flex-column" data-widget="treeview" role="menu">
              <li className="nav-item">
                <button
                  className={`nav-link ${activeTab === 'dashboard' ? 'active' : ''}`}
                  onClick={() => setActiveTab('dashboard')}
                >
                  <i className="nav-icon fas fa-tachometer-alt"></i>
                  <p>Dashboard</p>
                </button>
              </li>
              <li className="nav-item">
                <button
                  className={`nav-link ${activeTab === 'devices' ? 'active' : ''}`}
                  onClick={() => setActiveTab('devices')}
                >
                  <i className="nav-icon fas fa-microchip"></i>
                  <p>Dispositivos</p>
                </button>
              </li>
              <li className="nav-item">
                <button
                  className={`nav-link ${activeTab === 'alerts' ? 'active' : ''}`}
                  onClick={() => setActiveTab('alerts')}
                >
                  <i className="nav-icon fas fa-exclamation-triangle"></i>
                  <p>Alertas y Ordenes</p>
                </button>
              </li>
              <li className="nav-item">
                <button
                  className={`nav-link ${activeTab === 'billing' ? 'active' : ''}`}
                  onClick={() => setActiveTab('billing')}
                >
                  <i className="nav-icon fas fa-file-invoice-dollar"></i>
                  <p>Facturación y Config</p>
                </button>
              </li>
              <li className="nav-header">ADMINISTRACIÓN</li>
              <li className="nav-item">
                <a href="/admin-empresa" className="nav-link">
                  <i className="nav-icon fas fa-user-shield"></i>
                  <p>Panel Empresa</p>
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </aside>

      {/* Content Wrapper */}
      <div className="content-wrapper">
        <div className="content-header">
          <div className="container-fluid">
            <div className="row mb-2">
              <div className="col-sm-6">
                <h1 className="m-0">Operación AgroSentinel</h1>
              </div>
            </div>
          </div>
        </div>

        <section className="content">
          <div className="container-fluid">
            {/* KPI Boxes */}
            <div className="row">
              <div className="col-lg-3 col-6">
                <div className="small-box bg-info">
                  <div className="inner">
                    <h3>{stats.total}</h3>
                    <p>Dispositivos</p>
                  </div>
                  <div className="icon">
                    <i className="fas fa-microchip"></i>
                  </div>
                </div>
              </div>
              <div className="col-lg-3 col-6">
                <div className="small-box bg-success">
                  <div className="inner">
                    <h3>{stats.online}</h3>
                    <p>Online</p>
                  </div>
                  <div className="icon">
                    <i className="fas fa-check-circle"></i>
                  </div>
                </div>
              </div>
              <div className="col-lg-3 col-6">
                <div className="small-box bg-danger">
                  <div className="inner">
                    <h3>{stats.critical}</h3>
                    <p>Críticos</p>
                  </div>
                  <div className="icon">
                    <i className="fas fa-exclamation-circle"></i>
                  </div>
                </div>
              </div>
              <div className="col-lg-3 col-6">
                <div className="small-box bg-warning">
                  <div className="inner">
                    <h3>{stats.alerts}</h3>
                    <p>Alertas abiertas</p>
                  </div>
                  <div className="icon">
                    <i className="fas fa-bell"></i>
                  </div>
                </div>
              </div>
            </div>

            {activeTab === 'dashboard' && (
              <div className="row">
                <div className="col-12">
                  <div className="card">
                    <div className="card-header">
                      <h3 className="card-title">Mapa de dispositivos</h3>
                    </div>
                    <div className="card-body p-0">
                      <MapContainer center={[-34.62, -58.43]} zoom={10} style={{ height: '450px' }}>
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
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'devices' && (
              <div className="row">
                {devices.map(d => (
                  <div key={d._id} className="col-md-4">
                    <div className={`card card-outline card-${d.status === 'online' ? 'success' : d.status === 'warning' ? 'warning' : 'danger'}`}>
                      <div className="card-header">
                        <h3 className="card-title">{d.name}</h3>
                        <div className="card-tools">
                          <span className={`badge bg-${d.status === 'online' ? 'success' : d.status === 'warning' ? 'warning' : 'danger'}`}>
                            {d.status}
                          </span>
                        </div>
                      </div>
                      <div className="card-body">
                        <p className="mb-1"><strong>ID:</strong> {d.deviceId}</p>
                        <p className="mb-1"><strong>Nivel:</strong> {d.levelPct}%</p>
                        <p className="mb-1"><strong>Reserva:</strong> {d.reserveLiters} L</p>
                        <p className="mb-3"><strong>Bomba:</strong> {d.pumpOn ? 'Encendida' : 'Apagada'}</p>
                        <div className="d-flex" style={{ gap: '5px' }}>
                          <button className="btn btn-sm btn-success flex-fill" onClick={() => void pumpCommand(d.deviceId, 'pump_on')}>
                            Encender
                          </button>
                          <button className="btn btn-sm btn-secondary flex-fill" onClick={() => void pumpCommand(d.deviceId, 'pump_off')}>
                            Apagar
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'alerts' && (
              <div className="row">
                <div className="col-md-6">
                  <div className="card">
                    <div className="card-header">
                      <h3 className="card-title">Alertas Recientes</h3>
                    </div>
                    <div className="card-body p-0">
                      <table className="table table-sm">
                        <thead>
                          <tr>
                            <th>Equipo</th>
                            <th>Mensaje</th>
                            <th>Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {alerts.map(a => (
                            <tr key={a._id}>
                              <td>{a.deviceId}</td>
                              <td>{a.message}</td>
                              <td>
                                <span className={`badge bg-${a.status === 'open' ? 'danger' : 'success'}`}>{a.status}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
                <div className="col-md-6">
                  <div className="card">
                    <div className="card-header">
                      <h3 className="card-title">Ordenes de trabajo</h3>
                    </div>
                    <div className="card-body p-0">
                      <table className="table table-sm">
                        <thead>
                          <tr>
                            <th>Título</th>
                            <th>Estado</th>
                            <th>Acción</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orders.map(o => (
                            <tr key={o._id}>
                              <td>
                                <strong>{o.title}</strong><br/>
                                <small className="text-muted">{o.description}</small>
                              </td>
                              <td>
                                <span className={`badge bg-${o.status === 'closed' ? 'success' : o.status === 'in_progress' ? 'warning' : 'danger'}`}>
                                  {o.status}
                                </span>
                              </td>
                              <td>
                                {o.status !== 'closed' && (
                                  <button className="btn btn-xs btn-outline-success" onClick={() => void closeOrder(o._id)}>
                                    Cerrar
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'billing' && (
              <>
                <div className="row">
                  <div className="col-12">
                    <div className="card">
                      <div className="card-header bg-navy">
                        <h3 className="card-title">Facturación (ARCA)</h3>
                      </div>
                      <div className="card-body p-0">
                        <table className="table table-striped table-valign-middle">
                          <thead>
                            <tr>
                              <th>Periodo</th>
                              <th>Monto</th>
                              <th>Estado</th>
                              <th>Cae / Cbte</th>
                            </tr>
                          </thead>
                          <tbody>
                            {invoices.map(inv => (
                              <tr key={inv._id}>
                                <td>{inv.period}</td>
                                <td>${inv.amountArs.toLocaleString('es-AR')}</td>
                                <td>
                                  <span className={`badge bg-${inv.status === 'paid' ? 'success' : 'warning'}`}>{inv.status}</span>
                                </td>
                                <td>
                                  <small>
                                    Cae: {inv.arca?.cae ?? '-'}<br/>
                                    Nro: {inv.arca?.cbteNro ?? '-'}
                                  </small>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="row">
                  <div className="col-12">
                    <div className="card card-info">
                      <div className="card-header">
                        <h3 className="card-title">Configuración ARCA</h3>
                      </div>
                      <div className="card-body">
                        <div className="row">
                          <div className="col-md-3 form-group">
                            <label>Habilitar</label>
                            <select
                              className="form-control"
                              value={arcaConfig.enabled ? 'yes' : 'no'}
                              onChange={e => setArcaConfig(prev => ({ ...prev, enabled: e.target.value === 'yes' }))}
                            >
                              <option value="no">No</option>
                              <option value="yes">Si</option>
                            </select>
                          </div>
                          <div className="col-md-3 form-group">
                            <label>Modo</label>
                            <select
                              className="form-control"
                              value={arcaConfig.mock ? 'yes' : 'no'}
                              onChange={e => setArcaConfig(prev => ({ ...prev, mock: e.target.value === 'yes' }))}
                            >
                              <option value="yes">Pruebas</option>
                              <option value="no">Real</option>
                            </select>
                          </div>
                          <div className="col-md-3 form-group">
                            <label>CUIT</label>
                            <input className="form-control" value={arcaConfig.cuit} onChange={e => setArcaConfig(prev => ({ ...prev, cuit: e.target.value }))} />
                          </div>
                          <div className="col-md-3 form-group">
                            <label>P.Venta</label>
                            <input className="form-control" value={arcaConfig.ptoVta} onChange={e => setArcaConfig(prev => ({ ...prev, ptoVta: e.target.value }))} />
                          </div>
                          <div className="col-12 form-group">
                            <label>WSFE URL</label>
                            <input className="form-control" value={arcaConfig.wsfeUrl} onChange={e => setArcaConfig(prev => ({ ...prev, wsfeUrl: e.target.value }))} />
                          </div>
                          <div className="col-md-6 form-group">
                            <label>Token WSAA</label>
                            <textarea
                              className="form-control"
                              value={arcaConfig.token ?? ''}
                              onChange={e => setArcaConfig(prev => ({ ...prev, token: e.target.value }))}
                              rows={2}
                            />
                          </div>
                          <div className="col-md-6 form-group">
                            <label>Sign WSAA</label>
                            <textarea
                              className="form-control"
                              value={arcaConfig.sign ?? ''}
                              onChange={e => setArcaConfig(prev => ({ ...prev, sign: e.target.value }))}
                              rows={2}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="card-footer text-right">
                        <button className="btn btn-info" onClick={() => void saveArcaConfig()} disabled={savingArca}>
                          <i className="fas fa-save mr-1"></i> {savingArca ? 'Guardando...' : 'Guardar Configuración'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="row mt-4">
              <div className="col-12">
                <div className="card card-outline card-secondary">
                  <div className="card-header">
                    <h3 className="card-title">Gestión de Seguridad</h3>
                  </div>
                  <div className="card-body">
                    <PasswordSection token={props.session.token} mustChangePassword={props.session.user.mustChangePassword} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <footer className="main-footer">
        <div className="float-right d-none d-sm-inline">
          AgroSentinel v3.2
        </div>
        <strong>&copy; 2026 <a href="/">AgroSentinel</a>.</strong>
      </footer>
    </div>
  );
}

function CompanyAdminPanel(props: { session: AuthSession; onLogout: () => void }) {
  const [mainMenu, setMainMenu] = useState<'clientes' | 'planes_facturacion'>('clientes');
  const [subMenu, setSubMenu] = useState<'sensores' | 'usuarios' | 'planes' | 'arca'>('sensores');
  const [openMenus, setOpenMenus] = useState({ clientes: true, planes_facturacion: true });
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

  const selectMainMenu = (menu: 'clientes' | 'planes_facturacion') => {
    setMainMenu(menu);
    if (menu === 'clientes') setSubMenu('sensores');
    if (menu === 'planes_facturacion') setSubMenu('planes');
  };

  return (
    <div className={`wrapper ${sidebarCollapsed ? 'sidebar-collapse' : ''}`} style={{ minHeight: '100vh' }}>
      {/* Navbar */}
      <nav className="main-header navbar navbar-expand navbar-white navbar-light">
        <ul className="navbar-nav">
          <li className="nav-item">
            <button className="nav-link btn btn-link" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
              <i className="fas fa-bars"></i>
            </button>
          </li>
          <li className="nav-item d-none d-sm-inline-block">
            <a href="/" className="nav-link">Inicio</a>
          </li>
        </ul>

        <ul className="navbar-nav ml-auto">
          <li className="nav-item">
            <button className="nav-link btn btn-link" onClick={props.onLogout}>
              <i className="fas fa-sign-out-alt mr-1"></i> Cerrar sesión
            </button>
          </li>
        </ul>
      </nav>

      {/* Main Sidebar */}
      <aside className="main-sidebar sidebar-dark-primary elevation-4">
        <a href="#" className="brand-link">
          <span className="brand-text font-weight-light">AgroSentinel <strong>Admin</strong></span>
        </a>

        <div className="sidebar">
          <div className="user-panel mt-3 pb-3 mb-3 d-flex">
            <div className="info">
              <a href="#" className="d-block">{props.session.user.email}</a>
            </div>
          </div>

          <nav className="mt-2">
            <ul className="nav nav-pills nav-sidebar flex-column" data-widget="treeview" role="menu">
              <li className={`nav-item ${openMenus.clientes ? 'menu-open' : ''}`}>
                <button
                  className={`nav-link ${mainMenu === 'clientes' ? 'active' : ''}`}
                  onClick={() => {
                    selectMainMenu('clientes');
                    setOpenMenus(prev => ({ ...prev, clientes: !prev.clientes }));
                  }}
                >
                  <i className="nav-icon fas fa-users"></i>
                  <p>
                    Clientes
                    <i className="right fas fa-angle-left"></i>
                  </p>
                </button>
                <ul className="nav nav-treeview" style={{ display: openMenus.clientes ? 'block' : 'none' }}>
                  <li className="nav-item">
                    <button
                      className={`nav-link ${subMenu === 'sensores' ? 'active' : ''}`}
                      onClick={() => {
                        setMainMenu('clientes');
                        setSubMenu('sensores');
                      }}
                    >
                      <i className="far fa-circle nav-icon text-info"></i>
                      <p>Sensores</p>
                    </button>
                  </li>
                  <li className="nav-item">
                    <button
                      className={`nav-link ${subMenu === 'usuarios' ? 'active' : ''}`}
                      onClick={() => {
                        setMainMenu('clientes');
                        setSubMenu('usuarios');
                      }}
                    >
                      <i className="far fa-circle nav-icon text-warning"></i>
                      <p>Usuarios</p>
                    </button>
                  </li>
                </ul>
              </li>

              <li className={`nav-item ${openMenus.planes_facturacion ? 'menu-open' : ''}`}>
                <button
                  className={`nav-link ${mainMenu === 'planes_facturacion' ? 'active' : ''}`}
                  onClick={() => {
                    selectMainMenu('planes_facturacion');
                    setOpenMenus(prev => ({ ...prev, planes_facturacion: !prev.planes_facturacion }));
                  }}
                >
                  <i className="nav-icon fas fa-file-invoice-dollar"></i>
                  <p>
                    Planes y Facturacion
                    <i className="right fas fa-angle-left"></i>
                  </p>
                </button>
                <ul className="nav nav-treeview" style={{ display: openMenus.planes_facturacion ? 'block' : 'none' }}>
                  <li className="nav-item">
                    <button
                      className={`nav-link ${subMenu === 'planes' ? 'active' : ''}`}
                      onClick={() => {
                        setMainMenu('planes_facturacion');
                        setSubMenu('planes');
                      }}
                    >
                      <i className="far fa-circle nav-icon"></i>
                      <p>Planes base</p>
                    </button>
                  </li>
                  <li className="nav-item">
                    <button
                      className={`nav-link ${subMenu === 'arca' ? 'active' : ''}`}
                      onClick={() => {
                        setMainMenu('planes_facturacion');
                        setSubMenu('arca');
                      }}
                    >
                      <i className="far fa-circle nav-icon"></i>
                      <p>Configuración ARCA</p>
                    </button>
                  </li>
                </ul>
              </li>
            </ul>
          </nav>
        </div>
      </aside>

      {/* Content Wrapper */}
      <div className="content-wrapper">
        <div className="content-header">
          <div className="container-fluid">
            <div className="row mb-2">
              <div className="col-sm-6">
                <h1 className="m-0">{mainMenu === 'clientes' ? 'Gestión de Clientes' : 'Planes y Facturación'}</h1>
              </div>
              <div className="col-sm-6">
                <div className="float-sm-right d-flex align-items-center" style={{ gap: '10px' }}>
                  <label className="m-0 text-muted small">Tenant activo:</label>
                  <div className="input-group input-group-sm" style={{ width: '200px' }}>
                    <input
                      className="form-control"
                      value={tenantInput}
                      onChange={e => setTenantInput(e.target.value)}
                      placeholder="cliente-a"
                    />
                    <span className="input-group-append">
                      <button className="btn btn-info" onClick={() => setTenantId(tenantInput.trim() || DEFAULT_TENANT_ID)}>
                        <i className="fas fa-sync-alt"></i>
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <section className="content">
          <div className="container-fluid">
            {/* KPI Boxes */}
            <div className="row">
              <div className="col-lg-3 col-6">
                <div className="small-box bg-info">
                  <div className="inner">
                    <h3>{new Set(users.map(user => user.tenantId)).size || 1}</h3>
                    <p>Clientes activos</p>
                  </div>
                  <div className="icon">
                    <i className="fas fa-city"></i>
                  </div>
                </div>
              </div>
              <div className="col-lg-3 col-6">
                <div className="small-box bg-success">
                  <div className="inner">
                    <h3>{devices.length}</h3>
                    <p>Sensores registrados</p>
                  </div>
                  <div className="icon">
                    <i className="fas fa-microchip"></i>
                  </div>
                </div>
              </div>
              <div className="col-lg-3 col-6">
                <div className="small-box bg-warning">
                  <div className="inner">
                    <h3>{users.length}</h3>
                    <p>Usuarios del tenant</p>
                  </div>
                  <div className="icon">
                    <i className="fas fa-user-plus"></i>
                  </div>
                </div>
              </div>
              <div className="col-lg-3 col-6">
                <div className="small-box bg-danger">
                  <div className="inner">
                    <h3>{invoices.length}</h3>
                    <p>Facturas emitidas</p>
                  </div>
                  <div className="icon">
                    <i className="fas fa-file-invoice"></i>
                  </div>
                </div>
              </div>
            </div>

            <div className="row">
              <div className="col-12">
                {mainMenu === 'clientes' && subMenu === 'sensores' && (
                  <>
                    <div className="card card-primary">
                      <div className="card-header">
                        <h3 className="card-title">Alta de sensores para cliente</h3>
                      </div>
                      <div className="card-body">
                        <div className="row">
                          <div className="col-md-6 form-group">
                            <label>Device ID</label>
                            <input
                              className="form-control"
                              value={newDevice.deviceId}
                              onChange={e => setNewDevice(prev => ({ ...prev, deviceId: e.target.value }))}
                              placeholder="ESP32-CENTRO-001"
                            />
                          </div>
                          <div className="col-md-6 form-group">
                            <label>Nombre</label>
                            <input
                              className="form-control"
                              value={newDevice.name}
                              onChange={e => setNewDevice(prev => ({ ...prev, name: e.target.value }))}
                              placeholder="Tanque centro"
                            />
                          </div>
                          <div className="col-md-6 form-group">
                            <label>Latitud</label>
                            <input className="form-control" value={newDevice.lat} onChange={e => setNewDevice(prev => ({ ...prev, lat: e.target.value }))} />
                          </div>
                          <div className="col-md-6 form-group">
                            <label>Longitud</label>
                            <input className="form-control" value={newDevice.lng} onChange={e => setNewDevice(prev => ({ ...prev, lng: e.target.value }))} />
                          </div>
                          <div className="col-12 form-group">
                            <label>Dirección</label>
                            <input
                              className="form-control"
                              value={newDevice.address}
                              onChange={e => setNewDevice(prev => ({ ...prev, address: e.target.value }))}
                              placeholder="Lote 2"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="card-footer">
                        <button
                          className="btn btn-primary"
                          onClick={() => void createDevice()}
                          disabled={creatingDevice || !newDevice.deviceId || !newDevice.name}
                        >
                          <i className="fas fa-plus mr-1"></i> {creatingDevice ? 'Creando...' : 'Crear nuevo sensor'}
                        </button>
                      </div>
                    </div>

                    <div className="card">
                      <div className="card-header">
                        <h3 className="card-title">Sensores del cliente activo</h3>
                      </div>
                      <div className="card-body p-0">
                        <table className="table table-striped table-valign-middle">
                          <thead>
                            <tr>
                              <th>Nombre</th>
                              <th>Device ID</th>
                              <th>Estado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {devices.map(d => (
                              <tr key={d._id}>
                                <td>{d.name}</td>
                                <td>{d.deviceId}</td>
                                <td>
                                  <span className={`badge bg-${d.status === 'online' ? 'success' : d.status === 'warning' ? 'warning' : 'danger'}`}>
                                    {d.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}

                {mainMenu === 'clientes' && subMenu === 'usuarios' && (
                  <div className="row">
                    <div className="col-md-7">
                      <div className="card card-outline card-primary">
                        <div className="card-header">
                          <h3 className="card-title">Usuarios del cliente</h3>
                        </div>
                        <div className="card-body p-0">
                          <table className="table table-sm">
                            <thead>
                              <tr>
                                <th>Nombre</th>
                                <th>Email</th>
                                <th>Rol / Estado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {users.map(user => (
                                <tr key={user.id}>
                                  <td>{user.name}</td>
                                  <td>{user.email}</td>
                                  <td>
                                    <span className="badge bg-secondary mr-1">{user.role}</span>
                                    {user.mustChangePassword && <span className="badge bg-warning text-dark">Pend. clave</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                    <div className="col-md-5">
                      <div className="card card-success">
                        <div className="card-header">
                          <h3 className="card-title">Alta de nuevo usuario</h3>
                        </div>
                        <div className="card-body">
                          <div className="form-group">
                            <label>Nombre</label>
                            <input
                              className="form-control form-control-sm"
                              value={newUser.name}
                              onChange={e => setNewUser(prev => ({ ...prev, name: e.target.value }))}
                            />
                          </div>
                          <div className="form-group">
                            <label>Email</label>
                            <input
                              className="form-control form-control-sm"
                              value={newUser.email}
                              onChange={e => setNewUser(prev => ({ ...prev, email: e.target.value }))}
                            />
                          </div>
                          <div className="form-group">
                            <label>Rol</label>
                            <select
                              className="form-control form-control-sm"
                              value={newUser.role}
                              onChange={e =>
                                setNewUser(prev => ({ ...prev, role: e.target.value as 'owner' | 'operator' | 'technician' }))
                              }
                            >
                              <option value="owner">owner</option>
                              <option value="operator">operator</option>
                              <option value="technician">technician</option>
                            </select>
                          </div>
                          <div className="form-group">
                            <label>Contraseña inicial</label>
                            <input
                              className="form-control form-control-sm"
                              type="password"
                              value={newUser.password}
                              onChange={e => setNewUser(prev => ({ ...prev, password: e.target.value }))}
                            />
                          </div>
                        </div>
                        <div className="card-footer text-right">
                          <button
                            className="btn btn-success btn-sm"
                            onClick={() => void createUser()}
                            disabled={creatingUser || !newUser.email || !newUser.name || !newUser.password}
                          >
                            {creatingUser ? 'Creando...' : 'Crear usuario de empresa'}
                          </button>
                        </div>
                      </div>

                      <div className="card card-warning card-outline">
                        <div className="card-header">
                          <h3 className="card-title">Resetear contraseña</h3>
                        </div>
                        <div className="card-body">
                          <div className="form-group">
                            <label>Seleccionar Usuario</label>
                            <select className="form-control form-control-sm" value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}>
                              <option value="">Seleccionar</option>
                              {users.map(user => (
                                <option key={user.id} value={user.id}>
                                  {user.email}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="form-group">
                            <label>Nueva contraseña</label>
                            <input className="form-control form-control-sm" type="password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} />
                          </div>
                        </div>
                        <div className="card-footer text-right">
                          <button className="btn btn-warning btn-sm" onClick={() => void resetUserPassword()} disabled={!selectedUserId || !resetPassword}>
                            Aplicar reset clave
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {mainMenu === 'planes_facturacion' && subMenu === 'planes' && (
                  <div className="row">
                    <div className="col-md-6">
                      <div className="card">
                        <div className="card-header bg-navy">
                          <h3 className="card-title">Esquemas de Planes</h3>
                        </div>
                        <div className="card-body p-0">
                          <table className="table">
                            <thead>
                              <tr>
                                <th>Plan</th>
                                <th>Precio</th>
                                <th>Equipos</th>
                              </tr>
                            </thead>
                            <tbody>
                              {plans.map(plan => (
                                <tr key={plan._id}>
                                  <td><strong>{plan.name}</strong></td>
                                  <td>${plan.monthlyPriceArs.toLocaleString('es-AR')}</td>
                                  <td>{plan.maxDevices} max.</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="card">
                        <div className="card-header bg-olive">
                          <h3 className="card-title">Facturas Recientes</h3>
                        </div>
                        <div className="card-body p-0">
                          <table className="table table-sm">
                            <thead>
                              <tr>
                                <th>Período</th>
                                <th>Monto</th>
                                <th>Estado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {invoices.map(inv => (
                                <tr key={inv._id}>
                                  <td>{inv.period}</td>
                                  <td>${inv.amountArs.toLocaleString('es-AR')}</td>
                                  <td>
                                    <span className={`badge ${inv.status === 'paid' ? 'bg-success' : 'bg-secondary'}`}>
                                      {inv.status}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {mainMenu === 'planes_facturacion' && subMenu === 'arca' && (
                  <div className="card card-info">
                    <div className="card-header">
                      <h3 className="card-title">Configuración ARCA por cliente</h3>
                    </div>
                    <div className="card-body">
                      <div className="row">
                        <div className="col-md-3 form-group">
                          <label>Habilitar ARCA</label>
                          <select
                            className="form-control"
                            value={arcaConfig.enabled ? 'yes' : 'no'}
                            onChange={e => setArcaConfig(prev => ({ ...prev, enabled: e.target.value === 'yes' }))}
                          >
                            <option value="no">No</option>
                            <option value="yes">Si</option>
                          </select>
                        </div>
                        <div className="col-md-3 form-group">
                          <label>Modo mock</label>
                          <select
                            className="form-control"
                            value={arcaConfig.mock ? 'yes' : 'no'}
                            onChange={e => setArcaConfig(prev => ({ ...prev, mock: e.target.value === 'yes' }))}
                          >
                            <option value="yes">Si (pruebas)</option>
                            <option value="no">No (real)</option>
                          </select>
                        </div>
                        <div className="col-md-3 form-group">
                          <label>CUIT</label>
                          <input className="form-control" value={arcaConfig.cuit} onChange={e => setArcaConfig(prev => ({ ...prev, cuit: e.target.value }))} />
                        </div>
                        <div className="col-md-3 form-group">
                          <label>Punto de venta</label>
                          <input
                            className="form-control"
                            value={arcaConfig.ptoVta}
                            onChange={e => setArcaConfig(prev => ({ ...prev, ptoVta: e.target.value }))}
                          />
                        </div>
                        <div className="col-12 form-group">
                          <label>WSFE URL</label>
                          <input
                            className="form-control"
                            value={arcaConfig.wsfeUrl}
                            onChange={e => setArcaConfig(prev => ({ ...prev, wsfeUrl: e.target.value }))}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="card-footer text-right">
                      <button className="btn btn-info" onClick={() => void saveArcaConfig()} disabled={savingArca}>
                        <i className="fas fa-save mr-1"></i> {savingArca ? 'Guardando...' : 'Guardar ARCA cliente'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="row mt-4">
              <div className="col-12">
                <div className="card card-outline card-secondary">
                  <div className="card-body">
                    <PasswordSection token={props.session.token} mustChangePassword={props.session.user.mustChangePassword} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <footer className="main-footer">
        <div className="float-right d-none d-sm-inline">
          AgroSentinel v3.2
        </div>
        <strong>&copy; 2026 <a href="/">AgroSentinel</a>.</strong> Todos los derechos reservados.
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
