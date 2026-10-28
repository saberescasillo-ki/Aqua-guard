/* =========================================================
   Aqua Guard Beta — Simulación (parte visual)
   La física y los escenarios están en scenarios.js.
   ========================================================= */
(() => {
  const TICKS_POR_SEG = 4;      // a velocidad 1×
  const PAUSA_LECTURA_MS = 2200; // pausa en cada paso si "Pausar para leer" está activo

  const $ = (id) => document.getElementById(id);
  const simBox = document.querySelector('.sim');
  let escenario = SCENARIOS[0];
  let runner = null;
  let timer = null;
  let esperarHasta = 0;
  let notificadas = new Set();

  /* ---------- Selector de escenarios ---------- */
  const chips = $('sim-scenarios');
  SCENARIOS.forEach((sc) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = sc.nombre;
    b.dataset.id = sc.id;
    b.addEventListener('click', () => { elegir(sc); });
    chips.append(b);
  });

  function elegir(sc) {
    escenario = sc;
    chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.id === sc.id));
    reiniciar();
  }

  /* ---------- Control ---------- */
  function reiniciar() {
    pausar();
    runner = createSimRunner(escenario);
    notificadas = new Set();
    $('sim-phone').replaceChildren(vacio());
    $('sim-title').textContent = escenario.nombre;
    narrar(runner.revisarEvento());
    dibujar();
  }

  function reproducir() {
    if (runner.terminado) reiniciar();
    pausar();
    esperarHasta = 0;
    const ms = 1000 / (TICKS_POR_SEG * (Number(Settings.get('simSpeed')) || 1));
    timer = setInterval(tick, ms);
    $('sim-play').textContent = 'Pausar';
  }

  function pausar() {
    if (timer) clearInterval(timer);
    timer = null;
    $('sim-play').textContent = runner && runner.terminado ? 'Repetir' : 'Reproducir';
  }

  function tick() {
    if (Date.now() < esperarHasta) return;
    const { evento } = runner.step();
    if (evento) {
      narrar(evento);
      if (Settings.get('simPausa')) esperarHasta = Date.now() + PAUSA_LECTURA_MS / Math.max(1, Number(Settings.get('simSpeed')));
    }
    dibujar();
    if (runner.terminado) {
      if (Settings.get('simLoop')) {
        // deja leer el final y vuelve a empezar
        clearInterval(timer);
        timer = setTimeout(() => { reiniciar(); reproducir(); }, 3500);
      } else {
        pausar();
      }
    }
  }

  /** Avanza la simulación hasta el siguiente paso de la historia. */
  function siguientePaso() {
    pausar();
    if (runner.terminado) return;
    let evento = null;
    for (let i = 0; i < 2000 && !evento && !runner.terminado; i++) evento = runner.step().evento;
    if (evento) narrar(evento);
    dibujar();
    pausar();
  }

  /* ---------- Pintar ---------- */
  function narrar(evento) {
    if (!evento) return;
    $('sim-step').textContent = `Paso ${evento.indice + 1} de ${escenario.eventos.length} · ${runner.hora()}`;
    $('sim-text').textContent = evento.texto;
  }

  function nivel(rectId, txtId, pct, lectura, top, alto) {
    const h = (alto * pct) / 100;
    const r = $(rectId);
    r.setAttribute('y', top + alto - h);
    r.setAttribute('height', h);
    $(txtId).textContent = lectura < 0 ? '??' : `${Math.round(pct)}%`;
  }

  function dibujar() {
    const st = runner.st;
    const res = runner.res;
    $('sim-clock').textContent = `${st.noche ? 'Noche' : 'Día'} · ${runner.hora()}`;
    simBox.classList.toggle('night', st.noche);
    nivel('sim-tinaco', 'sim-tinaco-txt', st.tinaco, st.lectura.tinaco, 41, 70);
    nivel('sim-cisterna', 'sim-cisterna-txt', st.cisterna, st.lectura.cisterna, 141, 68);
    $('sim-sensor-t').classList.toggle('bad', !st.sensorT);
    $('sim-sensor-c').classList.toggle('bad', !st.sensorC);
    const bombea = st.bomba && st.bombaFunciona;
    $('sim-pump').classList.toggle('on', bombea);
    $('sim-pump').classList.toggle('fail', !st.bombaFunciona);
    $('sim-flow').classList.toggle('on', bombea);
    $('sim-lock').classList.toggle('on', runner.bloqueada);
    $('sim-supply').classList.toggle('on', st.suministro > 0 && st.cisterna < 100);
    $('sim-tap').classList.toggle('on', st.consumo > 0 && st.tinaco > 0);
    $('sim-leak').classList.toggle('on', st.fuga > 0 && st.tinaco > 0);
    $('sim-progress').style.width = `${runner.progreso * 100}%`;
    notificar(res.alerts, st.noche);
  }

  /* ---------- Notificaciones del móvil simulado ---------- */
  function vacio() {
    const li = document.createElement('li');
    li.className = 'muted small';
    li.textContent = 'Aún no hay notificaciones.';
    return li;
  }

  function notificar(alertas, noche) {
    $('sim-phone-box').hidden = !Settings.get('simNotifs');
    const lista = $('sim-phone');
    for (const a of alertas) {
      if (notificadas.has(a.id)) continue;
      notificadas.add(a.id);
      if (lista.firstElementChild && !lista.firstElementChild.classList.contains('n')) lista.replaceChildren();
      const silenciosa = noche && a.level === 'info';
      const li = document.createElement('li');
      li.className = `n ${a.level}${silenciosa ? ' silent' : ''}`;
      const t = document.createElement('strong');
      t.textContent = `${silenciosa ? 'En silencio: ' : ''}${a.title}`;
      const m = document.createElement('small');
      m.textContent = `${runner.hora()} · ${a.msg}${silenciosa ? ' (guardada en silencio por el modo noche)' : ''}`;
      li.append(t, m);
      lista.prepend(li);
    }
    // Si el aviso se resolvió, puede volver a notificarse más adelante
    for (const id of [...notificadas]) if (!alertas.some((a) => a.id === id)) notificadas.delete(id);
  }

  /* ---------- Eventos ---------- */
  $('sim-play').addEventListener('click', () => (timer ? pausar() : reproducir()));
  $('sim-restart').addEventListener('click', reiniciar);
  $('sim-next').addEventListener('click', siguientePaso);
  Settings.onChange((key) => {
    if (key === 'simSpeed' && timer) reproducir();
    if (key === 'simNotifs') $('sim-phone-box').hidden = !Settings.get('simNotifs');
  });
  // Si el usuario sale de la pestaña, la simulación se pausa
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    if (t.dataset.view !== 'simulacion' && timer) pausar();
  }));

  elegir(SCENARIOS[0]);
})();
