/* =========================================================
   Aqua Guard Beta — Escenarios de la simulación
   ---------------------------------------------------------
   Cada escenario arranca con un estado inicial y una lista de
   eventos que se disparan EN ORDEN. Un evento se dispara cuando:
     at:    llega ese minuto de la simulación
     after: pasan N minutos desde el evento anterior
     when:  se cumple una condición  (st = estado, res = motor)
   "accion" cambia el mundo simulado (romper un tubo, reparar…).
   "texto" puede ser una función para mostrar datos calculados.
   El último evento lleva fin: true.

   Unidades: niveles en %, caudales en % por minuto.
   ========================================================= */
const TINACO_L = 1100;  // litros de referencia para los resúmenes

const consumoDia = (st) => ((st.t % 12) < 5 ? 1.0 : 0);  // tandas: 5 min usando agua, 7 min sin usar
const tieneAlerta = (res, id) => res.alerts.some((a) => a.id === id);
const litros = (pct) => Math.round((pct / 100) * TINACO_L);

const SCENARIOS = [
  {
    id: 'normal',
    nombre: 'Funcionamiento normal',
    inicio: { hora: '07:30', cisterna: 80, tinaco: 35, suministro: 0.15 },
    minPorTick: 1,
    duracion: 75,
    consumo: consumoDia,
    eventos: [
      { at: 0, texto: '☀️ 7:30 a. m. La familia se levanta: duchas, cocina y lavabo. El tinaco baja por tandas.' },
      { at: 3, texto: '📡 Cada ESP32 mide su nivel con el sensor ultrasónico (calcula la distancia por el eco) y lo envía por WiFi a la app.' },
      { when: (st) => st.bomba, texto: '🔌 El tinaco llegó al 25 %: el ESP32 Bomba activa el relé y la bomba sube agua de la cisterna al tinaco.' },
      { when: (st) => !st.bomba, texto: '✅ Tinaco al 95 %: la bomba se apaga sola.' },
      { after: 5, fin: true, texto: '👍 Así es un día normal: todo automático y sin ninguna alerta.' },
    ],
  },
  {
    id: 'fuga',
    nombre: 'Fuga de agua',
    inicio: { hora: '11:00', cisterna: 75, tinaco: 80, suministro: 0.1 },
    minPorTick: 1,
    duracion: 60,
    consumo: consumoDia,
    eventos: [
      { at: 0, texto: '🏠 Mediodía: la casa usa agua por tandas, como siempre.' },
      { at: 8, accion: (st) => { st.fuga = 0.6; }, texto: '💧 Se rompe una tubería después del tinaco. El agua empieza a salir sin parar.' },
      { when: (st, res) => tieneAlerta(res, 'fuga'), texto: '📱 La app nota que el tinaco baja SIN pausas (el uso normal siempre tiene pausas) y te manda: “Posible fuga de agua”.' },
      { after: 3, accion: (st) => { st.bloqueoUsuario = true; }, texto: '👆 Tú tocas “Bloquear bomba” en la app para no seguir gastando el agua de la cisterna en la fuga.' },
      { after: 12, accion: (st, eng) => { st.fuga = 0; st.bloqueoUsuario = false; eng.clear('fuga'); }, texto: '🔧 El plomero repara la tubería. Marcas la alerta como revisada y la bomba vuelve a automático.' },
      { after: 6, fin: true, texto: (st) => `📊 Resumen: la fuga tiró unos ${litros(st.perdida)} litros. Sin el aviso, la bomba habría seguido rellenando el tinaco hacia la fuga.` },
    ],
  },
  {
    id: 'noche',
    nombre: 'Modo noche',
    inicio: { hora: '22:30', cisterna: 55, tinaco: 60, suministro: 0.25, noche: true },
    minPorTick: 5,
    duracion: 450,
    consumo: () => 0,
    eventos: [
      { at: 0, texto: '🌙 22:30. El modo noche se activa solo (horario 22:00 – 06:00).' },
      { at: 5, texto: '🤖 En modo noche la app decide sola: no te pregunta nada, aplica las protecciones y solo te despierta si algo es urgente.' },
      { when: (st) => st.bomba, texto: '⛽ Aprovecha la noche para llenar el tinaco al 100 % y dejarlo listo para las duchas de la mañana.' },
      { when: (st) => !st.bomba, texto: '🔕 Tinaco lleno. Los avisos sin importancia (como “Cisterna llena”) se guardan en silencio.' },
      { when: (st) => st.t >= 450, fin: true, texto: '☀️ 6:00 a. m. Resumen de la noche: tinaco lleno, cisterna recuperada con el agua de la red y 0 alertas urgentes.' },
    ],
  },
  {
    id: 'sensor',
    nombre: 'Sensor dañado',
    inicio: { hora: '15:00', cisterna: 70, tinaco: 55, suministro: 0.1 },
    minPorTick: 1,
    duracion: 35,
    consumo: consumoDia,
    eventos: [
      { at: 0, texto: '🏠 Tarde normal: los dos sensores reportan bien.' },
      { at: 6, accion: (st) => { st.sensorT = false; }, texto: '⚡ Al sensor ultrasónico del tinaco le entra humedad y deja de responder (manda lecturas imposibles).' },
      { when: (st, res) => tieneAlerta(res, 'sensorT'), texto: '📱 Tras 2 lecturas imposibles la app avisa “Sensor del tinaco dañado” y bloquea la bomba: sin sensor no sabría cuándo apagarla y el tinaco se desbordaría.' },
      { after: 10, accion: (st) => { st.sensorT = true; }, texto: '🔧 Secas el sensor y revisas el cable.' },
      { when: (st, res) => !tieneAlerta(res, 'sensorT'), texto: '✅ Las lecturas vuelven a ser válidas: la alerta se quita sola y la bomba regresa a automático.' },
      { after: 5, fin: true, texto: '💡 Consejo: usa sensores a prueba de agua (JSN-SR04T) dentro de los tanques.' },
    ],
  },
  {
    id: 'llena',
    nombre: 'Cisterna llena',
    inicio: { hora: '09:00', cisterna: 82, tinaco: 85, suministro: 0.8 },
    minPorTick: 1,
    duracion: 35,
    consumo: (st) => consumoDia(st) * 0.5,
    eventos: [
      { at: 0, texto: '🚰 Llega el agua de la red municipal y empieza a entrar a la cisterna.' },
      { when: (st, res) => tieneAlerta(res, 'llena'), texto: '📱 Al pasar el 95 % la app te avisa “Cisterna llena”. Es solo informativo, no es un problema.' },
      { when: (st) => st.cisterna >= 100, accion: (st) => { st.suministro = 0; }, texto: '🎈 El flotador de la cisterna cierra la entrada. Si el nivel siguiera subiendo, revisa el flotador: podría desbordarse.' },
      { after: 6, fin: true, texto: '✅ Con la cisterna llena la bomba puede trabajar tranquila varios días.' },
    ],
  },
  {
    id: 'vacia',
    nombre: 'Cisterna vacía',
    inicio: { hora: '13:00', cisterna: 22, tinaco: 30, suministro: 0 },
    minPorTick: 1,
    duracion: 45,
    consumo: consumoDia,
    eventos: [
      { at: 0, texto: '🚱 Hoy no llegó agua de la red. La cisterna está baja (22 %).' },
      { when: (st) => st.bomba, texto: '🔌 El tinaco necesita agua y la bomba empieza a sacarla de la cisterna.' },
      { when: (st, res) => tieneAlerta(res, 'vacia'), texto: '🛑 La cisterna baja al 10 %: la app bloquea la bomba para que no trabaje en seco (se quemaría el motor).' },
      { after: 8, accion: (st) => { st.suministro = 1.5; }, texto: '🚰 Regresa el agua de la red y la cisterna se empieza a llenar.' },
      { when: (st, res) => !tieneAlerta(res, 'vacia'), texto: '✅ Al pasar el 20 % se quita el bloqueo y la bomba vuelve a trabajar sola.' },
      { after: 6, fin: true, texto: '💡 Por eso el ESP32 Cisterna es importante: protege a la bomba aunque nadie esté viendo.' },
    ],
  },
  {
    id: 'bomba',
    nombre: 'Bomba no funciona',
    inicio: { hora: '18:00', cisterna: 80, tinaco: 32, suministro: 0.1 },
    minPorTick: 1,
    duracion: 45,
    consumo: consumoDia,
    eventos: [
      { at: 0, texto: '🏠 Tarde: el tinaco está algo bajo.' },
      { at: 2, accion: (st) => { st.bombaFunciona = false; }, texto: '⚙️ Sin que nadie lo note, el motor de la bomba se atasca.' },
      { when: (st) => st.bomba, texto: '🔌 El tinaco llega al 25 % y el ESP32 activa el relé… pero el agua no sube.' },
      { when: (st, res) => tieneAlerta(res, 'bomba'), texto: '📱 Tras 5 minutos sin que el tinaco suba, la app avisa “La bomba no funciona” y corta el relé para proteger el motor.' },
      { after: 8, accion: (st, eng) => { st.bombaFunciona = true; eng.clear('bomba'); }, texto: '🔧 El técnico libera el impulsor. Marcas la alerta como revisada.' },
      { when: (st) => st.bomba, texto: '✅ La bomba vuelve a encender y esta vez el tinaco sí sube.' },
      { after: 6, fin: true, texto: '💡 Revisa también el breaker y que la bomba esté cebada (con agua en el tubo de succión).' },
    ],
  },
  {
    id: 'fugaNoche',
    nombre: 'Fuga + modo noche',
    inicio: { hora: '00:30', cisterna: 80, tinaco: 96, suministro: 0, noche: true },
    minPorTick: 3,
    duracion: 330,
    consumo: () => 0,
    eventos: [
      { at: 0, texto: '🌙 00:30, modo noche activo. Todos duermen: el consumo debería ser cero.' },
      { at: 30, accion: (st) => { st.fuga = 0.3; }, texto: '💧 Se rompe la manguera del baño. Empieza a salir agua.' },
      { when: (st, res) => tieneAlerta(res, 'fugaNoche'), texto: '🤖 En solo 10 minutos la app nota que el nivel baja sin que nadie use agua. Como es de noche, actúa SOLA: bloquea la bomba.' },
      { after: 6, texto: '📳 Por ser urgente, esta alerta sí suena aunque sea de noche (las leves se guardan en silencio).' },
      { when: (st) => st.t >= 330, fin: true, texto: (st) => `☀️ 6:00 a. m. Al despertar ves el resumen: el tinaco perdió unos ${litros(st.perdida)} L, pero la cisterna quedó intacta (${Math.round(st.cisterna)} %) porque la bomba no siguió bombeando hacia la fuga.` },
    ],
  },
];

