/* Escenarios de simulación */
// at / after / when; textos en i18n
const TINACO_L = 1100;  // litros depósito arriba

const consumoDia = (st) => ((st.t % 12) < 5 ? 1.0 : 0);  // uso por tandas
const tieneAlerta = (res, id) => res.alerts.some((a) => a.id === id);
const litros = (pct) => Math.round((pct / 100) * TINACO_L);

const SCENARIOS = [
  {
    id: 'normal',
    inicio: { hora: '07:30', cisterna: 80, tinaco: 35, suministro: 0.15 },
    minPorTick: 1,
    duracion: 75,
    consumo: consumoDia,
    eventos: [
      { at: 0 },
      { at: 3 },
      { when: (st) => st.bomba },
      { when: (st) => !st.bomba },
      { after: 5, fin: true },
    ],
  },
  {
    id: 'fuga',
    inicio: { hora: '11:00', cisterna: 75, tinaco: 80, suministro: 0.1 },
    minPorTick: 1,
    duracion: 60,
    consumo: consumoDia,
    eventos: [
      { at: 0 },
      { at: 8, accion: (st) => { st.fuga = 0.6; } },
      { when: (st, res) => tieneAlerta(res, 'fuga') },
      { after: 3, accion: (st) => { st.bloqueoUsuario = true; } },
      { after: 12, accion: (st, eng) => { st.fuga = 0; st.bloqueoUsuario = false; eng.clear('fuga'); } },
      { after: 6, fin: true, vars: (st) => ({ litros: litros(st.perdida) }) },
    ],
  },
  {
    id: 'noche',
    inicio: { hora: '22:30', cisterna: 55, tinaco: 60, suministro: 0.25, noche: true },
    minPorTick: 5,
    duracion: 450,
    consumo: () => 0,
    eventos: [
      { at: 0 },
      { at: 5 },
      { when: (st) => st.bomba },
      { when: (st) => !st.bomba },
      { when: (st) => st.t >= 450, fin: true },
    ],
  },
  {
    id: 'sensor',
    inicio: { hora: '15:00', cisterna: 70, tinaco: 55, suministro: 0.1 },
    minPorTick: 1,
    duracion: 35,
    consumo: consumoDia,
    eventos: [
      { at: 0 },
      { at: 6, accion: (st) => { st.sensorT = false; } },
      { when: (st, res) => tieneAlerta(res, 'sensorT') },
      { after: 10, accion: (st) => { st.sensorT = true; } },
      { when: (st, res) => !tieneAlerta(res, 'sensorT') },
      { after: 5, fin: true },
    ],
  },
  {
    id: 'llena',
    inicio: { hora: '09:00', cisterna: 82, tinaco: 85, suministro: 0.8 },
    minPorTick: 1,
    duracion: 35,
    consumo: (st) => consumoDia(st) * 0.5,
    eventos: [
      { at: 0 },
      { when: (st, res) => tieneAlerta(res, 'llena') },
      { when: (st) => st.cisterna >= 100, accion: (st) => { st.suministro = 0; } },
      { after: 6, fin: true },
    ],
  },
  {
    id: 'vacia',
    inicio: { hora: '13:00', cisterna: 22, tinaco: 30, suministro: 0 },
    minPorTick: 1,
    duracion: 45,
    consumo: consumoDia,
    eventos: [
      { at: 0 },
      { when: (st) => st.bomba },
      { when: (st, res) => tieneAlerta(res, 'vacia') },
      { after: 8, accion: (st) => { st.suministro = 1.5; } },
      { when: (st, res) => !tieneAlerta(res, 'vacia') },
      { after: 6, fin: true },
    ],
  },
  {
    id: 'bomba',
    inicio: { hora: '18:00', cisterna: 80, tinaco: 32, suministro: 0.1 },
    minPorTick: 1,
    duracion: 45,
    consumo: consumoDia,
    eventos: [
      { at: 0 },
      { at: 2, accion: (st) => { st.bombaFunciona = false; } },
      { when: (st) => st.bomba },
      { when: (st, res) => tieneAlerta(res, 'bomba') },
      { after: 8, accion: (st, eng) => { st.bombaFunciona = true; eng.clear('bomba'); } },
      { when: (st) => st.bomba },
      { after: 6, fin: true },
    ],
  },
  {
    id: 'fugaNoche',
    inicio: { hora: '00:30', cisterna: 80, tinaco: 96, suministro: 0, noche: true },
    minPorTick: 3,
    duracion: 330,
    consumo: () => 0,
    eventos: [
      { at: 0 },
      { at: 30, accion: (st) => { st.fuga = 0.3; } },
      { when: (st, res) => tieneAlerta(res, 'fugaNoche') },
      { after: 6 },
      { when: (st) => st.t >= 330, fin: true, vars: (st) => ({ litros: litros(st.perdida), aljibe: Math.round(st.cisterna) }) },
    ],
  },
];

