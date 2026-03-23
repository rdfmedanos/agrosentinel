import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { io } from 'socket.io-client';
import { CircleMarker, MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';

type Device = {
  _id: string;
  deviceId: string;
  name: string;
  tenantId?: string;
  userId?: string;
  levelPct: number;
  reserveLiters: number;
  pumpOn: boolean;
  status: 'online' | 'warning' | 'critical' | 'offline';
  location: { lat: number; lng: number; address: string };
  lastHeartbeatAt?: string;
  createdAt?: string;
  clientName?: string;
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
  planId?: string;
  planName?: string;
};

type AuthSession = {
  token: string;
  user: AuthUser;
};

const API_URL = import.meta.env.VITE_API_URL ?? '/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? window.location.origin;

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

function saveNavState(state: { section: string; clientId?: string }) {
  localStorage.setItem('agrosentinel_nav', JSON.stringify(state));
}

function loadNavState(): { section: string; clientId?: string } | null {
  const stored = localStorage.getItem('agrosentinel_nav');
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

function markerColor(status: Device['status'], levelPct?: number, hasAlert?: boolean) {
  if (hasAlert || status === 'critical' || status === 'offline') return '#e11d48';
  if (status === 'warning' || (levelPct !== undefined && levelPct < 20)) return '#f59e0b';
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
          <p>Arquitectura modular para escalar dispositivos, tecnicos y sedes sin perder claridad operativa.</p>
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
  const [showPassword, setShowPassword] = useState(false);
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
    <main className="login-page">
      <div className="login-box">
        <div className="card card-outline card-primary">
          <div className="card-header text-center">
            <h1 className="h3 mb-0 font-weight-bold">AgroSentinel</h1>
            <p className="text-muted small mb-0 mt-1">{props.title}</p>
          </div>
          <div className="card-body">
            <p className="login-box-msg text-muted">Ingresar con email y contrasena.</p>
            <div className="mb-3">
              <label className="form-label small fw-semibold">Email</label>
              <input type="email" className="form-control" value={email} onChange={e => setEmail(e.target.value)} placeholder="usuario@dominio.com" />
            </div>
            <div className="mb-3">
              <label className="form-label small fw-semibold">Contrasena</label>
              <div className="input-group">
                <input type={showPassword ? 'text' : 'password'} className="form-control" value={password} onChange={e => setPassword(e.target.value)} placeholder="********" />
                <div className="input-group-append">
                  <button className="btn btn-outline-secondary" type="button" onClick={() => setShowPassword(!showPassword)}>
                    <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                  </button>
                </div>
              </div>
            </div>
            {error && <div className="alert alert-danger py-2 small">{error}</div>}
            <div className="row">
              <div className="col-12">
                <button type="button" className="btn btn-primary btn-block" onClick={() => void submit()} disabled={loading || !email || !password}>
                  {loading ? 'Ingresando...' : 'Ingresar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function PasswordSection(props: { token: string; mustChangePassword: boolean }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
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
    <div>
      <h6 className="fw-bold mb-3">Gestion de contrasena</h6>
      {props.mustChangePassword && <div className="alert alert-warning py-2 small">Debes cambiar la contrasena inicial.</div>}
      <div className="mb-3">
        <label className="form-label small fw-semibold">Contrasena actual</label>
        <div className="input-group">
          <input type={showCurrentPassword ? 'text' : 'password'} className="form-control form-control-sm" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
          <div className="input-group-append">
            <button className="btn btn-outline-secondary" type="button" onClick={() => setShowCurrentPassword(!showCurrentPassword)}>
              <i className={`fas ${showCurrentPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
            </button>
          </div>
        </div>
      </div>
      <div className="mb-3">
        <label className="form-label small fw-semibold">Nueva contrasena</label>
        <div className="input-group">
          <input type={showNewPassword ? 'text' : 'password'} className="form-control form-control-sm" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          <div className="input-group-append">
            <button className="btn btn-outline-secondary" type="button" onClick={() => setShowNewPassword(!showNewPassword)}>
              <i className={`fas ${showNewPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
            </button>
          </div>
        </div>
      </div>
      <button className="btn btn-primary btn-sm" onClick={() => void save()} disabled={!currentPassword || !newPassword}>
        Cambiar contrasena
      </button>
      {message && <div className="alert alert-success py-2 small mt-2 mb-0">{message}</div>}
    </div>
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
    <div className={`wrapper ${sidebarCollapsed ? 'sidebar-collapse' : ''}`} style={{ minHeight: '100vh' }}>
      <nav className="main-header navbar navbar-expand navbar-white navbar-light">
        <ul className="navbar-nav">
          <li className="nav-item">
            <button className="nav-link" data-lte-toggle="sidebar" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
              <i className="fas fa-bars"></i>
            </button>
          </li>
          <li className="nav-item d-none d-sm-inline-block">
            <a href="/" className="nav-link">Web Principal</a>
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

      <aside className="main-sidebar sidebar-dark-primary elevation-4">
        <a href="/" className="brand-link text-center">
          <span className="brand-text fw-bold h4">AgroSentinel</span>
        </a>
        <div className="sidebar">
          <nav className="mt-3">
            <ul className="nav nav-pills nav-sidebar flex-column" data-lte-menu="treeview" role="menu">
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

      <div className="content-wrapper">
        <div className="content-header">
          <div className="container-fluid">
            <div className="row mb-2">
              <div className="col-sm-6">
                <h1 className="m-0">Operacion AgroSentinel</h1>
              </div>
              <div className="col-sm-6">
                <ol className="breadcrumb float-sm-end">
                  <li className="breadcrumb-item"><a href="#">Home</a></li>
                  <li className="breadcrumb-item active">Dashboard</li>
                </ol>
              </div>
            </div>
          </div>
        </div>

        <div className="content content-card">
          <div className="container-fluid">
            <div className="row">
              <div className="col-lg-3 col-6">
                <div className="small-box bg-info">
                  <div className="inner">
                    <h3>{stats.total}</h3>
                    <p>Dispositivos</p>
                  </div>
                  <div className="icon"><i className="fas fa-microchip"></i></div>
                </div>
              </div>
              <div className="col-lg-3 col-6">
                <div className="small-box bg-primary">
                  <div className="inner">
                    <h3>{stats.online}</h3>
                    <p>Online</p>
                  </div>
                  <div className="icon"><i className="fas fa-signal"></i></div>
                </div>
              </div>
              <div className="col-lg-3 col-6">
                <div className="small-box bg-danger">
                  <div className="inner">
                    <h3>{stats.critical}</h3>
                    <p>Criticos</p>
                  </div>
                  <div className="icon"><i className="fas fa-exclamation-triangle"></i></div>
                </div>
              </div>
              <div className="col-lg-3 col-6">
                <div className="small-box bg-warning">
                  <div className="inner">
                    <h3>{stats.alerts}</h3>
                    <p>Alertas Abiertas</p>
                  </div>
                  <div className="icon"><i className="fas fa-bell"></i></div>
                </div>
              </div>
            </div>

            <div className="row">
              <div className="col-12">
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-map-marked-alt me-2"></i>Mapa de Dispositivos</h3>
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
                              <h6 className="fw-bold mb-1">{d.name}</h6>
                              <p className="mb-0 small">Estado: <span className={`badge ${d.status === 'online' ? 'text-bg-success' : 'text-bg-danger'}`}>{d.status}</span></p>
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
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-list me-2"></i>Estado de Sensores</h3>
                  </div>
                  <div className="card-body p-0">
                    <div className="table-responsive">
                      <table className="table table-hover m-0">
                        <thead>
                          <tr><th>Sensor</th><th>Nivel</th><th>Bomba</th><th>Estado</th><th className="text-end">Acciones</th></tr>
                        </thead>
                        <tbody>
                          {devices.map(d => (
                            <tr key={d._id}>
                              <td>
                                <div className="fw-bold">{d.name}</div>
                                <div className="small text-muted">{d.deviceId}</div>
                              </td>
                              <td className="align-middle">
                                <div className="d-flex align-items-center">
                                  <div className="progress me-2" style={{ width: '80px', height: '6px' }}>
                                    <div className={`progress-bar ${d.levelPct < 20 ? 'bg-danger' : d.levelPct < 50 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${d.levelPct}%` }}></div>
                                  </div>
                                  <span className="small fw-bold">{d.levelPct}%</span>
                                </div>
                              </td>
                              <td className="align-middle">
                                <span className={`badge ${d.pumpOn ? 'text-bg-info' : 'text-bg-secondary'}`}>{d.pumpOn ? 'Encendida' : 'Apagada'}</span>
                              </td>
                              <td className="align-middle">
                                <span className={`badge ${d.status === 'online' ? 'text-bg-success' : 'text-bg-danger'}`}>{d.status}</span>
                              </td>
                              <td className="text-end align-middle">
                                <div className="btn-group">
                                  <button className="btn btn-sm btn-outline-primary" onClick={() => void pumpCommand(d.deviceId, 'pump_on')}>ON</button>
                                  <button className="btn btn-sm btn-outline-secondary" onClick={() => void pumpCommand(d.deviceId, 'pump_off')}>OFF</button>
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
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-exclamation-circle me-2"></i>Notificaciones</h3>
                  </div>
                  <div className="card-body p-0" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    <ul className="list-group list-group-flush">
                      {alerts.map(a => (
                        <li key={a._id} className="list-group-item px-3 py-2">
                          <div className="d-flex justify-content-between">
                            <span className="small fw-bold">{a.deviceId}</span>
                            <span className={`badge ${a.status === 'open' ? 'text-bg-danger' : 'text-bg-secondary'}`}>{a.status}</span>
                          </div>
                          <div className="small mt-1">{a.message}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            <div className="row mt-4">
              <div className="col-md-6">
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-tools me-2"></i>Ordenes de Trabajo</h3>
                  </div>
                  <div className="card-body p-3">
                    {orders.map(o => (
                      <div className="border rounded p-2 mb-2" key={o._id}>
                        <div className="d-flex justify-content-between align-items-start">
                          <h6 className="fw-bold mb-1">{o.title}</h6>
                          <span className={`badge ${o.status === 'closed' ? 'text-bg-success' : o.status === 'in_progress' ? 'text-bg-warning' : 'text-bg-danger'}`}>{o.status}</span>
                        </div>
                        <p className="small text-muted mb-2">{o.description}</p>
                        {o.status !== 'closed' && <button className="btn btn-sm btn-outline-success w-100" onClick={() => void closeOrder(o._id)}>Cerrar Orden</button>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="col-md-6">
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-file-invoice me-2"></i>Facturacion ARCA</h3>
                  </div>
                  <div className="card-body p-0">
                    <table className="table table-sm m-0">
                      <thead><tr><th>Periodo</th><th>Monto</th><th>Estado</th></tr></thead>
                      <tbody>
                        {invoices.map(inv => (
                          <tr key={inv._id}>
                            <td>{inv.period}</td>
                            <td>${inv.amountArs.toLocaleString('es-AR')}</td>
                            <td><span className={`badge ${inv.status === 'paid' ? 'text-bg-success' : 'text-bg-warning'}`}>{inv.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="card mt-3">
                  <div className="card-body p-3">
                    <PasswordSection token={props.session.token} mustChangePassword={props.session.user.mustChangePassword} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className="main-footer text-center">
        <strong>AgroSentinel &copy; 2026</strong>
      </footer>
    </div>
  );
}

type AdminSection = 'dashboard' | 'clientes' | 'dispositivos' | 'usuarios' | 'facturacion' | 'arca' | 'notificaciones' | 'reportes' | 'actividad' | 'servidor' | 'pending-devices';

function CompanyAdminPanel(props: { session: AuthSession; onLogout: () => void; onPasswordChanged: () => void }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [operacionOpen, setOperacionOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<AdminSection>('dashboard');
  const [tenantId, setTenantId] = useState<string>('');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [allDevices, setAllDevices] = useState<Device[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<TenantClient[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [loadingClients, setLoadingClients] = useState(false);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [arcaConfig, setArcaConfig] = useState<ArcaConfig>(emptyArcaConfig);
  const [savingArca, setSavingArca] = useState(false);
  const [creatingDevice, setCreatingDevice] = useState(false);
  const [restoreClient, setRestoreClient] = useState(true);
  const [creatingUser, setCreatingUser] = useState(false);
  const [serverTab, setServerTab] = useState<'servidor' | 'mqtt'>('servidor');
  const [showMqttConfig, setShowMqttConfig] = useState(false);
  const [mqttConfig, setMqttConfig] = useState({ host: 'localhost', port: '1883', username: '', password: '', qos: '1' });
  const [showMqttPassword, setShowMqttPassword] = useState(false);
  const [showAllDevicesModal, setShowAllDevicesModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [newDevice, setNewDevice] = useState({ deviceId: '', name: '', lat: '-34.62', lng: '-58.43', address: '' });
  const [pendingDevices, setPendingDevices] = useState<{ device_id: string; status: string; last_seen: number; created_at?: number }[]>([]);
  const [usersList, setUsersList] = useState<{ id: string; name: string; email: string; role: string; tenantId: string }[]>([]);
  const [assigningDevice, setAssigningDevice] = useState<string | null>(null);
  const [pendingFilter, setPendingFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [newUser, setNewUser] = useState({
    name: '',
    email: '',
    role: 'owner' as 'owner' | 'operator' | 'technician',
    password: 'Cliente123!'
  });
  const [resetPassword, setResetPassword] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [showAddClient, setShowAddClient] = useState(false);
  const [showEditClient, setShowEditClient] = useState(false);
  const [creatingClient, setCreatingClient] = useState(false);
  const [newClient, setNewClient] = useState({
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    address: '',
    planId: ''
  });
  const [editClient, setEditClient] = useState({
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    address: '',
    planId: ''
  });
  const [savingClient, setSavingClient] = useState(false);
  const [selectedClient, setSelectedClient] = useState<TenantClient | null>(null);
  const [clientTab, setClientTab] = useState<'info' | 'dispositivos' | 'mapa'>('info');
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [editDevice, setEditDevice] = useState({ name: '', address: '', lat: '', lng: '' });
  const [editDeviceUserId, setEditDeviceUserId] = useState<string>('');
  const [savingDevice, setSavingDevice] = useState(false);
  const [showAddSensorModal, setShowAddSensorModal] = useState(false);
  const [newSensor, setNewSensor] = useState({ deviceId: '', name: '', lat: '-34.62', lng: '-58.43', address: '' });
  const [creatingSensor, setCreatingSensor] = useState(false);

  const changePassword = async () => {
    setPwdError('');
    setChangingPwd(true);
    try {
      await postJson('/auth/change-password-first', { newPassword }, props.session.token);
      props.onPasswordChanged();
    } catch {
      setPwdError('No se pudo cambiar la contrasena');
      setChangingPwd(false);
    }
  };

  if (props.session.user.mustChangePassword) {
    return (
      <div className="login-page" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="login-box">
          <div className="card card-outline card-primary">
            <div className="card-header text-center">
              <h1 className="h3 mb-0 font-weight-bold">AgroSentinel</h1>
              <p className="text-muted small mb-0 mt-1">Cambio de contrasena obligatorio</p>
            </div>
            <div className="card-body">
              <div className="alert alert-warning py-2 mb-3">
                <i className="fas fa-exclamation-triangle me-2"></i>
                Debes cambiar tu contrasena antes de continuar
              </div>
              <div className="mb-3">
                <label className="form-label small fw-semibold">Nueva contrasena</label>
                <input type="password" className="form-control" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Minimo 8 caracteres" minLength={8} />
              </div>
              {pwdError && <div className="alert alert-danger py-2 small">{pwdError}</div>}
              <button className="btn btn-primary btn-block" onClick={() => void changePassword()} disabled={changingPwd || newPassword.length < 8}>
                {changingPwd ? 'Guardando...' : 'Cambiar contrasena'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients;
    const search = clientSearch.toLowerCase();
    return clients.filter(c =>
      c.companyName.toLowerCase().includes(search) ||
      c.email?.toLowerCase().includes(search) ||
      c.contactName?.toLowerCase().includes(search) ||
      c.phone?.includes(search)
    );
  }, [clients, clientSearch]);

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

  const loadAllDevices = useCallback(async () => {
    const token = props.session.token;
    try {
      const allDevices = await getJson<Device[]>('/devices?all=true', token);
      const devicesWithClient = allDevices.map((d: Device) => {
        const client = clients.find(c => c.tenantId === d.tenantId);
        return { ...d, clientName: client?.companyName || 'Unknown' };
      });
      setAllDevices(devicesWithClient);
    } catch {
      console.error('Error loading all devices');
    }
  }, [props.session.token, clients]);

  const loadCompanyData = useCallback(async (targetTenant: string) => {
    if (!targetTenant) return;
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
    if (tenantId) {
      void loadCompanyData(tenantId);
    }
  }, [tenantId, loadCompanyData]);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  useEffect(() => {
    if (props.session.user.role !== 'company_admin') return;
    const token = props.session.token;
    let interval: ReturnType<typeof setInterval>;
    
    const loadPendingDevices = async () => {
      try {
        const [pending, users] = await Promise.all([
          getJson<{ device_id: string; status: string; last_seen: number; created_at?: number }[]>('/devices/pending', token),
          getJson<{ id: string; name: string; email: string; role: string; tenantId: string }[]>('/devices/users', token)
        ]);
        setPendingDevices(pending);
        setUsersList(users);
      } catch (err) {
        console.error('Error loading pending devices:', err);
      }
    };

    loadPendingDevices();
    interval = setInterval(loadPendingDevices, 5000);
    return () => clearInterval(interval);
  }, [props.session]);

  useEffect(() => {
    const nav = loadNavState();
    if (nav) {
      setActiveSection(nav.section as AdminSection);
      setOperacionOpen(['clientes', 'dispositivos', 'usuarios', 'notificaciones', 'pending-devices'].includes(nav.section));
      setConfigOpen(['facturacion', 'arca', 'reportes', 'servidor'].includes(nav.section));
    }
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    const socket = io(SOCKET_URL, {
      auth: { token: props.session.token }
    });
    socket.emit('tenant:join', tenantId);
    socket.on('devices:updated', () => void loadCompanyData(tenantId));
    socket.on('telemetry:new', () => void loadCompanyData(tenantId));
    socket.on('alerts:updated', () => void loadCompanyData(tenantId));
    return () => { socket.disconnect(); };
  }, [tenantId, props.session.token]);

  useEffect(() => {
    if (clients.length > 0 && !tenantId && restoreClient) {
      const nav = loadNavState();
      if (nav?.clientId) {
        const client = clients.find(c => c._id === nav.clientId);
        if (client) {
          setSelectedClient(client);
          setTenantId(client.tenantId);
          void loadCompanyData(client.tenantId);
          return;
        }
      }
      setTenantId(clients[0].tenantId);
      void loadCompanyData(clients[0].tenantId);
    }
    if (!restoreClient) {
      setRestoreClient(true);
    }
  }, [clients, tenantId]);

  const setSection = async (section: AdminSection) => {
    setActiveSection(section);
    setOperacionOpen(['clientes', 'dispositivos', 'usuarios', 'notificaciones'].includes(section));
    setConfigOpen(['facturacion', 'arca', 'reportes', 'servidor', 'mqtt'].includes(section));
    if (section === 'clientes') {
      setSelectedClient(null);
      setRestoreClient(false);
      saveNavState({ section: 'clientes' });
    } else if (section === 'dispositivos') {
      await loadAllDevices();
      saveNavState({ section: 'dispositivos' });
    } else {
      saveNavState({ section, clientId: selectedClient?._id });
    }
  };

  const openEditClient = () => {
    if (!selectedClient) return;
    setEditClient({
      companyName: selectedClient.companyName,
      contactName: selectedClient.contactName || '',
      email: selectedClient.email || '',
      phone: selectedClient.phone || '',
      address: selectedClient.address || '',
      planId: (selectedClient as TenantClient & { planId?: string }).planId || ''
    });
    setShowEditClient(true);
  };

  const saveClient = async () => {
    if (!selectedClient || !editClient.companyName || !editClient.email) return;
    setSavingClient(true);
    try {
      await putJson(`/tenants/${selectedClient._id}`, {
        companyName: editClient.companyName,
        contactName: editClient.contactName,
        email: editClient.email,
        phone: editClient.phone,
        address: editClient.address,
        planId: editClient.planId || undefined
      }, props.session.token);
      setShowEditClient(false);
      void loadClients();
      const updated = clients.find(c => c._id === selectedClient._id);
      if (updated) {
        setSelectedClient({
          ...updated,
          companyName: editClient.companyName,
          contactName: editClient.contactName,
          email: editClient.email,
          phone: editClient.phone,
          address: editClient.address,
          planName: plans.find(p => p._id === editClient.planId)?.name
        });
      }
    } finally {
      setSavingClient(false);
    }
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

  const openDeviceModal = (device: Device) => {
    setSelectedDevice(device);
    setEditDevice({
      name: device.name,
      address: device.location.address,
      lat: String(device.location.lat),
      lng: String(device.location.lng)
    });
    setEditDeviceUserId(device.tenantId || '');
    setShowDeviceModal(true);
  };

  const saveDevice = async () => {
    if (!selectedDevice) return;
    setSavingDevice(true);
    try {
      const updateData: Record<string, unknown> = {
        name: editDevice.name,
        address: editDevice.address,
        lat: Number(editDevice.lat),
        lng: Number(editDevice.lng)
      };
      if (editDeviceUserId !== (selectedDevice.tenantId || '')) {
        updateData.userId = editDeviceUserId || null;
        updateData.tenantId = editDeviceUserId || null;
      }
      await patchJson(`/devices/${selectedDevice._id}`, updateData, props.session.token);
      setShowDeviceModal(false);
      setSelectedDevice(null);
      await loadCompanyData(tenantId);
    } finally {
      setSavingDevice(false);
    }
  };

  const createSensor = async () => {
    if (!newSensor.deviceId || !newSensor.name) return;
    setCreatingSensor(true);
    try {
      await postJson('/devices', {
        tenantId,
        deviceId: newSensor.deviceId,
        name: newSensor.name,
        lat: Number(newSensor.lat),
        lng: Number(newSensor.lng),
        address: newSensor.address
      }, props.session.token);
      setShowAddSensorModal(false);
      setNewSensor({ deviceId: '', name: '', lat: '-34.62', lng: '-58.43', address: '' });
      await loadCompanyData(tenantId);
    } finally {
      setCreatingSensor(false);
    }
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
      facturacion: 'Facturacion y Planes',
      arca: 'Configuracion ARCA',
      notificaciones: 'Notificaciones',
      reportes: 'Reportes',
      actividad: 'Actividad',
      servidor: 'Servidor',
      'pending-devices': 'Dispositivos Pendientes'
    };
    return map[activeSection];
  };

  return (
    <div className={`wrapper ${sidebarCollapsed ? 'sidebar-collapse' : ''}`} style={{ minHeight: '100vh' }}>
      <nav className="main-header navbar navbar-expand navbar-white navbar-light">
        <ul className="navbar-nav">
          <li className="nav-item">
            <a className="nav-link" data-lte-toggle="sidebar" href="#" onClick={e => { e.preventDefault(); setSidebarCollapsed(!sidebarCollapsed); }}>
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
        <ul className="navbar-nav ms-auto">
          <li className="nav-item dropdown">
            <a className="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown">
              <i className="far fa-user-circle"></i>
              <span className="d-none d-md-inline ms-1">{props.session.user.name}</span>
            </a>
            <div className="dropdown-menu dropdown-menu-lg dropdown-menu-end">
              <a href="#" className="dropdown-item">
                <i className="fas fa-user me-2"></i> {props.session.user.name}
              </a>
              <div className="dropdown-divider"></div>
              <a href="#" className="dropdown-item">
                <i className="fas fa-envelope me-2"></i> {props.session.user.email}
              </a>
              <div className="dropdown-divider"></div>
              <a href="#" className="dropdown-item text-danger" onClick={e => { e.preventDefault(); props.onLogout(); }}>
                <i className="fas fa-sign-out-alt me-2"></i> Cerrar sesion
              </a>
            </div>
          </li>
          <li className="nav-item">
            <a className="nav-link" href="#" data-lte-toggle="fullscreen" onClick={e => e.preventDefault()}>
              <i className="fas fa-expand-arrows-alt"></i>
            </a>
          </li>
        </ul>
      </nav>

      <aside className="main-sidebar sidebar-dark-primary elevation-4">
        <a href="/" className="brand-link text-center">
          <span className="brand-text fw-bold h3 text-white">AgroSentinel</span>
        </a>
        <div className="sidebar">
          <div className="user-panel mt-3 pb-3 mb-3 d-flex">
            <div className="image">
              <i className="fas fa-user-circle text-white" style={{ fontSize: '2rem' }}></i>
            </div>
            <div className="info">
              <a href="#" className="d-block text-white fw-bold">{props.session.user.name}</a>
              <span className="text-white-50 small text-uppercase">{props.session.user.role.replace('_', ' ')}</span>
            </div>
          </div>
          <nav className="mt-2">
            <ul className="nav nav-pills nav-sidebar flex-column" data-lte-menu="treeview" role="menu">
              <li className="nav-item">
                <a href="#" className={`nav-link ${activeSection === 'dashboard' ? 'active' : ''}`}
                  onClick={e => { e.preventDefault(); setSection('dashboard'); }}>
                  <i className="nav-icon fas fa-tachometer-alt"></i><p>Dashboard</p>
                </a>
              </li>

              <li className={`nav-item has-treeview ${operacionOpen ? 'menu-open' : ''}`}>
                <a href="#" className={`nav-link ${['clientes', 'dispositivos', 'usuarios', 'notificaciones'].includes(activeSection) ? 'active' : ''}`}
                  onClick={e => { e.preventDefault(); setOperacionOpen(!operacionOpen); setConfigOpen(false); }}>
                  <i className="nav-icon fas fa-cogs"></i>
                  <p>Operacion <i className={`right fas fa-angle-left ${operacionOpen ? 'fa-rotate-90' : ''}`}></i></p>
                </a>
                {operacionOpen && (
                  <ul className="nav nav-treeview" style={{ marginLeft: '1rem' }}>
                    <li className="nav-item">
                      <a href="#" className={`nav-link ${activeSection === 'clientes' ? 'active' : ''}`}
                        onClick={e => { e.preventDefault(); setSection('clientes'); }}>
                        <i className="far fa-circle nav-icon"></i><p>Clientes</p>
                      </a>
                    </li>
                    <li className="nav-item">
                      <a href="#" className={`nav-link ${activeSection === 'dispositivos' ? 'active' : ''}`}
                        onClick={e => { e.preventDefault(); setSection('dispositivos'); }}>
                        <i className="far fa-circle nav-icon"></i><p>Dispositivos</p>
                      </a>
                    </li>
                    <li className="nav-item">
                      <a href="#" className={`nav-link ${activeSection === 'usuarios' ? 'active' : ''}`}
                        onClick={e => { e.preventDefault(); setSection('usuarios'); }}>
                        <i className="far fa-circle nav-icon"></i><p>Usuarios</p>
                      </a>
                    </li>
                    <li className="nav-item">
                      <a href="#" className={`nav-link ${activeSection === 'notificaciones' ? 'active' : ''}`}
                        onClick={e => { e.preventDefault(); setSection('notificaciones'); }}>
                        <i className="far fa-circle nav-icon"></i><p>Notificaciones</p>
                      </a>
                    </li>
                    <li className="nav-item">
                      <a href="#" className={`nav-link ${activeSection === 'pending-devices' ? 'active' : ''}`}
                        onClick={e => { e.preventDefault(); setSection('pending-devices'); }}>
                        <i className="far fa-circle nav-icon"></i><p>Dispositivos Pendientes</p>
                        {pendingDevices.length > 0 && <span className="badge bg-danger ms-2">{pendingDevices.length}</span>}
                      </a>
                    </li>
                  </ul>
                )}
              </li>

              <li className={`nav-item has-treeview ${configOpen ? 'menu-open' : ''}`}>
                <a href="#" className={`nav-link ${['facturacion', 'arca', 'reportes', 'servidor', 'mqtt'].includes(activeSection) ? 'active' : ''}`}
                  onClick={e => { e.preventDefault(); setConfigOpen(!configOpen); setOperacionOpen(false); }}>
                  <i className="nav-icon fas fa-cog"></i>
                  <p>Configuracion <i className={`right fas fa-angle-left ${configOpen ? 'fa-rotate-90' : ''}`}></i></p>
                </a>
                {configOpen && (
                  <ul className="nav nav-treeview" style={{ marginLeft: '1rem' }}>
                    <li className="nav-item">
                      <a href="#" className={`nav-link ${activeSection === 'facturacion' ? 'active' : ''}`}
                        onClick={e => { e.preventDefault(); setSection('facturacion'); }}>
                        <i className="far fa-circle nav-icon"></i><p>Facturacion y Planes</p>
                      </a>
                    </li>
                    <li className="nav-item">
                      <a href="#" className={`nav-link ${activeSection === 'arca' ? 'active' : ''}`}
                        onClick={e => { e.preventDefault(); setSection('arca'); }}>
                        <i className="far fa-circle nav-icon"></i><p>Configuracion ARCA</p>
                      </a>
                    </li>
                    <li className="nav-item">
                      <a href="#" className={`nav-link ${activeSection === 'reportes' ? 'active' : ''}`}
                        onClick={e => { e.preventDefault(); setSection('reportes'); }}>
                        <i className="far fa-circle nav-icon"></i><p>Reportes</p>
                      </a>
                    </li>
                    <li className="nav-item">
                      <a href="#" className={`nav-link ${activeSection === 'servidor' ? 'active' : ''}`}
                        onClick={e => { e.preventDefault(); setSection('servidor'); }}>
                        <i className="far fa-circle nav-icon"></i><p>Servidor</p>
                      </a>
                    </li>
                  </ul>
                )}
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

      <div className="content-wrapper">
        <div className="content-header">
          <div className="container-fluid">
            <div className="row mb-2">
              <div className="col-sm-6">
                <h1 className="m-0" style={{ fontSize: '1.5rem', fontWeight: '600' }}>{sectionTitle()}</h1>
              </div>
              <div className="col-sm-6">
                <ol className="breadcrumb float-sm-end mb-0" style={{ background: 'transparent' }}>
                  <li className="breadcrumb-item">
                    <a href="#" onClick={e => { e.preventDefault(); setSection('dashboard'); }}><i className="fas fa-home"></i></a>
                  </li>
                  <li className="breadcrumb-item active">{sectionTitle()}</li>
                </ol>
              </div>
            </div>
          </div>
        </div>

        <div className="content">
          <div className="container-fluid">

            {activeSection === 'dashboard' && (
              <>
                <div className="row">
                  <div className="col-lg-3 col-6">
                    <div className="small-box bg-info">
                      <div className="inner"><h3>{stats.tenants}</h3><p>Clientes Activos</p></div>
                      <div className="icon"><i className="fas fa-building"></i></div>
                    </div>
                  </div>
                  <div className="col-lg-3 col-6">
                    <div className="small-box bg-primary">
                      <div className="inner"><h3>{stats.total}</h3><p>Dispositivos Totales</p></div>
                      <div className="icon"><i className="fas fa-microchip"></i></div>
                    </div>
                  </div>
                  <div className="col-lg-3 col-6">
                    <div className="small-box bg-primary">
                      <div className="inner"><h3>{stats.online}</h3><p>Online</p></div>
                      <div className="icon"><i className="fas fa-signal"></i></div>
                    </div>
                  </div>
                  <div className="col-lg-3 col-6">
                    <div className="small-box bg-danger">
                      <div className="inner"><h3>{stats.offline}</h3><p>Offline / Criticos</p></div>
                      <div className="icon"><i className="fas fa-exclamation-triangle"></i></div>
                    </div>
                  </div>
                </div>
                <div className="row">
                  <div className="col-lg-4 col-6">
                    <div className="small-box bg-warning">
                      <div className="inner"><h3>{stats.alerts}</h3><p>Alertas Abiertas</p></div>
                      <div className="icon"><i className="fas fa-bell"></i></div>
                    </div>
                  </div>
                  <div className="col-lg-4 col-6">
                    <div className="small-box bg-secondary">
                      <div className="inner"><h3>{stats.users}</h3><p>Usuarios Totales</p></div>
                      <div className="icon"><i className="fas fa-users"></i></div>
                    </div>
                  </div>
                  <div className="col-lg-4 col-6">
                    <div className="small-box bg-indigo">
                      <div className="inner"><h3>{invoices.length}</h3><p>Facturas Registradas</p></div>
                      <div className="icon"><i className="fas fa-file-invoice-dollar"></i></div>
                    </div>
                  </div>
                </div>
                <div className="row">
                  <div className="col-md-8">
                    <div className="card">
                      <div className="card-header"><h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-microchip me-2"></i>Estado de Dispositivos</h3></div>
                      <div className="card-body p-0">
                        <table className="table table-hover m-0">
                          <thead><tr><th>Nombre</th><th>Device ID</th><th>Nivel</th><th>Estado</th><th>Direccion</th></tr></thead>
                          <tbody>
                            {devices.map(d => (
                              <tr key={d._id}>
                                <td className="fw-bold">{d.name}</td>
                                <td className="small text-muted">{d.deviceId}</td>
                                <td><span className={`badge ${d.levelPct < 20 ? 'text-bg-danger' : d.levelPct < 50 ? 'text-bg-warning' : 'text-bg-success'}`}>{d.levelPct}%</span></td>
                                <td><span className={`badge ${d.status === 'online' ? 'text-bg-success' : 'text-bg-danger'}`}>{d.status}</span></td>
                                <td className="small">{d.location.address}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-4">
                    <div className="card">
                      <div className="card-header"><h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-bell me-2"></i>Alertas Recientes</h3></div>
                      <div className="card-body p-0" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                        {alerts.filter(a => a.status === 'open').length === 0 ? (
                          <p className="text-center text-muted p-3 small">Sin alertas abiertas</p>
                        ) : (
                          <ul className="list-group list-group-flush">
                            {alerts.filter(a => a.status === 'open').slice(0, 10).map(a => (
                              <li key={a._id} className="list-group-item border-0 px-3 py-2">
                                <div className="d-flex justify-content-between">
                                  <span className="fw-bold small">{a.deviceId}</span>
                                  <span className={`badge ${a.type === 'critical_level' ? 'text-bg-danger' : 'text-bg-secondary'}`}>{a.type}</span>
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
                {selectedClient ? (
                  <div className="col-12">
                    <div className="row">
                      <div className="col-md-3"><div className="text-center p-3 border rounded bg-white"><div className="text-muted small">Dispositivos</div><div className="h4 fw-bold text-primary">{stats.total}</div></div></div>
                      <div className="col-md-3"><div className="text-center p-3 border rounded bg-white"><div className="text-muted small">Online</div><div className="h4 fw-bold text-success">{stats.online}</div></div></div>
                      <div className="col-md-3"><div className="text-center p-3 border rounded bg-white"><div className="text-muted small">Alertas</div><div className="h4 fw-bold text-danger">{stats.alerts}</div></div></div>
                      <div className="col-md-3"><div className="text-center p-3 border rounded bg-white"><div className="text-muted small">Usuarios</div><div className="h4 fw-bold text-info">{stats.users}</div></div></div>
                    </div>

                    <div className="card card-primary card-outline card-tabs mt-3">
                      <div className="card-header">
                        <div className="d-flex justify-content-between align-items-center w-100">
                          <h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-building mr-2"></i>{selectedClient.companyName}</h3>
                          <button className="btn btn-default btn-sm" onClick={() => { setSelectedClient(null); setRestoreClient(false); }}>
                            <i className="fas fa-arrow-left mr-1"></i>Volver a Clientes
                          </button>
                        </div>
                        <ul className="nav nav-tabs mt-3" role="tablist">
                          <li className="nav-item">
                            <a className={`nav-link ${clientTab === 'info' ? 'active' : ''}`} href="#" onClick={e => { e.preventDefault(); setClientTab('info'); }}>
                              <i className="fas fa-info-circle mr-1"></i> Informacion
                            </a>
                          </li>
                          <li className="nav-item">
                            <a className={`nav-link ${clientTab === 'dispositivos' ? 'active' : ''}`} href="#" onClick={e => { e.preventDefault(); setClientTab('dispositivos'); }}>
                              <i className="fas fa-microchip mr-1"></i> Dispositivos
                            </a>
                          </li>
                          <li className="nav-item">
                            <a className={`nav-link ${clientTab === 'mapa' ? 'active' : ''}`} href="#" onClick={e => { e.preventDefault(); setClientTab('mapa'); }}>
                              <i className="fas fa-map-marked-alt mr-1"></i> Mapa
                            </a>
                          </li>
                        </ul>
                      </div>
                      <div className="card-body">
                        {clientTab === 'info' && (
                          <div className="tab-content">
                            <div className="tab-pane active show">
                              <div className="d-flex justify-content-between align-items-center mb-3">
                                <h5 className="mb-0"><i className="fas fa-building mr-2 text-primary"></i>Datos del Cliente</h5>
                                <button className="btn btn-primary btn-sm" onClick={() => openEditClient()}>
                                  <i className="fas fa-edit mr-1"></i>Editar Cliente
                                </button>
                              </div>
                              <table className="table table-sm table-borderless">
                                <tbody>
                                  <tr><td className="text-muted">Tenant ID:</td><td className="fw-bold">{selectedClient.tenantId}</td></tr>
                                  <tr><td className="text-muted">Empresa:</td><td>{selectedClient.companyName}</td></tr>
                                  <tr><td className="text-muted">Contacto:</td><td>{selectedClient.contactName || '—'}</td></tr>
                                  <tr><td className="text-muted">Email:</td><td>{selectedClient.email || '—'}</td></tr>
                                  <tr><td className="text-muted">Telefono:</td><td>{selectedClient.phone || '—'}</td></tr>
                                  <tr><td className="text-muted">Direccion:</td><td>{selectedClient.address || '—'}</td></tr>
                                  <tr><td className="text-muted">Plan:</td><td>{selectedClient.planName || '—'}</td></tr>
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                        {clientTab === 'dispositivos' && (
                          <div className="tab-content">
                            <div className="tab-pane active show">
                              <div className="table-responsive">
                                <div className="mb-3">
                                  <button className="btn btn-primary btn-sm" onClick={() => setShowAddSensorModal(true)}>
                                    <i className="fas fa-plus me-1"></i>Agregar Dispositivo
                                  </button>
                                </div>
                                <table className="table table-hover table-striped">
                                  <thead>
                                    <tr>
                                      <th>Nombre</th>
                                      <th>Device ID</th>
                                      <th>Nivel</th>
                                      <th>Bomba</th>
                                      <th>Estado</th>
                                      <th>Ultima Comunicacion</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {devices.length === 0 ? (
                                      <tr><td colSpan={6} className="text-center text-muted py-3">No hay dispositivos registrados</td></tr>
                                    ) : (
                                      devices.map(d => (
                                        <tr key={d._id} onClick={(e) => { e.stopPropagation(); openDeviceModal(d); }} style={{ cursor: 'pointer' }}>
                                          <td className="fw-bold">{d.name}</td>
                                          <td className="small text-muted">{d.deviceId}</td>
                                          <td>
                                            <div className="d-flex align-items-center">
                                              <div className="progress me-2" style={{ width: '60px', height: '6px' }}>
                                                <div className={`progress-bar ${d.levelPct < 20 ? 'bg-danger' : d.levelPct < 50 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${d.levelPct}%` }}></div>
                                              </div>
                                              <span className="small fw-bold">{d.levelPct}%</span>
                                            </div>
                                          </td>
                                          <td><span className={`badge ${d.pumpOn ? 'text-bg-info' : 'text-bg-secondary'}`}>{d.pumpOn ? 'ON' : 'OFF'}</span></td>
                                          <td><span className={`badge ${d.status === 'online' ? 'text-bg-success' : d.status === 'warning' ? 'text-bg-warning' : 'text-bg-danger'}`}>{d.status}</span></td>
                                          <td className="small text-muted">{d.lastHeartbeatAt ? new Date(d.lastHeartbeatAt).toLocaleString('es-AR') : '—'}</td>
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>
                        )}
                        {clientTab === 'mapa' && (
                          <div className="tab-content" style={{ height: '500px' }}>
                            <div className="tab-pane active show h-100">
                              {(() => {
                                const deviceList = devices.filter(d => d.location.lat && d.location.lng);
                                if (deviceList.length === 0) {
                                  return (
                                    <div className="d-flex align-items-center justify-content-center h-100 text-muted">
                                      No hay dispositivos con ubicación para mostrar en el mapa
                                    </div>
                                  );
                                }
                                const lats = deviceList.map(d => d.location.lat);
                                const lngs = deviceList.map(d => d.location.lng);
                                const center: [number, number] = [
                                  (Math.min(...lats) + Math.max(...lats)) / 2,
                                  (Math.min(...lngs) + Math.max(...lngs)) / 2
                                ];
                                return (
                              <MapContainer center={center} zoom={10} style={{ height: '100%', width: '100%' }}>
                                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                                {devices.map(d => {
                                  const deviceAlerts = alerts.filter(a => a.deviceId === d.deviceId && a.status === 'open');
                                  const hasAlert = deviceAlerts.length > 0;
                                  const color = markerColor(d.status, d.levelPct, hasAlert);
                                  return (
                                  <Marker key={d._id} position={[d.location.lat, d.location.lng]} draggable={true} eventHandlers={{
                                    dragend: async (e) => {
                                      const newPos = e.target.getLatLng();
                                      const deviceId = d._id;
                                      const lat = newPos.lat;
                                      const lng = newPos.lng;
                                      try {
                                        await patchJson(`/devices/${deviceId}`, { lat, lng }, props.session.token);
                                        setDevices(devices.map(dev => dev._id === deviceId ? { ...dev, location: { ...dev.location, lat, lng } } : dev));
                                      } catch (err) {
                                        console.error('Error updating device location:', err);
                                      }
                                    },
                                    click: () => {
                                      openDeviceModal(d);
                                    }
                                  }} icon={L.divIcon({ className: 'custom-marker', html: `<div style="background-color:${color};width:24px;height:24px;border-radius:50%;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);cursor:pointer;"></div>`, iconSize: [24, 24], iconAnchor: [12, 12] })}>
                                    <Popup><div className="p-1"><h6 className="fw-bold mb-1">{d.name}</h6><p className="mb-0 small">Estado: <span className={`badge ${d.status === 'online' ? 'text-bg-success' : 'text-bg-danger'}`}>{d.status}</span></p><p className="mb-0 small">Nivel: <strong>{d.levelPct}%</strong></p>{hasAlert && <p className="mb-0 small text-danger"><i className="fas fa-exclamation-triangle"></i> Alerta activa</p>}<p className="mb-0 small text-muted">Click para editar, arrastra para mover</p></div></Popup>
                                  </Marker>
                                );})}
                              </MapContainer>
                                );
                              })()}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="col-12">
                    <div className="card card-header-blue">
                      <div className="card-header d-flex justify-content-between align-items-center">
                        <h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-building me-2"></i>Clientes</h3>
                        <button className="btn btn-light btn-sm" onClick={() => setShowAddClient(true)}>
                          <i className="fas fa-plus me-1"></i>Agregar Cliente
                        </button>
                      </div>
                      <div className="card-body">
                        <div className="mb-3">
                          <div className="input-group">
                            <div className="input-group-prepend">
                              <span className="input-group-text"><i className="fas fa-search"></i></span>
                            </div>
                            <input
                              type="text"
                              className="form-control"
                              placeholder="Buscar cliente por nombre, email o contacto..."
                              value={clientSearch}
                              onChange={e => setClientSearch(e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="table-responsive">
                          <table className="table table-hover table-striped">
                            <thead>
                              <tr>
                                <th>Empresa</th>
                                <th>Contacto</th>
                                <th>Email</th>
                                <th>Telefono</th>
                                <th>Direccion</th>
                                <th>Plan</th>
                              </tr>
                            </thead>
                            <tbody>
                              {loadingClients ? (
                                <tr><td colSpan={6} className="text-center text-muted py-3"><i className="fas fa-spinner fa-spin me-1"></i>Cargando clientes...</td></tr>
                              ) : filteredClients.length === 0 ? (
                                <tr><td colSpan={6} className="text-center text-muted py-3">No se encontraron clientes</td></tr>
                              ) : (
                                filteredClients.map(c => (
                                  <tr key={c._id} onClick={async () => { setSelectedClient(c); setTenantId(c.tenantId); setRestoreClient(true); await loadCompanyData(c.tenantId); saveNavState({ section: 'clientes', clientId: c._id }); }} style={{ cursor: 'pointer' }}>
                                    <td className="fw-bold">{c.companyName}</td>
                                    <td>{c.contactName || '—'}</td>
                                    <td>{c.email || '—'}</td>
                                    <td>{c.phone || '—'}</td>
                                    <td className="small">{c.address || '—'}</td>
                                    <td>{c.planName || '—'}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeSection === 'dispositivos' && (
              <div className="row">
                <div className="col-12">
                  <div className="card">
                    <div className="card-header">
                      <h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-plus-circle me-2"></i>Agregar Dispositivo</h3>
                    </div>
                    <div className="card-body">
                      <div className="row">
                        <div className="col-md-3 mb-3"><label className="form-label small fw-bold">Device ID</label><input className="form-control" value={newDevice.deviceId} onChange={e => setNewDevice(p => ({ ...p, deviceId: e.target.value }))} placeholder="ESP32-001" /></div>
                        <div className="col-md-3 mb-3"><label className="form-label small fw-bold">Nombre</label><input className="form-control" value={newDevice.name} onChange={e => setNewDevice(p => ({ ...p, name: e.target.value }))} placeholder="Tanque Principal" /></div>
                        <div className="col-md-3 mb-3"><label className="form-label small fw-bold">Direccion</label><input className="form-control" value={newDevice.address} onChange={e => setNewDevice(p => ({ ...p, address: e.target.value }))} placeholder="Ruta 2 km 45" /></div>
                        <div className="col-md-2 mb-3 d-flex align-items-end"><button className="btn btn-primary w-100 fw-bold" onClick={() => void createDevice()} disabled={creatingDevice}>{creatingDevice ? '...' : 'Vincular'}</button></div>
                      </div>
                    </div>
                  </div>
                  <div className="card mt-3">
                    <div className="card-header d-flex justify-content-between align-items-center">
                      <h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-microchip me-2"></i>Dispositivos Registrados ({allDevices.length})</h3>
                      <button className="btn btn-light btn-sm ml-auto" onClick={() => setShowAllDevicesModal(true)}>
                        <i className="fas fa-expand me-1"></i>Ver Todos
                      </button>
                    </div>
                    <div className="card-body p-0">
                      <div className="table-responsive">
                        <table className="table table-hover m-0">
                          <thead><tr><th>Nombre</th><th>Device ID</th><th>Cliente</th><th>Direccion</th><th>Nivel</th><th>Bomba</th><th>Estado</th></tr></thead>
                          <tbody>
                            {allDevices.map(d => (
                              <tr key={d._id} onClick={(e) => { e.stopPropagation(); openDeviceModal(d); }} style={{ cursor: 'pointer' }}>
                                <td className="fw-bold">{d.name}</td>
                                <td className="small text-muted">{d.deviceId}</td>
                                <td className="small">{d.clientName || 'Unknown'}</td>
                                <td className="small">{d.location.address}</td>
                                <td>
                                  <div className="d-flex align-items-center">
                                    <div className="progress me-2" style={{ width: '60px', height: '6px' }}>
                                      <div className={`progress-bar ${d.levelPct < 20 ? 'bg-danger' : d.levelPct < 50 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${d.levelPct}%` }}></div>
                                    </div>
                                    <span className="small fw-bold">{d.levelPct}%</span>
                                  </div>
                                </td>
                                <td><span className={`badge ${d.pumpOn ? 'text-bg-info' : 'text-bg-secondary'}`}>{d.pumpOn ? 'ON' : 'OFF'}</span></td>
                                <td><span className={`badge ${d.status === 'online' ? 'text-bg-success' : d.status === 'warning' ? 'text-bg-warning' : 'text-bg-danger'}`}>{d.status}</span></td>
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
                  <div className="card">
                    <div className="card-header"><h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-user-plus me-2"></i>Crear Usuario</h3></div>
                    <div className="card-body">
                      <div className="mb-3"><label className="form-label small fw-bold">Nombre</label><input className="form-control" value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} placeholder="Juan Perez" /></div>
                      <div className="mb-3"><label className="form-label small fw-bold">Email</label><input className="form-control" type="email" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} placeholder="juan@cliente.com" /></div>
                      <div className="mb-3"><label className="form-label small fw-bold">Rol</label>
                        <select className="form-control" value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value as 'owner' | 'operator' | 'technician' }))}>
                          <option value="owner">Owner</option><option value="operator">Operator</option><option value="technician">Technician</option>
                        </select>
                      </div>
                      <div className="mb-3"><label className="form-label small fw-bold">Contrasena</label><input className="form-control" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} /></div>
                      <button className="btn btn-primary w-100 fw-bold" onClick={() => void createUser()} disabled={creatingUser}>{creatingUser ? '...' : 'Crear Usuario'}</button>
                    </div>
                  </div>
                  <div className="card mt-3">
                    <div className="card-header"><h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-key me-2"></i>Resetear Contrasena</h3></div>
                    <div className="card-body">
                      <div className="mb-3"><label className="form-label small fw-bold">Usuario</label>
                        <select className="form-control" value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}>
                          <option value="">Seleccionar...</option>{users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
                        </select>
                      </div>
                      <div className="mb-3"><label className="form-label small fw-bold">Nueva Contrasena</label><input className="form-control" value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="Nueva contrasena" /></div>
                      <button className="btn btn-warning w-100 fw-bold" onClick={() => void resetUserPassword()} disabled={!selectedUserId || !resetPassword}>Resetear</button>
                    </div>
                  </div>
                </div>
                <div className="col-md-8">
                  <div className="card">
                    <div className="card-header"><h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-users me-2"></i>Usuarios ({users.length})</h3></div>
                    <div className="card-body p-0">
                      <div className="table-responsive">
                        <table className="table table-hover m-0">
                          <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Tenant</th></tr></thead>
                          <tbody>
                            {users.map(u => (
                              <tr key={u.id}>
                                <td className="fw-bold">{u.name}</td>
                                <td className="small text-muted">{u.email}</td>
                                <td><span className="badge text-bg-primary">{u.role}</span></td>
                                <td>{u.mustChangePassword ? <span className="badge text-bg-warning"><i className="fas fa-exclamation-triangle me-1"></i>Pendiente</span> : <span className="badge text-bg-success">OK</span>}</td>
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
                  <div className="card">
                    <div className="card-header"><h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-tags me-2"></i>Planes Disponibles</h3></div>
                    <div className="card-body p-0">
                      <table className="table m-0">
                        <thead><tr><th>Plan</th><th>Dispositivos Max.</th><th>Precio Mensual</th></tr></thead>
                        <tbody>{plans.map(p => (
                          <tr key={p._id}>
                            <td className="fw-bold">{p.name}</td>
                            <td>{p.maxDevices}</td>
                            <td className="text-primary fw-bold">${p.monthlyPriceArs.toLocaleString('es-AR')}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </div>
                </div>
                <div className="col-md-6">
                  <div className="card">
                    <div className="card-header"><h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-file-invoice-dollar me-2"></i>Historial de Facturacion</h3></div>
                    <div className="card-body p-0">
                      <table className="table m-0">
                        <thead><tr><th>Periodo</th><th>Monto</th><th>CAE</th><th>Estado</th></tr></thead>
                        <tbody>{invoices.map(i => (
                          <tr key={i._id}>
                            <td className="fw-bold">{i.period}</td>
                            <td>${i.amountArs.toLocaleString('es-AR')}</td>
                            <td className="small text-muted">{i.arca?.cae || '—'}</td>
                            <td><span className={`badge ${i.status === 'paid' ? 'text-bg-success' : i.status === 'issued' ? 'text-bg-info' : 'text-bg-secondary'}`}>{i.status}</span></td>
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
                  <div className="card">
                    <div className="card-header bg-danger">
                      <h3 className="card-title fw-bold text-white"><i className="fas fa-shield-alt me-2"></i>Configuracion ARCA / AFIP</h3>
                    </div>
                    <div className="card-body">
                      <div className="row">
                        <div className="col-md-6 mb-3"><label className="form-label small fw-bold">CUIT</label><input className="form-control" value={arcaConfig.cuit} onChange={e => setArcaConfig(p => ({ ...p, cuit: e.target.value }))} placeholder="30712345678" /></div>
                        <div className="col-md-6 mb-3"><label className="form-label small fw-bold">Punto de Venta</label><input className="form-control" value={arcaConfig.ptoVta} onChange={e => setArcaConfig(p => ({ ...p, ptoVta: e.target.value }))} /></div>
                        <div className="col-md-6 mb-3"><label className="form-label small fw-bold">WSFE URL</label><input className="form-control" value={arcaConfig.wsfeUrl} onChange={e => setArcaConfig(p => ({ ...p, wsfeUrl: e.target.value }))} /></div>
                        <div className="col-md-6 mb-3"><label className="form-label small fw-bold">Token</label><input className="form-control" value={arcaConfig.token || ''} onChange={e => setArcaConfig(p => ({ ...p, token: e.target.value }))} /></div>
                        <div className="col-md-6 mb-3"><label className="form-label small fw-bold">Sign</label><input className="form-control" value={arcaConfig.sign || ''} onChange={e => setArcaConfig(p => ({ ...p, sign: e.target.value }))} /></div>
                        <div className="col-md-6 mb-3">
                          <div className="form-check form-switch mt-4">
                            <input type="checkbox" className="form-check-input" id="arcaEnabled" checked={arcaConfig.enabled} onChange={e => setArcaConfig(p => ({ ...p, enabled: e.target.checked }))} />
                            <label className="form-check-label fw-bold" htmlFor="arcaEnabled">Habilitar Facturacion ARCA</label>
                          </div>
                          <div className="form-check form-switch mt-2">
                            <input type="checkbox" className="form-check-input" id="arcaMock" checked={arcaConfig.mock} onChange={e => setArcaConfig(p => ({ ...p, mock: e.target.checked }))} />
                            <label className="form-check-label" htmlFor="arcaMock">Modo Mock (pruebas)</label>
                          </div>
                        </div>
                        <div className="col-12">
                          <button className="btn btn-danger fw-bold" onClick={() => void saveArcaConfig()} disabled={savingArca}>{savingArca ? 'Guardando...' : 'Guardar Configuracion'}</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-md-4">
                  <div className="card">
                    <div className="card-header"><h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-key me-2"></i>Mi Contrasena</h3></div>
                    <div className="card-body">
                      <PasswordSection token={props.session.token} mustChangePassword={props.session.user.mustChangePassword} />
                    </div>
                  </div>
                  <div className="card mt-3">
                    <div className="card-header"><h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-info-circle me-2"></i>Datos Actuales</h3></div>
                    <div className="card-body small">
                      <p className="mb-1"><strong>CUIT:</strong> {arcaConfig.cuit || '—'}</p>
                      <p className="mb-1"><strong>Pto. Vta:</strong> {arcaConfig.ptoVta}</p>
                      <p className="mb-1"><strong>Habilitado:</strong> <span className={`badge ${arcaConfig.enabled ? 'text-bg-success' : 'text-bg-secondary'}`}>{arcaConfig.enabled ? 'Si' : 'No'}</span></p>
                      <p className="mb-0"><strong>Modo Mock:</strong> <span className={`badge ${arcaConfig.mock ? 'text-bg-warning' : 'text-bg-success'}`}>{arcaConfig.mock ? 'Si' : 'No'}</span></p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'notificaciones' && (
              <div className="row">
                <div className="col-12">
                  <div className="card">
                    <div className="card-header"><h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-bell me-2"></i>Notificaciones y Alertas ({alerts.length})</h3></div>
                    <div className="card-body p-0">
                      {alerts.length === 0 ? (
                        <p className="text-center text-muted p-4">Sin notificaciones registradas</p>
                      ) : (
                        <table className="table table-hover m-0">
                          <thead><tr><th>Dispositivo</th><th>Tipo</th><th>Mensaje</th><th>Estado</th></tr></thead>
                          <tbody>{alerts.map(a => (
                            <tr key={a._id}>
                              <td className="fw-bold">{a.deviceId}</td>
                              <td><span className={`badge ${a.type === 'critical_level' ? 'text-bg-danger' : 'text-bg-secondary'}`}>{a.type}</span></td>
                              <td>{a.message}</td>
                              <td><span className={`badge ${a.status === 'open' ? 'text-bg-danger' : 'text-bg-success'}`}>{a.status}</span></td>
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
                  <div className="card">
                    <div className="card-header"><h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-chart-bar me-2"></i>Resumen Operativo</h3></div>
                    <div className="card-body">
                      <div className="border rounded p-3 mb-3">
                        <div className="d-flex justify-content-between mb-2"><span>Dispositivos Totales</span><span className="fw-bold">{stats.total}</span></div>
                        <div className="d-flex justify-content-between mb-2"><span>Online</span><span className="fw-bold text-success">{stats.online}</span></div>
                        <div className="d-flex justify-content-between mb-2"><span>Offline/Criticos</span><span className="fw-bold text-danger">{stats.offline}</span></div>
                        <div className="d-flex justify-content-between"><span>Alertas Abiertas</span><span className="fw-bold text-warning">{stats.alerts}</span></div>
                      </div>
                      <div className="border rounded p-3">
                        <div className="d-flex justify-content-between mb-2"><span>Clientes</span><span className="fw-bold">{stats.tenants}</span></div>
                        <div className="d-flex justify-content-between mb-2"><span>Usuarios</span><span className="fw-bold">{stats.users}</span></div>
                        <div className="d-flex justify-content-between"><span>Facturas</span><span className="fw-bold">{invoices.length}</span></div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-md-6">
                  <div className="card">
                    <div className="card-header"><h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-chart-pie me-2"></i>Estado de Dispositivos</h3></div>
                    <div className="card-body text-center">
                      <div className="display-1 fw-bold text-success">{stats.online}</div>
                      <div className="text-muted small">Dispositivos Online</div>
                      <div className="progress mt-3" style={{ height: '10px' }}>
                        <div className="progress-bar bg-success" style={{ width: stats.total > 0 ? `${(stats.online / stats.total) * 100}%` : '0%' }}></div>
                        <div className="progress-bar bg-danger" style={{ width: stats.total > 0 ? `${(stats.offline / stats.total) * 100}%` : '0%' }}></div>
                      </div>
                      <div className="d-flex justify-content-between mt-1 small text-muted">
                        <span>Online</span><span>Offline/Criticos</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'actividad' && (
              <div className="row">
                <div className="col-12">
                  <div className="card">
                    <div className="card-header"><h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-history me-2"></i>Registro de Actividad</h3></div>
                    <div className="card-body p-0">
                      <table className="table table-hover m-0">
                        <thead><tr><th>Fecha</th><th>Evento</th><th>Detalle</th></tr></thead>
                        <tbody>
                          {[
                            { date: new Date().toLocaleString('es-AR'), event: 'Acceso', detail: `Login exitoso: ${props.session.user.email}` },
                            { date: new Date().toLocaleString('es-AR'), event: 'Sesion', detail: `Rol: ${props.session.user.role} | Tenant: ${props.session.user.tenantId}` },
                            { date: new Date().toLocaleString('es-AR'), event: 'Dispositivos', detail: `${stats.total} dispositivos cargados para ${tenantId}` },
                            { date: new Date().toLocaleString('es-AR'), event: 'Alertas', detail: `${stats.alerts} alertas abiertas` },
                          ].map((row, i) => (
                            <tr key={i}>
                              <td className="small text-muted">{row.date}</td>
                              <td><span className="badge text-bg-info">{row.event}</span></td>
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

            {activeSection === 'servidor' && (
              <div className="row">
                <div className="col-12">
                  <div className="card">
                    <div className="card-header">
                      <h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-server me-2"></i>Configuracion del Servidor</h3>
                    </div>
                    <div className="card-body p-0">
                      <div className="card card-primary card-outline card-tabs">
                        <div className="card-header p-0 border-bottom-0">
                          <ul className="nav nav-tabs" role="tablist">
                            <li className="nav-item">
                              <a className={`nav-link ${serverTab === 'servidor' ? 'active' : ''}`} href="#" onClick={e => { e.preventDefault(); setServerTab('servidor'); }}>
                                <i className="fas fa-server mr-1"></i> Servidor
                              </a>
                            </li>
                            <li className="nav-item">
                              <a className={`nav-link ${serverTab === 'mqtt' ? 'active' : ''}`} href="#" onClick={e => { e.preventDefault(); setServerTab('mqtt'); }}>
                                <i className="fas fa-wifi mr-1"></i> MQTT
                              </a>
                            </li>
                          </ul>
                        </div>
                        <div className="card-body">
                          {serverTab === 'servidor' && (
                            <div>
                              <div className="alert alert-info mb-3">
                                <i className="fas fa-info-circle mr-2"></i>
                                La configuración del servidor se gestiona a través de variables de entorno. Contacte al administrador del sistema para realizar cambios.
                              </div>
                              <table className="table table-sm table-bordered">
                                <thead className="thead-dark"><tr><th>Parametro</th><th>Valor Actual</th></tr></thead>
                                <tbody>
                                  <tr><td>API URL</td><td className="text-muted">http://localhost:4000</td></tr>
                                  <tr><td>Web URL</td><td className="text-muted">http://localhost:5173</td></tr>
                                  <tr><td>Base de Datos</td><td className="text-muted">MongoDB</td></tr>
                                  <tr><td>Broker MQTT</td><td className="text-muted">localhost:1883</td></tr>
                                </tbody>
                              </table>
                            </div>
                          )}
                          {serverTab === 'mqtt' && (
                            <div>
                              <div className="d-flex justify-content-between align-items-center mb-3">
                                <div className="alert alert-info mb-0">
                                  <i className="fas fa-info-circle mr-2"></i>
                                  La configuración MQTT se gestiona a través de variables de entorno.
                                </div>
                                <button className="btn btn-primary btn-sm" onClick={() => setShowMqttConfig(true)}>
                                  <i className="fas fa-cog mr-1"></i>Configurar Credenciales
                                </button>
                              </div>
                              <table className="table table-sm table-bordered">
                                <thead className="thead-dark"><tr><th>Parametro</th><th>Valor Actual</th></tr></thead>
                                <tbody>
                                  <tr><td>Broker</td><td className="text-muted">{mqttConfig.host}</td></tr>
                                  <tr><td>Puerto</td><td className="text-muted">{mqttConfig.port}</td></tr>
                                  <tr><td>Usuario</td><td className="text-muted">{mqttConfig.username || '—'}</td></tr>
                                  <tr><td>QoS</td><td className="text-muted">{mqttConfig.qos}</td></tr>
                                  <tr><td>Retención</td><td className="text-muted">true</td></tr>
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'pending-devices' && (
              <div className="row">
                <div className="col-12">
                  <div className="card">
                    <div className="card-header d-flex justify-content-between align-items-center">
                      <h3 className="card-title text-white fw-bold mb-0">
                        <i className="fas fa-clock me-2"></i>Dispositivos Pendientes de Aprobacion ({pendingDevices.length})
                      </h3>
                      <div>
                        <div className="btn-group" role="group">
                          <button type="button" className={`btn btn-sm ${pendingFilter === 'all' ? 'btn-light' : 'btn-outline-light'}`} onClick={() => setPendingFilter('all')}>Todos</button>
                          <button type="button" className={`btn btn-sm ${pendingFilter === 'online' ? 'btn-success' : 'btn-outline-success'}`} onClick={() => setPendingFilter('online')}>Online</button>
                          <button type="button" className={`btn btn-sm ${pendingFilter === 'offline' ? 'btn-danger' : 'btn-outline-danger'}`} onClick={() => setPendingFilter('offline')}>Offline</button>
                        </div>
                      </div>
                    </div>
                    <div className="card-body p-0">
                      {pendingDevices.length === 0 ? (
                        <div className="text-center text-muted p-4">
                          <i className="fas fa-check-circle fa-3x mb-3 text-success"></i>
                          <p className="mb-0">No hay dispositivos pendientes</p>
                          <small>Los nuevos dispositivos apareceran aqui cuando se conecten al MQTT</small>
                        </div>
                      ) : (
                        <div className="table-responsive">
                          <table className="table table-hover m-0">
                            <thead><tr><th>Device ID</th><th>Estado</th><th>Ultima Conexion</th><th>Asignar a Cliente</th><th>Accion</th></tr></thead>
                            <tbody>
                              {pendingDevices.filter(d => pendingFilter === 'all' || d.status === pendingFilter).map(d => (
                                <tr key={d.device_id}>
                                  <td className="fw-bold">{d.device_id}</td>
                                  <td>
                                    <span className={`badge ${d.status === 'online' ? 'text-bg-success' : 'text-bg-danger'}`}>
                                      <i className={`fas fa-circle me-1 ${d.status === 'online' ? 'fa-spin' : ''}`}></i>
                                      {d.status}
                                    </span>
                                  </td>
                                  <td className="small text-muted">
                                    {d.last_seen ? new Date(d.last_seen).toLocaleString('es-AR') : 'N/A'}
                                  </td>
                                  <td style={{ minWidth: '200px' }}>
                                    <select className="form-control form-control-sm" value={assigningDevice === d.device_id ? selectedUserId : ''} 
                                      onChange={e => { setAssigningDevice(d.device_id); setSelectedUserId(e.target.value); }}>
                                      <option value="">Seleccionar cliente...</option>
                                      {clients.map(c => (
                                        <option key={c.tenantId} value={c.tenantId}>{c.companyName}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td>
                                    <button className="btn btn-success btn-sm fw-bold" 
                                      disabled={!selectedUserId || assigningDevice !== d.device_id}
                                      onClick={async () => {
                                        try {
                                          await postJson('/devices/assign', { device_id: d.device_id, tenant_id: selectedUserId }, props.session.token);
                                          setPendingDevices(p => p.filter(x => x.device_id !== d.device_id));
                                          setAssigningDevice(null);
                                          setSelectedUserId('');
                                        } catch (err) {
                                          alert('Error al asignar dispositivo');
                                        }
                                      }}>
                                      <i className="fas fa-check me-1"></i>Aprobar
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      <div className={`modal fade ${showAddClient ? 'show' : ''}`} style={{ display: showAddClient ? 'block' : 'none' }}>
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header bg-primary">
              <h4 className="modal-title"><i className="fas fa-building mr-2"></i>Agregar Nuevo Cliente</h4>
              <button type="button" className="close text-white" onClick={() => setShowAddClient(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="mb-3">
                <label className="form-label small fw-bold">Nombre de la Empresa *</label>
                <input className="form-control" value={newClient.companyName}
                  onChange={e => setNewClient(p => ({ ...p, companyName: e.target.value }))}
                  placeholder="Estancia Don Juan" />
              </div>
              <div className="row">
                <div className="col-md-6 mb-3">
                  <label className="form-label small fw-bold">Nombre del Contacto</label>
                  <input className="form-control" value={newClient.contactName}
                    onChange={e => setNewClient(p => ({ ...p, contactName: e.target.value }))}
                    placeholder="Juan Perez" />
                </div>
                <div className="col-md-6 mb-3">
                  <label className="form-label small fw-bold">Telefono</label>
                  <input className="form-control" value={newClient.phone}
                    onChange={e => setNewClient(p => ({ ...p, phone: e.target.value }))}
                    placeholder="+54 9 11 1234-5678" />
                </div>
              </div>
              <div className="mb-3">
                <label className="form-label small fw-bold">Email de Contacto *</label>
                <input className="form-control" type="email" value={newClient.email}
                  onChange={e => setNewClient(p => ({ ...p, email: e.target.value }))}
                  placeholder="contacto@estancia.com" />
              </div>
              <div className="mb-3">
                <label className="form-label small fw-bold">Direccion</label>
                <input className="form-control" value={newClient.address}
                  onChange={e => setNewClient(p => ({ ...p, address: e.target.value }))}
                  placeholder="Ruta 2 km 45, Pcia. de Buenos Aires" />
              </div>
              <div className="mb-3">
                <label className="form-label small fw-bold">Plan</label>
                <select className="form-control" value={newClient.planId}
                  onChange={e => setNewClient(p => ({ ...p, planId: e.target.value }))}>
                  <option value="">Seleccionar plan...</option>
                  {plans.map(p => <option key={p._id} value={p._id}>{p.name} - ${p.monthlyPriceArs.toLocaleString('es-AR')}/mes</option>)}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-default" onClick={() => setShowAddClient(false)}>Cancelar</button>
              <button type="button" className="btn btn-primary"
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
      {showAddClient && <div className="modal-backdrop fade show" onClick={() => setShowAddClient(false)}></div>}

      <div className={`modal fade ${showEditClient ? 'show' : ''}`} style={{ display: showEditClient ? 'block' : 'none' }}>
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header bg-primary">
              <h4 className="modal-title"><i className="fas fa-edit mr-2"></i>Editar Cliente</h4>
              <button type="button" className="close text-white" onClick={() => setShowEditClient(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="mb-3">
                <label className="form-label small fw-bold">Nombre de la Empresa *</label>
                <input className="form-control" value={editClient.companyName}
                  onChange={e => setEditClient(p => ({ ...p, companyName: e.target.value }))} />
              </div>
              <div className="row">
                <div className="col-md-6 mb-3">
                  <label className="form-label small fw-bold">Nombre del Contacto</label>
                  <input className="form-control" value={editClient.contactName}
                    onChange={e => setEditClient(p => ({ ...p, contactName: e.target.value }))} />
                </div>
                <div className="col-md-6 mb-3">
                  <label className="form-label small fw-bold">Telefono</label>
                  <input className="form-control" value={editClient.phone}
                    onChange={e => setEditClient(p => ({ ...p, phone: e.target.value }))} />
                </div>
              </div>
              <div className="mb-3">
                <label className="form-label small fw-bold">Email de Contacto *</label>
                <input className="form-control" type="email" value={editClient.email}
                  onChange={e => setEditClient(p => ({ ...p, email: e.target.value }))} />
              </div>
              <div className="mb-3">
                <label className="form-label small fw-bold">Direccion</label>
                <input className="form-control" value={editClient.address}
                  onChange={e => setEditClient(p => ({ ...p, address: e.target.value }))} />
              </div>
              <div className="mb-3">
                <label className="form-label small fw-bold">Plan</label>
                <select className="form-control" value={editClient.planId}
                  onChange={e => setEditClient(p => ({ ...p, planId: e.target.value }))}>
                  <option value="">Seleccionar plan...</option>
                  {plans.map(p => <option key={p._id} value={p._id}>{p.name} - ${p.monthlyPriceArs.toLocaleString('es-AR')}/mes</option>)}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-default" onClick={() => setShowEditClient(false)}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={() => void saveClient()} disabled={savingClient || !editClient.companyName || !editClient.email}>
                {savingClient ? 'Guardando...' : <><i className="fas fa-save mr-1"></i>Guardar Cambios</>}
              </button>
            </div>
          </div>
        </div>
      </div>
      {showEditClient && <div className="modal-backdrop fade show" onClick={() => setShowEditClient(false)}></div>}

      <div className={`modal fade ${showDeviceModal ? 'show' : ''}`} style={{ display: showDeviceModal ? 'block' : 'none' }}>
        <div className="modal-dialog modal-xl" style={{ maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="modal-content" style={{ display: 'flex', flexDirection: 'column', maxHeight: '100%' }}>
            <div className="modal-header bg-primary">
              <h4 className="modal-title"><i className="fas fa-microchip mr-2"></i>Detalle del Sensor</h4>
              <button type="button" className="close text-white" onClick={() => setShowDeviceModal(false)}>&times;</button>
            </div>
            <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
              {selectedDevice && (
                <>
                  <div className="row mb-4">
                    <div className="col-md-6">
                      <h5 className="text-primary"><i className="fas fa-info-circle mr-1"></i>Informacion General</h5>
                      <table className="table table-sm table-borderless">
                        <tr><td className="text-muted fw-bold">Device ID:</td><td>{selectedDevice.deviceId}</td></tr>
                        <tr><td className="text-muted fw-bold">Nombre:</td><td className="fw-bold">{selectedDevice.name}</td></tr>
                        <tr><td className="text-muted fw-bold">Nivel:</td><td><span className="badge text-bg-success">{selectedDevice.levelPct}%</span></td></tr>
                        <tr><td className="text-muted fw-bold">Reserva:</td><td>{selectedDevice.reserveLiters} litros</td></tr>
                        <tr><td className="text-muted fw-bold">Bomba:</td><td><span className={`badge ${selectedDevice.pumpOn ? 'text-bg-info' : 'text-bg-secondary'}`}>{selectedDevice.pumpOn ? 'ENCENDIDA' : 'APAGADA'}</span></td></tr>
                        <tr><td className="text-muted fw-bold">Estado:</td><td><span className={`badge ${selectedDevice.status === 'online' ? 'text-bg-success' : selectedDevice.status === 'warning' ? 'text-bg-warning' : 'text-bg-danger'}`}>{selectedDevice.status}</span></td></tr>
                        <tr><td className="text-muted fw-bold">Ultima Comunicacion:</td><td className="small">{selectedDevice.lastHeartbeatAt ? new Date(selectedDevice.lastHeartbeatAt).toLocaleString('es-AR') : '—'}</td></tr>
                      </table>
                    </div>
                    <div className="col-md-6">
                      <h5 className="text-primary"><i className="fas fa-map-marker-alt mr-1"></i>Ubicacion</h5>
                      <table className="table table-sm table-borderless">
                        <tr><td className="text-muted fw-bold">Latitud:</td><td>{selectedDevice.location.lat}</td></tr>
                        <tr><td className="text-muted fw-bold">Longitud:</td><td>{selectedDevice.location.lng}</td></tr>
                        <tr><td className="text-muted fw-bold">Direccion:</td><td>{selectedDevice.location.address || '—'}</td></tr>
                      </table>
                      <div className="alert alert-warning py-2 small mt-3">
                        <i className="fas fa-clock mr-1"></i>
                        Creado: {selectedDevice.createdAt ? new Date(selectedDevice.createdAt).toLocaleString('es-AR') : '—'}
                      </div>
                    </div>
                  </div>
                  <hr />
                  <h5 className="text-primary"><i className="fas fa-edit mr-1"></i>Modificar Sensor</h5>
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="form-label small fw-bold">Nombre</label>
                      <input className="form-control" value={editDevice.name} onChange={e => setEditDevice(p => ({ ...p, name: e.target.value }))} />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label small fw-bold">Cliente</label>
                      <select className="form-control" value={editDeviceUserId} onChange={e => setEditDeviceUserId(e.target.value)}>
                        <option value="">Sin asignar</option>
                        {clients.map(c => (
                          <option key={c._id} value={c.tenantId}>{c.companyName}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label small fw-bold">Direccion</label>
                      <input className="form-control" value={editDevice.address} onChange={e => setEditDevice(p => ({ ...p, address: e.target.value }))} />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label small fw-bold">Latitud</label>
                      <input className="form-control" value={editDevice.lat} onChange={e => setEditDevice(p => ({ ...p, lat: e.target.value }))} />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label small fw-bold">Longitud</label>
                      <input className="form-control" value={editDevice.lng} onChange={e => setEditDevice(p => ({ ...p, lng: e.target.value }))} />
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-default" onClick={() => setShowDeviceModal(false)}>Cerrar</button>
              <button type="button" className="btn btn-primary" onClick={() => void saveDevice()} disabled={savingDevice}>
                {savingDevice ? 'Guardando...' : <><i className="fas fa-save mr-1"></i>Guardar Cambios</>}
              </button>
            </div>
          </div>
        </div>
      </div>
      {showDeviceModal && <div className="modal-backdrop fade show" onClick={() => setShowDeviceModal(false)}></div>}

      <div className={`modal fade ${showAddSensorModal ? 'show' : ''}`} style={{ display: showAddSensorModal ? 'block' : 'none' }}>
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header bg-primary">
              <h4 className="modal-title"><i className="fas fa-plus-circle mr-2"></i>Agregar Nuevo Sensor</h4>
              <button type="button" className="close text-white" onClick={() => setShowAddSensorModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="mb-3">
                <label className="form-label small fw-bold">Device ID *</label>
                <input className="form-control" value={newSensor.deviceId} onChange={e => setNewSensor(p => ({ ...p, deviceId: e.target.value }))} placeholder="ESP32-001" />
              </div>
              <div className="mb-3">
                <label className="form-label small fw-bold">Nombre *</label>
                <input className="form-control" value={newSensor.name} onChange={e => setNewSensor(p => ({ ...p, name: e.target.value }))} placeholder="Tanque Principal" />
              </div>
              <div className="mb-3">
                <label className="form-label small fw-bold">Direccion</label>
                <input className="form-control" value={newSensor.address} onChange={e => setNewSensor(p => ({ ...p, address: e.target.value }))} placeholder="Ruta 2 km 45" />
              </div>
              <div className="row">
                <div className="col-md-6 mb-3">
                  <label className="form-label small fw-bold">Latitud</label>
                  <input className="form-control" value={newSensor.lat} onChange={e => setNewSensor(p => ({ ...p, lat: e.target.value }))} />
                </div>
                <div className="col-md-6 mb-3">
                  <label className="form-label small fw-bold">Longitud</label>
                  <input className="form-control" value={newSensor.lng} onChange={e => setNewSensor(p => ({ ...p, lng: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-default" onClick={() => setShowAddSensorModal(false)}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={() => void createSensor()} disabled={creatingSensor || !newSensor.deviceId || !newSensor.name}>
                {creatingSensor ? 'Creando...' : <><i className="fas fa-plus mr-1"></i>Crear Sensor</>}
              </button>
            </div>
          </div>
        </div>
      </div>
      {showAddSensorModal && <div className="modal-backdrop fade show" onClick={() => setShowAddSensorModal(false)}></div>}

      {showAllDevicesModal && (
        <>
          <div className="modal-backdrop fade show" style={{ opacity: 0.5 }}></div>
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1050, display: 'flex', flexDirection: 'column', backgroundColor: 'white' }}>
            <div className="bg-primary px-3 py-2 d-flex align-items-center">
              <h5 className="mb-0 text-white"><i className="fas fa-map-marked-alt mr-2"></i>Mapa de Todos los Dispositivos</h5>
              <button className="btn btn-outline-light btn-sm ml-auto" onClick={() => setShowAllDevicesModal(false)}>
                <i className="fas fa-times"></i> Cerrar
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {allDevices.length > 0 && (() => {
                const lats = allDevices.map(d => d.location.lat);
                const lngs = allDevices.map(d => d.location.lng);
                const center: [number, number] = [
                  (Math.min(...lats) + Math.max(...lats)) / 2,
                  (Math.min(...lngs) + Math.max(...lngs)) / 2
                ];
                return (
              <MapContainer center={center} zoom={10} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                {allDevices.map(d => {
                  const color = markerColor(d.status, d.levelPct, false);
                  return (
                  <Marker key={d._id} position={[d.location.lat, d.location.lng]} eventHandlers={{
                    click: () => { openDeviceModal(d); }
                  }} icon={L.divIcon({ className: 'custom-marker', html: `<div style="background-color:${color};width:24px;height:24px;border-radius:50%;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);cursor:pointer;"></div>`, iconSize: [24, 24], iconAnchor: [12, 12] })}>
                    <Popup><div className="p-1"><h6 className="fw-bold mb-1">{d.name}</h6><p className="mb-0 small">Cliente: <strong>{d.clientName}</strong></p><p className="mb-0 small">Estado: <span className={`badge ${d.status === 'online' ? 'text-bg-success' : 'text-bg-danger'}`}>{d.status}</span></p><p className="mb-0 small">Nivel: <strong>{d.levelPct}%</strong></p><p className="mb-0 small text-muted">Click para editar</p></div></Popup>
                  </Marker>
                );})}
              </MapContainer>
                );
              })()}
              {allDevices.length === 0 && (
                <div className="text-center text-muted py-5">No hay dispositivos para mostrar en el mapa</div>
              )}
            </div>
          </div>
        </>
      )}

      <div className={`modal fade ${showMqttConfig ? 'show' : ''}`} style={{ display: showMqttConfig ? 'block' : 'none' }}>
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header bg-primary">
              <h4 className="modal-title"><i className="fas fa-wifi mr-2"></i>Configuración MQTT</h4>
              <button type="button" className="close text-white" onClick={() => setShowMqttConfig(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="mb-3">
                <label className="form-label small fw-bold">Broker Host</label>
                <input className="form-control" value={mqttConfig.host} onChange={e => setMqttConfig(p => ({ ...p, host: e.target.value }))} placeholder="localhost" />
              </div>
              <div className="mb-3">
                <label className="form-label small fw-bold">Puerto</label>
                <input className="form-control" value={mqttConfig.port} onChange={e => setMqttConfig(p => ({ ...p, port: e.target.value }))} placeholder="1883" />
              </div>
              <div className="mb-3">
                <label className="form-label small fw-bold">Usuario</label>
                <input className="form-control" value={mqttConfig.username} onChange={e => setMqttConfig(p => ({ ...p, username: e.target.value }))} placeholder="Usuario MQTT" />
              </div>
              <div className="mb-3">
                <label className="form-label small fw-bold">Contraseña</label>
                <div className="input-group">
                  <input className="form-control" type={showMqttPassword ? 'text' : 'password'} value={mqttConfig.password} onChange={e => setMqttConfig(p => ({ ...p, password: e.target.value }))} placeholder="Contraseña MQTT" />
                  <div className="input-group-append">
                    <button className="btn btn-outline-secondary" type="button" onClick={() => setShowMqttPassword(!showMqttPassword)}>
                      <i className={`fas ${showMqttPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </button>
                  </div>
                </div>
              </div>
              <div className="mb-3">
                <label className="form-label small fw-bold">QoS</label>
                <select className="form-control" value={mqttConfig.qos} onChange={e => setMqttConfig(p => ({ ...p, qos: e.target.value }))}>
                  <option value="0">0 - Mejor esfuerzo</option>
                  <option value="1">1 - Al menos una vez</option>
                  <option value="2">2 - Exactamente una vez</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-default" onClick={() => setShowMqttConfig(false)}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={() => setShowMqttConfig(false)}>
                <i className="fas fa-save mr-1"></i>Guardar
              </button>
            </div>
          </div>
        </div>
      </div>
      {showMqttConfig && <div className="modal-backdrop fade show" onClick={() => setShowMqttConfig(false)}></div>}

      <footer className="main-footer">
        <div className="float-end d-none d-sm-inline-block">
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
    return <CompanyAdminPanel session={session} onLogout={logout} onPasswordChanged={() => {
      const updated = { ...session, user: { ...session.user, mustChangePassword: false } };
      setSession(updated);
      saveSession(updated);
    }} />;
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
