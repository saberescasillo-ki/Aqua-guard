/* =========================================================
   Aqua Guard · Litium — Lógica principal
   ---------------------------------------------------------
   Cada ESP32 expone (ver carpeta /firmware):
     GET http://<IP>/api/status   -> JSON con sus datos
     GET http://<IP>/api/bomba?modo=on|off|auto  (solo ESP32 Bomba)
   ========================================================= */

const STORAGE_KEY = 'aquaguard.config';
const REQUEST_TIMEOUT_MS = 1500;
// IP por defecto de un ESP32 en modo punto de acceso (su propia red WiFi)
const DEFAULT_AP_IP = '192.168.4.1';

const config = loadConfig();
const devices = {
  cisterna: { online: false, lastSeen: 0, data: null },
  bomba: { online: false, lastSeen: 0, data: null },
};
let pollTimer = null;

const $ = (sel) => document.querySelector(sel);

/* ---------------- Configuración ---------------- */
function loadConfig() {
  const defaults = { ipCisterna: '', ipBomba: '', interval: 2000 };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
  } catch {
    return defaults;
  }
}

function saveConfig() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch { /* modo privado */ }
}

/* ---------------- Red ---------------- */
function baseUrl(ip) {
  return ip.startsWith('http') ? ip.replace(/\/$/, '') : `http://${ip}`;
}

async function fetchJson(ip, path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl(ip) + path, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function pollDevice(name, ip) {
  const dev = devices[name];
  const wasOnline = dev.online;
  if (!ip) { dev.online = false; return; }
  try {
    dev.data = await fetchJson(ip, '/api/status');
    dev.online = true;
    dev.lastSeen = Date.now();
    if (!wasOnline) log(`ESP32 ${name} conectado (${ip})`);
  } catch {
    dev.online = false;
    if (wasOnline) log(`ESP32 ${name} dejó de responder`);
  }
}

async function pollAll() {
  await Promise.all([
    pollDevice('cisterna', config.ipCisterna),
    pollDevice('bomba', config.ipBomba),
  ]);
  render();
}

function startPolling() {
  stopPolling();
  pollAll();
  pollTimer = setInterval(pollAll, Number(config.interval) || 2000);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

/**
 * Busca los ESP32: prueba las IPs escritas (y la IP de punto de acceso)
 * y asigna cada una según el campo "device" que responde el ESP32.
 * Así la app se conecta sola al ESP32 que está enviando datos.
 */
async function scan(candidates) {
  const unique = [...new Set(candidates.filter(Boolean))];
  const found = {};
  await Promise.all(unique.map(async (ip) => {
    try {
      const data = await fetchJson(ip, '/api/status');
      if (data.device === 'cisterna' || data.device === 'bomba') found[data.device] = ip;
    } catch { /* no responde */ }
  }));
  return found;
}

async function setPump(modo) {
  if (!config.ipBomba) { log('Configura primero la IP del ESP32 Bomba'); return; }
  try {
    await fetchJson(config.ipBomba, `/api/bomba?modo=${modo}`);
    log(`Orden enviada a la bomba: ${modo.toUpperCase()}`);
    pollAll();
  } catch {
    log('No se pudo enviar la orden a la bomba');
  }
}

/* ---------------- Interfaz ---------------- */
function setPill(el, online, onText = 'Online', offText = 'Offline') {
  el.classList.toggle('pill-on', online);
  el.classList.toggle('pill-off', !online);
  el.lastElementChild.textContent = online ? onText : offText;
}

function fmt(value, unit, decimals = 0) {
  const sep = unit === '%' ? '' : ' ';
  return `${typeof value === 'number' ? value.toFixed(decimals) : '--'}${sep}${unit}`;
}

function render() {
  const c = devices.cisterna;
  const b = devices.bomba;

  // Fuente activa: el ESP32 (o ambos) que está enviando datos
  const sources = [c.online && 'Cisterna', b.online && 'Bomba'].filter(Boolean);
  $('#active-source').textContent = sources.length ? `ESP32 ${sources.join(' + ')}` : 'Ningún ESP32';
  setPill($('#link-status'), sources.length > 0, 'Conectado', 'Sin conexión');

  setPill(document.querySelector('[data-status="cisterna"]'), c.online);
  setPill(document.querySelector('[data-status="bomba"]'), b.online);

  const cd = c.online ? c.data : {};
  const level = typeof cd.nivel === 'number' ? Math.max(0, Math.min(100, cd.nivel)) : null;
  $('#cisterna-water').style.height = `${level ?? 0}%`;
  $('#cisterna-level').textContent = level === null ? '--%' : `${Math.round(level)}%`;
  $('#cisterna-dist').textContent = fmt(cd.distancia_cm, 'cm', 1);
  $('#cisterna-rssi').textContent = fmt(cd.rssi, 'dBm');

  const bd = b.online ? b.data : {};
  const pumpOn = bd.bomba === true;
  $('#pump-icon').classList.toggle('on', pumpOn);
  $('#pump-text').textContent = b.online ? (pumpOn ? 'Encendida' : 'Apagada') : 'Sin datos';
  $('#bomba-level').textContent = fmt(bd.nivel_tinaco, '%');
  $('#bomba-mode').textContent = bd.modo ? bd.modo.toUpperCase() : '--';
  $('#bomba-rssi').textContent = fmt(bd.rssi, 'dBm');
}

function log(msg) {
  const li = document.createElement('li');
  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString();
  li.append(time, msg);
  const list = $('#log');
  list.prepend(li);
  while (list.children.length > 50) list.lastElementChild.remove();
}

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  window.scrollTo(0, 0);
}

/* ---------------- Eventos ---------------- */
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => showView(tab.dataset.view));
});

document.querySelectorAll('[data-pump]').forEach((btn) => {
  btn.addEventListener('click', () => setPump(btn.dataset.pump));
});

$('#btn-refresh').addEventListener('click', pollAll);

$('#form-conexion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ipC = $('#ip-cisterna').value.trim();
  const ipB = $('#ip-bomba').value.trim();
  config.interval = Number($('#poll-interval').value);

  const result = $('#scan-result');
  result.textContent = 'Buscando ESP32…';
  const found = await scan([ipC, ipB, DEFAULT_AP_IP]);

  // Si el ESP32 responde, usamos la IP detectada; si no, guardamos lo escrito
  config.ipCisterna = found.cisterna || ipC;
  config.ipBomba = found.bomba || ipB;
  $('#ip-cisterna').value = config.ipCisterna;
  $('#ip-bomba').value = config.ipBomba;
  saveConfig();

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

/* ---------------- Inicio ---------------- */
$('#ip-cisterna').value = config.ipCisterna;
$('#ip-bomba').value = config.ipBomba;
$('#poll-interval').value = String(config.interval);
render();
if (config.ipCisterna || config.ipBomba) startPolling();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