// Ejecutor de escenarios
function createSimRunner(scenario) {
  const [h, m] = scenario.inicio.hora.split(':').map(Number);
  const st = {
    t: 0,
    horaInicio: h * 60 + m,
    cisterna: scenario.inicio.cisterna,
    tinaco: scenario.inicio.tinaco,
    suministro: scenario.inicio.suministro || 0,
    noche: !!scenario.inicio.noche,
    bomba: false,
    bombaFunciona: true,
    sensorT: true,
    sensorC: true,
    fuga: 0,
    consumo: 0,
    bloqueoUsuario: false,
    perdida: 0,       // % perdido
    lectura: { tinaco: null, cisterna: null },
  };
  const engine = AquaEngine.create();
  let res = engine.update(lecturas());
  let siguiente = 0;
  let ultimoEvento = 0;
  let terminado = false;

  function lecturas() {
    st.lectura.tinaco = st.sensorT ? round(st.tinaco) : -1;  // -1 = sin eco
    st.lectura.cisterna = st.sensorC ? round(st.cisterna) : -1;
    return { t: st.t, tinaco: st.lectura.tinaco, cisterna: st.lectura.cisterna, bomba: st.bomba, noche: st.noche };
  }

  function round(v) { return Math.round(v * 10) / 10; }
  function clamp(v) { return Math.max(0, Math.min(100, v)); }

  // Lógica ESP32 Bomba
  function controlarBomba() {
    if (res.lock.length || st.bloqueoUsuario) { st.bomba = false; return; }
    const nivel = st.lectura.tinaco;
    if (nivel < 0) return;
    const encender = st.noche ? 85 : 25;
    const apagar = st.noche ? 100 : 95;
    if (!st.bomba && nivel <= encender) st.bomba = true;
    else if (st.bomba && nivel >= apagar) st.bomba = false;
  }

  function fisica(dt) {
    st.consumo = scenario.consumo(st);
    const salida = Math.min(st.tinaco, (st.consumo + st.fuga) * dt);
    st.perdida += st.tinaco > 0 ? Math.min(st.fuga * dt, salida) : 0;
    st.tinaco -= salida;
    if (st.bomba && st.bombaFunciona && st.cisterna > 0) {
      const flujo = Math.min(2.5 * dt, st.cisterna * 2);  // arriba es menor
      st.tinaco += flujo;
      st.cisterna -= flujo / 2;
    }
    st.cisterna += st.suministro * dt;
    st.tinaco = clamp(st.tinaco);
    st.cisterna = clamp(st.cisterna);
  }

  function evento(ev) {
    if (ev.at !== undefined) return st.t >= ev.at;
    if (ev.after !== undefined) return st.t >= ultimoEvento + ev.after;
    return ev.when(st, res);
  }

  // Siguiente evento
  function revisarEvento() {
    const ev = scenario.eventos[siguiente];
    if (!ev || !evento(ev)) return null;
    if (ev.accion) ev.accion(st, engine);
    if (ev.accion) res = engine.update(lecturas());  // aplicar ya
    ultimoEvento = st.t;
    siguiente += 1;
    if (ev.fin) terminado = true;
    return { ...ev, indice: siguiente - 1, vars: ev.vars ? ev.vars(st) : {} };
  }

  // Un paso
  function step() {
    if (terminado) return { evento: null, res };
    const dt = scenario.minPorTick;
    controlarBomba();
    fisica(dt);
    st.t += dt;
    res = engine.update(lecturas());
    controlarBomba();
    return { evento: revisarEvento(), res };
  }

  function hora() {
    const total = (st.horaInicio + st.t) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(Math.floor(total % 60)).padStart(2, '0')}`;
  }

  return {
    st, step, hora, revisarEvento,
    get res() { return res; },
    get terminado() { return terminado; },
    get progreso() { return Math.min(1, st.t / scenario.duracion); },
    get bloqueada() { return res.lock.length > 0 || st.bloqueoUsuario; },
  };
}

if (typeof module !== 'undefined') module.exports = { SCENARIOS, createSimRunner };
