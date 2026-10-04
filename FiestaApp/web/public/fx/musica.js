// Música de fondo para ambientar cada juego, compuesta en el momento con Web
// Audio (sin archivos ni canciones con derechos). Cada "ambiente" es un
// patrón que se repite con pequeñas variaciones:
//   sala     → lounge tranquilo para la sala de espera
//   show     → arpegios alegres de programa de preguntas
//   suspenso → bajo grave, latido y campanitas (Impostor, El Cazador)
//   casino   → acordes de jazz con bajo caminando (Ruleta, Caja Fuerte)
//   carrera  → bajo rápido y bombo (Autos, Aguante, La Torre)
//   juegos   → punteo relajado (Mímica, cartas, Tutifruti...)
// Cuando alguien habla por el audio de la sala, la música baja sola.

(function () {
  const KEY = 'soyparticipante:musica';
  let activa = true;
  try { activa = localStorage.getItem(KEY) !== 'off'; } catch (e) { /* sin storage */ }
  let ctx = null; let salida = null; let duck = null; let reverb = null;
  let ambiente = null; let proximo = 0; let paso = 0; let timer = null;
  const VOL = 0.16;

  function iniciarCtx() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    salida = ctx.createGain();
    salida.gain.value = 0;
    duck = ctx.createGain();
    duck.gain.value = 1;
    // Un poco de "sala" con un eco corto.
    const eco = ctx.createDelay(); eco.delayTime.value = 0.23;
    const vuelta = ctx.createGain(); vuelta.gain.value = 0.22;
    eco.connect(vuelta).connect(eco);
    reverb = ctx.createGain(); reverb.gain.value = 0.35;
    reverb.connect(eco); eco.connect(salida);
    salida.connect(duck).connect(ctx.destination);
    return ctx;
  }
  ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => { if (activa && ambiente) { iniciarCtx(); arrancar(); } }, { passive: true }));

  const nota = (n) => 440 * Math.pow(2, (n - 69) / 12); // número MIDI → Hz

  function tono(t, midi, dur, { tipo = 'triangle', vol = 0.3, ataque = 0.01, filtro = null, eco = 0.4 } = {}) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = tipo; o.frequency.setValueAtTime(nota(midi), t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + ataque);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let ult = o.connect(g);
    if (filtro) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filtro; ult = ult.connect(f); }
    ult.connect(salida);
    if (eco) { const e = ctx.createGain(); e.gain.value = eco; ult.connect(e).connect(reverb); }
    o.start(t); o.stop(t + dur + 0.05);
  }
  function bombo(t, vol = 0.5) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(salida); o.start(t); o.stop(t + 0.25);
  }
  let ruidoBuf = null;
  function chasquido(t, vol = 0.08, dur = 0.05, tono = 7000) {
    if (!ruidoBuf) { ruidoBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate); const d = ruidoBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const s = ctx.createBufferSource(); s.buffer = ruidoBuf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = tono;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(salida); s.start(t); s.stop(t + dur + 0.02);
  }

  // Cada ambiente: tempo (pasos de corchea por segundo) y qué suena en cada paso.
  const AMBIENTES = {
    sala: {
      bpm: 84,
      acordes: [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 62]], // Am7 Fmaj7 G7 Em7
      paso(t, i, d) {
        const ac = this.acordes[Math.floor(i / 16) % 4];
        if (i % 16 === 0) ac.forEach((n) => tono(t, n, d * 15, { tipo: 'sine', vol: 0.07, ataque: 0.4 }));
        if (i % 16 === 0) tono(t, ac[0] - 24, d * 7, { tipo: 'sine', vol: 0.18, eco: 0 });
        if (i % 4 === 2 && Math.random() < 0.6) tono(t, ac[(i / 2) % 4 | 0] + 12, d * 2, { tipo: 'triangle', vol: 0.05 });
        if (i % 2 === 1) chasquido(t, 0.02);
      }
    },
    show: {
      bpm: 116,
      acordes: [[60, 64, 67], [67, 71, 74], [69, 72, 76], [65, 69, 72]], // C G Am F
      paso(t, i, d) {
        const ac = this.acordes[Math.floor(i / 8) % 4];
        tono(t, ac[i % 3] + (i % 6 > 2 ? 12 : 0), d * 1.6, { tipo: 'triangle', vol: 0.08, filtro: 3000 });
        if (i % 8 === 0) tono(t, ac[0] - 24, d * 3.5, { tipo: 'sawtooth', vol: 0.09, filtro: 500, eco: 0 });
        if (i % 4 === 0) bombo(t, 0.32);
        if (i % 2 === 1) chasquido(t, 0.035);
        if (i % 8 === 4) chasquido(t, 0.06, 0.12, 1800);
      }
    },
    suspenso: {
      bpm: 66,
      paso(t, i, d) {
        if (i % 32 === 0) { tono(t, 33, d * 31, { tipo: 'sine', vol: 0.22, ataque: 1.5, eco: 0 }); tono(t, 40, d * 31, { tipo: 'triangle', vol: 0.05, ataque: 2, filtro: 400 }); }
        // Latido
        if (i % 8 === 0) bombo(t, 0.28);
        if (i % 8 === 1) bombo(t, 0.16);
        if (i % 16 === 11 && Math.random() < 0.5) tono(t, [81, 84, 80, 87][Math.floor(Math.random() * 4)], d * 6, { tipo: 'sine', vol: 0.04, eco: 0.8 });
        if (i % 32 === 24) tono(t, 46, d * 8, { tipo: 'sawtooth', vol: 0.025, filtro: 700, ataque: 1 });
      }
    },
    casino: {
      bpm: 96,
      acordes: [[62, 65, 69, 72], [55, 59, 62, 65], [60, 64, 67, 71], [57, 61, 64, 67]], // Dm7 G7 Cmaj7 A7
      bajos: [[38, 41, 45, 47], [43, 47, 50, 49], [36, 40, 43, 45], [45, 44, 43, 42]],
      paso(t, i, d) {
        const k = Math.floor(i / 8) % 4;
        const swing = i % 2 === 1 ? d * 0.33 : 0;
        if (i % 2 === 0) tono(t, this.bajos[k][(i / 2) % 4], d * 1.8, { tipo: 'sine', vol: 0.2, eco: 0 });
        if (i % 8 === 2 || i % 8 === 7) this.acordes[k].forEach((n) => tono(t + swing, n, d * 1.2, { tipo: 'sine', vol: 0.05, filtro: 2500 }));
        if (i % 2 === 1) chasquido(t + swing, 0.03, 0.04, 6000);
        if (i % 4 === 0) chasquido(t, 0.018, 0.25, 5000);
      }
    },
    carrera: {
      bpm: 144,
      notas: [40, 40, 52, 40, 43, 40, 47, 45],
      paso(t, i, d) {
        tono(t, this.notas[i % 8] + (Math.floor(i / 32) % 2 ? 2 : 0), d * 0.9, { tipo: 'sawtooth', vol: 0.09, filtro: 900, eco: 0 });
        if (i % 2 === 0) bombo(t, 0.3);
        if (i % 2 === 1) chasquido(t, 0.04);
        if (i % 16 === 8) [64, 67, 71].forEach((n) => tono(t, n, d * 1.5, { tipo: 'square', vol: 0.025, filtro: 2500 }));
      }
    },
    juegos: {
      bpm: 100,
      acordes: [[67, 71, 74], [64, 67, 71], [60, 64, 67], [62, 66, 69]], // G Em C D
      paso(t, i, d) {
        const ac = this.acordes[Math.floor(i / 8) % 4];
        if ([0, 3, 4, 6].includes(i % 8)) tono(t, ac[[0, 1, 2, 1][i % 4]], d * 1.4, { tipo: 'triangle', vol: 0.08, filtro: 2600 });
        if (i % 8 === 0) tono(t, ac[0] - 24, d * 4, { tipo: 'sine', vol: 0.16, eco: 0 });
        if (i % 4 === 2) chasquido(t, 0.03, 0.06, 4000);
      }
    }
  };

  function programar() {
    if (!ctx || !ambiente) return;
    const a = AMBIENTES[ambiente];
    const d = 60 / a.bpm / 2; // corchea
    while (proximo < ctx.currentTime + 0.25) {
      try { a.paso(proximo, paso, d); } catch (e) { /* una nota mala no corta la música */ }
      proximo += d;
      paso += 1;
    }
  }

  function arrancar() {
    if (!ctx || !activa || !ambiente || timer) return;
    proximo = ctx.currentTime + 0.1;
    timer = setInterval(programar, 80);
    salida.gain.cancelScheduledValues(ctx.currentTime);
    salida.gain.setTargetAtTime(VOL, ctx.currentTime, 0.6);
  }
  function parar() {
    if (timer) clearInterval(timer);
    timer = null;
    if (ctx && salida) salida.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
  }

  window.Musica = {
    get activa() { return activa; },
    setActiva(v) {
      activa = !!v;
      try { localStorage.setItem(KEY, activa ? 'on' : 'off'); } catch (e) { /* sin storage */ }
      if (activa) { iniciarCtx(); arrancar(); } else parar();
    },
    // Cambia de ambiente (null = silencio). Fundido suave entre ambientes.
    setAmbiente(nombre) {
      const nuevo = AMBIENTES[nombre] ? nombre : null;
      if (nuevo === ambiente) return;
      ambiente = nuevo;
      paso = 0;
      if (!nuevo) { parar(); return; }
      if (ctx && timer) { salida.gain.setTargetAtTime(VOL * 0.3, ctx.currentTime, 0.15); salida.gain.setTargetAtTime(VOL, ctx.currentTime + 0.5, 0.6); }
      if (ctx && activa) arrancar();
    },
    // Baja la música mientras alguien habla por el audio de la sala.
    bajar(si) {
      if (!ctx || !duck) return;
      duck.gain.setTargetAtTime(si ? 0.28 : 1, ctx.currentTime, si ? 0.08 : 0.6);
    }
  };
}());
