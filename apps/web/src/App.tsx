import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { io } from 'socket.io-client';
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import Swal from 'sweetalert2';
import { useToast } from './Toast';
import 'sweetalert2/dist/sweetalert2.min.css';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function AssignMap(props: { lat: string; lng: string; onSelect: (lat: number, lng: number) => void }) {
  const center: [number, number] = props.lat && props.lng ? [Number(props.lat), Number(props.lng)] : [-34.62, -58.43];
  
  return (
    <MapContainer 
      center={center} 
      zoom={13} 
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {props.lat && props.lng && (
        <Marker position={[Number(props.lat), Number(props.lng)]} />
      )}
      <MapClickHandler onMapClick={(lat, lng) => props.onSelect(lat, lng)} />
    </MapContainer>
  );
}

function MapClickHandler(props: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e: any) => {
      props.onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function MapCenterUpdater(props: { lat: string; lng: string }) {
  const map = useMap();
  useEffect(() => {
    const lat = Number(props.lat);
    const lng = Number(props.lng);
    if (!isNaN(lat) && !isNaN(lng)) {
      map.setView([lat, lng], map.getZoom());
    }
  }, [props.lat, props.lng, map]);
  return null;
}

function getStatusColor(status: string) {
  if (status === 'online') return '#28a745';
  if (status === 'warning') return '#ffc107';
  return '#dc3545';
}

function getStatusBadge(status: string) {
  if (status === 'online') return 'text-bg-success';
  if (status === 'warning') return 'text-bg-warning';
  return 'text-bg-danger';
}

function getPumpColor(on: boolean) {
  return on ? '#28a745' : '#dc3545';
}

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
  configNivelMin?: number;
  configNivelMax?: number;
  configAlertaBaja?: number;
  configModoAuto?: boolean;
};

type Alert = {
  _id: string;
  deviceId: string;
  message: string;
  type: 'offline' | 'critical_level';
  status: 'open' | 'resolved';
  openedAt?: string;
  createdAt?: string;
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
  tipo: 'A' | 'B' | 'C' | 'M';
  estado: 'borrador' | 'pendiente' | 'autorizado' | 'rechazado' | 'anulado';
  arca?: { cae?: string; cbteNro?: number };
};

type Plan = {
  _id: string;
  name: string;
  monthlyPriceArs: number;
  maxDevices: number;
  active?: boolean;
  features?: string[];
};

type ArcaConfig = {
  enabled: boolean;
  mock: boolean;
  environment: 'mock' | 'homologacion' | 'produccion';
  cuit: string;
  ptoVta: string;
  wsfeUrl: string;
  wsaaUrl: string;
  token?: string;
  sign?: string;
  certPath?: string;
  certPassword?: string;
};

type ArcaDiagnostics = {
  tenantId: string;
  config: {
    environment: 'mock' | 'homologacion' | 'produccion';
    enabled: boolean;
    mock: boolean;
    hasCredentials: boolean;
    hasCertConfig: boolean;
    wsaaUrl?: string;
    wsfeUrl?: string;
  };
  authSession?: {
    uniqueId: string | null;
    generationTime: string | null;
    expirationTime: string | null;
    expired: boolean;
    service: string | null;
    source: string | null;
    signPreview: string | null;
  };
  certificate: {
    hasPrivateKey: boolean;
    hasCsr: boolean;
    hasCertificate: boolean;
    createdAt: string | null;
    environment: string | null;
  };
  connection: {
    ok: boolean;
    message: string;
    lastVoucher?: number;
  };
  credentialsAutoRefreshed?: boolean;
  documents: {
    total: number;
    pending: number;
    authorized: number;
    withCae: number;
    syncedPct: number;
    byTipo?: {
      A: { localLast: number; remoteLast: number | null; synced: boolean | null };
      B: { localLast: number; remoteLast: number | null; synced: boolean | null };
      C: { localLast: number; remoteLast: number | null; synced: boolean | null };
    };
  };
};

type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'operator' | 'technician' | 'company_admin' | 'client';
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
  taxId?: string;
  ivaCondition?: string;
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
  environment: 'mock',
  cuit: '',
  ptoVta: '1',
  wsfeUrl: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  wsaaUrl: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  token: '',
  sign: '',
  certPath: '',
  certPassword: ''
};

function authHeaders(token?: string, json = false): HeadersInit {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function buildApiError(res: Response): Promise<Error> {
  let detail = '';
  try {
    const data = await res.clone().json() as { error?: string; details?: string };
    detail = data.details || data.error || '';
  } catch {
    try {
      detail = await res.clone().text();
    } catch {
      detail = '';
    }
  }
  const suffix = detail ? `: ${detail}` : '';
  return new Error(`API ${res.status}${suffix}`);
}

async function getJson<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: authHeaders(token) });
  if (!res.ok) {
    const err = await buildApiError(res);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  return res.json();
}

async function putJson<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'PUT',
    headers: authHeaders(token, true),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw await buildApiError(res);
  return res.json();
}

async function postJson(path: string, body: unknown, token?: string) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw await buildApiError(res);
  return res;
}

async function patchJson(path: string, body: unknown, token?: string) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'PATCH',
    headers: authHeaders(token, true),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw await buildApiError(res);
  return res;
}

