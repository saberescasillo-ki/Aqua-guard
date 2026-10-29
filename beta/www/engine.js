/* Motor de detección */
// tinaco = arriba, cisterna = abajo
const AquaEngine = (() => {
  const DEFAULTS = {
    vaciaOn: 10, vaciaOff: 20,        // aljibe vacío
    llenaOn: 95, llenaOff: 90,        // aljibe lleno
    saltoMax: 25,                     // salto = sensor raro
    lecturasMalas: 2,                 // fallos antes de avisar
    bombaMin: 5, bombaSubida: 2,      // bomba sin subir
    fugaDia:   { ventana: 20, caida: 6 },   // minutos / % caída
    fugaNoche: { ventana: 10, caida: 1.5 },
    pausaMin: 3,                      // pausa = uso normal
    pausaEps: 0.4,                    // margen sin cambio
    historialMin: 60,
  };

  // Gravedad (textos en i18n)
  const NIVELES = {
    fuga: 'danger', fugaNoche: 'danger', sensorT: 'warn', sensorC: 'warn',
    vacia: 'danger', llena: 'info', bomba: 'danger',
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

    // true / false / sin datos
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
      if (!muestras.length || hist[0].t > desde + 0.1 * p.ventana) return false;  // falta historial
      if (muestras.some((h) => h.bomba || h.tinaco === null)) return false;
      if (muestras[0].tinaco - muestras[muestras.length - 1].tinaco < p.caida) return false;
      // Pausa = no fuga
      let ancla = muestras[0];
      for (const h of muestras) {
        if (h.tinaco > ancla.tinaco + cfg.pausaEps) return false;  // subió, no fuga
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

      // Aljibe vacío / lleno
      if (cisterna !== null) {
        toggle('vacia', cisterna <= cfg.vaciaOn, cisterna >= cfg.vaciaOff);
        toggle('llena', cisterna >= cfg.llenaOn, cisterna < cfg.llenaOff);
      }

      // Bomba averiada
      if (s.bomba && tinaco !== null) {
        if (bombaDesde === null) { bombaDesde = s.t; tinacoInicio = tinaco; }
        if (s.t - bombaDesde >= cfg.bombaMin && tinaco - tinacoInicio < cfg.bombaSubida) activas.add('bomba');
      } else if (!s.bomba) {
        bombaDesde = null;
      }

      // Fuga hasta revisar
      if (!activas.has('fuga') && !activas.has('fugaNoche') && hayFuga(s)) {
        activas.add(s.noche ? 'fugaNoche' : 'fuga');
      }
      // Noche: fuga automática
      if (s.noche && activas.has('fuga')) { activas.delete('fuga'); activas.add('fugaNoche'); }

      const lock = [];
      if (activas.has('vacia')) lock.push('vacia');
      if (activas.has('bomba')) lock.push('bomba');
      if (activas.has('sensorT') || activas.has('sensorC')) lock.push('sensor');
      if (activas.has('fugaNoche')) lock.push('fuga');

      ultimo = { alerts: [...activas].map((id) => ({ id, level: NIVELES[id] })), lock };
      return ultimo;
    }

    function toggle(id, encender, apagar) {
      if (encender) activas.add(id);
      else if (apagar) activas.delete(id);
    }

    // Marcar como revisado
    function clear(id) {
      activas.delete(id);
      if (id === 'fuga' || id === 'fugaNoche') { activas.delete('fuga'); activas.delete('fugaNoche'); hist = []; }
      if (id === 'bomba') bombaDesde = null;
    }

    reset();
    return { update, clear, reset, get state() { return ultimo; } };
  }

  return { create, NIVELES };
})();
