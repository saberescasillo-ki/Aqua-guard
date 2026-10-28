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

   Nombres: en el código, "tinaco" es el depósito de arriba (en
   pantalla se llama CISTERNA) y "cisterna" es el depósito de abajo
   (en pantalla se llama ALJIBE).
   ========================================================= */
const TINACO_L = 1100;  // litros de la cisterna (depósito de arriba) para los resúmenes

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
      { at: 0, texto: 'Son las 07:30. La familia se levanta: duchas, cocina y lavabo. La cisterna baja por tandas.' },
      { at: 3, texto: 'Cada ESP32 mide su nivel con el sensor ultrasónico (calcula la distancia por el eco) y lo envía por wifi a la aplicación.' },
      { when: (st) => st.bomba, texto: 'La cisterna ha llegado al 25 %: el ESP32 Bomba activa el relé y la bomba sube agua del aljibe a la cisterna.' },
      { when: (st) => !st.bomba, texto: 'Cisterna al 95 %: la bomba se apaga sola.' },
      { after: 5, fin: true, texto: 'Así es un día normal: todo automático y sin ningún aviso.' },
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
      { at: 0, texto: 'Mediodía: en casa se gasta agua por tandas, como siempre.' },
      { at: 8, accion: (st) => { st.fuga = 0.6; }, texto: 'Se rompe una tubería después de la cisterna. El agua empieza a salir sin parar.' },
      { when: (st, res) => tieneAlerta(res, 'fuga'), texto: 'La aplicación nota que la cisterna baja SIN pausas (el uso normal siempre tiene pausas) y te avisa: «Posible fuga de agua».' },
      { after: 3, accion: (st) => { st.bloqueoUsuario = true; }, texto: 'Pulsas «Bloquear bomba» en la aplicación para no seguir gastando el agua del aljibe en la fuga.' },
      { after: 12, accion: (st, eng) => { st.fuga = 0; st.bloqueoUsuario = false; eng.clear('fuga'); }, texto: 'El fontanero repara la tubería. Marcas el aviso como revisado y la bomba vuelve a automático.' },
      { after: 6, fin: true, texto: (st) => `Resumen: la fuga ha tirado unos ${litros(st.perdida)} litros. Sin el aviso, la bomba habría seguido rellenando la cisterna hacia la fuga.` },
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
      { at: 0, texto: 'Son las 22:30. El modo noche se activa solo (horario de 22:00 a 06:00).' },
      { at: 5, texto: 'En modo noche la aplicación decide sola: no te pregunta nada, aplica las protecciones y solo te despierta si algo es urgente.' },
      { when: (st) => st.bomba, texto: 'Aprovecha la noche para llenar la cisterna al 100 % y dejarla lista para las duchas de la mañana.' },
      { when: (st) => !st.bomba, texto: 'Cisterna llena. Los avisos sin importancia (como «Aljibe lleno») se guardan en silencio.' },
      { when: (st) => st.t >= 450, fin: true, texto: 'Son las 06:00. Resumen de la noche: cisterna llena, aljibe recuperado con el agua de la red y ningún aviso urgente.' },
    ],
  },
  {
    id: 'sensor',
    nombre: 'Sensor averiado',
    inicio: { hora: '15:00', cisterna: 70, tinaco: 55, suministro: 0.1 },
    minPorTick: 1,
    duracion: 35,
    consumo: consumoDia,
    eventos: [
      { at: 0, texto: 'Tarde normal: los dos sensores informan bien.' },
      { at: 6, accion: (st) => { st.sensorT = false; }, texto: 'Al sensor ultrasónico de la cisterna le entra humedad y deja de responder (envía lecturas imposibles).' },
      { when: (st, res) => tieneAlerta(res, 'sensorT'), texto: 'Tras 2 lecturas imposibles la aplicación avisa «Sensor de la cisterna averiado» y bloquea la bomba: sin sensor no sabría cuándo apagarla y la cisterna rebosaría.' },
      { after: 10, accion: (st) => { st.sensorT = true; }, texto: 'Secas el sensor y revisas el cable.' },
      { when: (st, res) => !tieneAlerta(res, 'sensorT'), texto: 'Las lecturas vuelven a ser válidas: el aviso se quita solo y la bomba vuelve a automático.' },
      { after: 5, fin: true, texto: 'Consejo: usa sensores estancos (JSN-SR04T) dentro de los depósitos.' },
    ],
  },
  {
    id: 'llena',
    nombre: 'Aljibe lleno',
    inicio: { hora: '09:00', cisterna: 82, tinaco: 85, suministro: 0.8 },
    minPorTick: 1,
    duracion: 35,
    consumo: (st) => consumoDia(st) * 0.5,
    eventos: [
      { at: 0, texto: 'Llega el agua de la red de suministro y empieza a entrar en el aljibe.' },
      { when: (st, res) => tieneAlerta(res, 'llena'), texto: 'Al pasar del 95 % la aplicación te avisa «Aljibe lleno». Es solo informativo, no es ningún problema.' },
      { when: (st) => st.cisterna >= 100, accion: (st) => { st.suministro = 0; }, texto: 'La boya del aljibe cierra la entrada. Si el nivel siguiera subiendo, revisa la boya: podría rebosar.' },
      { after: 6, fin: true, texto: 'Con el aljibe lleno, la bomba puede trabajar tranquila varios días.' },
    ],
  },
  {
    id: 'vacia',
    nombre: 'Aljibe vacío',
    inicio: { hora: '13:00', cisterna: 22, tinaco: 30, suministro: 0 },
    minPorTick: 1,
    duracion: 45,
    consumo: consumoDia,
    eventos: [
      { at: 0, texto: 'Hoy no ha llegado agua de la red. El aljibe está bajo (22 %).' },
      { when: (st) => st.bomba, texto: 'La cisterna necesita agua y la bomba empieza a sacarla del aljibe.' },
      { when: (st, res) => tieneAlerta(res, 'vacia'), texto: 'El aljibe baja al 10 %: la aplicación bloquea la bomba para que no trabaje en seco (se quemaría el motor).' },
      { after: 8, accion: (st) => { st.suministro = 1.5; }, texto: 'Vuelve el agua de la red y el aljibe empieza a llenarse.' },
      { when: (st, res) => !tieneAlerta(res, 'vacia'), texto: 'Al pasar del 20 % se quita el bloqueo y la bomba vuelve a trabajar sola.' },
      { after: 6, fin: true, texto: 'Por eso el ESP32 Aljibe es importante: protege la bomba aunque nadie esté mirando.' },
    ],
  },
  {
    id: 'bomba',
    nombre: 'Bomba averiada',
    inicio: { hora: '18:00', cisterna: 80, tinaco: 32, suministro: 0.1 },
    minPorTick: 1,
    duracion: 45,
    consumo: consumoDia,
    eventos: [
      { at: 0, texto: 'Por la tarde: la cisterna está algo baja.' },
      { at: 2, accion: (st) => { st.bombaFunciona = false; }, texto: 'Sin que nadie se dé cuenta, el motor de la bomba se atasca.' },
      { when: (st) => st.bomba, texto: 'La cisterna llega al 25 % y el ESP32 activa el relé… pero el agua no sube.' },
      { when: (st, res) => tieneAlerta(res, 'bomba'), texto: 'Tras 5 minutos sin que la cisterna suba, la aplicación avisa «La bomba no funciona» y corta el relé para proteger el motor.' },
      { after: 8, accion: (st, eng) => { st.bombaFunciona = true; eng.clear('bomba'); }, texto: 'El técnico desatasca el impulsor. Marcas el aviso como revisado.' },
      { when: (st) => st.bomba, texto: 'La bomba vuelve a arrancar y esta vez la cisterna sí sube.' },
      { after: 6, fin: true, texto: 'Revisa también el diferencial y que la bomba esté cebada (con agua en el tubo de aspiración).' },
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
      { at: 0, texto: 'Son las 00:30 y el modo noche está activo. Todos duermen: el consumo debería ser cero.' },
      { at: 30, accion: (st) => { st.fuga = 0.3; }, texto: 'Se rompe el latiguillo del baño. Empieza a salir agua.' },
      { when: (st, res) => tieneAlerta(res, 'fugaNoche'), texto: 'En solo 10 minutos la aplicación nota que el nivel baja sin que nadie use agua. Como es de noche, actúa SOLA: bloquea la bomba.' },
      { after: 6, texto: 'Por ser urgente, este aviso sí suena aunque sea de noche (los leves se guardan en silencio).' },
      { when: (st) => st.t >= 330, fin: true, texto: (st) => `Son las 06:00. Al despertar ves el resumen: la cisterna ha perdido unos ${litros(st.perdida)} L, pero el aljibe sigue intacto (${Math.round(st.cisterna)} %) porque la bomba no ha seguido bombeando hacia la fuga.` },
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
    perdida: 0,       // % de cisterna perdido por fugas
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
      const flujo = Math.min(2.5 * dt, st.cisterna * 2);  // la cisterna es más pequeña: 1 % del aljibe ≈ 2 % de la cisterna
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