async function deleteJson(path: string, token?: string) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'DELETE',
    headers: authHeaders(token)
  });
  if (!res.ok) throw await buildApiError(res);
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
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);

  const [resetToken, setResetToken] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetError, setResetError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const email = params.get('email');
    if (token && email) {
      setResetToken(token);
      setResetEmail(decodeURIComponent(email));
    }
  }, []);

  const handleResetPassword = async () => {
    if (newPassword !== confirmPassword) {
      setResetError('Las contrasenas no coinciden');
      return;
    }
    if (newPassword.length < 8) {
      setResetError('La contrasena debe tener al menos 8 caracteres');
      return;
    }
    setResetLoading(true);
    setResetError('');
    try {
      await postJson('/auth/reset-password', { token: resetToken, email: resetEmail, newPassword });
      setResetSuccess(true);
    } catch {
      setResetError('Token invalido o expirado');
    } finally {
      setResetLoading(false);
    }
  };

  if (resetToken && !resetSuccess) {
    return (
      <main className="login-page">
        <div className="login-box">
          <div className="card card-outline card-primary">
            <div className="card-header text-center">
              <h1 className="h3 mb-0 font-weight-bold">AgroSentinel</h1>
              <p className="text-muted small mb-0 mt-1">Nueva contrasena</p>
            </div>
            <div className="card-body">
              <p className="text-muted small">Ingresa tu nueva contrasena.</p>
              <div className="mb-3">
                <label className="form-label small fw-semibold">Nueva contrasena</label>
                <input type="password" className="form-control" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Minimo 8 caracteres" />
              </div>
              <div className="mb-3">
                <label className="form-label small fw-semibold">Confirmar contrasena</label>
                <input type="password" className="form-control" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Repite tu contrasena" />
              </div>
              {resetError && <div className="alert alert-danger py-2 small">{resetError}</div>}
              <div className="row">
                <div className="col-12">
                  <button type="button" className="btn btn-primary btn-block" onClick={() => void handleResetPassword()} disabled={resetLoading || !newPassword || !confirmPassword}>
                    {resetLoading ? 'Guardando...' : 'Guardar contrasena'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (resetSuccess) {
    return (
      <main className="login-page">
        <div className="login-box">
          <div className="card card-outline card-primary">
            <div className="card-header text-center">
              <h1 className="h3 mb-0 font-weight-bold">AgroSentinel</h1>
            </div>
            <div className="card-body text-center">
              <i className="fas fa-check-circle text-success fa-3x mb-3"></i>
              <p className="mb-3">Tu contrasena ha sido actualizada correctamente.</p>
              <a href="/" className="btn btn-primary">Ir al login</a>
            </div>
          </div>
        </div>
      </main>
    );
  }

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

  const handleForgotPassword = async () => {
    if (!forgotEmail) return;
    setForgotLoading(true);
    try {
      await postJson('/auth/forgot-password', { email: forgotEmail });
      setForgotSent(true);
    } catch {
      setError('No se pudo procesar la solicitud');
    } finally {
      setForgotLoading(false);
    }
  };

  if (showForgotPassword) {
    return (
      <main className="login-page">
        <div className="login-box">
          <div className="card card-outline card-primary">
            <div className="card-header text-center">
              <h1 className="h3 mb-0 font-weight-bold">AgroSentinel</h1>
              <p className="text-muted small mb-0 mt-1">Recuperar contrasena</p>
            </div>
            <div className="card-body">
              {forgotSent ? (
                <div className="text-center">
                  <i className="fas fa-check-circle text-success fa-3x mb-3"></i>
                  <p>Se ha enviado un enlace de recuperacion a tu email.</p>
                  <button className="btn btn-link" onClick={() => { setShowForgotPassword(false); setForgotSent(false); setForgotEmail(''); }}>
                    Volver al login
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-muted small">Ingresa tu email y te enviaremos un enlace para recuperar tu contrasena.</p>
                  <div className="mb-3">
                    <label className="form-label small fw-semibold">Email</label>
                    <input type="email" className="form-control" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} placeholder="tu@email.com" />
                  </div>
                  {error && <div className="alert alert-danger py-2 small">{error}</div>}
                  <div className="row">
                    <div className="col-12">
                      <button type="button" className="btn btn-primary btn-block" onClick={() => void handleForgotPassword()} disabled={forgotLoading || !forgotEmail}>
                        {forgotLoading ? 'Enviando...' : 'Enviar enlace'}
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 text-center">
                    <button className="btn btn-link" onClick={() => { setShowForgotPassword(false); setError(''); }}>
                      <i className="fas fa-arrow-left mr-1"></i>Volver al login
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    );
  }

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
            <div className="mt-3 text-center">
              <button className="btn btn-link" onClick={() => setShowForgotPassword(true)}>
                <i className="fas fa-lock mr-1"></i>Olvidaste tu contrasena?
              </button>
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
  const [clientData, setClientData] = useState<{companyName: string; contactName: string; email: string; phone: string; address: string; taxId: string; ivaCondition: string} | null>(null);
  const [savingClientData, setSavingClientData] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>([-34.62, -58.43]);

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

      const validDevices = d.filter(dev => dev.location && typeof dev.location.lat === 'number' && typeof dev.location.lng === 'number');
      if (validDevices.length > 0) {
        const lats = validDevices.map(dev => Number(dev.location.lat));
        const lngs = validDevices.map(dev => Number(dev.location.lng));
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);
        if (validDevices.length === 1) {
          setMapCenter([lats[0], lngs[0]]);
        } else {
          setMapCenter([
            (minLat + maxLat) / 2,
            (minLng + maxLng) / 2
          ]);
        }
      } else {
        setMapCenter([-34.62, -58.43]);
      }
    } catch (err) {
      console.error('Error loading devices/alerts/orders/invoices:', err);
    }

    try {
      const arca = await getJson<ArcaConfig>(`/billing/arca-config?tenantId=${tenantId}`, token);
      setArcaConfig(arca);
    } catch (err) {
      console.error('Error loading arca config:', err);
    }

    try {
      const tenant = await getJson<{companyName: string; contactName: string; email: string; phone: string; address: string; taxId: string; ivaCondition: string}>('/tenants/me', token);
      setClientData(tenant);
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
    socket.on('devices:updated', (payload: any) => {
      if (payload && payload.deviceId) {
        setDevices(prev => prev.map(d => d.deviceId === payload.deviceId ? { ...d, ...payload } : d));
      } else {
        void loadAll();
      }
    });
    socket.on('alerts:updated', () => void loadAll());
    socket.on('work-orders:updated', () => void loadAll());
    socket.on('telemetry:new', (payload: any) => {
      if (payload && payload.deviceId) {
        setDevices(prev => prev.map(d => d.deviceId === payload.deviceId ? { ...d, ...payload, lastSeenAt: new Date().toISOString() } : d));
      }
    });
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

  const saveClientData = async () => {
    if (!clientData) return;
    setSavingClientData(true);
    try {
      const updated = await putJson<{companyName: string; contactName: string; email: string; phone: string; address: string; taxId: string; ivaCondition: string}>('/tenants/me', clientData, props.session.token);
      setClientData(updated);
    } finally {
      setSavingClientData(false);
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
                    {mapCenter ? (
                    <MapContainer center={mapCenter} zoom={10} style={{ height: '380px', width: '100%' }}>
                      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                      <MapCenterUpdater lat={mapCenter[0].toString()} lng={mapCenter[1].toString()} />
                      {devices.filter(d => d.location && typeof d.location.lat === 'number' && typeof d.location.lng === 'number').map(d => (
                        <CircleMarker
                          key={d._id}
                          center={[d.location.lat, d.location.lng]}
                          radius={11}
                          pathOptions={{ color: markerColor(d.status), fillOpacity: 0.8 }}
                        >
                          <Popup>
                            <div className="p-1">
                              <h6 className="fw-bold mb-1">{d.name}</h6>
                              <p className="mb-0 small">Estado: <span className={`badge ${getStatusBadge(d.status)}`}><i className={`fas fa-circle mr-1`} style={{ fontSize: '0.6em', color: getStatusColor(d.status) }}></i>{d.status}</span></p>
                              <p className="mb-0 small">Nivel: <strong>{d.levelPct}%</strong></p>
                            </div>
                          </Popup>
                        </CircleMarker>
                      ))}
                    </MapContainer>
                    ) : (
                      <div className="d-flex align-items-center justify-content-center" style={{ height: '380px', backgroundColor: '#f8f9fa' }}>
                        <div className="text-center text-muted">
                          <i className="fas fa-spinner fa-spin fa-2x mb-2"></i>
                          <p>Cargando mapa...</p>
                        </div>
                      </div>
                    )}
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
                                <span className={`badge ${d.pumpOn ? 'text-bg-success' : 'text-bg-danger'}`}>
                                  <i className="fas fa-circle" style={{fontSize: '0.6em', marginRight: '4px', verticalAlign: 'middle', color: getPumpColor(d.pumpOn)}}></i> 
                                  {d.pumpOn ? 'ENCENDIDA' : 'APAGADA'}
                                </span>
                              </td>
                              <td className="align-middle">
                                <span className={`badge ${getStatusBadge(d.status)}`}><i className={`fas fa-circle mr-1`} style={{ fontSize: '0.6em', color: getStatusColor(d.status) }}></i>{d.status}</span>
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
                      <thead><tr><th>Periodo</th><th>Monto</th><th>Tipo</th><th>Estado</th></tr></thead>
                      <tbody>
                        {invoices.length === 0 ? (
                          <tr><td colSpan={4} className="text-center text-muted py-3">No hay facturas</td></tr>
                        ) : invoices.map(inv => (
                          <tr key={inv._id}>
                            <td>{inv.period}</td>
                            <td>${inv.amountArs.toLocaleString('es-AR')}</td>
                            <td>Factura {inv.tipo}</td>
                            <td><span className={`badge ${inv.estado === 'autorizado' ? 'text-bg-success' : inv.estado === 'pendiente' ? 'text-bg-warning' : 'text-bg-danger'}`}>{inv.estado}</span></td>
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

            <div className="row mt-4">
              <div className="col-12">
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-user-circle me-2"></i>Mis Datos</h3>
                  </div>
                  <div className="card-body">
                    {(() => {
                      const data = clientData || { companyName: props.session.user.name || '', contactName: props.session.user.name || '', email: props.session.user.email || '', phone: '', address: '', taxId: '', ivaCondition: 'Consumidor Final' };
                      return (
                        <div className="row">
                          <div className="col-md-6">
                            <div className="mb-3">
                              <label className="form-label fw-bold">Razon Social / Nombre</label>
                              <input className="form-control" value={data.companyName} onChange={e => setClientData(d => d ? { ...d, companyName: e.target.value } : null)} />
                            </div>
                            <div className="mb-3">
                              <label className="form-label fw-bold">Nombre de Contacto</label>
                              <input className="form-control" value={data.contactName} onChange={e => setClientData(d => d ? { ...d, contactName: e.target.value } : null)} />
                            </div>
                            <div className="mb-3">
                              <label className="form-label fw-bold">Email</label>
                              <input className="form-control" type="email" value={data.email} onChange={e => setClientData(d => d ? { ...d, email: e.target.value } : null)} />
                            </div>
                            <div className="mb-3">
                              <label className="form-label fw-bold">Telefono</label>
                              <input className="form-control" value={data.phone} onChange={e => setClientData(d => d ? { ...d, phone: e.target.value } : null)} />
                            </div>
                          </div>
                          <div className="col-md-6">
                            <div className="mb-3">
                              <label className="form-label fw-bold">Direccion</label>
                              <input className="form-control" value={data.address} onChange={e => setClientData(d => d ? { ...d, address: e.target.value } : null)} />
                            </div>
                            <div className="mb-3">
                              <label className="form-label fw-bold">CUIT / CUIL</label>
                              <input className="form-control" value={data.taxId} onChange={e => setClientData(d => d ? { ...d, taxId: e.target.value } : null)} />
                            </div>
                            <div className="mb-3">
                              <label className="form-label fw-bold">Condicion ante IVA</label>
                              <select className="form-control" value={data.ivaCondition} onChange={e => setClientData(d => d ? { ...d, ivaCondition: e.target.value } : null)}>
                                <option value="Consumidor Final">Consumidor Final</option>
                                <option value="Responsable Inscripto">Responsable Inscripto</option>
                                <option value="Monotributista">Monotributista</option>
                                <option value="Exento">Exento</option>
                              </select>
                            </div>
                            <button className="btn btn-primary mt-3" onClick={() => void saveClientData()} disabled={savingClientData}>
                              {savingClientData ? 'Guardando...' : 'Guardar Cambios'}
                            </button>
                          </div>
                        </div>
                      );
                    })()}
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

type AdminSection = 'dashboard' | 'clientes' | 'dispositivos' | 'usuarios' | 'facturacion' | 'arca' | 'notificaciones' | 'reportes' | 'actividad' | 'servidor' | 'pending-devices' | 'backup';

function CompanyAdminPanel(props: { session: AuthSession; onLogout: () => void; onPasswordChanged: () => void }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [operacionOpen, setOperacionOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<AdminSection>('dashboard');
  const [tenantId, setTenantId] = useState<string>('');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [editPlanData, setEditPlanData] = useState<{ name: string; maxDevices: number; monthlyPriceArs: number; active: boolean; features: string[] }>({ name: '', maxDevices: 0, monthlyPriceArs: 0, active: true, features: [] });
  const [savingPlan, setSavingPlan] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [allDevices, setAllDevices] = useState<Device[]>([]);
  const [clients, setClients] = useState<TenantClient[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [loadingClients, setLoadingClients] = useState(false);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [arcaConfig, setArcaConfig] = useState<ArcaConfig>(emptyArcaConfig);
  const [savingArca, setSavingArca] = useState(false);
  const [arcaDiagnostics, setArcaDiagnostics] = useState<ArcaDiagnostics | null>(null);
  const [testingArca, setTestingArca] = useState(false);
  const [restoreClient, setRestoreClient] = useState(true);
  const [creatingUser, setCreatingUser] = useState(false);
  const [serverTab, setServerTab] = useState<'servidor' | 'mqtt' | 'config' | 'backup'>('servidor');
  const [facturacionTab, setFacturacionTab] = useState<'planes' | 'arca' | 'empresa' | 'certificado' | 'facturas'>('facturas');
  const [companyInfo, setCompanyInfo] = useState({ companyName: '', contactName: '', email: '', phone: '', address: '', taxId: '', ivaCondition: 'Responsable Inscripto', province: '', city: '' });
  const [savingCompanyInfo, setSavingCompanyInfo] = useState(false);
  const [provinces, setProvinces] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [processingInvoiceId, setProcessingInvoiceId] = useState<string | null>(null);
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  const [showCreateInvoiceModal, setShowCreateInvoiceModal] = useState(false);
  const [newInvoice, setNewInvoice] = useState({ tenantId: '', clientTenantId: '', tipo: 'B', clienteNombre: 'Consumidor Final', clienteTipoDoc: 99, clienteNroDoc: '0', clienteCondicionIva: 'Consumidor Final', amountArs: 0, period: new Date().toISOString().slice(0, 7) });
  const [systemConfig, setSystemConfig] = useState<{key: string; value: string; description?: string}[]>([]);
  const [savingConfig, setSavingConfig] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [backupError, setBackupError] = useState('');
  const [backupSuccess, setBackupSuccess] = useState('');
  const [certStatus, setCertStatus] = useState<{
    hasPrivateKey: boolean;
    hasCsr: boolean;
    hasCertificate: boolean;
    environment: string | null;
    createdAt: string | null;
    companyName?: string;
    taxId?: string;
  } | null>(null);
  const [uploadingCert, setUploadingCert] = useState(false);
  const [certificatePemInput, setCertificatePemInput] = useState('');
  const [devicesMapCenter, setDevicesMapCenter] = useState<[number, number] | null>(null);
  const [allDevicesMapCenter, setAllDevicesMapCenter] = useState<[number, number] | null>(null);
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
  const [pendingDevices, setPendingDevices] = useState<{ device_id: string; status: string; last_seen: number; created_at?: number }[]>([]);
  const [usersList, setUsersList] = useState<{ id: string; name: string; email: string; role: string; tenantId: string }[]>([]);
  const [assigningDevice, setAssigningDevice] = useState<string | null>(null);
  const [assigningName, setAssigningName] = useState('');
  const [assigningLat, setAssigningLat] = useState('');
  const [assigningLng, setAssigningLng] = useState('');

  const showSwal = useCallback((message: string, level: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    const titles: Record<'success' | 'error' | 'warning' | 'info', string> = {
      success: 'Exito',
      error: 'Error',
      warning: 'Atencion',
      info: 'Info'
    };
    void Swal.fire({
      toast: true,
      position: 'top-end',
      icon: level,
      title: titles[level],
      text: message,
      showConfirmButton: false,
      timer: 4200,
      timerProgressBar: true
    });
  }, []);

  useEffect(() => {
    const originalAlert = window.alert;
    window.alert = (message?: unknown) => {
      const text = String(message ?? '');
      const lower = text.toLowerCase();
      let level: 'success' | 'error' | 'warning' | 'info' = 'info';
      if (lower.includes('error') || lower.includes('fall') || lower.includes('no se pudo')) level = 'error';
      else if (lower.includes('pendiente') || lower.includes('warning') || lower.includes('atencion')) level = 'warning';
      else if (lower.includes('exitos') || lower.includes('guardad') || lower.includes('autoriz')) level = 'success';
      showSwal(text, level);
    };

    return () => {
      window.alert = originalAlert;
    };
  }, [showSwal]);
  const [showAssigningMap, setShowAssigningMap] = useState(false);
  const [pendingFilter, setPendingFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [newUser, setNewUser] = useState({
    name: '',
    email: '',
    role: 'owner' as 'owner' | 'operator' | 'technician',
    password: 'Cliente123!'
  });
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [showEditUserModal, setShowEditUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<{ id: string; name: string; email: string; role: 'owner' | 'operator' | 'technician'; tenantId: string } | null>(null);
  const [editUserPassword, setEditUserPassword] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [showAddClient, setShowAddClient] = useState(false);
  const [showEditClient, setShowEditClient] = useState(false);
  const [creatingClient, setCreatingClient] = useState(false);
  const [createdClientCredentials, setCreatedClientCredentials] = useState<{email: string; password: string; tenantId: string} | null>(null);
  const [newClient, setNewClient] = useState({
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    address: '',
    planId: '',
    taxId: '',
    ivaCondition: 'Consumidor Final'
  });
  const [editClient, setEditClient] = useState({
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    address: '',
    planId: '',
    taxId: '',
    ivaCondition: 'Consumidor Final'
  });
  const [savingClient, setSavingClient] = useState(false);
  const [selectedClient, setSelectedClient] = useState<TenantClient | null>(null);
  const [clientTab, setClientTab] = useState<'info' | 'dispositivos' | 'mapa'>('info');
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [editDevice, setEditDevice] = useState<{ name: string; address: string; lat: string; lng: string; configNivelMin?: number; configNivelMax?: number; configAlertaBaja?: number; configModoAuto?: boolean }>({ name: '', address: '', lat: '', lng: '' });
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
      setChangingPwd(false);
      props.onPasswordChanged();
    } catch (err) {
      console.error('Password change error:', err);
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

  useEffect(() => {
    void loadAllDevices();
  }, []);

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
    void getJson<Plan[]>('/billing/plans', props.session.token).then(setPlans).catch(console.error);
  }, [props.session.token, props.session.user.role]);

  useEffect(() => {
    setDevicesMapCenter(null);
  }, [tenantId]);

  useEffect(() => {
    if (serverTab === 'config') {
      getJson<{key: string; value: string; description?: string}[]>('/config', props.session.token)
        .then(data => {
          console.log('Config loaded:', data);
          setSystemConfig(data);
        })
        .catch(err => {
          console.error('Error loading config:', err);
          alert('Error al cargar configuración: ' + err.message);
        });
    }
  }, [serverTab, props.session.token]);

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
    if (activeSection === 'usuarios' && props.session.user.role === 'company_admin') {
      const tid = props.session.user.tenantId;
      void (async () => {
        try {
          const tenantUsers = await getJson<AuthUser[]>(`/auth/admin/users?tenantId=${tid}`, props.session.token);
          setUsers(tenantUsers);
        } catch (err) {
          console.error('Error loading users:', err);
        }
      })();
    }
  }, [activeSection, props.session.user.role, props.session.user.tenantId, props.session.token]);

  useEffect(() => {
    if (activeSection === 'facturacion' && facturacionTab === 'empresa') {
      void (async () => {
        try {
          const info = await getJson<typeof companyInfo>('/billing/company-info', props.session.token);
          setCompanyInfo(info);
          if (info.province) {
            const citiesRes = await getJson<string[]>('/billing/cities/' + encodeURIComponent(info.province), props.session.token);
            setCities(citiesRes);
          }
        } catch (err) {
          console.error('Error loading company info:', err);
        }
      })();
    }
  }, [activeSection, facturacionTab, props.session.token]);

  useEffect(() => {
    if (provinces.length === 0) {
      void (async () => {
        try {
          const provs = await getJson<string[]>('/billing/provinces', props.session.token);
          setProvinces(provs);
        } catch (err) {
          console.error('Error loading provinces:', err);
        }
      })();
    }
  }, [activeSection]);

  useEffect(() => {
    if (activeSection === 'facturacion' && facturacionTab === 'facturas' && props.session?.token) {
      void (async () => {
        try {
          const data = await getJson<any[]>('/billing/invoices', props.session.token);
          setInvoices(data);
        } catch (err) {
          console.error('Error loading invoices:', err);
        }
      })();
    }
  }, [activeSection, facturacionTab, props.session?.token]);

  const certificateTenantId = props.session.user.tenantId;
  const certificateQuery = `?tenantId=${encodeURIComponent(certificateTenantId)}`;

  useEffect(() => {
    if (activeSection !== 'facturacion' || (facturacionTab !== 'certificado' && facturacionTab !== 'arca')) return;
    void runArcaDiagnostics();
  }, [activeSection, facturacionTab, certificateTenantId]);

  const loadCertStatus = async () => {
    try {
      const status = await getJson<typeof certStatus>(`/billing/certificate/status${certificateQuery}`, props.session.token);
      setCertStatus(status);
    } catch (err) {
      console.error('Error loading cert status:', err);
    }
  };

  useEffect(() => {
    if (activeSection === 'facturacion' && facturacionTab === 'certificado') {
      void loadCertStatus();
    }
  }, [activeSection, facturacionTab, props.session.token, certificateTenantId]);

  const createInvoice = async (autoAuthorize = true) => {
    setCreatingInvoice(true);
    try {
      const res = await postJson('/billing/invoices', {
        tipo: newInvoice.tipo,
        cliente: {
          tipoDoc: newInvoice.clienteTipoDoc,
          nroDoc: newInvoice.clienteNroDoc,
          nombre: newInvoice.clienteNombre,
          condicionIva: newInvoice.clienteCondicionIva
        },
        period: newInvoice.period,
        amountArs: newInvoice.amountArs,
        clientTenantId: newInvoice.clientTenantId || undefined
      }, props.session.token);
      const invoice = await res.json();

      let createdInvoice = invoice;
      let authorizeError = '';
      if (autoAuthorize) {
        try {
          const authRes = await postJson(`/billing/invoices/${invoice._id}/authorize`, {}, props.session.token);
          const authResult = await authRes.json();
          createdInvoice = authResult.invoice;
        } catch (err) {
          authorizeError = err instanceof Error ? err.message : String(err);
        }
      }

      setInvoices([createdInvoice, ...invoices]);
      setNewInvoice({ tenantId: '', clientTenantId: '', tipo: 'B', clienteNombre: 'Consumidor Final', clienteTipoDoc: 99, clienteNroDoc: '0', clienteCondicionIva: 'Consumidor Final', amountArs: 0, period: new Date().toISOString().slice(0, 7) });
      setShowCreateInvoiceModal(false);
      if (!autoAuthorize) {
        alert('Factura guardada en estado pendiente');
      } else if (authorizeError) {
        alert(`Factura creada en estado pendiente. No se pudo autorizar en ARCA: ${authorizeError}`);
      } else {
        alert('Factura creada y autorizada exitosamente');
      }
    } catch (err) {
      console.error('Error creating invoice:', err);
      alert(`Error al crear factura: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCreatingInvoice(false);
    }
  };

  const authorizeSingleInvoice = async (invoiceId: string) => {
    setProcessingInvoiceId(invoiceId);
    try {
      const authRes = await postJson(`/billing/invoices/${invoiceId}/authorize`, {}, props.session.token);
      const authResult = await authRes.json();
      setInvoices(prev => prev.map(item => item._id === invoiceId ? authResult.invoice : item));
      alert('Factura autorizada correctamente');
    } catch (err) {
      console.error('Error authorizing invoice:', invoiceId, err);
      alert(`No se pudo autorizar la factura: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setProcessingInvoiceId(null);
    }
  };

  const deletePendingInvoice = async (invoiceId: string) => {
    const result = await Swal.fire({
      title: '¿Eliminar factura pendiente?',
      text: 'Esta acción no se puede deshacer.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d'
    });
    if (!result.isConfirmed) return;
    setProcessingInvoiceId(invoiceId);
    try {
      await deleteJson(`/billing/invoices/${invoiceId}`, props.session.token);
      setInvoices(prev => prev.filter(item => item._id !== invoiceId));
      if (expandedInvoiceId === invoiceId) setExpandedInvoiceId(null);
      alert('Factura pendiente eliminada');
    } catch (err) {
      console.error('Error deleting invoice:', invoiceId, err);
      alert(`No se pudo eliminar la factura: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setProcessingInvoiceId(null);
    }
  };

  useEffect(() => {
    if (!showCreateInvoiceModal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showCreateInvoiceModal]);

  useEffect(() => {
    const nav = loadNavState();
    if (nav) {
      setActiveSection(nav.section as AdminSection);
setOperacionOpen(['clientes', 'dispositivos', 'notificaciones', 'pending-devices'].includes(nav.section));
    setConfigOpen(['facturacion', 'arca', 'reportes', 'servidor', 'mqtt', 'backup', 'usuarios'].includes(nav.section));
    }
  }, []);

  useEffect(() => {
    if (!showMqttConfig) return;
    void (async () => {
      try {
        const config = await getJson<{ host: string; port: number; username: string; password: string }>('/mqtt-config', props.session.token);
        setMqttConfig({ ...config, port: String(config.port), qos: '1' });
      } catch (err) {
        console.error('Error loading MQTT config:', err);
      }
    })();
  }, [showMqttConfig, props.session.token]);

  useEffect(() => {
    if (!tenantId) return;
    const socket = io(SOCKET_URL, {
      auth: { token: props.session.token }
    });
    socket.emit('tenant:join', tenantId);
    socket.on('devices:updated', (payload: any) => {
      if (payload && payload.deviceId) {
        setDevices(prev => prev.map(d => d.deviceId === payload.deviceId ? { ...d, ...payload } : d));
        setAllDevices(prev => prev.map(d => d.deviceId === payload.deviceId ? { ...d, ...payload } : d));
        setSelectedDevice(prev => (prev && prev.deviceId === payload.deviceId) ? { ...prev, ...payload } : prev);
      } else {
        void loadCompanyData(tenantId);
      }
    });
    socket.on('telemetry:new', (payload: any) => {
      if (payload && payload.deviceId) {
        const ts = new Date().toISOString();
        setDevices(prev => prev.map(d => d.deviceId === payload.deviceId ? { ...d, ...payload, lastSeenAt: ts } : d));
        setAllDevices(prev => prev.map(d => d.deviceId === payload.deviceId ? { ...d, ...payload, lastSeenAt: ts } : d));
        setSelectedDevice(prev => (prev && prev.deviceId === payload.deviceId) ? { ...prev, ...payload, lastSeenAt: ts } : prev);
      }
    });
    socket.on('alerts:updated', () => void loadCompanyData(tenantId));
    
    return () => { 
      socket.disconnect(); 
    };
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
    setOperacionOpen(['clientes', 'dispositivos', 'notificaciones', 'pending-devices'].includes(section));
    setConfigOpen(['facturacion', 'arca', 'reportes', 'servidor', 'mqtt', 'backup', 'usuarios'].includes(section));
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
      planId: (selectedClient as TenantClient & { planId?: string }).planId || '',
      taxId: selectedClient.taxId || '',
      ivaCondition: selectedClient.ivaCondition || 'Consumidor Final'
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
        planId: editClient.planId || undefined,
        taxId: editClient.taxId,
        ivaCondition: editClient.ivaCondition
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
          planName: plans.find(p => p._id === editClient.planId)?.name,
          taxId: editClient.taxId,
          ivaCondition: editClient.ivaCondition
        });
      }
    } finally {
      setSavingClient(false);
    }
  };

  const saveArcaConfig = async () => {
    setSavingArca(true);
    try {
      await putJson(`/billing/arca-config?tenantId=${certificateTenantId}`, arcaConfig, props.session.token);
      await loadCompanyData(certificateTenantId);
    } finally {
      setSavingArca(false);
    }
  };

  const runArcaDiagnostics = async () => {
    setTestingArca(true);
    try {
      const data = await getJson<ArcaDiagnostics>(`/billing/arca/diagnostics?tenantId=${certificateTenantId}`, props.session.token);
      setArcaDiagnostics(data);
    } catch (err) {
      console.error('Error testing ARCA connection:', err);
      alert('No se pudo obtener el diagnostico ARCA');
    } finally {
      setTestingArca(false);
    }
  };

  const savePlan = async (planId: string) => {
    setSavingPlan(true);
    try {
      const updated = await putJson(`/billing/plans/${planId}`, editPlanData, props.session.token) as Plan;
      setPlans(plans.map(p => p._id === planId ? updated : p));
      setEditingPlanId(null);
    } catch (err) {
      console.error('Error saving plan:', err);
      alert('Error al guardar plan');
    } finally {
      setSavingPlan(false);
    }
  };

  const saveCompanyInfo = async () => {
    setSavingCompanyInfo(true);
    try {
      const updated = await putJson('/billing/company-info', companyInfo, props.session.token);
      setCompanyInfo(updated as typeof companyInfo);
      alert('Datos guardados exitosamente');
    } catch (err) {
      console.error('Error saving company info:', err);
      alert('Error al guardar datos');
    } finally {
      setSavingCompanyInfo(false);
    }
  };

  const createBackup = async () => {
    setCreatingBackup(true);
    setBackupError('');
    setBackupSuccess('');
    try {
      const data = await getJson<{ clients: TenantClient[]; devices: Device[] }>('/backup/export', props.session.token);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `agrosentinel_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupSuccess('Backup creado exitosamente');
    } catch (err) {
      setBackupError('Error al crear backup');
    } finally {
      setCreatingBackup(false);
    }
  };

  const restoreBackup = async (file: File) => {
    setRestoringBackup(true);
    setBackupError('');
    setBackupSuccess('');
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await postJson('/backup/import', data, props.session.token);
      setBackupSuccess('Backup restaurado exitosamente');
      await loadCompanyData(tenantId);
    } catch (err) {
      setBackupError('Error al restaurar backup. Verifique el archivo.');
    } finally {
      setRestoringBackup(false);
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
      setShowCreateUserModal(false);
      await loadCompanyData(tenantId);
    } finally {
      setCreatingUser(false);
    }
  };

  const openEditUserModal = (user: { id: string; name: string; email: string; role: 'owner' | 'operator' | 'technician'; tenantId: string }) => {
    setEditingUser(user);
    setEditUserPassword('');
    setShowEditUserModal(true);
  };

  const saveUserEdit = async () => {
    if (!editingUser) return;
    await postJson('/auth/admin/update-user', {
      userId: editingUser.id,
      name: editingUser.name,
      email: editingUser.email,
      role: editingUser.role,
      ...(editUserPassword ? { password: editUserPassword } : {})
    }, props.session.token);
    setShowEditUserModal(false);
    setEditingUser(null);
    await loadCompanyData(tenantId);
  };

  const deleteUser = async (userId: string) => {
    if (!confirm('¿Estás seguro de eliminar este usuario?')) return;
    await postJson('/auth/admin/delete-user', { userId }, props.session.token);
    await loadCompanyData(tenantId);
  };

  const openDeviceModal = (device: Device) => {
    setSelectedDevice(device);
    setEditDevice({
      name: device.name,
      address: device.location.address,
      lat: String(device.location.lat),
      lng: String(device.location.lng),
      configNivelMin: (device as unknown as { configNivelMin?: number }).configNivelMin,
      configNivelMax: (device as unknown as { configNivelMax?: number }).configNivelMax,
      configAlertaBaja: (device as unknown as { configAlertaBaja?: number }).configAlertaBaja,
      configModoAuto: (device as unknown as { configModoAuto?: boolean }).configModoAuto
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
        lng: Number(editDevice.lng),
        configNivelMin: editDevice.configNivelMin,
        configNivelMax: editDevice.configNivelMax,
        configAlertaBaja: editDevice.configAlertaBaja,
        configModoAuto: editDevice.configModoAuto
      };
      if (editDeviceUserId !== (selectedDevice.tenantId || '')) {
        updateData.userId = editDeviceUserId || null;
        updateData.tenantId = editDeviceUserId || null;
      }
      await patchJson(`/devices/${selectedDevice._id}`, updateData, props.session.token);
      
      if (editDevice.configNivelMin || editDevice.configNivelMax || editDevice.configAlertaBaja || editDevice.configModoAuto !== undefined) {
        await postJson(`/devices/${selectedDevice._id}/config`, {
          nivel_min: editDevice.configNivelMin,
          nivel_max: editDevice.configNivelMax,
          alerta_baja: editDevice.configAlertaBaja,
          modo: editDevice.configModoAuto ? 'auto' : 'manual'
        }, props.session.token);
      }
      
      setShowDeviceModal(false);
      setSelectedDevice(null);
      await loadCompanyData(tenantId);
    } finally {
      setSavingDevice(false);
    }
  };

  const deleteDevice = async () => {
    if (!selectedDevice) return;
    if (!confirm(`¿Está seguro de eliminar el dispositivo "${selectedDevice.name}"? Esta acción no se puede deshacer.`)) return;
    
    setSavingDevice(true);
    try {
      await deleteJson(`/devices/${selectedDevice._id}`, props.session.token);
      setShowDeviceModal(false);
      setSelectedDevice(null);
      await Promise.all([loadCompanyData(tenantId), loadAllDevices()]);
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
      'pending-devices': 'Dispositivos Pendientes',
      backup: 'Backup'
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
                <a href="#" className={`nav-link ${['clientes', 'dispositivos', 'notificaciones'].includes(activeSection) ? 'active' : ''}`}
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
                <a href="#" className={`nav-link ${['facturacion', 'reportes', 'servidor', 'mqtt', 'backup', 'usuarios'].includes(activeSection) ? 'active' : ''}`}
                  onClick={e => { e.preventDefault(); setConfigOpen(!configOpen); setOperacionOpen(false); }}>
                  <i className="nav-icon fas fa-cog"></i>
                  <p>Configuracion <i className={`right fas fa-angle-left ${configOpen ? 'fa-rotate-90' : ''}`}></i></p>
                </a>
                {configOpen && (
                  <ul className="nav nav-treeview" style={{ marginLeft: '1rem' }}>
                    <li className="nav-item">
                      <a href="#" className={`nav-link ${activeSection === 'usuarios' ? 'active' : ''}`}
                        onClick={e => { e.preventDefault(); setSection('usuarios'); }}>
                        <i className="far fa-circle nav-icon"></i><p>Usuarios</p>
                      </a>
                    </li>
                    <li className="nav-item">
                      <a href="#" className={`nav-link ${activeSection === 'facturacion' ? 'active' : ''}`}
                        onClick={e => { e.preventDefault(); setSection('facturacion'); }}>
                        <i className="far fa-circle nav-icon"></i><p>Facturacion</p>
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
                    <li className="nav-item">
                      <a href="#" className={`nav-link ${activeSection === 'backup' ? 'active' : ''}`}
                        onClick={e => { e.preventDefault(); setSection('backup'); }}>
                        <i className="nav-icon fas fa-database"></i><p>Backup</p>
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
                    <div className="small-box bg-info" style={{ cursor: 'pointer' }} onClick={() => { setSection('clientes'); }}>
                      <div className="inner"><h3>{stats.tenants}</h3><p>Clientes Activos</p></div>
                      <div className="icon"><i className="fas fa-building"></i></div>
                    </div>
                  </div>
                  <div className="col-lg-3 col-6">
                    <div className="small-box bg-primary" style={{ cursor: 'pointer' }} onClick={() => { setSection('dispositivos'); }}>
                      <div className="inner"><h3>{stats.total}</h3><p>Dispositivos Totales</p></div>
                      <div className="icon"><i className="fas fa-microchip"></i></div>
                    </div>
                  </div>
                  <div className="col-lg-3 col-6">
                    <div className="small-box bg-primary" style={{ cursor: 'pointer' }} onClick={() => { setSection('dispositivos'); }}>
                      <div className="inner"><h3>{stats.online}</h3><p>Online</p></div>
                      <div className="icon"><i className="fas fa-signal"></i></div>
                    </div>
                  </div>
                  <div className="col-lg-3 col-6">
                    <div className="small-box bg-danger" style={{ cursor: 'pointer' }} onClick={() => { setSection('notificaciones'); }}>
                      <div className="inner"><h3>{stats.offline}</h3><p>Offline / Criticos</p></div>
                      <div className="icon"><i className="fas fa-exclamation-triangle"></i></div>
                    </div>
                  </div>
                </div>
                <div className="row">
                  <div className="col-lg-4 col-6">
                    <div className="small-box bg-warning" style={{ cursor: 'pointer' }} onClick={() => { setSection('notificaciones'); }}>
                      <div className="inner"><h3>{stats.alerts}</h3><p>Alertas Abiertas</p></div>
                      <div className="icon"><i className="fas fa-bell"></i></div>
                    </div>
                  </div>
                  <div className="col-lg-4 col-6">
                    <div className="small-box bg-secondary" style={{ cursor: 'pointer' }} onClick={() => { setSection('usuarios'); }}>
                      <div className="inner"><h3>{stats.users}</h3><p>Usuarios Totales</p></div>
                      <div className="icon"><i className="fas fa-users"></i></div>
                    </div>
                  </div>
                  <div className="col-lg-4 col-6">
                    <div className="small-box bg-indigo" style={{ cursor: 'pointer' }} onClick={() => { setSection('facturacion'); }}>
                      <div className="inner"><h3>{invoices.length}</h3><p>Facturas Registradas</p></div>
                      <div className="icon"><i className="fas fa-file-invoice-dollar"></i></div>
                    </div>
                  </div>
                </div>
                <div className="row">
                  <div className="col-md-8">
                    <div className="card">
                      <div className="card-header d-flex justify-content-between align-items-center">
                        <h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-microchip me-2"></i>Estado de Dispositivos</h3>
                        <button className="btn btn-sm btn-light" onClick={() => setSection('dispositivos')}>Ver Todos</button>
                      </div>
                      <div className="card-body p-0">
                        <table className="table table-hover m-0">
                          <thead><tr><th>Nombre</th><th>Device ID</th><th>Nivel</th><th>Bomba</th><th>Estado</th></tr></thead>
                          <tbody>
                            {devices.map(d => (
                              <tr key={d._id} style={{ cursor: 'pointer' }} onClick={() => { setSection('dispositivos'); openDeviceModal(d); }}>
                                <td className="fw-bold">{d.name}</td>
                                <td className="small text-muted">{d.deviceId}</td>
                                <td><span className={`badge ${d.levelPct < 20 ? 'text-bg-danger' : d.levelPct < 50 ? 'text-bg-warning' : 'text-bg-success'}`}>{d.levelPct}%</span></td>
                                <td>
                                  <span className={`badge ${d.pumpOn ? 'text-bg-success' : 'text-bg-danger'}`}>
                                    <i className="fas fa-circle" style={{fontSize: '0.6em', marginRight: '4px', verticalAlign: 'middle', color: getPumpColor(d.pumpOn)}}></i>
                                    {d.pumpOn ? 'ON' : 'OFF'}
                                  </span>
                                </td>
                                <td><span className={`badge ${getStatusBadge(d.status)}`}><i className={`fas fa-circle mr-1`} style={{ fontSize: '0.6em', color: getStatusColor(d.status) }}></i>{d.status}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-4">
                    <div className="card">
                      <div className="card-header d-flex justify-content-between align-items-center">
                        <h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-bell me-2"></i>Alertas Recientes</h3>
                        <button className="btn btn-sm btn-light" onClick={() => setSection('notificaciones')}>Ver Todas</button>
                      </div>
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
<ul className="nav nav-tabs" role="tablist">
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
                                  <tr>
                                    <td className="text-muted">Portal Cliente:</td>
                                    <td>
                                      <a href={`/panel-cliente?tenant=${selectedClient.tenantId}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-primary">
                                        <i className="fas fa-external-link-alt mr-1"></i>Abrir portal
                                      </a>
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                        {clientTab === 'dispositivos' && (
                          <div className="tab-content">
                            <div className="tab-pane active show">
                              <div className="table-responsive">
                                <table className="table table-hover table-striped">
                                  <thead>
                                    <tr>
                                      <th>Nombre</th>
                                      <th>Device ID</th>
                                      <th>Nivel</th>
                                      <th>Bomba</th>
                                      <th>Estado</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {devices.length === 0 ? (
                                      <tr><td colSpan={5} className="text-center text-muted py-3">No hay dispositivos registrados</td></tr>
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
                                          <td><span className={`badge ${d.pumpOn ? 'text-bg-success' : 'text-bg-danger'}`}>
                                    <i className="fas fa-circle" style={{fontSize: '0.6em', marginRight: '4px', verticalAlign: 'middle', color: getPumpColor(d.pumpOn)}}></i> 
                                    {d.pumpOn ? 'ON' : 'OFF'}
                                  </span></td>
                                          <td><span className={`badge ${getStatusBadge(d.status)}`}><i className={`fas fa-circle mr-1`} style={{ fontSize: '0.6em', color: getStatusColor(d.status) }}></i>{d.status}</span></td>
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
                                const deviceList = devices.filter(d => d.location && typeof d.location.lat === 'number' && typeof d.location.lng === 'number');
                                if (deviceList.length === 0) {
                                  return (
                                    <div className="d-flex align-items-center justify-content-center h-100 text-muted">
                                      No hay dispositivos con ubicación para mostrar en el mapa
                                    </div>
                                  );
                                }
                                const lats = deviceList.map(d => Number(d.location.lat));
                                const lngs = deviceList.map(d => Number(d.location.lng));
                                const minLat = Math.min(...lats);
                                const maxLat = Math.max(...lats);
                                const minLng = Math.min(...lngs);
                                const maxLng = Math.max(...lngs);
                                const center: [number, number] = [
                                  (minLat + maxLat) / 2,
                                  (minLng + maxLng) / 2
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
                                    <Popup><div className="p-1"><h6 className="fw-bold mb-1">{d.name}</h6><p className="mb-0 small">Estado: <span className={`badge ${getStatusBadge(d.status)}`}><i className={`fas fa-circle mr-1`} style={{ fontSize: '0.6em', color: getStatusColor(d.status) }}></i>{d.status}</span></p><p className="mb-0 small">Nivel: <strong>{d.levelPct}%</strong></p>{hasAlert && <p className="mb-0 small text-danger"><i className="fas fa-exclamation-triangle"></i> Alerta activa</p>}<p className="mb-0 small text-muted">Click para editar, arrastra para mover</p></div></Popup>
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
                        <h3 className="card-title text-white fw-bold mb-0 flex-grow-1"><i className="fas fa-building me-2"></i>Clientes</h3>
                        <button className="btn btn-light btn-sm ms-auto" onClick={() => setShowAddClient(true)}>
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
                                <th>CUIT</th>
                                <th>Cond. IVA</th>
                                <th>Email</th>
                                <th>Telefono</th>
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
                                    <td className="small">{c.taxId || '—'}</td>
                                    <td><span className="badge badge-secondary">{c.ivaCondition || 'Cons. Final'}</span></td>
                                    <td>{c.email || '—'}</td>
                                    <td>{c.phone || '—'}</td>
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
                  <div className="card mt-3">
                    <div className="card-header d-flex justify-content-between align-items-center">
                      <h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-microchip me-2"></i>Dispositivos Registrados ({allDevices.length})</h3>
                      <button className="btn btn-light btn-sm ml-auto" onClick={() => { setAllDevicesMapCenter(null); setShowAllDevicesModal(true); }}>
                        <i className="fas fa-expand me-1"></i>Ver Todos
                      </button>
                    </div>
                    <div className="card-body p-0">
                      <div className="table-responsive">
                        <table className="table table-hover m-0">
                          <thead><tr><th>Nombre</th><th>Device ID</th><th>Cliente</th><th>Nivel</th><th>Bomba</th><th>Estado</th></tr></thead>
                          <tbody>
                            {allDevices.map(d => (
                              <tr key={d._id} onClick={(e) => { e.stopPropagation(); openDeviceModal(d); }} style={{ cursor: 'pointer' }}>
                                <td className="fw-bold">{d.name}</td>
                                <td className="small text-muted">{d.deviceId}</td>
                                <td className="small">{d.clientName || 'Unknown'}</td>
                                <td>
                                  <div className="d-flex align-items-center">
                                    <div className="progress me-2" style={{ width: '60px', height: '6px' }}>
                                      <div className={`progress-bar ${d.levelPct < 20 ? 'bg-danger' : d.levelPct < 50 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${d.levelPct}%` }}></div>
                                    </div>
                                    <span className="small fw-bold">{d.levelPct}%</span>
                                  </div>
                                </td>
                                <td><span className={`badge ${d.pumpOn ? 'text-bg-success' : 'text-bg-danger'}`}><i className="fas fa-circle mr-1" style={{ fontSize: '0.6em', color: getPumpColor(d.pumpOn) }}></i>{d.pumpOn ? 'ON' : 'OFF'}</span></td>
                                <td><span className={`badge ${getStatusBadge(d.status)}`}><i className={`fas fa-circle mr-1`} style={{ fontSize: '0.6em', color: getStatusColor(d.status) }}></i>{d.status}</span></td>
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
                <div className="col-12">
                  <div className="card">
                    <div className="card-header d-flex justify-content-between align-items-center">
                      <h3 className="card-title text-white fw-bold mb-0 flex-grow-1"><i className="fas fa-users me-2"></i>Usuarios ({usersList.length})</h3>
                      <button className="btn btn-sm btn-light fw-bold ms-auto" onClick={() => setShowCreateUserModal(true)}><i className="fas fa-plus me-1"></i>Crear Usuario</button>
                    </div>
                    <div className="card-body p-0">
                      <div className="table-responsive">
                        <table className="table table-hover m-0">
                          <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Tenant</th></tr></thead>
                          <tbody>
                            {usersList.map(u => (
                              <tr key={u.id} style={{ cursor: 'pointer' }} onClick={() => openEditUserModal({ ...u, role: u.role as 'owner' | 'operator' | 'technician' })}>
                                <td className="fw-bold">{u.name}</td>
                                <td className="small text-muted">{u.email}</td>
                                <td><span className="badge text-bg-primary">{u.role}</span></td>
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
                <div className="col-12">
                  <div className="card card-primary card-outline card-tabs">
                    <div className="card-header">
                      <div className="d-flex justify-content-between align-items-center w-100">
                        <h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-file-invoice-dollar mr-2"></i>Facturacion y Planes</h3>
                      </div>
                      <ul className="nav nav-tabs" role="tablist">
                        <li className="nav-item">
                          <a className={`nav-link ${facturacionTab === 'planes' ? 'active' : ''}`} href="#" onClick={e => { e.preventDefault(); setFacturacionTab('planes'); }}>
                            <i className="fas fa-tags mr-1"></i> Planes
                          </a>
                        </li>
                        <li className="nav-item">
                          <a className={`nav-link ${facturacionTab === 'empresa' ? 'active' : ''}`} href="#" onClick={e => { e.preventDefault(); setFacturacionTab('empresa'); }}>
                            <i className="fas fa-building mr-1"></i> Mi Empresa
                          </a>
                        </li>
                        <li className="nav-item">
                          <a className={`nav-link ${facturacionTab === 'certificado' ? 'active' : ''}`} href="#" onClick={e => { e.preventDefault(); setFacturacionTab('certificado'); }}>
                            <i className="fas fa-shield-alt mr-1"></i> ARCA / Certificado
                          </a>
                        </li>
                        <li className="nav-item">
                          <a className={`nav-link ${facturacionTab === 'facturas' ? 'active' : ''}`} href="#" onClick={e => { e.preventDefault(); setFacturacionTab('facturas'); }}>
                            <i className="fas fa-file-invoice mr-1"></i> Facturas
                          </a>
                        </li>
                      </ul>
                    </div>
                    <div className="card-body">
                      <div className="tab-content">
                        <div className={`tab-pane ${facturacionTab === 'planes' ? 'active show' : ''}`}>
                          <div className="table-responsive">
                            <table className="table m-0">
                              <thead><tr><th>Plan</th><th>Dispositivos Max.</th><th>Precio Mensual (ARS)</th><th>Activo</th></tr></thead>
                              <tbody>{plans.map(p => (
                                <tr key={p._id} style={{ cursor: editingPlanId !== p._id ? 'pointer' : 'default' }} onClick={() => { if (editingPlanId !== p._id) { setEditingPlanId(p._id); setEditPlanData({ name: p.name, maxDevices: p.maxDevices, monthlyPriceArs: p.monthlyPriceArs, active: !!p.active, features: p.features || [] }); } }}>
                                  <td>
                                    {editingPlanId === p._id ? (
                                      <input type="text" className="form-control form-control-sm" value={editPlanData.name} onChange={e => setEditPlanData(d => ({ ...d, name: e.target.value }))} onClick={e => e.stopPropagation()} />
                                    ) : (
                                      <span className="fw-bold">{p.name}</span>
                                    )}
                                  </td>
                                  <td>
                                    {editingPlanId === p._id ? (
                                      <input type="number" className="form-control form-control-sm" value={editPlanData.maxDevices} onChange={e => setEditPlanData(d => ({ ...d, maxDevices: Number(e.target.value) }))} onClick={e => e.stopPropagation()} />
                                    ) : (
                                      p.maxDevices
                                    )}
                                  </td>
                                  <td>
                                    {editingPlanId === p._id ? (
                                      <input type="number" className="form-control form-control-sm" value={editPlanData.monthlyPriceArs} onChange={e => setEditPlanData(d => ({ ...d, monthlyPriceArs: Number(e.target.value) }))} onClick={e => e.stopPropagation()} />
                                    ) : (
                                      <span className="text-primary fw-bold">${p.monthlyPriceArs.toLocaleString('es-AR')}</span>
                                    )}
                                  </td>
                                  <td>
                                    {editingPlanId === p._id ? (
                                      <div className="d-flex gap-1">
                                        <button className="btn btn-success btn-sm" onClick={e => { e.stopPropagation(); void savePlan(p._id); }} disabled={savingPlan}>Guardar</button>
                                        <button className="btn btn-secondary btn-sm" onClick={e => { e.stopPropagation(); setEditingPlanId(null); }}>Cancelar</button>
                                      </div>
                                    ) : (
                                      <span className={`badge ${p.active ? 'text-bg-success' : 'text-bg-secondary'}`}>{p.active ? 'Si' : 'No'}</span>
                                    )}
                                  </td>
                                </tr>
                              ))}</tbody>
                            </table>
                          </div>
                        </div>
                        <div className={`tab-pane ${facturacionTab === 'arca' ? 'active show' : ''}`}>
                          <div className="row">
                            <div className="col-md-8">
                              <div className="alert alert-warning">
                                <i className="fas fa-exclamation-triangle mr-2"></i>
                                Configuracion de ARCA / AFIP para facturacion electronica
                              </div>
                              <div className="card mb-3 border-info">
                                <div className="card-header d-flex justify-content-between align-items-center">
                                  <h4 className="card-title small fw-bold mb-0"><i className="fas fa-stethoscope mr-1"></i>Diagnostico de conexion ARCA</h4>
                                  <button className="btn btn-info btn-sm" onClick={() => void runArcaDiagnostics()} disabled={testingArca || !certificateTenantId}>
                                    {testingArca ? 'Probando...' : 'Probar conexion'}
                                  </button>
                                </div>
                                <div className="card-body small">
                                  {arcaDiagnostics ? (
                                    <>
                                      <p className="mb-1"><strong>Estado conexion:</strong> <span className={`badge ${arcaDiagnostics.connection.ok ? 'text-bg-success' : 'text-bg-danger'}`}>{arcaDiagnostics.connection.ok ? 'Conectado' : 'Con errores'}</span></p>
                                      <p className="mb-1"><strong>Detalle:</strong> {arcaDiagnostics.connection.message}</p>
                                      {arcaDiagnostics.connection.message.includes('coe.alreadyAuthenticated') ? (
                                        <div className="alert alert-warning py-2 px-3 mt-2 mb-2">
                                          <strong>Sesion WSAA ya activa.</strong> Cargue Token/Sign vigentes (por ejemplo desde Odoo) o espere el vencimiento del TA para regenerarlos automaticamente.
                                        </div>
                                      ) : null}
                                      <p className="mb-1"><strong>Ultimo comprobante ARCA:</strong> {arcaDiagnostics.connection.lastVoucher ?? 'N/D'}</p>
                                      <p className="mb-1"><strong>Credenciales:</strong> <span className={`badge ${arcaDiagnostics.config.hasCredentials ? 'text-bg-success' : 'text-bg-warning'}`}>{arcaDiagnostics.config.hasCredentials ? 'OK' : 'Faltantes'}</span></p>
                                      {arcaDiagnostics.credentialsAutoRefreshed ? <p className="mb-1 text-success"><strong>Credenciales:</strong> generadas automaticamente desde certificado.</p> : null}
                                      {arcaDiagnostics.authSession ? (
                                        <>
                                          <p className="mb-1"><strong>Unique ID:</strong> {arcaDiagnostics.authSession.uniqueId || 'N/D'}</p>
                                          <p className="mb-1"><strong>Generation Time:</strong> {arcaDiagnostics.authSession.generationTime ? new Date(arcaDiagnostics.authSession.generationTime).toLocaleString('es-AR') : 'N/D'}</p>
                                          <p className="mb-1"><strong>Expiration Time:</strong> {arcaDiagnostics.authSession.expirationTime ? new Date(arcaDiagnostics.authSession.expirationTime).toLocaleString('es-AR') : 'N/D'} {arcaDiagnostics.authSession.expired ? <span className="badge text-bg-danger ms-1">Expirado</span> : null}</p>
                                          <p className="mb-1"><strong>Sign:</strong> {arcaDiagnostics.authSession.signPreview || 'N/D'}</p>
                                          <p className="mb-1"><strong>Servicio:</strong> {arcaDiagnostics.authSession.service || 'N/D'}</p>
                                          <p className="mb-1"><strong>AFIP Login URL:</strong> {arcaDiagnostics.config.wsaaUrl || 'N/D'}</p>
                                          <p className="mb-1"><strong>AFIP WS URL:</strong> {arcaDiagnostics.config.wsfeUrl ? (arcaDiagnostics.config.wsfeUrl.includes('?') ? arcaDiagnostics.config.wsfeUrl : `${arcaDiagnostics.config.wsfeUrl}?WSDL`) : 'N/D'}</p>
                                        </>
                                      ) : null}
                                      <p className="mb-1"><strong>Certificado cargado:</strong> <span className={`badge ${arcaDiagnostics.certificate.hasCertificate ? 'text-bg-success' : 'text-bg-warning'}`}>{arcaDiagnostics.certificate.hasCertificate ? 'Sincronizado' : 'Pendiente'}</span></p>
                                      <hr className="my-2" />
                                      <p className="mb-1"><strong>Documentos locales:</strong> {arcaDiagnostics.documents.total}</p>
                                      <p className="mb-1"><strong>Autorizados con CAE:</strong> {arcaDiagnostics.documents.withCae}</p>
                                      <p className="mb-1"><strong>Pendientes:</strong> {arcaDiagnostics.documents.pending}</p>
                                      <p className="mb-0"><strong>Sincronizacion:</strong> <span className={`badge ${arcaDiagnostics.documents.syncedPct >= 80 ? 'text-bg-success' : arcaDiagnostics.documents.syncedPct >= 50 ? 'text-bg-warning' : 'text-bg-danger'}`}>{arcaDiagnostics.documents.syncedPct}%</span></p>
                                      {arcaDiagnostics.documents.byTipo ? (
                                        <>
                                          <hr className="my-2" />
                                          <p className="mb-1"><strong>Sync por tipo:</strong></p>
                                          <p className="mb-1">A: local {arcaDiagnostics.documents.byTipo.A.localLast} / ARCA {arcaDiagnostics.documents.byTipo.A.remoteLast ?? 'N/D'} <span className={`badge ${arcaDiagnostics.documents.byTipo.A.synced === null ? 'text-bg-secondary' : arcaDiagnostics.documents.byTipo.A.synced ? 'text-bg-success' : 'text-bg-warning'}`}>{arcaDiagnostics.documents.byTipo.A.synced === null ? 'N/D' : arcaDiagnostics.documents.byTipo.A.synced ? 'OK' : 'Atrasado'}</span></p>
                                          <p className="mb-1">B: local {arcaDiagnostics.documents.byTipo.B.localLast} / ARCA {arcaDiagnostics.documents.byTipo.B.remoteLast ?? 'N/D'} <span className={`badge ${arcaDiagnostics.documents.byTipo.B.synced === null ? 'text-bg-secondary' : arcaDiagnostics.documents.byTipo.B.synced ? 'text-bg-success' : 'text-bg-warning'}`}>{arcaDiagnostics.documents.byTipo.B.synced === null ? 'N/D' : arcaDiagnostics.documents.byTipo.B.synced ? 'OK' : 'Atrasado'}</span></p>
                                          <p className="mb-0">C: local {arcaDiagnostics.documents.byTipo.C.localLast} / ARCA {arcaDiagnostics.documents.byTipo.C.remoteLast ?? 'N/D'} <span className={`badge ${arcaDiagnostics.documents.byTipo.C.synced === null ? 'text-bg-secondary' : arcaDiagnostics.documents.byTipo.C.synced ? 'text-bg-success' : 'text-bg-warning'}`}>{arcaDiagnostics.documents.byTipo.C.synced === null ? 'N/D' : arcaDiagnostics.documents.byTipo.C.synced ? 'OK' : 'Atrasado'}</span></p>
                                        </>
                                      ) : null}
                                    </>
                                  ) : (
                                    <p className="mb-0 text-muted">Ejecute la prueba para validar conexion, certificado y sincronizacion de comprobantes.</p>
                                  )}
                                </div>
                              </div>
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
                            <div className="col-md-4">
                              <div className="card bg-light">
                                <div className="card-header"><h4 className="card-title small fw-bold mb-0"><i className="fas fa-info-circle mr-1"></i>Datos Actuales</h4></div>
                                <div className="card-body small">
                                  <p className="mb-1"><strong>CUIT:</strong> {arcaConfig.cuit || '—'}</p>
                                  <p className="mb-1"><strong>Pto. Vta:</strong> {arcaConfig.ptoVta}</p>
                                  <p className="mb-1"><strong>Habilitado:</strong> <span className={`badge ${arcaConfig.enabled ? 'text-bg-success' : 'text-bg-secondary'}`}>{arcaConfig.enabled ? 'Si' : 'No'}</span></p>
                                  <p className="mb-0"><strong>Modo Mock:</strong> <span className={`badge ${arcaConfig.mock ? 'text-bg-warning' : 'text-bg-success'}`}>{arcaConfig.mock ? 'Si' : 'No'}</span></p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className={`tab-pane ${facturacionTab === 'empresa' ? 'active show' : ''}`}>
                          <div className="row">
                            <div className="col-md-8">
                              <div className="alert alert-info">
                                <i className="fas fa-building mr-2"></i>
                                Datos fiscales y de contacto de su empresa para facturacion electronica
                              </div>
                              <div className="row">
                                <div className="col-md-6 mb-3"><label className="form-label small fw-bold">Razon Social</label><input className="form-control" value={companyInfo.companyName} onChange={e => setCompanyInfo(p => ({ ...p, companyName: e.target.value }))} placeholder="Mi Empresa S.A." /></div>
                                <div className="col-md-6 mb-3"><label className="form-label small fw-bold">CUIT</label><input className="form-control" value={companyInfo.taxId} onChange={e => setCompanyInfo(p => ({ ...p, taxId: e.target.value }))} placeholder="30712345678" /></div>
                                <div className="col-md-6 mb-3"><label className="form-label small fw-bold">Condicion IVA</label><select className="form-control" value={companyInfo.ivaCondition} onChange={e => setCompanyInfo(p => ({ ...p, ivaCondition: e.target.value }))}><option>Responsable Inscripto</option><option>Monotributista</option><option>Exento</option><option>Consumidor Final</option></select></div>
                                <div className="col-md-6 mb-3"><label className="form-label small fw-bold">Provincia</label>
                                  <select className="form-control" value={companyInfo.province} onChange={async e => {
                                    const prov = e.target.value;
                                    setCompanyInfo(p => ({ ...p, province: prov, city: '' }));
                                    if (prov) {
                                      try {
                                        const citiesRes = await getJson<string[]>('/billing/cities/' + encodeURIComponent(prov), props.session.token);
                                        setCities(citiesRes);
                                      } catch { setCities([]); }
                                    } else { setCities([]); }
                                  }}>
                                    <option value="">Seleccionar provincia...</option>
                                    {provinces.map(p => <option key={p} value={p}>{p}</option>)}
                                  </select>
                                </div>
                                <div className="col-md-6 mb-3"><label className="form-label small fw-bold">Ciudad</label>
                                  <select className="form-control" value={companyInfo.city} onChange={e => setCompanyInfo(p => ({ ...p, city: e.target.value }))}>
                                    <option value="">Seleccionar ciudad...</option>
                                    {cities.map(c => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                </div>
                                <div className="col-md-6 mb-3"><label className="form-label small fw-bold">Persona de Contacto</label><input className="form-control" value={companyInfo.contactName} onChange={e => setCompanyInfo(p => ({ ...p, contactName: e.target.value }))} placeholder="Juan Perez" /></div>
                                <div className="col-md-6 mb-3"><label className="form-label small fw-bold">Email</label><input className="form-control" type="email" value={companyInfo.email} onChange={e => setCompanyInfo(p => ({ ...p, email: e.target.value }))} placeholder="contacto@empresa.com" /></div>
                                <div className="col-md-6 mb-3"><label className="form-label small fw-bold">Telefono</label><input className="form-control" value={companyInfo.phone} onChange={e => setCompanyInfo(p => ({ ...p, phone: e.target.value }))} placeholder="+54 11 1234-5678" /></div>
                                <div className="col-md-12 mb-3"><label className="form-label small fw-bold">Direccion</label><input className="form-control" value={companyInfo.address} onChange={e => setCompanyInfo(p => ({ ...p, address: e.target.value }))} placeholder="Av. Rivadavia 1234, CABA" /></div>
                                <div className="col-12">
                                  <button className="btn btn-primary fw-bold" onClick={() => void saveCompanyInfo()} disabled={savingCompanyInfo}>Guardar Datos</button>
                                </div>
                              </div>
                            </div>
                            <div className="col-md-4">
                              <div className="card bg-light">
                                <div className="card-header"><h4 className="card-title small fw-bold mb-0"><i className="fas fa-info-circle mr-1"></i>Datos Actuales</h4></div>
                                <div className="card-body small">
                                  <p className="mb-1"><strong>Empresa:</strong> {companyInfo.companyName || '—'}</p>
                                  <p className="mb-1"><strong>CUIT:</strong> {companyInfo.taxId || '—'}</p>
                                  <p className="mb-1"><strong>IVA:</strong> {companyInfo.ivaCondition || '—'}</p>
                                  <p className="mb-1"><strong>Provincia:</strong> {companyInfo.province || '—'}</p>
                                  <p className="mb-1"><strong>Ciudad:</strong> {companyInfo.city || '—'}</p>
                                  <p className="mb-1"><strong>Contacto:</strong> {companyInfo.contactName || '—'}</p>
                                  <p className="mb-1"><strong>Email:</strong> {companyInfo.email || '—'}</p>
                                  <p className="mb-0"><strong>Telefono:</strong> {companyInfo.phone || '—'}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className={`tab-pane ${facturacionTab === 'certificado' ? 'active show' : ''}`}>
                          <div className="row">
                            <div className="col-md-8">
                              <div className="alert alert-info">
                                <i className="fas fa-key mr-2"></i>
                                Generador de Certificados ARCA - Necesario para facturacion electronica real
                              </div>

                              <div className="card mb-3 border-info">
                                <div className="card-header d-flex justify-content-between align-items-center">
                                  <h4 className="card-title small fw-bold mb-0"><i className="fas fa-stethoscope mr-1"></i>Diagnostico de conexion ARCA</h4>
                                  <button className="btn btn-info btn-sm" onClick={() => void runArcaDiagnostics()} disabled={testingArca || !certificateTenantId}>
                                    {testingArca ? 'Probando...' : 'Probar conexion'}
                                  </button>
                                </div>
                                <div className="card-body small">
                                  {arcaDiagnostics ? (
                                    <>
                                      <p className="mb-1"><strong>Estado conexion:</strong> <span className={`badge ${arcaDiagnostics.connection.ok ? 'text-bg-success' : 'text-bg-danger'}`}>{arcaDiagnostics.connection.ok ? 'Conectado' : 'Con errores'}</span></p>
                                      <p className="mb-1"><strong>Detalle:</strong> {arcaDiagnostics.connection.message}</p>
                                      <p className="mb-1"><strong>Ultimo comprobante ARCA:</strong> {arcaDiagnostics.connection.lastVoucher ?? 'N/D'}</p>
                                      <p className="mb-1"><strong>Credenciales:</strong> <span className={`badge ${arcaDiagnostics.config.hasCredentials ? 'text-bg-success' : 'text-bg-warning'}`}>{arcaDiagnostics.config.hasCredentials ? 'OK' : 'Faltantes'}</span></p>
                                      {arcaDiagnostics.credentialsAutoRefreshed ? <p className="mb-1 text-success"><strong>Credenciales:</strong> generadas automaticamente desde certificado.</p> : null}
                                      {arcaDiagnostics.authSession ? (
                                        <>
                                          <p className="mb-1"><strong>Unique ID:</strong> {arcaDiagnostics.authSession.uniqueId || 'N/D'}</p>
                                          <p className="mb-1"><strong>Generation Time:</strong> {arcaDiagnostics.authSession.generationTime ? new Date(arcaDiagnostics.authSession.generationTime).toLocaleString('es-AR') : 'N/D'}</p>
                                          <p className="mb-1"><strong>Expiration Time:</strong> {arcaDiagnostics.authSession.expirationTime ? new Date(arcaDiagnostics.authSession.expirationTime).toLocaleString('es-AR') : 'N/D'} {arcaDiagnostics.authSession.expired ? <span className="badge text-bg-danger ms-1">Expirado</span> : null}</p>
                                          <p className="mb-1"><strong>Sign:</strong> {arcaDiagnostics.authSession.signPreview || 'N/D'}</p>
                                          <p className="mb-1"><strong>Servicio:</strong> {arcaDiagnostics.authSession.service || 'N/D'}</p>
                                          <p className="mb-1"><strong>AFIP Login URL:</strong> {arcaDiagnostics.config.wsaaUrl || 'N/D'}</p>
                                          <p className="mb-1"><strong>AFIP WS URL:</strong> {arcaDiagnostics.config.wsfeUrl ? (arcaDiagnostics.config.wsfeUrl.includes('?') ? arcaDiagnostics.config.wsfeUrl : `${arcaDiagnostics.config.wsfeUrl}?WSDL`) : 'N/D'}</p>
                                        </>
                                      ) : null}
                                      <p className="mb-1"><strong>Certificado cargado:</strong> <span className={`badge ${arcaDiagnostics.certificate.hasCertificate ? 'text-bg-success' : 'text-bg-warning'}`}>{arcaDiagnostics.certificate.hasCertificate ? 'Sincronizado' : 'Pendiente'}</span></p>
                                      <hr className="my-2" />
                                      <p className="mb-1"><strong>Documentos locales:</strong> {arcaDiagnostics.documents.total}</p>
                                      <p className="mb-1"><strong>Autorizados con CAE:</strong> {arcaDiagnostics.documents.withCae}</p>
                                      <p className="mb-1"><strong>Pendientes:</strong> {arcaDiagnostics.documents.pending}</p>
                                      <p className="mb-0"><strong>Sincronizacion:</strong> <span className={`badge ${arcaDiagnostics.documents.syncedPct >= 80 ? 'text-bg-success' : arcaDiagnostics.documents.syncedPct >= 50 ? 'text-bg-warning' : 'text-bg-danger'}`}>{arcaDiagnostics.documents.syncedPct}%</span></p>
                                      {arcaDiagnostics.documents.byTipo ? (
                                        <>
                                          <hr className="my-2" />
                                          <p className="mb-1"><strong>Sync por tipo:</strong></p>
                                          <p className="mb-1">A: local {arcaDiagnostics.documents.byTipo.A.localLast} / ARCA {arcaDiagnostics.documents.byTipo.A.remoteLast ?? 'N/D'} <span className={`badge ${arcaDiagnostics.documents.byTipo.A.synced === null ? 'text-bg-secondary' : arcaDiagnostics.documents.byTipo.A.synced ? 'text-bg-success' : 'text-bg-warning'}`}>{arcaDiagnostics.documents.byTipo.A.synced === null ? 'N/D' : arcaDiagnostics.documents.byTipo.A.synced ? 'OK' : 'Atrasado'}</span></p>
                                          <p className="mb-1">B: local {arcaDiagnostics.documents.byTipo.B.localLast} / ARCA {arcaDiagnostics.documents.byTipo.B.remoteLast ?? 'N/D'} <span className={`badge ${arcaDiagnostics.documents.byTipo.B.synced === null ? 'text-bg-secondary' : arcaDiagnostics.documents.byTipo.B.synced ? 'text-bg-success' : 'text-bg-warning'}`}>{arcaDiagnostics.documents.byTipo.B.synced === null ? 'N/D' : arcaDiagnostics.documents.byTipo.B.synced ? 'OK' : 'Atrasado'}</span></p>
                                          <p className="mb-0">C: local {arcaDiagnostics.documents.byTipo.C.localLast} / ARCA {arcaDiagnostics.documents.byTipo.C.remoteLast ?? 'N/D'} <span className={`badge ${arcaDiagnostics.documents.byTipo.C.synced === null ? 'text-bg-secondary' : arcaDiagnostics.documents.byTipo.C.synced ? 'text-bg-success' : 'text-bg-warning'}`}>{arcaDiagnostics.documents.byTipo.C.synced === null ? 'N/D' : arcaDiagnostics.documents.byTipo.C.synced ? 'OK' : 'Atrasado'}</span></p>
                                        </>
                                      ) : null}
                                    </>
                                  ) : (
                                    <p className="mb-0 text-muted">Ejecute la prueba para validar conexion, certificado y sincronizacion de comprobantes.</p>
                                  )}
                                </div>
                              </div>

                              <div className="card mb-3">
                                <div className="card-header bg-secondary text-white">
                                  <h5 className="card-title mb-0"><i className="fas fa-sliders-h mr-1"></i>Configuracion ARCA desde interfaz</h5>
                                </div>
                                <div className="card-body">
                                  <p className="text-muted small">Estos campos reemplazan la configuracion manual de variables ARCA en el archivo .env para este cliente.</p>
                                  <div className="row">
                                    <div className="col-md-4 mb-3">
                                      <label className="form-label small fw-bold">Entorno</label>
                                      <select
                                        className="form-control"
                                        value={arcaConfig.environment}
                                        onChange={e => {
                                          const environment = e.target.value as ArcaConfig['environment'];
                                          setArcaConfig(p => ({
                                            ...p,
                                            environment,
                                            mock: environment === 'mock' ? true : p.mock
                                          }));
                                        }}
                                      >
                                        <option value="mock">Mock</option>
                                        <option value="homologacion">Homologacion</option>
                                        <option value="produccion">Produccion</option>
                                      </select>
                                    </div>
                                    <div className="col-md-4 mb-3">
                                      <label className="form-label small fw-bold">CUIT</label>
                                      <input className="form-control" value={arcaConfig.cuit} onChange={e => setArcaConfig(p => ({ ...p, cuit: e.target.value }))} placeholder="30712345678" />
                                    </div>
                                    <div className="col-md-4 mb-3">
                                      <label className="form-label small fw-bold">Punto de Venta</label>
                                      <input className="form-control" value={arcaConfig.ptoVta} onChange={e => setArcaConfig(p => ({ ...p, ptoVta: e.target.value }))} />
                                    </div>
                                    <div className="col-md-6 mb-3">
                                      <label className="form-label small fw-bold">WSAA URL</label>
                                      <input className="form-control" value={arcaConfig.wsaaUrl} onChange={e => setArcaConfig(p => ({ ...p, wsaaUrl: e.target.value }))} />
                                    </div>
                                    <div className="col-md-6 mb-3">
                                      <label className="form-label small fw-bold">WSFE URL</label>
                                      <input className="form-control" value={arcaConfig.wsfeUrl} onChange={e => setArcaConfig(p => ({ ...p, wsfeUrl: e.target.value }))} />
                                    </div>
                                    <div className="col-md-6 mb-3">
                                      <label className="form-label small fw-bold">ARCA Token</label>
                                      <input className="form-control" value={arcaConfig.token || ''} onChange={e => setArcaConfig(p => ({ ...p, token: e.target.value }))} placeholder="Token WSAA" />
                                    </div>
                                    <div className="col-md-6 mb-3">
                                      <label className="form-label small fw-bold">ARCA Sign</label>
                                      <input className="form-control" value={arcaConfig.sign || ''} onChange={e => setArcaConfig(p => ({ ...p, sign: e.target.value }))} placeholder="Sign WSAA" />
                                    </div>
                                    <div className="col-md-6 mb-3">
                                      <label className="form-label small fw-bold">ARCA_CERT_PATH</label>
                                      <input className="form-control" value={arcaConfig.certPath || ''} onChange={e => setArcaConfig(p => ({ ...p, certPath: e.target.value }))} placeholder="/ruta/certificado.p12" />
                                    </div>
                                    <div className="col-md-6 mb-3">
                                      <label className="form-label small fw-bold">ARCA_CERT_PASSWORD</label>
                                      <input type="password" className="form-control" value={arcaConfig.certPassword || ''} onChange={e => setArcaConfig(p => ({ ...p, certPassword: e.target.value }))} />
                                    </div>
                                    <div className="col-md-6 mb-3">
                                      <div className="form-check form-switch mt-4">
                                        <input type="checkbox" className="form-check-input" id="certArcaEnabled" checked={arcaConfig.enabled} onChange={e => setArcaConfig(p => ({ ...p, enabled: e.target.checked }))} />
                                        <label className="form-check-label fw-bold" htmlFor="certArcaEnabled">Habilitar ARCA</label>
                                      </div>
                                      <div className="form-check form-switch mt-2">
                                        <input type="checkbox" className="form-check-input" id="certArcaMock" checked={arcaConfig.mock} onChange={e => setArcaConfig(p => ({ ...p, mock: e.target.checked, environment: e.target.checked ? 'mock' : (p.environment === 'mock' ? 'homologacion' : p.environment) }))} />
                                        <label className="form-check-label" htmlFor="certArcaMock">Modo mock</label>
                                      </div>
                                    </div>
                                  </div>
                                  <button className="btn btn-secondary" onClick={() => void saveArcaConfig()} disabled={savingArca}>
                                    {savingArca ? 'Guardando...' : 'Guardar configuracion ARCA'}
                                  </button>
                                </div>
                              </div>

                              <div className="card mb-3">
                                <div className="card-header bg-primary text-white">
                                  <h5 className="card-title mb-0"><i className="fas fa-cogs mr-1"></i>Paso 1: Generar Clave Privada y CSR</h5>
                                </div>
                                <div className="card-body">
                                  <p className="text-muted small">Complete los datos de su empresa para generar el CSR (Certificate Signing Request)</p>
                                  <div className="row">
                                    <div className="col-md-6 mb-3">
                                      <label className="form-label small fw-bold">Razon Social *</label>
                                      <input type="text" className="form-control" id="csrCompanyName" placeholder="Mi Empresa S.A." defaultValue={companyInfo.companyName} />
                                    </div>
                                    <div className="col-md-6 mb-3">
                                      <label className="form-label small fw-bold">CUIT *</label>
                                      <input type="text" className="form-control" id="csrTaxId" placeholder="30712345678" defaultValue={companyInfo.taxId} />
                                    </div>
                                    <div className="col-md-6 mb-3">
                                      <label className="form-label small fw-bold">Provincia *</label>
                                      <input type="text" className="form-control" id="csrProvince" placeholder="Buenos Aires" />
                                    </div>
                                    <div className="col-md-6 mb-3">
                                      <label className="form-label small fw-bold">Ciudad *</label>
                                      <input type="text" className="form-control" id="csrCity" placeholder="Ciudad de Buenos Aires" />
                                    </div>
                                    <div className="col-md-6 mb-3">
                                      <label className="form-label small fw-bold">Entorno *</label>
                                      <select className="form-control" id="csrEnvironment">
                                        <option value="homologacion">Homologacion (Testing)</option>
                                        <option value="produccion">Produccion (Real)</option>
                                      </select>
                                    </div>
                                  </div>
                                  <button className="btn btn-primary" id="btnGenerateCsr" onClick={async () => {
                                    const companyName = (document.getElementById('csrCompanyName') as HTMLInputElement).value;
                                    const taxId = (document.getElementById('csrTaxId') as HTMLInputElement).value;
                                    const province = (document.getElementById('csrProvince') as HTMLInputElement).value;
                                    const city = (document.getElementById('csrCity') as HTMLInputElement).value;
                                    const environment = (document.getElementById('csrEnvironment') as HTMLSelectElement).value;

                                    if (!companyName || !taxId || !province || !city) {
                                      alert('Complete todos los campos');
                                      return;
                                    }

                                    const btn = document.getElementById('btnGenerateCsr') as HTMLButtonElement;
                                    btn.disabled = true;
                                    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando...';

                                    try {
                                      const res = await postJson(`/billing/certificate/generate${certificateQuery}`, {
                                        companyName, taxId, province, city, environment
                                      }, props.session.token);
                                      if (res.ok) {
                                        alert('CSR generado correctamente');
                                        await loadCertStatus();
                                      } else {
                                        const err = await res.json();
                                        alert('Error: ' + (err.error || 'Error desconocido'));
                                      }
                                    } catch (err) {
                                      alert('Error al generar CSR');
                                    } finally {
                                      btn.disabled = false;
                                      btn.innerHTML = '<i class="fas fa-key"></i> Generar Key + CSR';
                                    }
                                  }}>
                                    <i className="fas fa-key mr-1"></i> Generar Key + CSR
                                  </button>
                                </div>
                              </div>

                              <div className="card mb-3" id="csrSection" style={{ display: certStatus?.hasCsr ? 'block' : 'none' }}>
                                <div className="card-header bg-success text-white">
                                  <h5 className="card-title mb-0"><i className="fas fa-download mr-1"></i>Paso 2: Descargar CSR y Obtener Certificado de ARCA</h5>
                                </div>
                                <div className="card-body">
                                  <div className="alert alert-warning">
                                    <i className="fas fa-exclamation-triangle mr-2"></i>
                                    <strong>Importante:</strong> Descargue el archivo CSR y subalo a ARCA para obtener el certificado firmado.
                                  </div>
                                  <div className="row">
                                    <div className="col-md-6 mb-3">
                                      <button className="btn btn-success btn-block w-100" id="btnDownloadKey" onClick={() => {
                                        window.open(`${API_URL}/billing/certificate/download/key${certificateQuery}&token=${props.session.token}`, '_blank');
                                      }}>
                                        <i className="fas fa-key mr-1"></i> Descargar Clave Privada (.key)
                                      </button>
                                      <small className="text-muted d-block mt-1">Guarde este archivo en un lugar seguro</small>
                                    </div>
                                    <div className="col-md-6 mb-3">
                                      <button className="btn btn-info btn-block w-100" id="btnDownloadCsr" onClick={() => {
                                        window.open(`${API_URL}/billing/certificate/download/csr${certificateQuery}&token=${props.session.token}`, '_blank');
                                      }}>
                                        <i className="fas fa-file-alt mr-1"></i> Descargar CSR (.csr)
                                      </button>
                                      <small className="text-muted d-block mt-1">Este archivo se sube a ARCA</small>
                                    </div>
                                  </div>
                                  <hr />
                                  <h6><i className="fas fa-arrow-right mr-1"></i> Instrucciones para obtener el certificado de ARCA:</h6>
                                  <ol className="text-muted small">
                                    <li>Ingrese a <a href="https://www.afip.gob.ar/ws/" target="_blank">https://www.afip.gob.ar/ws/</a></li>
                                    <li>Vaya a "Administracion de Certificados Digitales"</li>
                                    <li>Seleccione "Crear nuevo certificado para Web Services"</li>
                                    <li>Suba el archivo <strong>request.csr</strong> descargado</li>
                                    <li>Siga las instrucciones de ARCA y descargue el certificado firmado (<strong>.crt</strong>)</li>
                                  </ol>
                                </div>
                              </div>

                              <div className="card mb-3" id="uploadCrtSection" style={{ display: certStatus?.hasCsr || certStatus?.hasCertificate ? 'block' : 'none' }}>
                                <div className="card-header bg-info text-white">
                                  <h5 className="card-title mb-0"><i className="fas fa-upload mr-1"></i>Paso 3: Subir Certificado Firmado por ARCA</h5>
                                </div>
                                <div className="card-body">
                                  <div className="mb-3">
                                    {certStatus?.environment === 'produccion' ? (
                                      <>
                                        <label className="form-label small fw-bold">Certificado Firmado (.crt)</label>
                                        <div className="input-group">
                                          <input type="file" className="form-control" accept=".crt,.cer,.pem" id="certCrtFile"
                                            onChange={async (e) => {
                                              const file = e.target.files?.[0];
                                              if (!file) return;
                                              const formData = new FormData();
                                              formData.append('certificate', file);
                                              setUploadingCert(true);
                                              try {
                                                  const res = await fetch(`${API_URL}/billing/certificate/upload-crt${certificateQuery}`, {
                                                    method: 'POST',
                                                    headers: { Authorization: `Bearer ${props.session.token}` },
                                                    body: formData
                                                });
                                                const data = await res.json();
                                                if (res.ok) {
                                                  alert('Certificado cargado y validado correctamente');
                                                  await loadCertStatus();
                                                } else {
                                                  alert('Error: ' + (data.error || 'Error al cargar certificado'));
                                                }
                                              } catch {
                                                alert('Error al cargar certificado');
                                              } finally {
                                                setUploadingCert(false);
                                                (document.getElementById('certCrtFile') as HTMLInputElement).value = '';
                                              }
                                            }}
                                            disabled={uploadingCert}
                                          />
                                        </div>
                                        <small className="text-muted">Archivo .crt, .cer o .pem firmado por ARCA</small>
                                      </>
                                    ) : (
                                      <>
                                        <label className="form-label small fw-bold">Certificado PEM (Homologacion)</label>
                                        <textarea
                                          className="form-control"
                                          rows={8}
                                          placeholder="Pegue aqui el certificado completo en formato PEM (incluyendo BEGIN CERTIFICATE y END CERTIFICATE)"
                                          value={certificatePemInput}
                                          onChange={e => setCertificatePemInput(e.target.value)}
                                          disabled={uploadingCert}
                                        />
                                        <small className="text-muted d-block mt-1">Copie y pegue el certificado devuelto por ARCA en homologacion</small>
                                        <button className="btn btn-info mt-2" disabled={uploadingCert || !certificatePemInput.trim()} onClick={async () => {
                                          setUploadingCert(true);
                                          try {
                                              const res = await fetch(`${API_URL}/billing/certificate/upload-crt${certificateQuery}`, {
                                                method: 'POST',
                                                headers: {
                                                  'Content-Type': 'application/json',
                                                Authorization: `Bearer ${props.session.token}`
                                              },
                                              body: JSON.stringify({ certificatePem: certificatePemInput })
                                            });
                                            const data = await res.json();
                                            if (res.ok) {
                                              alert('Certificado cargado y validado correctamente');
                                              setCertificatePemInput('');
                                              await loadCertStatus();
                                            } else {
                                              alert('Error: ' + (data.error || 'Error al cargar certificado'));
                                            }
                                          } catch {
                                            alert('Error al cargar certificado');
                                          } finally {
                                            setUploadingCert(false);
                                          }
                                        }}>
                                          <i className="fas fa-paste mr-1"></i> Pegar y Validar Certificado
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="card mb-3" id="generateP12Section" style={{ display: certStatus?.hasCertificate ? 'block' : 'none' }}>
                                <div className="card-header bg-warning">
                                  <h5 className="card-title mb-0"><i className="fas fa-file-archive mr-1"></i>Paso 4: Generar Archivo P12 (Opcional)</h5>
                                </div>
                                <div className="card-body">
                                  <p className="text-muted small">Genere el archivo .p12 necesario para algunos Web Services de AFIP</p>
                                  <div className="row">
                                    <div className="col-md-8 mb-3">
                                      <label className="form-label small fw-bold">Contrasena para P12</label>
                                      <input type="password" className="form-control" id="p12Password" placeholder="Minimo 6 caracteres" />
                                    </div>
                                    <div className="col-md-4 mb-3 d-flex align-items-end">
                                      <button className="btn btn-warning w-100" onClick={async () => {
                                        const password = (document.getElementById('p12Password') as HTMLInputElement).value;
                                        if (!password || password.length < 6) {
                                          alert('La contrasena debe tener al menos 6 caracteres');
                                          return;
                                        }
                                        try {
                                            const res = await fetch(`${API_URL}/billing/certificate/generate-p12${certificateQuery}`, {
                                              method: 'POST',
                                              headers: { 
                                                'Content-Type': 'application/json',
                                              Authorization: `Bearer ${props.session.token}`
                                            },
                                            body: JSON.stringify({ password })
                                          });
                                          if (res.ok) {
                                            const blob = await res.blob();
                                            const url = URL.createObjectURL(blob);
                                            const a = document.createElement('a');
                                            a.href = url;
                                            a.download = 'certificate.p12';
                                            a.click();
                                            URL.revokeObjectURL(url);
                                            alert('Archivo P12 descargado');
                                          } else {
                                            alert('Error al generar P12');
                                          }
                                        } catch {
                                          alert('Error al generar P12');
                                        }
                                      }}>
                                        <i className="fas fa-download mr-1"></i> Descargar P12
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="card" id="certStatusCard" style={{ display: certStatus?.hasPrivateKey || certStatus?.hasCsr || certStatus?.hasCertificate ? 'block' : 'none' }}>
                                <div className="card-header bg-success text-white">
                                  <h5 className="card-title mb-0"><i className="fas fa-check-circle mr-1"></i> Estado del Certificado</h5>
                                </div>
                                <div className="card-body" id="certStatusBody">
                                  {certStatus ? (
                                    <>
                                      <div className="row">
                                        <div className="col-md-4 text-center">
                                          <i className={`fas ${certStatus.hasPrivateKey ? 'fa-check-circle text-success' : 'fa-times-circle text-danger'} fa-2x mb-2`}></i>
                                          <p className="mb-0"><strong>Clave Privada</strong></p>
                                          <small>{certStatus.hasPrivateKey ? 'Generada' : 'No disponible'}</small>
                                        </div>
                                        <div className="col-md-4 text-center">
                                          <i className={`fas ${certStatus.hasCertificate ? 'fa-check-circle text-success' : 'fa-clock text-warning'} fa-2x mb-2`}></i>
                                          <p className="mb-0"><strong>Certificado ARCA</strong></p>
                                          <small>{certStatus.hasCertificate ? 'Cargado' : 'Pendiente'}</small>
                                        </div>
                                        <div className="col-md-4 text-center">
                                          <i className={`fas ${certStatus.environment === 'produccion' ? 'fa-rocket text-primary' : 'fa-flask text-info'} fa-2x mb-2`}></i>
                                          <p className="mb-0"><strong>Entorno</strong></p>
                                          <small>{certStatus.environment === 'produccion' ? 'Produccion' : 'Homologacion'}</small>
                                        </div>
                                      </div>
                                      {certStatus.createdAt ? (
                                        <p className="mt-2 mb-0 text-muted small">Generado: {new Date(certStatus.createdAt).toLocaleString('es-AR')}</p>
                                      ) : null}
                                    </>
                                  ) : null}
                                </div>
                                <div className="card-footer">
                                  <button className="btn btn-danger btn-sm" onClick={async () => {
                                    if (!confirm('¿Eliminar todos los certificados? Esta accion no se puede deshacer.')) return;
                                    try {
                                      await deleteJson(`/billing/certificate${certificateQuery}`, props.session.token);
                                      alert('Certificados eliminados');
                                      await loadCertStatus();
                                    } catch {
                                      alert('Error al eliminar certificados');
                                    }
                                  }}>
                                    <i className="fas fa-trash mr-1"></i> Eliminar Todo
                                  </button>
                                </div>
                              </div>
                            </div>

                            <div className="col-md-4">
                              <div className="card bg-light">
                                <div className="card-header"><h4 className="card-title small fw-bold mb-0"><i className="fas fa-info-circle mr-1"></i>Informacion</h4></div>
                                <div className="card-body small">
                                  <p className="mb-2"><strong>Proceso de obtencion de certificado:</strong></p>
                                  <ol className="mb-2 ps-3">
                                    <li><strong>Genere</strong> la clave privada y el CSR</li>
                                    <li><strong>Descargue</strong> el archivo request.csr</li>
                                    <li><strong>Suba</strong> el CSR a ARCA</li>
                                    <li><strong>Descargue</strong> el certificado firmado</li>
                                    <li><strong>Suba</strong> el certificado a esta plataforma</li>
                                    <li><strong>Genere</strong> el archivo P12 si es necesario</li>
                                  </ol>
                                  <hr />
                                  <p className="mb-2"><strong>Archivos generados:</strong></p>
                                  <ul className="ps-3">
                                    <li><code>private.key</code> - Clave privada RSA 2048 bits</li>
                                    <li><code>request.csr</code> - Certificate Signing Request</li>
                                    <li><code>certificate.crt</code> - Certificado firmado por ARCA</li>
                                    <li><code>certificate.p12</code> - Archivo PKCS#12 (opcional)</li>
                                  </ul>
                                  <hr />
                                  <p className="mb-0"><strong>Modo Mock:</strong> Puede usar el modo mock para pruebas sin certificado.</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className={`tab-pane ${facturacionTab === 'facturas' ? 'active show' : ''}`}>
                          <div className="row">
                            <div className="col-12">
                              <div className="alert alert-info mb-3">
                                <i className="fas fa-file-invoice mr-2"></i>
                                Gestion de facturas electronicas ARCA
                              </div>
                            </div>
                            <div className="col-12">
                              <div className="card">
                                <div className="card-header">
                                  <div className="d-flex justify-content-between align-items-center">
                                    <h4 className="card-title small fw-bold mb-0"><i className="fas fa-list mr-1"></i>Facturas ({invoices.length})</h4>
                                    <div className="d-flex align-items-center" style={{ gap: '8px' }}>
                                      <button className="btn btn-light btn-sm" onClick={() => setShowCreateInvoiceModal(true)}>
                                        <i className="fas fa-plus me-1"></i>Nueva Factura
                                      </button>
                                    </div>
                                  </div>
                                </div>
                                <div className="card-body p-0">
                                  <div className="table-responsive" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                                    <table className="table table-sm m-0">
                                      <thead className="thead-light">
                                        <tr>
                                          <th style={{width: '40px'}}></th>
                                          <th>Periodo</th>
                                          <th>Tipo</th>
                                          <th>Cliente</th>
                                          <th>Monto</th>
                                          <th>CAE</th>
                                          <th>Estado</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {invoices.length === 0 ? (
                                          <tr><td colSpan={7} className="text-center text-muted py-3">No hay facturas registradas</td></tr>
                                        ) : (
                                          invoices.flatMap(inv => {
                                            const expanded = expandedInvoiceId === inv._id;
                                            const isPending = inv.estado === 'pendiente';
                                            const isProcessing = processingInvoiceId === inv._id;
                                            return [
                                              <tr key={inv._id} style={{ cursor: 'pointer' }} onClick={() => setExpandedInvoiceId(expanded ? null : inv._id)}>
                                                <td className="text-center text-muted"><i className={`fas ${expanded ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i></td>
                                                <td className="small">{inv.period || '-'}</td>
                                                <td><span className="badge text-bg-secondary">Factura {inv.tipo || 'B'}</span></td>
                                                <td className="small">{inv.cliente?.nombre || inv.clienteNombre || '-'}</td>
                                                <td className="fw-bold text-primary">${(inv.amountArs || 0).toLocaleString('es-AR')}</td>
                                                <td className="small">{inv.cae || '-'}</td>
                                                <td>
                                                  <span className={`badge ${inv.estado === 'autorizado' ? 'text-bg-success' : inv.estado === 'paid' ? 'text-bg-info' : 'text-bg-warning'}`}>
                                                    {inv.estado === 'autorizado' ? 'Autorizada' : inv.estado === 'paid' ? 'Pagada' : inv.estado || 'Borrador'}
                                                  </span>
                                                </td>
                                              </tr>,
                                              expanded ? (
                                                <tr key={`${inv._id}-expanded`}>
                                                  <td colSpan={7} className="bg-light">
                                                    <div className="d-flex justify-content-between align-items-center flex-wrap" style={{ gap: '8px' }}>
                                                      <div className="small text-muted">
                                                        <strong>ID:</strong> {inv._id} | <strong>Punto de venta:</strong> {inv.puntoVenta || '-'} | <strong>Numero:</strong> {inv.numero || '-'}
                                                      </div>
                                                      <div className="d-flex align-items-center" style={{ gap: '8px' }}>
                                                        <a
                                                          href={`${API_URL}/billing/invoices/${inv._id}/pdf?token=${props.session.token}`}
                                                          target="_blank"
                                                          className="btn btn-sm btn-outline-primary"
                                                          title="Ver PDF"
                                                          onClick={e => e.stopPropagation()}
                                                        >
                                                          <i className="fas fa-file-pdf me-1"></i>PDF
                                                        </a>
                                                        {isPending ? (
                                                          <button
                                                            className="btn btn-sm btn-outline-success"
                                                            onClick={e => {
                                                              e.stopPropagation();
                                                              void authorizeSingleInvoice(inv._id);
                                                            }}
                                                            disabled={isProcessing}
                                                          >
                                                            {isProcessing ? 'Procesando...' : 'Autorizar'}
                                                          </button>
                                                        ) : null}
                                                        {isPending ? (
                                                          <button
                                                            className="btn btn-sm btn-outline-danger"
                                                            onClick={e => {
                                                              e.stopPropagation();
                                                              void deletePendingInvoice(inv._id);
                                                            }}
                                                            disabled={isProcessing}
                                                          >
                                                            Eliminar pendiente
                                                          </button>
                                                        ) : null}
                                                      </div>
                                                    </div>
                                                  </td>
                                                </tr>
                                              ) : null
                                            ].filter(Boolean) as JSX.Element[];
                                          })
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'notificaciones' && (
              <div className="row">
                <div className="col-12">
                  <div className="card">
                    <div className="card-header d-flex justify-content-between align-items-center">
                      <h3 className="card-title text-white fw-bold mb-0 flex-grow-1"><i className="fas fa-bell me-2"></i>Notificaciones y Alertas ({alerts.length})</h3>
                      <div className="ms-auto d-flex gap-2">
                        <button className="btn btn-sm btn-light" onClick={async () => {
                          if (!confirm('¿Probar notificación de Telegram?')) return;
                          try {
                            await postJson('/alerts/test-telegram', { message: '🧪 Prueba de AgroSentinel - Notificaciones funcionando correctamente' }, props.session.token);
                            alert('Mensaje de prueba enviado a Telegram');
                          } catch { alert('Error al enviar mensaje de prueba'); }
                        }}>
                          <i className="fab fa-telegram mr-1"></i>Probar Telegram
                        </button>
                        <button className="btn btn-sm btn-light" onClick={async () => {
                          try {
                            const resolvedAlerts = alerts.filter(al => al.status === 'resolved');
                            for (const a of resolvedAlerts) {
                              await deleteJson(`/alerts/${a._id}`, props.session.token);
                            }
                            setAlerts(alerts.filter(a => a.status === 'open'));
                            void Swal.fire({
                              toast: true,
                              position: 'top-end',
                              icon: 'success',
                              title: 'Exito',
                              text: 'Alertas resueltas limpiadas correctamente',
                              showConfirmButton: false,
                              timer: 4200,
                              timerProgressBar: true
                            });
                          } catch (err) {
                            void Swal.fire({
                              toast: true,
                              position: 'top-end',
                              icon: 'error',
                              title: 'Error',
                              text: 'Error al limpiar alertas',
                              showConfirmButton: false,
                              timer: 4200,
                              timerProgressBar: true
                            });
                          }
                        }}>
                          <i className="fas fa-trash mr-1"></i>Limpiar Resueltas
                        </button>
                      </div>
                    </div>
                    <div className="card-body p-0">
                      {alerts.length === 0 ? (
                        <p className="text-center text-muted p-4">Sin notificaciones registradas</p>
                      ) : (
                        <table className="table table-hover m-0">
                          <thead><tr><th>Dispositivo</th><th>Tipo</th><th>Mensaje</th><th>Estado</th><th>Fecha</th></tr></thead>
                          <tbody>{alerts.slice(0, 100).map(a => (
                            <tr key={a._id}>
                              <td className="fw-bold">{a.deviceId}</td>
                              <td><span className={`badge ${a.type === 'critical_level' ? 'text-bg-danger' : 'text-bg-secondary'}`}>{a.type}</span></td>
                              <td>{a.message}</td>
                              <td><span className={`badge ${a.status === 'open' ? 'text-bg-danger' : 'text-bg-success'}`}>{a.status}</span></td>
                              <td className="small text-muted">{a.openedAt ? new Date(a.openedAt).toLocaleString('es-AR') : '-'}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      )}
                      {alerts.length > 100 && <div className="text-center text-muted p-2 small">Mostrando las últimas 100 de {alerts.length}</div>}
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
                      <ul className="nav nav-tabs mt-3 px-3" role="tablist">
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
                            <li className="nav-item">
                              <a className={`nav-link ${serverTab === 'config' ? 'active' : ''}`} href="#" onClick={e => { e.preventDefault(); setServerTab('config'); }}>
                                <i className="fas fa-cogs mr-1"></i> Config
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
                          {serverTab === 'config' && (
                            <div>
                              <div className="alert alert-info mb-3">
                                <i className="fas fa-info-circle mr-2"></i>
                                Configuracion del sistema. Algunos cambios requieren reiniciar el servidor.
                              </div>
                              {systemConfig.length === 0 ? (
                                <p className="text-muted">Cargando configuración...</p>
                              ) : (
                                <table className="table table-sm table-bordered">
                                  <thead className="thead-dark">
                                    <tr><th>Parametro</th><th>Valor</th><th style={{width: 40}}></th></tr>
                                  </thead>
                                  <tbody>
                                    {systemConfig.map(cfg => (
                                      <tr key={cfg.key}>
                                        <td>
                                          <strong>{cfg.key}</strong>
                                          {cfg.description && <div className="small text-muted">{cfg.description}</div>}
                                        </td>
                                        <td>
                                          {(cfg.key === 'TELEGRAM_BOT_TOKEN' || cfg.key === 'TELEGRAM_CHAT_ID') && cfg.value ? (
                                            <input type="password" className="form-control form-control-sm" value={cfg.value} 
                                              onChange={e => {
                                                setSystemConfig(prev => prev.map(c => c.key === cfg.key ? { ...c, value: e.target.value } : c));
                                              }} />
                                          ) : cfg.key === 'TELEGRAM_ENABLED' ? (
                                            <select className="form-control form-control-sm" value={cfg.value}
                                              onChange={e => setSystemConfig(prev => prev.map(c => c.key === cfg.key ? { ...c, value: e.target.value } : c))}>
                                              <option value="false">false</option>
                                              <option value="true">true</option>
                                            </select>
                                          ) : (
                                            <input type="text" className="form-control form-control-sm" value={cfg.value}
                                              onChange={e => setSystemConfig(prev => prev.map(c => c.key === cfg.key ? { ...c, value: e.target.value } : c))} />
                                          )}
                                        </td>
                                        <td><span className="badge bg-info" title={cfg.description || cfg.key}>?</span></td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                              <button className="btn btn-primary" disabled={savingConfig} onClick={async () => {
                                setSavingConfig(true);
                                try {
                                  for (const cfg of systemConfig) {
                                    await putJson(`/config/${cfg.key}`, { value: cfg.value }, props.session.token);
                                  }
                                  alert('Configuración guardada. Reinicie el servidor para aplicar cambios.');
                                } catch (err) {
                                  alert('Error al guardar configuración');
                                }
                                setSavingConfig(false);
                              }}>
                                <i className="fas fa-save mr-1"></i>{savingConfig ? 'Guardando...' : 'Guardar Configuración'}
                              </button>
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
                      <h3 className="card-title text-white fw-bold mb-0 flex-grow-1">
                        <i className="fas fa-clock me-2"></i>Dispositivos Pendientes de Aprobacion ({pendingDevices.length})
                      </h3>
                      <div className="ms-auto">
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
                            <thead><tr><th>Device ID</th><th>Estado</th><th>Ultima Conexion</th><th>Nombre</th><th>Ubicacion</th><th>Cliente</th><th>Accion</th></tr></thead>
                            <tbody>
                              {pendingDevices.filter(d => pendingFilter === 'all' || d.status === pendingFilter).map(d => (
                                <tr key={d.device_id}>
                                  <td className="fw-bold">{d.device_id}</td>
                                  <td>
                                    <span className={`badge ${getStatusBadge(d.status)}`}>
                                      <i className={`fas fa-circle me-1`} style={{ color: getStatusColor(d.status) }}></i>
                                      {d.status}
                                    </span>
                                  </td>
                                  <td className="small text-muted">
                                    {d.last_seen ? new Date(d.last_seen).toLocaleString('es-AR') : 'N/A'}
                                  </td>
                                  <td style={{ minWidth: '150px' }}>
                                    <input type="text" className="form-control form-control-sm" placeholder="Nombre del dispositivo"
                                      value={assigningDevice === d.device_id ? assigningName : ''}
                                      onChange={e => { setAssigningDevice(d.device_id); setAssigningName(e.target.value); }}
                                    />
                                  </td>
                                  <td style={{ minWidth: '180px' }}>
                                    <button className="btn btn-outline-primary btn-sm w-100" 
                                      onClick={() => { setAssigningDevice(d.device_id); setShowAssigningMap(true); }}>
                                      <i className="fas fa-map-marker-alt mr-1"></i>
                                      {assigningDevice === d.device_id && assigningLat && assigningLng ? 'Ubicado' : 'Seleccionar en mapa'}
                                    </button>
                                  </td>
                                  <td style={{ minWidth: '180px' }}>
                                    <select className="form-control form-control-sm" value={assigningDevice === d.device_id ? selectedUserId : ''} 
                                      onChange={e => { setAssigningDevice(d.device_id); setSelectedUserId(e.target.value); }}>
                                      <option value="">Seleccionar...</option>
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
                                          await postJson('/devices/assign', { 
                                            device_id: d.device_id, 
                                            tenant_id: selectedUserId,
                                            name: assigningName || undefined,
                                            lat: assigningLat ? Number(assigningLat) : undefined,
                                            lng: assigningLng ? Number(assigningLng) : undefined
                                          }, props.session.token);
                                          setPendingDevices(p => p.filter(x => x.device_id !== d.device_id));
                                          setAssigningDevice(null);
                                          setSelectedUserId('');
                                          setAssigningName('');
                                          setAssigningLat('');
                                          setAssigningLng('');
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

            {showAssigningMap && (
            <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
              <div className="modal-dialog modal-lg modal-dialog-centered">
                <div className="modal-content">
                  <div className="modal-header bg-primary">
                    <h4 className="modal-title"><i className="fas fa-map-marker-alt mr-2"></i>Seleccionar Ubicacion</h4>
                    <button type="button" className="close text-white" onClick={() => setShowAssigningMap(false)}>&times;</button>
                  </div>
                  <div className="modal-body p-0" style={{ height: '450px' }}>
                    <AssignMap 
                      lat={assigningLat} 
                      lng={assigningLng} 
                      onSelect={(lat, lng) => {
                        setAssigningLat(lat.toString());
                        setAssigningLng(lng.toString());
                      }} 
                    />
                  </div>
                  <div className="modal-footer">
                    <div className="mr-auto text-muted small">
                      Lat: {assigningLat || '—'} | Lng: {assigningLng || '—'}
                    </div>
                    <button type="button" className="btn btn-secondary" onClick={() => setShowAssigningMap(false)}>Cerrar</button>
                    <button type="button" className="btn btn-primary" onClick={() => setShowAssigningMap(false)}>Confirmar</button>
                  </div>
                </div>
              </div>
            </div>
            )}

            {activeSection === 'backup' && (
              <div className="row">
                <div className="col-12">
                  <div className="card">
                    <div className="card-header">
                      <h3 className="card-title text-white fw-bold mb-0"><i className="fas fa-database me-2"></i>Backup y Restauracion</h3>
                    </div>
                    <div className="card-body">
                      <div className="row">
                        <div className="col-md-6">
                          <div className="card card-primary">
                            <div className="card-header">
                              <h5 className="card-title mb-0"><i className="fas fa-download mr-2"></i>Exportar Datos</h5>
                            </div>
                            <div className="card-body">
                              <p className="text-muted">Exporta todos los clientes y dispositivos a un archivo JSON.</p>
                              <button className="btn btn-primary" onClick={() => void createBackup()} disabled={creatingBackup}>
                                {creatingBackup ? <><i className="fas fa-spinner fa-spin mr-1"></i>Generando...</> : <><i className="fas fa-download mr-1"></i>Descargar Backup</>}
                              </button>
                              {backupSuccess && <div className="alert alert-success mt-3 mb-0">{backupSuccess}</div>}
                              {backupError && <div className="alert alert-danger mt-3 mb-0">{backupError}</div>}
                            </div>
                          </div>
                        </div>
                        <div className="col-md-6">
                          <div className="card card-warning">
                            <div className="card-header">
                              <h5 className="card-title mb-0"><i className="fas fa-upload mr-2"></i>Importar Datos</h5>
                            </div>
                            <div className="card-body">
                              <p className="text-muted">Restaura clientes y dispositivos desde un archivo JSON de backup.</p>
                              <input 
                                type="file" 
                                accept=".json" 
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) void restoreBackup(file);
                                }} 
                                disabled={restoringBackup}
                              />
                              {restoringBackup && <div className="mt-2"><i className="fas fa-spinner fa-spin mr-1"></i>Restaurando...</div>}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="alert alert-warning mt-3">
                        <i className="fas fa-exclamation-triangle mr-2"></i>
                        <strong>Nota:</strong> La restauración no eliminará datos existentes, solo agregará o actualizará los del backup.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      <div className={`modal fade ${showCreateInvoiceModal ? 'show' : ''}`} style={{ display: showCreateInvoiceModal ? 'block' : 'none', overflowY: 'auto', backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <div className="modal-dialog modal-lg" style={{ margin: '30px auto' }}>
          <div className="modal-content" style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header bg-primary">
              <h4 className="modal-title"><i className="fas fa-file-invoice mr-2"></i>Nueva Factura</h4>
              <button type="button" className="close text-white" onClick={() => setShowCreateInvoiceModal(false)}>&times;</button>
            </div>
            <div className="modal-body" style={{ overflowY: 'auto' }}>
              <div className="mb-3">
                <label className="form-label small fw-bold">Cliente</label>
                <select className="form-control" value={newInvoice.clientTenantId} onChange={e => {
                  const client = clients.find(c => c.tenantId === e.target.value);
                  if (client) {
                    const plan = plans.find(p => p._id === client.planId);
                    const ivaCondition = client.ivaCondition || 'Consumidor Final';
                    let tipoComprobante = 'B';
                    if (ivaCondition === 'Responsable Inscripto') {
                      tipoComprobante = 'A';
                    }
                    setNewInvoice({
                      tenantId: props.session.user.tenantId,
                      clientTenantId: client.tenantId,
                      tipo: tipoComprobante,
                      clienteNombre: client.companyName,
                      clienteTipoDoc: 80,
                      clienteNroDoc: client.taxId || '',
                      clienteCondicionIva: ivaCondition,
                      amountArs: plan ? plan.monthlyPriceArs : 0,
                      period: newInvoice.period
                    });
                  } else {
                    setNewInvoice(p => ({ ...p, clientTenantId: '', clienteNombre: 'Consumidor Final', clienteTipoDoc: 99, clienteNroDoc: '0', clienteCondicionIva: 'Consumidor Final' }));
                  }
                }}>
                  <option value="">Consumidor Final</option>
                  {clients.map(c => (
                    <option key={c.tenantId} value={c.tenantId}>
                      {c.companyName} {c.planName ? `(${c.planName})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-3">
                <label className="form-label small fw-bold">Tipo de Comprobante</label>
                <select className="form-control" value={newInvoice.tipo} onChange={e => setNewInvoice(p => ({ ...p, tipo: e.target.value }))}>
                  <option value="A">Factura A</option>
                  <option value="B">Factura B</option>
                  <option value="C">Factura C</option>
                </select>
              </div>
              <div className="mb-3">
                <label className="form-label small fw-bold">Nombre / Razon Social</label>
                <input className="form-control" value={newInvoice.clienteNombre} onChange={e => setNewInvoice(p => ({ ...p, clienteNombre: e.target.value }))} placeholder="Consumidor Final" />
              </div>
              <div className="row">
                <div className="col-6 mb-3">
                  <label className="form-label small fw-bold">Tipo Doc</label>
                  <select className="form-control" value={newInvoice.clienteTipoDoc} onChange={e => setNewInvoice(p => ({ ...p, clienteTipoDoc: Number(e.target.value) }))}>
                    <option value={99}>99 - Sin identificar</option>
                    <option value={80}>80 - CUIT</option>
                    <option value={86}>86 - CUIL</option>
                    <option value={96}>96 - DNI</option>
                  </select>
                </div>
                <div className="col-6 mb-3">
                  <label className="form-label small fw-bold">Nro. Documento</label>
                  <input className="form-control" value={newInvoice.clienteNroDoc} onChange={e => setNewInvoice(p => ({ ...p, clienteNroDoc: e.target.value }))} placeholder="0" />
                </div>
              </div>
              <div className="mb-3">
                <label className="form-label small fw-bold">Condicion IVA</label>
                <select className="form-control" value={newInvoice.clienteCondicionIva} onChange={e => setNewInvoice(p => ({ ...p, clienteCondicionIva: e.target.value }))}>
                  <option>Consumidor Final</option>
                  <option>Responsable Inscripto</option>
                  <option>Monotributista</option>
                  <option>Exento</option>
                </select>
              </div>
              <div className="row">
                <div className="col-6 mb-3">
                  <label className="form-label small fw-bold">Periodo</label>
                  <input className="form-control" type="month" value={newInvoice.period} onChange={e => setNewInvoice(p => ({ ...p, period: e.target.value }))} />
                </div>
                <div className="col-6 mb-3">
                  <label className="form-label small fw-bold">Monto (ARS)</label>
                  <input className="form-control" type="number" value={newInvoice.amountArs} onChange={e => setNewInvoice(p => ({ ...p, amountArs: Number(e.target.value) }))} placeholder="0" />
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ position: 'sticky', bottom: 0, backgroundColor: '#fff', borderTop: '1px solid #dee2e6', zIndex: 2 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowCreateInvoiceModal(false)}>Cancelar</button>
              <button className="btn btn-outline-primary" onClick={() => void createInvoice(false)} disabled={creatingInvoice || !newInvoice.amountArs}>
                {creatingInvoice ? <><i className="fas fa-spinner fa-spin mr-1"></i>Guardando...</> : <><i className="fas fa-save mr-1"></i>Guardar sin autorizar</>}
              </button>
              <button className="btn btn-primary" onClick={() => void createInvoice(true)} disabled={creatingInvoice || !newInvoice.amountArs}>
                {creatingInvoice ? <><i className="fas fa-spinner fa-spin mr-1"></i>Creando...</> : <><i className="fas fa-check mr-1"></i>Crear y Autorizar</>}
              </button>
            </div>
          </div>
        </div>
      </div>
      {showCreateInvoiceModal && <div className="modal-backdrop fade show" onClick={() => setShowCreateInvoiceModal(false)}></div>}

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
              <div className="row">
                <div className="col-md-6 mb-3">
                  <label className="form-label small fw-bold">CUIT</label>
                  <input className="form-control" value={newClient.taxId}
                    onChange={e => setNewClient(p => ({ ...p, taxId: e.target.value }))}
                    placeholder="30712345678" />
                </div>
                <div className="col-md-6 mb-3">
                  <label className="form-label small fw-bold">Condicion IVA</label>
                  <select className="form-control" value={newClient.ivaCondition}
                    onChange={e => setNewClient(p => ({ ...p, ivaCondition: e.target.value }))}>
                    <option>Consumidor Final</option>
                    <option>Responsable Inscripto</option>
                    <option>Monotributista</option>
                    <option>Exento</option>
                  </select>
                </div>
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
                      planId: newClient.planId || undefined,
                      taxId: newClient.taxId,
                      ivaCondition: newClient.ivaCondition
                    }, props.session.token);
                    const data = await res.json() as { tenantId: string; clientUsername: string; clientPassword: string };
                    setCreatedClientCredentials({ email: data.clientUsername, password: data.clientPassword, tenantId: data.tenantId });
                    setNewClient({ companyName: '', contactName: '', email: '', phone: '', address: '', planId: '', taxId: '', ivaCondition: 'Consumidor Final' });
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

      {createdClientCredentials && (
        <>
          <div className="modal fade show" style={{ display: 'block' }}>
            <div className="modal-dialog">
              <div className="modal-content">
                <div className="modal-header bg-success">
                  <h4 className="modal-title"><i className="fas fa-check-circle mr-2"></i>Cliente Creado</h4>
                  <button type="button" className="close text-white" onClick={() => setCreatedClientCredentials(null)}>&times;</button>
                </div>
                <div className="modal-body">
                  <p className="text-muted">Se han generado las credenciales de acceso para el cliente:</p>
                  <div className="alert alert-info">
                    <div className="mb-2"><strong>Usuario:</strong> <span className="text-monospace">{createdClientCredentials.email || '(sin email)'}</span></div>
                    <div className="mb-2"><strong>Contrasena:</strong> <span className="text-monospace">{createdClientCredentials.password || '(error)'}</span></div>
                    <div><strong>ID:</strong> <span className="text-monospace">{createdClientCredentials.tenantId}</span></div>
                  </div>
                  <p className="small text-muted">El cliente debera cambiar la contrasena en su primer ingreso.</p>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-primary" onClick={() => setCreatedClientCredentials(null)}>Aceptar</button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </>
      )}

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
              <div className="row">
                <div className="col-md-6 mb-3">
                  <label className="form-label small fw-bold">CUIT</label>
                  <input className="form-control" value={editClient.taxId}
                    onChange={e => setEditClient(p => ({ ...p, taxId: e.target.value }))}
                    placeholder="30712345678" />
                </div>
                <div className="col-md-6 mb-3">
                  <label className="form-label small fw-bold">Condicion IVA</label>
                  <select className="form-control" value={editClient.ivaCondition}
                    onChange={e => setEditClient(p => ({ ...p, ivaCondition: e.target.value }))}>
                    <option>Consumidor Final</option>
                    <option>Responsable Inscripto</option>
                    <option>Monotributista</option>
                    <option>Exento</option>
                  </select>
                </div>
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
            <div className="modal-footer d-flex justify-content-between">
              <button type="button" className="btn btn-warning" onClick={async () => {
                if (!selectedClient?._id) {
                  alert('Selecciona un cliente primero');
                  return;
                }
                if (!confirm('Esto generara una nueva contrasena para el cliente. Continuar?')) return;
                try {
                  const res = await postJson(`/tenants/${selectedClient._id}/reset-password`, {}, props.session.token);
                  if (!res.ok) {
                    const err = await res.json();
                    alert(err.error || 'Error al regenerar contrasena');
                    return;
                  }
                  const data = await res.json() as { email: string; newPassword: string };
                  setCreatedClientCredentials({ email: data.email, password: data.newPassword, tenantId: selectedClient.tenantId });
                } catch (e) {
                  alert('Error al regenerar contrasena: ' + (e as Error).message);
                }
              }}>
                <i className="fas fa-key mr-1"></i>Generar Nueva Contrasena
              </button>
              <div>
                <button type="button" className="btn btn-default mr-2" onClick={() => setShowEditClient(false)}>Cancelar</button>
                <button type="button" className="btn btn-primary" onClick={() => void saveClient()} disabled={savingClient || !editClient.companyName || !editClient.email}>
                  {savingClient ? 'Guardando...' : <><i className="fas fa-save mr-1"></i>Guardar Cambios</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {showEditClient && <div className="modal-backdrop fade show" onClick={() => setShowEditClient(false)}></div>}

      <div className={`modal fade ${showDeviceModal ? 'show' : ''}`} style={{ display: showDeviceModal ? 'block' : 'none', overflow: 'auto' }}>
        <div className="modal-dialog modal-xl" style={{ margin: '30px auto' }}>
          <div className="modal-content">
            <div className="modal-header bg-primary">
              <h4 className="modal-title"><i className="fas fa-microchip mr-2"></i>Detalle del Dispositivo</h4>
              <button type="button" className="close text-white" onClick={() => setShowDeviceModal(false)}>&times;</button>
            </div>
            <div className="modal-body" style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
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
                        <tr><td className="text-muted fw-bold">Bomba:</td><td><span className={`badge ${selectedDevice.pumpOn ? 'text-bg-success' : 'text-bg-danger'}`}>
                                  <i className="fas fa-circle" style={{fontSize: '0.6em', marginRight: '4px', verticalAlign: 'middle', color: getPumpColor(selectedDevice.pumpOn)}}></i> 
                                  {selectedDevice.pumpOn ? 'ENCENDIDA' : 'APAGADA'}
                                </span></td></tr>
                        <tr><td className="text-muted fw-bold">Estado:</td><td><span className={`badge ${getStatusBadge(selectedDevice.status)}`}><i className={`fas fa-circle mr-1`} style={{ fontSize: '0.6em', color: getStatusColor(selectedDevice.status) }}></i>{selectedDevice.status}</span></td></tr>
                        <tr><td className="text-muted fw-bold">Ultima Comunicacion:</td><td className="small">{selectedDevice.lastHeartbeatAt ? new Date(selectedDevice.lastHeartbeatAt).toLocaleString('es-AR') : '—'}</td></tr>
                      </table>
                    </div>
                    <div className="col-md-6">
                      <h5 className="text-primary"><i className="fas fa-map-marker-alt mr-1"></i>Ubicacion (haz clic para seleccionar)</h5>
                      <div className="mb-3" style={{ height: '280px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #dee2e6' }}>
                        <MapContainer 
                          center={!isNaN(Number(editDevice.lat)) && !isNaN(Number(editDevice.lng)) ? [Number(editDevice.lat), Number(editDevice.lng)] : [-34.62, -58.43]} 
                          zoom={13} 
                          style={{ height: '100%', width: '100%' }}
                        >
                          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                          <MapCenterUpdater lat={editDevice.lat} lng={editDevice.lng} />
                          {!isNaN(Number(editDevice.lat)) && !isNaN(Number(editDevice.lng)) && (
                            <Marker position={[Number(editDevice.lat), Number(editDevice.lng)]} />
                          )}
                          <MapClickHandler onMapClick={(lat, lng) => setEditDevice(p => ({ ...p, lat: lat.toString(), lng: lng.toString() }))} />
                        </MapContainer>
                      </div>
                      <div className="d-flex gap-2 mb-2">
                        <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => {
                          if (navigator.geolocation) {
                            navigator.geolocation.getCurrentPosition((pos) => {
                              setEditDevice(p => ({ ...p, lat: pos.coords.latitude.toString(), lng: pos.coords.longitude.toString() }));
                            });
                          }
                        }}>
                          <i className="fas fa-crosshairs mr-1"></i> Mi ubicacion
                        </button>
                      </div>
                      <table className="table table-sm table-borderless">
                        <tr><td className="text-muted fw-bold">Latitud:</td><td>{editDevice.lat || '—'}</td></tr>
                        <tr><td className="text-muted fw-bold">Longitud:</td><td>{editDevice.lng || '—'}</td></tr>
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
                      <label className="form-label small fw-bold">Latitud</label>
                      <input className="form-control" value={editDevice.lat} onChange={e => setEditDevice(p => ({ ...p, lat: e.target.value }))} />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label small fw-bold">Longitud</label>
                      <input className="form-control" value={editDevice.lng} onChange={e => setEditDevice(p => ({ ...p, lng: e.target.value }))} />
                    </div>
                  </div>
                  <hr />
                  <h5 className="text-primary"><i className="fas fa-cog mr-1"></i>Configuracion de Bomba</h5>
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="form-label small fw-bold">Nivel para encender bomba (%)</label>
                      <input type="number" className="form-control" value={editDevice.configNivelMin ?? 50} onChange={e => setEditDevice(p => ({ ...p, configNivelMin: Number(e.target.value) }))} min={0} max={100} />
                      <small className="text-muted">Default: 50%</small>
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label small fw-bold">Nivel para apagar bomba (%)</label>
                      <input type="number" className="form-control" value={editDevice.configNivelMax ?? 95} onChange={e => setEditDevice(p => ({ ...p, configNivelMax: Number(e.target.value) }))} min={0} max={100} />
                      <small className="text-muted">Default: 95%</small>
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label small fw-bold">Nivel de alerta critica (%)</label>
                      <input type="number" className="form-control" value={editDevice.configAlertaBaja ?? 30} onChange={e => setEditDevice(p => ({ ...p, configAlertaBaja: Number(e.target.value) }))} min={0} max={100} />
                      <small className="text-muted">Alerta si bomba no enciende por debajo de este nivel</small>
                    </div>
                    <div className="col-md-6 mb-3 d-flex align-items-end">
                      <div className="custom-control custom-switch">
                        <input type="checkbox" className="custom-control-input" id="modoAuto" checked={editDevice.configModoAuto ?? true} onChange={e => setEditDevice(p => ({ ...p, configModoAuto: e.target.checked }))} />
                        <label className="custom-control-label fw-bold" htmlFor="modoAuto">Modo Automatico</label>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer d-flex justify-content-between">
              <button type="button" className="btn btn-danger" style={{ minWidth: '100px' }} onClick={() => void deleteDevice()} disabled={savingDevice}>
                <i className="fas fa-trash-alt mr-1"></i>Eliminar
              </button>
              <div>
                <button type="button" className="btn btn-default mr-2" onClick={() => setShowDeviceModal(false)}>Cerrar</button>
                <button type="button" className="btn btn-primary" onClick={() => void saveDevice()} disabled={savingDevice}>
                  {savingDevice ? 'Guardando...' : <><i className="fas fa-save mr-1"></i>Guardar Cambios</>}
                </button>
              </div>
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
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1050, display: 'flex', flexDirection: 'column', backgroundColor: '#f4f6f9' }}>
            <div className="bg-primary px-3 py-2 d-flex align-items-center">
              <h5 className="mb-0 text-white"><i className="fas fa-map-marked-alt mr-2"></i>Mapa de Todos los Dispositivos</h5>
              <button className="btn btn-outline-light btn-sm ml-auto" onClick={() => setShowAllDevicesModal(false)}>
                <i className="fas fa-times"></i> Cerrar
              </button>
            </div>
            <div style={{ flex: 1, minHeight: '500px', position: 'relative' }}>
              {(() => {
                const validDevices = allDevices.filter(d => d.location && d.location.lat && d.location.lng && d.location.lat !== 0 && d.location.lng !== 0);
                if (validDevices.length === 0) {
                  return (
                    <div className="d-flex align-items-center justify-content-center h-100">
                      <div className="text-center text-muted">
                        <i className="fas fa-map-marker-alt fa-3x mb-3"></i>
                        <p>No hay dispositivos con ubicación válida</p>
                      </div>
                    </div>
                  );
                }
                const lats = validDevices.map(d => d.location.lat);
                const lngs = validDevices.map(d => d.location.lng);
                const defaultCenter: [number, number] = [
                  lats.length > 0 ? (Math.min(...lats) + Math.max(...lats)) / 2 : -34.6,
                  lngs.length > 0 ? (Math.min(...lngs) + Math.max(...lngs)) / 2 : -58.4
                ];
                const mapCenter = allDevicesMapCenter || defaultCenter;
                if (!allDevicesMapCenter && lats.length > 0) {
                  setAllDevicesMapCenter(mapCenter);
                }
                return (
                  <MapContainer center={mapCenter} zoom={10} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' />
                    {validDevices.map(d => {
                      const color = markerColor(d.status, d.levelPct, false);
                      return (
                      <Marker key={d._id} position={[d.location.lat, d.location.lng]} eventHandlers={{
                        click: () => { setShowAllDevicesModal(false); openDeviceModal(d); }
                      }} icon={L.divIcon({ className: 'custom-marker', html: `<div style="background-color:${color};width:24px;height:24px;border-radius:50%;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);cursor:pointer;"></div>`, iconSize: [24, 24], iconAnchor: [12, 12] })}>
                        <Popup><div className="p-1"><h6 className="fw-bold mb-1">{d.name}</h6><p className="mb-0 small">Cliente: <strong>{d.clientName}</strong></p><p className="mb-0 small">Estado: <span className={`badge ${getStatusBadge(d.status)}`}><i className={`fas fa-circle mr-1`} style={{ fontSize: '0.6em', color: getStatusColor(d.status) }}></i>{d.status}</span></p><p className="mb-0 small">Nivel: <strong>{d.levelPct}%</strong></p></div></Popup>
                      </Marker>
                    );})}
                  </MapContainer>
                );
              })()}
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
              <button type="button" className="btn btn-primary" onClick={async () => {
                try {
                  await putJson('/mqtt-config', mqttConfig, props.session.token);
                  setShowMqttConfig(false);
                  alert('Configuración guardada');
                } catch (err) {
                  alert('Error al guardar configuración');
                }
              }}>
                <i className="fas fa-save mr-1"></i>Guardar
              </button>
            </div>
          </div>
        </div>
      </div>
      {showMqttConfig && <div className="modal-backdrop fade show" onClick={() => setShowMqttConfig(false)}></div>}

      <div className={`modal fade ${showCreateUserModal ? 'show' : ''}`} style={{ display: showCreateUserModal ? 'block' : 'none' }}>
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header bg-primary">
              <h4 className="modal-title"><i className="fas fa-user-plus mr-2"></i>Crear Usuario</h4>
              <button type="button" className="close text-white" onClick={() => setShowCreateUserModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="mb-3"><label className="form-label small fw-bold">Nombre</label><input className="form-control" value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} placeholder="Juan Perez" /></div>
              <div className="mb-3"><label className="form-label small fw-bold">Email</label><input className="form-control" type="email" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} placeholder="juan@cliente.com" /></div>
              <div className="mb-3"><label className="form-label small fw-bold">Rol</label>
                <select className="form-control" value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value as 'owner' | 'operator' | 'technician' }))}>
                  <option value="owner">Owner</option><option value="operator">Operator</option><option value="technician">Technician</option>
                </select>
              </div>
              <div className="mb-3"><label className="form-label small fw-bold">Contrasena</label><input className="form-control" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} /></div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowCreateUserModal(false)}>Cancelar</button>
              <button className="btn btn-primary fw-bold" onClick={() => void createUser()} disabled={creatingUser}>{creatingUser ? '...' : 'Crear Usuario'}</button>
            </div>
          </div>
        </div>
      </div>
      {showCreateUserModal && <div className="modal-backdrop fade show" onClick={() => setShowCreateUserModal(false)}></div>}

      <div className={`modal fade ${showEditUserModal ? 'show' : ''}`} style={{ display: showEditUserModal ? 'block' : 'none' }}>
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header bg-primary">
              <h4 className="modal-title"><i className="fas fa-user-edit mr-2"></i>Editar Usuario</h4>
              <button type="button" className="close text-white" onClick={() => setShowEditUserModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              {editingUser && (
                <>
                  <div className="mb-3"><label className="form-label small fw-bold">Nombre</label><input className="form-control" value={editingUser.name} onChange={e => setEditingUser(p => p ? { ...p, name: e.target.value } : null)} /></div>
                  <div className="mb-3"><label className="form-label small fw-bold">Email</label><input className="form-control" type="email" value={editingUser.email} onChange={e => setEditingUser(p => p ? { ...p, email: e.target.value } : null)} /></div>
                  <div className="mb-3"><label className="form-label small fw-bold">Rol</label>
                    <select className="form-control" value={editingUser.role} onChange={e => setEditingUser(p => p ? { ...p, role: e.target.value as 'owner' | 'operator' | 'technician' } : null)}>
                      <option value="owner">Owner</option><option value="operator">Operator</option><option value="technician">Technician</option>
                    </select>
                  </div>
                  {editingUser.role === 'owner' && (
                    <div className="alert alert-info mb-3">
                      <i className="fas fa-info-circle mr-1"></i> <strong>Acceso del cliente al panel:</strong><br/>
                      <span className="small text-muted">Usuario: {editingUser.email}</span><br/>
                      <a href={`/panel-cliente?tenant=${editingUser.tenantId}`} target="_blank" rel="noopener noreferrer" className="small">
                        <i className="fas fa-external-link-alt mr-1"></i>Abrir panel cliente
                      </a>
                    </div>
                  )}
                  <div className="mb-3"><label className="form-label small fw-bold">Nueva Contrasena <span className="text-muted">(opcional)</span></label><input className="form-control" value={editUserPassword} onChange={e => setEditUserPassword(e.target.value)} placeholder="Dejar vacio para mantener la actual" /></div>
                </>
              )}
            </div>
            <div className="modal-footer d-flex justify-content-between">
              <button type="button" className="btn btn-danger fw-bold" onClick={() => { if (editingUser) deleteUser(editingUser.id); }}>Eliminar Usuario</button>
              <div>
                <button type="button" className="btn btn-secondary me-2" onClick={() => setShowEditUserModal(false)}>Cancelar</button>
                <button className="btn btn-primary fw-bold ms-2" onClick={() => void saveUserEdit()}>Guardar Cambios</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {showEditUserModal && <div className="modal-backdrop fade show" onClick={() => setShowEditUserModal(false)}></div>}

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
  const { showToast } = useToast();

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
    if (current?.token) {
      setSession(current);
    }
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
          allowedRoles={['owner', 'operator', 'technician', 'client']}
          onAuthenticated={login}
        />
      );
    }
    if (session.user.role === 'company_admin') {
      return (
        <LoginPanel
          title="Este acceso es solo para usuarios de cliente"
          allowedRoles={['owner', 'operator', 'technician', 'client']}
          onAuthenticated={login}
        />
      );
    }
    return <ClientPanel session={session} onLogout={logout} />;
  }

  return <LandingPage />;
}
