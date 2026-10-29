/* Simulación: parte visual */
(() => {
  const TICKS_POR_SEG = 4;       // pasos por segundo
  const PAUSA_LECTURA_MS = 2200; // pausa para leer

  const $ = (id) => document.getElementById(id);
  const simBox = document.querySelector('.sim');
  let escenario = SCENARIOS[0];
  let runner = null;
  let timer = null;
  let esperarHasta = 0;
  let ultimoEvento = null;
  let notificadas = new Set();
  let notifs = [];

  // Botones de escenarios
  const chips = $('sim-scenarios');
  SCENARIOS.forEach((sc) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.id = sc.id;
    b.addEventListener('click', () => { elegir(sc); });
    chips.append(b);
  });

  function nombre(sc) { return t(`sc.${sc.id}.name`); }

  function elegir(sc) {
    escenario = sc;
    chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.id === sc.id));
    reiniciar();
  }

  // Controles
  function reiniciar() {
    pausar();
    runner = createSimRunner(escenario);
    notificadas = new Set();
    notifs = [];
    ultimoEvento = null;
    narrar(runner.revisarEvento());
    dibujar();
    textos();
  }

  function reproducir() {
    if (runner.terminado) reiniciar();
    pausar();
    esperarHasta = 0;
    const ms = 1000 / (TICKS_POR_SEG * (Number(Settings.get('simSpeed')) || 1));
    timer = setInterval(tick, ms);
    botonPlay();
  }

  function pausar() {
    if (timer) clearInterval(timer);
    timer = null;
    botonPlay();
  }

  function botonPlay() {
    let clave = 'sim.play';
    if (timer) clave = 'sim.pause';
    else if (runner && runner.terminado) clave = 'sim.replay';
    $('sim-play').textContent = t(clave);
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
        // Espera y repite
        clearInterval(timer);
        timer = setTimeout(() => { reiniciar(); reproducir(); }, 3500);
      } else {
        pausar();
      }
    }
  }

  // Saltar al siguiente evento
  function siguientePaso() {
    pausar();
    if (runner.terminado) return;
    let evento = null;
    for (let i = 0; i < 2000 && !evento && !runner.terminado; i++) evento = runner.step().evento;
    if (evento) narrar(evento);
    dibujar();
    pausar();
  }

  // Pintar
  function narrar(evento) {
    if (!evento) return;
    ultimoEvento = { ...evento, hora: runner.hora() };
    textoEvento();
  }

  function textoEvento() {
    if (!ultimoEvento) {
      $('sim-step').textContent = t('sim.stepEmpty');
      $('sim-text').textContent = t('sim.choose');
      return;
    }
    $('sim-step').textContent = t('sim.step', { n: ultimoEvento.indice + 1, total: escenario.eventos.length, hora: ultimoEvento.hora });
    $('sim-text').textContent = t(`sc.${escenario.id}.${ultimoEvento.indice}`, ultimoEvento.vars);
  }

  function nivel(rectId, txtId, pct, lectura, top, alto) {
    const h = (alto * pct) / 100;
    const r = $(rectId);
    r.setAttribute('y', top + alto - h);
    r.setAttribute('height', h);
    $(txtId).textContent = lectura < 0 ? '??' : `${Math.round(pct)}%`;
  }

  function reloj() {
    $('sim-clock').textContent = `${t(runner.st.noche ? 'sim.night' : 'sim.day')} · ${runner.hora()}`;
  }

  function dibujar() {
    const st = runner.st;
    reloj();
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
    notificar(runner.res.alerts, st.noche);
  }

  // Móvil simulado
  function notificar(alertas, noche) {
    let nuevas = false;
    for (const a of alertas) {
      if (notificadas.has(a.id)) continue;
      notificadas.add(a.id);
      notifs.unshift({ id: a.id, level: a.level, hora: runner.hora(), silenciosa: noche && a.level === 'info' });
      nuevas = true;
    }
    // Aviso resuelto, puede volver
    for (const id of [...notificadas]) if (!alertas.some((a) => a.id === id)) notificadas.delete(id);
    if (nuevas) pintarNotifs();
  }

  function pintarNotifs() {
    $('sim-phone-box').hidden = !Settings.get('simNotifs');
    const lista = $('sim-phone');
    if (!notifs.length) {
      const li = document.createElement('li');
      li.className = 'muted small';
      li.textContent = t('sim.noNotifs');
      lista.replaceChildren(li);
      return;
    }
    lista.replaceChildren(...notifs.map((n) => {
      const li = document.createElement('li');
      li.className = `n ${n.level}${n.silenciosa ? ' silent' : ''}`;
      const titulo = t(`alert.${n.id}.title`);
      const strong = document.createElement('strong');
      strong.textContent = n.silenciosa ? t('sim.silent', { title: titulo }) : titulo;
      const small = document.createElement('small');
      small.textContent = `${n.hora} · ${t(`alert.${n.id}.msg`)}${n.silenciosa ? ` ${t('sim.silentNote')}` : ''}`;
      li.append(strong, small);
      return li;
    }));
  }

  // Textos según idioma
  function textos() {
    chips.querySelectorAll('.chip').forEach((c) => { c.textContent = t(`sc.${c.dataset.id}.name`); });
    $('sim-title').textContent = nombre(escenario);
    textoEvento();
    reloj();
    botonPlay();
    pintarNotifs();
  }

  // Eventos
  $('sim-play').addEventListener('click', () => (timer ? pausar() : reproducir()));
  $('sim-restart').addEventListener('click', reiniciar);
  $('sim-next').addEventListener('click', siguientePaso);
  Settings.onChange((key) => {
    if (key === 'simSpeed' && timer) reproducir();
    if (key === 'simNotifs') $('sim-phone-box').hidden = !Settings.get('simNotifs');
    if (key === 'idioma') textos();
  });
  // Pausa al salir
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    if (tab.dataset.view !== 'simulacion' && timer) pausar();
  }));

  elegir(SCENARIOS[0]);
})();
