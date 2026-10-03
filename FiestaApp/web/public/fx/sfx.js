// Efectos de sonido de "programa de TV", sintetizados en el momento con Web
// Audio (sin archivos de audio: no pesan nada y no hay derechos que pagar).
//
// Los navegadores no dejan sonar nada hasta que la persona toca la pantalla
// una vez, así que el audio se "despierta" con el primer toque. Se puede
// silenciar desde el botón 🔊 de la barra de arriba (queda guardado en el
// celu).

(function () {
  const KEY = 'soyparticipante:sonido';
  let ctx = null;
  let master = null;
  let activo = true;
  try { activo = localStorage.getItem(KEY) !== 'off'; } catch (e) { /* sin storage */ }

  function despertar() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, despertar, { passive: true }));

  // Una nota con envolvente rápida.
  function tono(freq, { dur = 0.18, tipo = 'sine', vol = 0.6, cuando = 0, glide = null } = {}) {
    const t0 = ctx.currentTime + cuando;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = tipo;
    osc.frequency.setValueAtTime(freq, t0);
    if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // Ruido filtrado (para el "whoosh", el redoble y los aplausos).
  function ruido({ dur = 0.4, cuando = 0, desde = 400, hasta = 4000, vol = 0.4, q = 0.8 } = {}) {
    const t0 = ctx.currentTime + cuando;
    const largo = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, largo, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < largo; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'bandpass';
    filtro.Q.value = q;
    filtro.frequency.setValueAtTime(desde, t0);
    filtro.frequency.exponentialRampToValueAtTime(hasta, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filtro).connect(g).connect(master);
    src.start(t0);
  }

  const SONIDOS = {
    // Acierto: campanita de dos notas, brillante.
    acierto() { tono(880, { tipo: 'triangle', dur: 0.16 }); tono(1320, { tipo: 'triangle', dur: 0.32, cuando: 0.09 }); },
    // Error: chicharra grave.
    error() { tono(150, { tipo: 'sawtooth', dur: 0.35, vol: 0.35 }); tono(110, { tipo: 'square', dur: 0.35, vol: 0.2 }); },
    // Cambio de pantalla.
    whoosh() { ruido({ dur: 0.35, desde: 300, hasta: 3500, vol: 0.25 }); },
    // Toque de botón.
    pop() { tono(620, { tipo: 'sine', dur: 0.08, vol: 0.35, glide: 900 }); },
    // Te toca: dos notas que suben.
    turno() { tono(660, { tipo: 'triangle', dur: 0.12 }); tono(990, { tipo: 'triangle', dur: 0.2, cuando: 0.11 }); },
    // Redoble antes de una revelación.
    redoble() { for (let i = 0; i < 14; i++) ruido({ dur: 0.07, cuando: i * 0.06, desde: 180, hasta: 260, vol: 0.18 + i * 0.015, q: 1.5 }); },
    // Fanfarria de ganador: arpegio mayor + aplausos.
    fanfarria() {
      [523, 659, 784, 1046].forEach((f, i) => tono(f, { tipo: 'triangle', dur: 0.4, cuando: i * 0.11, vol: 0.45 }));
      for (let i = 0; i < 18; i++) ruido({ dur: 0.05, cuando: 0.5 + Math.random() * 1.2, desde: 1500, hasta: 3000, vol: 0.12, q: 0.6 });
    }
  };

  function play(nombre) {
    if (!activo || !ctx || ctx.state !== 'running') return;
    const s = SONIDOS[nombre];
    if (s) { try { s(); } catch (e) { /* un sonido nunca rompe el juego */ } }
  }

  function setActivo(v) {
    activo = !!v;
    try { localStorage.setItem(KEY, activo ? 'on' : 'off'); } catch (e) { /* sin storage */ }
    if (activo) { despertar(); play('pop'); }
  }

  window.Sfx = { play, setActivo, get activo() { return activo; } };
}());
