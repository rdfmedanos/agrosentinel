import type { CSSProperties } from 'react';

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

export function App() {
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
          <p>
            Arquitectura modular para escalar sensores, tecnicos y sedes sin perder claridad operativa.
          </p>
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
        <a className="btn btn-primary" href="mailto:rdfmedanos@yahoo.com.ar">
          Solicitar implementacion
        </a>
      </section>
    </main>
  );
}
