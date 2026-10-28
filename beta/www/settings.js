/* =========================================================
   Aqua Guard Beta — Ajustes (se guardan en el dispositivo)
   ========================================================= */
const Settings = (() => {
  const KEY = 'aquaguard-beta.settings';
  const DEFAULTS = {
    // Apariencia
    fontSize: 'normal',      // pequena | normal | grande | muy-grande
    color: 'marino',         // marino | petroleo | morado | vino | grafito
    theme: 'claro',          // claro | oscuro
    // Simulación
    simSpeed: 1,             // 0.5 | 1 | 2 | 4
    simPausa: true,          // pausar un momento en cada paso para leer
    simLoop: false,          // repetir el escenario al terminar
    simNotifs: true,         // mostrar las notificaciones del móvil simulado
    // Forma de leer los datos
    unidad: 'porcentaje',    // porcentaje | litros | centimetros
    capCisterna: 5000,       // litros del aljibe (depósito de abajo)
    capTinaco: 1100,         // litros de la cisterna (depósito de arriba)
    intervalo: 2000,         // ms entre lecturas
    fuente: 'auto',          // auto | cisterna | bomba
    // Conexión y operación
    ipCisterna: '',
    ipBomba: '',
    modoNoche: 'auto',       // apagado | encendido | auto (22:00 – 06:00)
  };

  const FONT_PX = { pequena: 14, normal: 16, grande: 18, 'muy-grande': 20 };
  const listeners = [];
  let data = load();

  function load() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; }
    catch { return { ...DEFAULTS }; }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* modo privado */ }
  }

  function get(key) { return data[key]; }

  function set(key, value) {
    if (data[key] === value) return;
    data[key] = value;
    save();
    apply();
    listeners.forEach((fn) => fn(key, value));
  }

  function onChange(fn) { listeners.push(fn); }

  function apply() {
    const root = document.documentElement;
    root.dataset.theme = data.theme;
    root.dataset.color = data.color;
    root.style.fontSize = `${FONT_PX[data.fontSize] || 16}px`;
  }

  apply();
  return { get, set, onChange, DEFAULTS };
})();
