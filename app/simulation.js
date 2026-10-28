/* =========================================================
   Aqua Guard · Litium — Simulación / Tutorial
   Muestra un ciclo normal del sistema paso a paso.
   Para cambiar los textos, edita el arreglo STEPS.
   ========================================================= */
(() => {
  const STEP_MS = 4500;   // duración de cada paso en modo "Reproducir"
  const TICK_MS = 100;    // frecuencia de animación de los niveles

  // highlight: elementos del SVG que se resaltan en cada paso
  const STEPS = [
    {
      title: '1. Encendido y conexión WiFi',
      text: 'Los dos ESP32 se encienden y se conectan a la red WiFi gracias a sus antenas. La app en tu teléfono los encuentra por su IP.',
      wifi: true, highlight: ['sim-esp-c', 'sim-esp-b'],
      target: { cisterna: 80, tinaco: 60 }, pump: false,
    },
    {
      title: '2. Lectura de la cisterna',
      text: 'El ESP32 Cisterna dispara su sensor ultrasónico: mide el tiempo que tarda el eco en rebotar en el agua y calcula la distancia y el % de nivel.',
      wifi: true, sensors: ['sim-sensor-c'], highlight: ['sim-esp-c'],
      target: { cisterna: 80, tinaco: 60 }, pump: false,
    },
    {
      title: '3. El tinaco se vacía',
      text: 'En casa se usa agua y el tinaco baja. El ESP32 Bomba lo vigila con su propio sensor ultrasónico y envía los datos a la app.',
      wifi: true, sensors: ['sim-sensor-t'], highlight: ['sim-esp-b'],
      target: { cisterna: 80, tinaco: 20 }, pump: false,
    },
    {
      title: '4. Se activa la bomba',
      text: 'Al bajar del 25%, el ESP32 Bomba activa el relé y la bomba sube agua de la cisterna al tinaco. Verás “Encendida” en el Panel.',
      wifi: true, sensors: ['sim-sensor-c', 'sim-sensor-t'], highlight: ['sim-pump'],
      target: { cisterna: 45, tinaco: 95 }, pump: true,
    },
    {
      title: '5. Tinaco lleno: se apaga',
      text: 'Al llegar al 95% el relé se abre y la bomba se apaga sola. Si la cisterna bajara del 15%, la bomba también se detiene para no trabajar en seco.',
      wifi: true, sensors: ['sim-sensor-t'], highlight: ['sim-esp-b'],
      target: { cisterna: 45, tinaco: 95 }, pump: false,
    },
    {
      title: '6. Control desde la app',
      text: 'Desde el Panel puedes ver ambos niveles en tiempo real y encender, apagar o dejar la bomba en modo AUTO cuando quieras.',
      wifi: true, highlight: ['sim-esp-c', 'sim-esp-b', 'sim-pump'],
      target: { cisterna: 45, tinaco: 95 }, pump: false,
    },
  ];

  const $ = (id) => document.getElementById(id);
  const level = { cisterna: 0, tinaco: 0 };
  let step = 0;
  let playTimer = null;

  function setWater(rectId, txtId, pct, top, height) {
    const h = (height * pct) / 100;
    const r = $(rectId);
    r.setAttribute('y', top + height - h);
    r.setAttribute('height', h);
    $(txtId).textContent = `${Math.round(pct)}%`;
  }

  function drawLevels() {
    setWater('sim-cisterna-water', 'sim-cisterna-txt', level.cisterna, 142, 96);
    setWater('sim-tinaco-water', 'sim-tinaco-txt', level.tinaco, 42, 86);
  }

  // Acerca suavemente los niveles al objetivo del paso actual
  function tick() {
    const target = STEPS[step].target;
    for (const k of Object.keys(level)) {
      const diff = target[k] - level[k];
      level[k] += Math.abs(diff) < 0.5 ? diff : diff * 0.08;
    }
    drawLevels();
  }

  function showStep(i) {
    step = (i + STEPS.length) % STEPS.length;
    const s = STEPS[step];
    $('sim-step-num').textContent = `Paso ${step + 1} de ${STEPS.length}`;
    $('sim-step-title').textContent = s.title;
    $('sim-step-text').textContent = s.text;
    $('sim-progress').style.width = `${((step + 1) / STEPS.length) * 100}%`;

    $('sim-wifi').classList.toggle('on', !!s.wifi);
    $('sim-pump').classList.toggle('on', s.pump);
    $('sim-flow').classList.toggle('on', s.pump);
    ['sim-sensor-c', 'sim-sensor-t'].forEach((id) =>
      $(id).classList.toggle('on', (s.sensors || []).includes(id)));
    ['sim-esp-c', 'sim-esp-b', 'sim-pump'].forEach((id) =>
      $(id).classList.toggle('highlight', (s.highlight || []).includes(id)));
  }

  function togglePlay() {
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
      $('sim-play').textContent = 'Reproducir';
    } else {
      playTimer = setInterval(() => showStep(step + 1), STEP_MS);
      $('sim-play').textContent = 'Pausar';
    }
  }

  $('sim-prev').addEventListener('click', () => showStep(step - 1));
  $('sim-next').addEventListener('click', () => showStep(step + 1));
  $('sim-play').addEventListener('click', togglePlay);

  showStep(0);
  setInterval(tick, TICK_MS);
})();
