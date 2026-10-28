/* =========================================================
   Aqua Guard Beta — Motor de detección
   ---------------------------------------------------------
   Lo usan el Panel (datos reales de los ESP32) y la Simulación,
   así el tutorial muestra exactamente lo que haría la app.

   update() recibe una lectura:
     { t: minutos, cisterna: %, tinaco: %, bomba: bool, noche: bool }
   (en el código "tinaco" = depósito de arriba, en pantalla CISTERNA;
    "cisterna" = depósito de abajo, en pantalla ALJIBE)
   (un nivel null / negativo / >100 cuenta como lectura dañada)
   y devuelve { alerts: [...], lock: [...] }:
     alerts → avisos activos { id, level: info|warn|danger, title, msg }
     lock   → motivos por los que la bomba debe quedar bloqueada
   ========================================================= */
const AquaEngine = (() => {
  const DEFAULTS = {
    vaciaOn: 10, vaciaOff: 20,        // % aljibe: bloquear / desbloquear
    llenaOn: 95, llenaOff: 90,        // % aljibe: aviso de lleno
    saltoMax: 25,                     // % de salto entre lecturas = sensor errático
    lecturasMalas: 2,                 // lecturas malas seguidas para avisar
    bombaMin: 5, bombaSubida: 2,      // si en 5 min con la bomba encendida la cisterna no sube 2 %, está averiada
    fugaDia:   { ventana: 20, caida: 6 },   // minutos / % de caída sin pausas
    fugaNoche: { ventana: 10, caida: 1.5 },
    pausaMin: 3,                      // una pausa de 3 min sin bajar = consumo normal, no fuga
    pausaEps: 0.4,                    // % de tolerancia para considerar "sin cambio"
    historialMin: 60,
  };

  const ALERTAS = {
    fuga:      { level: 'danger', title: 'Posible fuga de agua', msg: 'La cisterna baja sin parar aunque la bomba está apagada.' },
    fugaNoche: { level: 'danger', title: 'Fuga detectada (modo noche)', msg: 'De noche nadie usa agua y la cisterna sigue bajando. Bomba bloqueada automáticamente.' },
    sensorT:   { level: 'warn', title: 'Sensor de la cisterna averiado', msg: 'Lecturas imposibles o sin respuesta. La bomba se bloquea por seguridad.' },
    sensorC:   { level: 'warn', title: 'Sensor del aljibe averiado', msg: 'Lecturas imposibles o sin respuesta. Sin él no hay protección contra marcha en seco.' },
    vacia:     { level: 'danger', title: 'Aljibe vacío', msg: 'Bomba bloqueada para que no trabaje en seco.' },
    llena:     { level: 'info', title: 'Aljibe lleno', msg: 'El aljibe está a su máxima capacidad.' },
    bomba:     { level: 'danger', title: 'La bomba no funciona', msg: 'El relé está activado pero la cisterna no sube. Bomba apagada para proteger el motor.' },
  };

  function create(options = {}) {
    const cfg = { ...DEFAULTS, ...options };
    let hist, malas, previo, activas, bombaDesde, tinacoInicio, ultimo;

    function reset() {
      hist = [];
      malas = { tinaco: 0, cisterna: 0 };
      previo = { tinaco: null, cisterna: null };
      activas = new Set();
      bombaDesde = null;
      tinacoInicio = null;
      ultimo = { alerts: [], lock: [] };
    }

    // true = lectura buena, false = dañada, undefined = sin datos (ESP32 desconectado)
    function valida(nombre, v) {
      if (v === undefined) return undefined;
      const enRango = typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
      const mala = !enRango || (previo[nombre] !== null && Math.abs(v - previo[nombre]) > cfg.saltoMax);
      previo[nombre] = enRango ? v : null;
      malas[nombre] = mala ? malas[nombre] + 1 : 0;
      return !mala;
    }

    function hayFuga(s) {
      const p = s.noche ? cfg.fugaNoche : cfg.fugaDia;
      const desde = s.t - p.ventana;
      const muestras = hist.filter((h) => h.t >= desde);
      if (!muestras.length || hist[0].t > desde + 0.1 * p.ventana) return false;  // aún sin historial suficiente
      if (muestras.some((h) => h.bomba || h.tinaco === null)) return false;
      if (muestras[0].tinaco - muestras[muestras.length - 1].tinaco < p.caida) return false;
      // Si hubo una pausa (nivel quieto unos minutos) es consumo normal por tandas
      let ancla = muestras[0];
      for (const h of muestras) {
        if (h.tinaco > ancla.tinaco + cfg.pausaEps) return false;  // subió: no es fuga
        if (ancla.tinaco - h.tinaco >= cfg.pausaEps) ancla = h;
        else if (h.t - ancla.t >= cfg.pausaMin) return false;
      }
      return true;
    }

    function update(s) {
      const okT = valida('tinaco', s.tinaco);
      const okC = valida('cisterna', s.cisterna);
      const tinaco = okT === true ? s.tinaco : null;
      const cisterna = okC === true ? s.cisterna : null;

      hist.push({ t: s.t, tinaco, bomba: !!s.bomba });
      while (hist.length && hist[0].t < s.t - cfg.historialMin) hist.shift();

      // Sensores
      toggle('sensorT', okT === false && malas.tinaco >= cfg.lecturasMalas, okT !== false);
      toggle('sensorC', okC === false && malas.cisterna >= cfg.lecturasMalas, okC !== false);

      // Cisterna vacía / llena (con histéresis)
      if (cisterna !== null) {
        toggle('vacia', cisterna <= cfg.vaciaOn, cisterna >= cfg.vaciaOff);
        toggle('llena', cisterna >= cfg.llenaOn, cisterna < cfg.llenaOff);
      }

      // Bomba que no sube el agua
      if (s.bomba && tinaco !== null) {
        if (bombaDesde === null) { bombaDesde = s.t; tinacoInicio = tinaco; }
        if (s.t - bombaDesde >= cfg.bombaMin && tinaco - tinacoInicio < cfg.bombaSubida) activas.add('bomba');
      } else if (!s.bomba) {
        bombaDesde = null;
      }

      // Fuga: se queda activa hasta que alguien la marque como revisada
      if (!activas.has('fuga') && !activas.has('fugaNoche') && hayFuga(s)) {
        activas.add(s.noche ? 'fugaNoche' : 'fuga');
      }
      // Si se activa el modo noche con una fuga ya detectada, pasa a modo automático
      if (s.noche && activas.has('fuga')) { activas.delete('fuga'); activas.add('fugaNoche'); }

      const lock = [];
      if (activas.has('vacia')) lock.push('vacia');
      if (activas.has('bomba')) lock.push('bomba');
      if (activas.has('sensorT') || activas.has('sensorC')) lock.push('sensor');
      if (activas.has('fugaNoche')) lock.push('fuga');

      ultimo = { alerts: [...activas].map((id) => ({ id, ...ALERTAS[id] })), lock };
      return ultimo;
    }

    function toggle(id, encender, apagar) {
      if (encender) activas.add(id);
      else if (apagar) activas.delete(id);
    }

    /** Marca un aviso como revisado (ej. el plomero reparó la fuga). */
    function clear(id) {
      activas.delete(id);
      if (id === 'fuga' || id === 'fugaNoche') { activas.delete('fuga'); activas.delete('fugaNoche'); hist = []; }
      if (id === 'bomba') bombaDesde = null;
    }

    reset();
    return { update, clear, reset, get state() { return ultimo; } };
  }

  return { create, ALERTAS };
})();