/* ---------------------------------------------------------
   Ejecutor: avanza la física minuto a minuto y consulta al
   motor de detección (el mismo que usa el Panel real).
   --------------------------------------------------------- */
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
    perdida: 0,       // % de tinaco perdido por fugas
    lectura: { tinaco: null, cisterna: null },
  };
  const engine = AquaEngine.create();
  let res = engine.update(lecturas());
  let siguiente = 0;
  let ultimoEvento = 0;
  let terminado = false;

  function lecturas() {
    st.lectura.tinaco = st.sensorT ? round(st.tinaco) : -1;  // -1 = el sensor no recibe eco
    st.lectura.cisterna = st.sensorC ? round(st.cisterna) : -1;
    return { t: st.t, tinaco: st.lectura.tinaco, cisterna: st.lectura.cisterna, bomba: st.bomba, noche: st.noche };
  }

  function round(v) { return Math.round(v * 10) / 10; }
  function clamp(v) { return Math.max(0, Math.min(100, v)); }

  // Lógica del ESP32 Bomba (en modo noche llena hasta el 100 %)
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
      const flujo = Math.min(2.5 * dt, st.cisterna * 2);  // el tinaco es más chico: 1 % de cisterna ≈ 2 % de tinaco
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

  /** Dispara el siguiente evento si toca; devuelve el evento disparado o null. */
  function revisarEvento() {
    const ev = scenario.eventos[siguiente];
    if (!ev || !evento(ev)) return null;
    if (ev.accion) ev.accion(st, engine);
    if (ev.accion) res = engine.update(lecturas());  // refleja el cambio en este mismo paso
    ultimoEvento = st.t;
    siguiente += 1;
    if (ev.fin) terminado = true;
    return { ...ev, indice: siguiente - 1, texto: typeof ev.texto === 'function' ? ev.texto(st) : ev.texto };
  }

  /** Un paso de simulación. Devuelve { evento, res }. */
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
