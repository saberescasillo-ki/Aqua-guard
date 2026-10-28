/* =========================================================
   Aqua Guard Beta — Menú de tres rayas y enlace de los ajustes
   ========================================================= */
const APP_VERSION = '0.2.0-beta';

(() => {
  const drawer = document.getElementById('drawer');
  const backdrop = document.getElementById('drawer-backdrop');

  function showPage(name) {
    drawer.querySelectorAll('.drawer-page').forEach((p) => { p.hidden = p.dataset.page !== name; });
    drawer.scrollTop = 0;
  }

  function open() {
    showPage('menu');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    backdrop.hidden = false;
  }

  function close() {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    backdrop.hidden = true;
  }

  document.getElementById('btn-menu').addEventListener('click', open);
  backdrop.addEventListener('click', close);
  drawer.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  // data-back sin valor vuelve a la lista principal; con valor, a esa página (ej. las subopciones de "...")
  drawer.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => showPage(b.dataset.back || 'menu')));
  drawer.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => showPage(b.dataset.open)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  /* ---- Enlaza cualquier control con data-setting a Settings ---- */
  const parse = (el, v) => (el.dataset.type === 'number' ? Number(v) : v);

  // Grupos de radio: el contenedor lleva data-setting
  document.querySelectorAll('[data-setting]:not(input)').forEach((group) => {
    const key = group.dataset.setting;
    const radios = group.querySelectorAll('input[type="radio"]');
    const sync = () => radios.forEach((r) => { r.checked = String(Settings.get(key)) === r.value; });
    radios.forEach((r) => r.addEventListener('change', () => Settings.set(key, parse(group, r.value))));
    Settings.onChange((k) => { if (k === key) sync(); });
    sync();
  });

  // Casillas y campos sueltos
  document.querySelectorAll('input[data-setting]').forEach((input) => {
    const key = input.dataset.setting;
    if (input.type === 'checkbox') {
      input.checked = !!Settings.get(key);
      input.addEventListener('change', () => Settings.set(key, input.checked));
    } else {
      input.value = Settings.get(key);
      input.addEventListener('change', () => {
        const v = parse(input, input.value);
        if (input.dataset.type === 'number' && !(v > 0)) { input.value = Settings.get(key); return; }
        Settings.set(key, v);
      });
    }
  });

  /* ---- Versión ---- */
  const cap = window.Capacitor;
  const platform = cap && cap.isNativePlatform && cap.isNativePlatform()
    ? (cap.getPlatform() === 'ios' ? 'iPhone / iPad' : 'Android')
    : (navigator.userAgent.includes('Electron') ? 'Ordenador (escritorio)' : 'Navegador web');
  document.getElementById('app-version').textContent = APP_VERSION;
  document.getElementById('app-platform').textContent = platform;
})();
