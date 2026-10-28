/* =========================================================
   Aqua Guard Beta — Panel y conexión con los ESP32
   ---------------------------------------------------------
   Cada ESP32 expone (ver carpeta /firmware del repositorio):
     GET http://<IP>/api/status                 -> JSON con sus datos
     GET http://<IP>/api/bomba?modo=on|off|auto -> solo ESP32 Bomba
   ========================================================= */
const REQUEST_TIMEOUT_MS = 1500;
const DEFAULT_AP_IP = '192.168.4.1';  // IP de un ESP32 en modo punto de acceso

const $ = (sel) => document.querySelector(sel);

const devices = {
  cisterna: { online: false, data: {} },
  bomba: { online: false, data: {} },
};
const engine = AquaEngine.create();
let pollTimer = null;
let polling = false;
let bloqueoUsuario = false;
let bloqueoAplicado = false;   // la app apagó la bomba por un bloqueo
let nocheAnterior = null;
let alertasPrevias = new Set();

/* ---------------- Red ---------------- */
function baseUrl(ip) {
  return ip.startsWith('http') ? ip.replace(/\/$/, '') : `http://${ip}`;
}

async function fetchJson(ip, path) {
  const ctrl = new AbortController();
  let timer;
  // En la app nativa fetch va por HTTP nativo y puede ignorar la cancelación,
  // así que el tiempo límite también se aplica aquí.
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { ctrl.abort(); reject(new Error('timeout')); }, REQUEST_TIMEOUT_MS);
  });
  const request = (async () => {
    const res = await fetch(baseUrl(ip) + path, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function debeLeer(nombre) {
  const fuente = Settings.get('fuente');
  return fuente === 'auto' || fuente === nombre;
}

async function pollDevice(nombre) {
  const dev = devices[nombre];
  const ip = Settings.get(nombre === 'cisterna' ? 'ipCisterna' : 'ipBomba');
  const estaba = dev.online;
  if (!ip || !debeLeer(nombre)) { dev.online = false; return; }
  try {
    dev.data = await fetchJson(ip, '/api/status');
    dev.online = true;
    if (!estaba) log(`ESP32 ${nombre} conectado (${ip})`);
  } catch {
    dev.online = false;
    if (estaba) log(`ESP32 ${nombre} dejó de responder`);
  }
}

async function pollAll() {
  if (polling) return;  // evita acumular peticiones si un ESP32 tarda
  polling = true;
  try {
    await Promise.all([pollDevice('cisterna'), pollDevice('bomba')]);
    revisar();
  } finally {
    polling = false;
  }
  render();
}

function startPolling() {
  stopPolling();
  pollAll();
  pollTimer = setInterval(pollAll, Number(Settings.get('intervalo')) || 2000);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

/** Prueba las IPs y asigna cada una según el "device" que responde el ESP32. */
async function scan(candidates) {
  const found = {};
  await Promise.all([...new Set(candidates.filter(Boolean))].map(async (ip) => {
    try {
      const data = await fetchJson(ip, '/api/status');
      if (data.device === 'cisterna' || data.device === 'bomba') found[data.device] = ip;
    } catch { /* no responde */ }
  }));
  return found;
}

async function setPump(modo, motivo) {
  const ip = Settings.get('ipBomba');
  if (!ip) { log('Configura primero la IP del ESP32 Bomba'); return false; }
  try {
    await fetchJson(ip, `/api/bomba?modo=${modo}`);
    log(`Bomba → ${modo.toUpperCase()}${motivo ? ` (${motivo})` : ''}`);
    return true;
  } catch {
    log('No se pudo enviar la orden a la bomba');
    return false;
  }
}

/* ---------------- Modo noche y protecciones ---------------- */
function esNoche() {
  const modo = Settings.get('modoNoche');
  if (modo === 'encendido') return true;
  if (modo === 'apagado') return false;
  const h = new Date().getHours();
  return h >= 22 || h < 6;
}

function revisar() {
  const noche = esNoche();
  const c = devices.cisterna;
  const b = devices.bomba;

  if (noche !== nocheAnterior) {
    if (nocheAnterior !== null) log(noche ? '🌙 Modo noche activado: la app actúa sola' : '☀️ Modo noche desactivado');
    if (noche && b.online && b.data.modo !== 'auto' && !bloqueoUsuario) setPump('auto', 'modo noche');
    nocheAnterior = noche;
  }

  const res = engine.update({
    t: Date.now() / 60000,
    cisterna: c.online ? c.data.nivel : undefined,
    tinaco: b.online ? b.data.nivel_tinaco : undefined,
    bomba: b.online && b.data.bomba === true,
    noche,
  });

  // Avisos nuevos → registro (de noche, los leves se guardan en silencio)
  const ids = new Set(res.alerts.map((a) => a.id));
  res.alerts.filter((a) => !alertasPrevias.has(a.id)).forEach((a) => {
    const silencio = noche && a.level === 'info';
    log(`${silencio ? '🔕' : '⚠️'} ${a.title}`);
    if (!silencio && a.level === 'danger' && navigator.vibrate) navigator.vibrate([300, 150, 300]);
  });
  alertasPrevias = ids;

  // Aplica o libera el bloqueo de la bomba
  const bloquear = res.lock.length > 0 || bloqueoUsuario;
  if (b.online) {
    if (bloquear && (b.data.bomba || !bloqueoAplicado)) {
      setPump('off', `bloqueo: ${res.lock.concat(bloqueoUsuario ? ['usuario'] : []).join(', ')}`);
      bloqueoAplicado = true;
    } else if (!bloquear && bloqueoAplicado) {
      setPump('auto', 'bloqueo liberado');
      bloqueoAplicado = false;
    }
  }
}

/* ---------------- Interfaz ---------------- */
function setStatus(el, online, on = 'Online', off = 'Offline') {
  el.classList.toggle('on', online);
  el.classList.toggle('off', !online);
  el.textContent = online ? on : off;
}

function nivelTexto(pct, cm, capacidad) {
  if (typeof pct !== 'number') return '--';
  switch (Settings.get('unidad')) {
    case 'litros': return `${Math.round((pct / 100) * capacidad).toLocaleString()} L`;
    case 'centimetros': return typeof cm === 'number' && cm >= 0 ? `${cm.toFixed(1)} cm` : '-- cm';
    default: return `${Math.round(pct)} %`;
  }
}

function dbm(v) { return typeof v === 'number' ? `${v} dBm` : '-- dBm'; }

function render() {
  const c = devices.cisterna;
  const b = devices.bomba;
  const fuentes = [c.online && 'Cisterna', b.online && 'Bomba'].filter(Boolean);
  $('#active-source').textContent = fuentes.length ? `ESP32 ${fuentes.join(' + ')}` : 'Ningún ESP32';
  setStatus($('#link-status'), fuentes.length > 0, 'Conectado', 'Sin conexión');
  setStatus(document.querySelector('[data-status="cisterna"]'), c.online);
  setStatus(document.querySelector('[data-status="bomba"]'), b.online);

  const cd = c.online ? c.data : {};
  const bd = b.online ? b.data : {};
  const pctC = typeof cd.nivel === 'number' ? Math.max(0, Math.min(100, cd.nivel)) : null;
  const pctT = typeof bd.nivel_tinaco === 'number' ? Math.max(0, Math.min(100, bd.nivel_tinaco)) : null;

  $('#cisterna-bar').style.width = `${pctC ?? 0}%`;
  $('#cisterna-value').textContent = nivelTexto(pctC, cd.distancia_cm, Settings.get('capCisterna'));
  $('#cisterna-dist').textContent = typeof cd.distancia_cm === 'number' ? `${cd.distancia_cm.toFixed(1)} cm` : '-- cm';
  $('#cisterna-rssi').textContent = dbm(cd.rssi);

  $('#tinaco-bar').style.width = `${pctT ?? 0}%`;
  $('#tinaco-value').textContent = nivelTexto(pctT, bd.distancia_cm, Settings.get('capTinaco'));
  $('#pump-text').textContent = b.online ? (bd.bomba ? 'Encendida' : 'Apagada') : 'Sin datos';
  $('#pump-mode').textContent = bd.modo ? bd.modo.toUpperCase() : '--';
  $('#bomba-rssi').textContent = dbm(bd.rssi);

  const lockBtn = $('#btn-lock');
  lockBtn.textContent = bloqueoUsuario ? 'Desbloquear bomba' : 'Bloquear bomba';
  lockBtn.classList.toggle('danger', bloqueoUsuario);

  setStatus($('#night-state'), esNoche(), '🌙 Activo', 'Inactivo');
  renderAlerts();
}

function renderAlerts() {
  const cont = $('#alerts');
  cont.replaceChildren();
  const noche = esNoche();
  for (const a of engine.state.alerts) {
    const div = document.createElement('div');
    div.className = `alert ${a.level}`;
    const body = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = a.title;
    const msg = document.createElement('span');
    msg.className = 'small muted';
    msg.textContent = a.msg;
    body.append(title, msg);
    div.append(body);
    if (a.id === 'fuga' && !noche && !bloqueoUsuario) div.append(button('Bloquear bomba', () => { bloqueoUsuario = true; revisar(); render(); }));
    if (['fuga', 'fugaNoche', 'bomba'].includes(a.id)) div.append(button('Revisado', () => { engine.clear(a.id); log(`✔ ${a.title}: revisado`); revisar(); render(); }));
    cont.append(div);
  }
}

function button(text, onClick) {
  const b = document.createElement('button');
  b.className = 'btn outline';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function log(msg) {
  const li = document.createElement('li');
  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  li.append(time, msg);
  const list = $('#log');
  list.prepend(li);
  while (list.children.length > 80) list.lastElementChild.remove();
}

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  window.scrollTo(0, 0);
}

/* ---------------- Eventos ---------------- */
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view)));
document.querySelectorAll('[data-pump]').forEach((btn) => btn.addEventListener('click', async () => {
  if (bloqueoUsuario || engine.state.lock.length) { log('La bomba está bloqueada: revisa los avisos'); return; }
  if (await setPump(btn.dataset.pump)) pollAll();
}));
$('#btn-lock').addEventListener('click', () => {
  bloqueoUsuario = !bloqueoUsuario;
  log(bloqueoUsuario ? '🔒 Bomba bloqueada por ti' : '🔓 Bomba desbloqueada');
  revisar();
  render();
});
$('#btn-refresh').addEventListener('click', pollAll);

$('#form-conexion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ipC = $('#ip-cisterna').value.trim();
  const ipB = $('#ip-bomba').value.trim();
  const result = $('#scan-result');
  result.textContent = 'Buscando ESP32…';
  const found = await scan([ipC, ipB, DEFAULT_AP_IP]);
  Settings.set('ipCisterna', found.cisterna || ipC);
  Settings.set('ipBomba', found.bomba || ipB);
  $('#ip-cisterna').value = Settings.get('ipCisterna');
  $('#ip-bomba').value = Settings.get('ipBomba');
  const names = Object.keys(found);
  result.textContent = names.length
    ? `Conectado a: ${names.map((n) => `ESP32 ${n} (${found[n]})`).join(', ')}`
    : 'No se encontró ningún ESP32. Revisa la red WiFi y las IPs.';
  log(result.textContent);
  startPolling();
  if (names.length) showView('panel');
});

$('#btn-disconnect').addEventListener('click', () => {
  stopPolling();
  devices.cisterna.online = devices.bomba.online = false;
  render();
  $('#scan-result').textContent = 'Desconectado.';
  log('Desconectado por el usuario');
});

Settings.onChange((key) => {
  if (key === 'intervalo' || key === 'fuente') { if (pollTimer) startPolling(); }
  if (['unidad', 'capCisterna', 'capTinaco', 'modoNoche'].includes(key)) { revisar(); render(); }
});

/* ---------------- Inicio ---------------- */
$('#ip-cisterna').value = Settings.get('ipCisterna');
$('#ip-bomba').value = Settings.get('ipBomba');
render();
if (Settings.get('ipCisterna') || Settings.get('ipBomba')) startPolling();
setInterval(render, 60000);  // el modo noche automático cambia con la hora

const isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
if (!isNativeApp && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
