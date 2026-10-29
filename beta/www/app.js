/* Panel y conexión ESP32 */
// API: /api/status y /api/bomba?modo=on|off|auto
const REQUEST_TIMEOUT_MS = 1500;
const DEFAULT_AP_IP = '192.168.4.1';  // IP modo punto acceso

const $ = (sel) => document.querySelector(sel);

const devices = {
  cisterna: { online: false, data: {} },
  bomba: { online: false, data: {} },
};
// "cisterna" = depósito de abajo
const NOMBRES = { cisterna: 'tank.lower', bomba: 'pump' };
const engine = AquaEngine.create();
let pollTimer = null;
let polling = false;
let bloqueoUsuario = false;
let bloqueoAplicado = false;   // bloqueo ya enviado
let nocheAnterior = null;
let alertasPrevias = new Set();

const nombreEsp = (id) => t(NOMBRES[id]);

// Red
function baseUrl(ip) {
  return ip.startsWith('http') ? ip.replace(/\/$/, '') : `http://${ip}`;
}

async function fetchJson(ip, path) {
  const ctrl = new AbortController();
  let timer;
  // Límite también en nativo
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
    if (!estaba) log(t('log.connected', { name: nombreEsp(nombre), ip }));
  } catch {
    dev.online = false;
    if (estaba) log(t('log.lost', { name: nombreEsp(nombre) }));
  }
}

async function pollAll() {
  if (polling) return;  // sin peticiones acumuladas
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

// Detecta qué ESP32 responde
async function scan(candidates) {
  const found = {};
  await Promise.all([...new Set(candidates.filter(Boolean))].map(async (ip) => {
    try {
      const data = await fetchJson(ip, '/api/status');
      if (data.device === 'cisterna' || data.device === 'bomba') found[data.device] = ip;
    } catch { /* sin respuesta */ }
  }));
  return found;
}

async function setPump(modo, motivo) {
  const ip = Settings.get('ipBomba');
  if (!ip) { log(t('log.needIp')); return false; }
  try {
    await fetchJson(ip, `/api/bomba?modo=${modo}`);
    log(t('log.pump', { mode: modo.toUpperCase() }) + (motivo ? ` (${motivo})` : ''));
    return true;
  } catch {
    log(t('log.sendFail'));
    return false;
  }
}

// Modo noche y protecciones
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
    if (nocheAnterior !== null) log(t(noche ? 'log.nightOn' : 'log.nightOff'));
    if (noche && b.online && b.data.modo !== 'auto' && !bloqueoUsuario) setPump('auto', t('reason.night'));
    nocheAnterior = noche;
  }

  const res = engine.update({
    t: Date.now() / 60000,
    cisterna: c.online ? c.data.nivel : undefined,
    tinaco: b.online ? b.data.nivel_tinaco : undefined,
    bomba: b.online && b.data.bomba === true,
    noche,
  });

  // Avisos nuevos al registro
  const ids = new Set(res.alerts.map((a) => a.id));
  res.alerts.filter((a) => !alertasPrevias.has(a.id)).forEach((a) => {
    const silencio = noche && a.level === 'info';
    log(t(silencio ? 'log.alertSilent' : 'log.alert', { title: t(`alert.${a.id}.title`) }));
    if (!silencio && a.level === 'danger' && navigator.vibrate) navigator.vibrate([300, 150, 300]);
  });
  alertasPrevias = ids;

  // Bloquear o liberar bomba
  const bloquear = res.lock.length > 0 || bloqueoUsuario;
  if (b.online) {
    if (bloquear && (b.data.bomba || !bloqueoAplicado)) {
      const motivos = res.lock.concat(bloqueoUsuario ? ['usuario'] : []).map((m) => t(`lock.${m}`));
      setPump('off', t('reason.lock', { list: motivos.join(', ') }));
      bloqueoAplicado = true;
    } else if (!bloquear && bloqueoAplicado) {
      setPump('auto', t('reason.unlock'));
      bloqueoAplicado = false;
    }
  }
}

// Interfaz
function setStatus(el, online, on = t('status.connected'), off = t('status.disconnected')) {
  el.classList.toggle('on', online);
  el.classList.toggle('off', !online);
  el.textContent = online ? on : off;
}

function nivelTexto(pct, cm, capacidad) {
  if (typeof pct !== 'number') return '--';
  switch (Settings.get('unidad')) {
    case 'litros': return `${Math.round((pct / 100) * capacidad).toLocaleString(I18N.lang())} L`;
    case 'centimetros': return typeof cm === 'number' && cm >= 0 ? `${cm.toFixed(1)} cm` : '-- cm';
    default: return `${Math.round(pct)} %`;
  }
}

function dbm(v) { return typeof v === 'number' ? `${v} dBm` : '-- dBm'; }

function render() {
  const c = devices.cisterna;
  const b = devices.bomba;
  const fuentes = [c.online && nombreEsp('cisterna'), b.online && nombreEsp('bomba')].filter(Boolean);
  $('#active-source').textContent = fuentes.length ? `ESP32 ${fuentes.join(' + ')}` : t('panel.noEsp');
  setStatus($('#link-status'), fuentes.length > 0, t('status.connected'), t('status.none'));
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
  $('#pump-text').textContent = b.online ? t(bd.bomba ? 'panel.on' : 'panel.off') : t('panel.noData');
  $('#pump-mode').textContent = bd.modo ? bd.modo.toUpperCase() : '--';
  $('#bomba-rssi').textContent = dbm(bd.rssi);

  const lockBtn = $('#btn-lock');
  lockBtn.textContent = t(bloqueoUsuario ? 'panel.unlock' : 'panel.lock');
  lockBtn.classList.toggle('danger', bloqueoUsuario);

  setStatus($('#night-state'), esNoche(), t('night.active'), t('night.inactive'));
  renderAlerts();
}

function renderAlerts() {
  const cont = $('#alerts');
  cont.replaceChildren();
  const noche = esNoche();
  for (const a of engine.state.alerts) {
    const titulo = t(`alert.${a.id}.title`);
    const div = document.createElement('div');
    div.className = `alert ${a.level}`;
    const body = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = titulo;
    const msg = document.createElement('span');
    msg.className = 'small muted';
    msg.textContent = t(`alert.${a.id}.msg`);
    body.append(title, msg);
    div.append(body);
    if (a.id === 'fuga' && !noche && !bloqueoUsuario) div.append(button(t('panel.lock'), () => { bloqueoUsuario = true; revisar(); render(); }));
    if (['fuga', 'fugaNoche', 'bomba'].includes(a.id)) div.append(button(t('panel.checked'), () => { engine.clear(a.id); log(t('log.checked', { title: titulo })); revisar(); render(); }));
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
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === name));
  window.scrollTo(0, 0);
}

// Eventos
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view)));
document.querySelectorAll('[data-pump]').forEach((btn) => btn.addEventListener('click', async () => {
  if (bloqueoUsuario || engine.state.lock.length) { log(t('log.pumpLocked')); return; }
  if (await setPump(btn.dataset.pump)) pollAll();
}));
$('#btn-lock').addEventListener('click', () => {
  bloqueoUsuario = !bloqueoUsuario;
  log(t(bloqueoUsuario ? 'log.locked' : 'log.unlocked'));
  revisar();
  render();
});
$('#btn-refresh').addEventListener('click', pollAll);

$('#form-conexion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ipC = $('#ip-cisterna').value.trim();
  const ipB = $('#ip-bomba').value.trim();
  const result = $('#scan-result');
  result.textContent = t('conn.searching');
  const found = await scan([ipC, ipB, DEFAULT_AP_IP]);
  Settings.set('ipCisterna', found.cisterna || ipC);
  Settings.set('ipBomba', found.bomba || ipB);
  $('#ip-cisterna').value = Settings.get('ipCisterna');
  $('#ip-bomba').value = Settings.get('ipBomba');
  const names = Object.keys(found);
  result.textContent = names.length
    ? t('conn.found', { list: names.map((n) => `ESP32 ${nombreEsp(n)} (${found[n]})`).join(', ') })
    : t('conn.notFound');
  log(result.textContent);
  startPolling();
  if (names.length) showView('panel');
});

$('#btn-disconnect').addEventListener('click', () => {
  stopPolling();
  devices.cisterna.online = devices.bomba.online = false;
  render();
  $('#scan-result').textContent = t('conn.disconnected');
  log(t('log.userDisconnect'));
});

Settings.onChange((key) => {
  if (key === 'intervalo' || key === 'fuente') { if (pollTimer) startPolling(); }
  if (['unidad', 'capCisterna', 'capTinaco', 'modoNoche'].includes(key)) { revisar(); render(); }
  if (key === 'idioma') render();
});

// Inicio
$('#ip-cisterna').value = Settings.get('ipCisterna');
$('#ip-bomba').value = Settings.get('ipBomba');
render();
if (Settings.get('ipCisterna') || Settings.get('ipBomba')) startPolling();
setInterval(render, 60000);  // revisa modo noche

const isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
if (!isNativeApp && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
