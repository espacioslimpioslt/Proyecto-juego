// Audio en vivo entre los participantes (como una llamada grupal), directo de
// celu a celu con WebRTC: el servidor solo "presenta" a los celus (canal
// 'voz-senal'); el audio no pasa por el servidor ni se graba.
//
// - Cada uno elige: prender el audio (pide el micrófono) y, una vez adentro,
//   micrófono abierto, apagado o "mantener apretado para hablar".
// - Cada uno puede silenciar a cualquier otro (solo para sí mismo).
// - Se ilumina quién está hablando.
// - Reglas por juego (las pone app.js): por ejemplo en Mímica el que actúa
//   queda con el micrófono apagado y nadie lo escucha.
// - El anfitrión puede apagar el audio de toda la sala.
//
// Malla: cada celu se conecta con cada otro (anda bien hasta ~8 personas).

(function () {
  const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const KEY = 'soyparticipante:voz';

  let socket = null;
  let myId = null;
  let unido = false;
  let stream = null; // micrófono propio (null = solo escucho)
  let micAbierto = false; // el usuario quiere hablar
  let modoPtt = false; // mantener apretado para hablar
  let pttApretado = false;
  let forzadoMudo = false; // regla del juego (ej. Mímica)
  let motivoMudo = '';
  let lista = []; // [{ id, mic }] quienes tienen el audio prendido
  let nombres = {}; // id -> nombre
  let silenciados = new Set(); // los que yo no quiero escuchar
  let mudosPorJuego = new Set(); // los que nadie escucha por regla del juego
  let todoSilenciado = false;
  let esAnfitrion = false;
  let salaApagada = false;
  let enSala = false;
  const peers = new Map(); // id -> { pc, audio, gain, analyser, hablando }
  let ctx = null;
  let master = null;
  let analizadorPropio = null;
  let hablandoYo = false;
  const alHablar = []; // callbacks(hayAlguienHablando)

  try {
    const g = JSON.parse(localStorage.getItem(KEY) || '{}');
    modoPtt = !!g.ptt;
    silenciados = new Set(g.silenciados || []);
  } catch (e) { /* sin storage */ }
  function guardar() {
    try { localStorage.setItem(KEY, JSON.stringify({ ptt: modoPtt, silenciados: [...silenciados] })); } catch (e) { /* sin storage */ }
  }

  function audioCtx() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      master = ctx.createGain();
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // ---------- Micrófono ----------
  function actualizarPista() {
    if (!stream) return;
    const habla = !forzadoMudo && (modoPtt ? pttApretado : micAbierto);
    stream.getAudioTracks().forEach((t) => { t.enabled = habla; });
  }

  async function pedirMicrofono() {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (e) {
      return null;
    }
  }

  // ---------- Conexiones ----------
  function crearPeer(id) {
    if (peers.has(id)) return peers.get(id);
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const p = { pc, audio: null, gain: null, analyser: null, hablando: false, nivel: 0 };
    peers.set(id, p);
    if (stream) stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.onicecandidate = (e) => { if (e.candidate) socket.emit('voz-senal', { a: id, datos: { ice: e.candidate } }); };
    pc.ontrack = (e) => conectarAudio(id, p, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') { cerrarPeer(id); setTimeout(sincronizar, 1500); }
      pintar();
    };
    return p;
  }

  function conectarAudio(id, p, remoto) {
    // Un <audio> (necesario para que el navegador "abra" el audio remoto) y
    // el volumen y la detección de voz por Web Audio.
    if (!p.audio) {
      p.audio = new Audio();
      p.audio.autoplay = true;
      p.audio.playsInline = true;
    }
    p.audio.srcObject = remoto;
    const c = audioCtx();
    if (c) {
      p.audio.muted = true;
      const src = c.createMediaStreamSource(remoto);
      p.gain = c.createGain();
      p.analyser = c.createAnalyser();
      p.analyser.fftSize = 512;
      src.connect(p.analyser);
      src.connect(p.gain).connect(master);
    }
    p.audio.play().catch(() => {});
    aplicarVolumenes();
  }

  function cerrarPeer(id) {
    const p = peers.get(id);
    if (!p) return;
    try { p.pc.close(); } catch (e) { /* ya cerrada */ }
    if (p.audio) p.audio.srcObject = null;
    if (p.gain) p.gain.disconnect();
    peers.delete(id);
  }

  async function ofrecer(id) {
    const p = crearPeer(id);
    const oferta = await p.pc.createOffer();
    await p.pc.setLocalDescription(oferta);
    socket.emit('voz-senal', { a: id, datos: { sdp: p.pc.localDescription } });
  }

  // Conecta con los que están en la lista y corta con los que se fueron.
  // Para no chocar, ofrece siempre el de id "menor".
  function sincronizar() {
    if (!unido) return;
    const ids = new Set(lista.map((x) => x.id).filter((id) => id !== myId));
    [...peers.keys()].forEach((id) => { if (!ids.has(id)) cerrarPeer(id); });
    ids.forEach((id) => { if (!peers.has(id) && myId < id) ofrecer(id).catch(() => {}); });
    pintar();
  }

  async function recibirSenal({ de, datos }) {
    if (!unido || !datos) return;
    try {
      if (datos.sdp) {
        const p = peers.get(de) || crearPeer(de);
        await p.pc.setRemoteDescription(datos.sdp);
        if (datos.sdp.type === 'offer') {
          const resp = await p.pc.createAnswer();
          await p.pc.setLocalDescription(resp);
          socket.emit('voz-senal', { a: de, datos: { sdp: p.pc.localDescription } });
        }
      } else if (datos.ice) {
        const p = peers.get(de);
        if (p) await p.pc.addIceCandidate(datos.ice);
      }
    } catch (e) { /* una señal vieja o repetida: se ignora */ }
  }

  function aplicarVolumenes() {
    peers.forEach((p, id) => {
      const oir = !todoSilenciado && !silenciados.has(id) && !mudosPorJuego.has(id);
      if (p.gain) p.gain.gain.value = oir ? 1 : 0;
      else if (p.audio) p.audio.muted = !oir;
    });
  }

  // ---------- Entrar / salir ----------
  async function unirse() {
    if (unido || salaApagada) return;
    audioCtx();
    stream = await pedirMicrofono();
    micAbierto = !!stream && !modoPtt;
    if (stream && ctx) {
      analizadorPropio = ctx.createAnalyser();
      analizadorPropio.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analizadorPropio);
    }
    actualizarPista();
    unido = true;
    socket.emit('voz-unirse', { mic: !!stream });
    socket.emit('voz-pedir-lista');
    pintar();
    return !!stream;
  }

  function salir() {
    if (!unido) return;
    unido = false;
    [...peers.keys()].forEach(cerrarPeer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    analizadorPropio = null;
    micAbierto = false;
    socket.emit('voz-salir');
    pintar();
  }

  // ---------- Quién habla ----------
  function nivel(analyser) {
    if (!analyser) return 0;
    const datos = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(datos);
    let suma = 0;
    for (let i = 0; i < datos.length; i++) { const v = (datos[i] - 128) / 128; suma += v * v; }
    return Math.sqrt(suma / datos.length);
  }
  let alguienAntes = false;
  setInterval(() => {
    if (!unido) return;
    let cambio = false;
    peers.forEach((p, id) => {
      const oigo = !todoSilenciado && !silenciados.has(id) && !mudosPorJuego.has(id);
      p.nivel = p.nivel * 0.6 + nivel(p.analyser) * 0.4;
      const h = oigo && p.nivel > 0.025;
      if (h !== p.hablando) { p.hablando = h; cambio = true; }
    });
    const yo = !!(stream && stream.getAudioTracks().some((t) => t.enabled)) && nivel(analizadorPropio) > 0.03;
    if (yo !== hablandoYo) { hablandoYo = yo; cambio = true; }
    const alguien = [...peers.values()].some((p) => p.hablando);
    if (alguien !== alguienAntes) { alguienAntes = alguien; alHablar.forEach((f) => f(alguien)); }
    if (cambio) pintarHablando();
  }, 120);

  // ---------- Interfaz ----------
  let ui = null;
  function armarUi() {
    if (ui) return;
    ui = document.createElement('div');
    ui.className = 'voz hidden';
    ui.innerHTML = `
      <div class="voz-hablan" id="voz-hablan"></div>
      <div class="voz-barra">
        <button class="voz-mic" id="voz-mic" aria-label="Micrófono">🎤</button>
        <button class="voz-mas" id="voz-mas" aria-label="Opciones de audio">⋯</button>
      </div>
      <div class="voz-panel hidden" id="voz-panel"></div>`;
    document.body.appendChild(ui);
    const mic = ui.querySelector('#voz-mic');
    mic.addEventListener('click', async () => {
      if (!unido) { await unirse(); return; }
      if (modoPtt) return;
      if (!stream) { salir(); await unirse(); return; }
      micAbierto = !micAbierto;
      actualizarPista();
      pintar();
    });
    // Mantener apretado para hablar
    const apretar = (v) => (e) => { if (!unido || !modoPtt) return; e.preventDefault(); pttApretado = v; actualizarPista(); pintar(); };
    mic.addEventListener('pointerdown', apretar(true));
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => mic.addEventListener(ev, apretar(false)));
    ui.querySelector('#voz-mas').addEventListener('click', () => {
      ui.querySelector('#voz-panel').classList.toggle('hidden');
      pintarPanel();
    });
  }

  function pintar() {
    if (!ui) return;
    ui.classList.toggle('hidden', !enSala);
    const mic = ui.querySelector('#voz-mic');
    let estado = 'apagado';
    let txt = '🎤';
    if (salaApagada) { estado = 'bloqueado'; txt = '🔕'; }
    else if (!unido) { estado = 'apagado'; txt = '🎤'; }
    else if (!stream) { estado = 'escucha'; txt = '🎧'; }
    else if (forzadoMudo) { estado = 'forzado'; txt = '🤐'; }
    else if (modoPtt) { estado = pttApretado ? 'abierto' : 'ptt'; txt = pttApretado ? '🎙️' : '✋'; }
    else { estado = micAbierto ? 'abierto' : 'mudo'; txt = micAbierto ? '🎙️' : '🔇'; }
    mic.className = `voz-mic ${estado}${hablandoYo ? ' hablando' : ''}`;
    mic.textContent = txt;
    mic.title = {
      bloqueado: 'El anfitrión apagó el audio de la sala',
      apagado: 'Prender el audio de la sala',
      escucha: 'Solo escuchás (no diste permiso al micrófono)',
      forzado: motivoMudo || 'Micrófono apagado por el juego',
      ptt: 'Mantené apretado para hablar',
      abierto: 'Micrófono abierto (tocá para silenciarte)',
      mudo: 'Estás silenciado (tocá para hablar)'
    }[estado];
    if (!ui.querySelector('#voz-panel').classList.contains('hidden')) pintarPanel();
  }

  function pintarHablando() {
    if (!ui) return;
    const hablan = [...peers.entries()].filter(([, p]) => p.hablando).map(([id]) => nombres[id] || 'Alguien');
    ui.querySelector('#voz-hablan').innerHTML = hablan.map((n) => `<span>🔊 ${esc(n)}</span>`).join('');
    ui.querySelector('#voz-mic').classList.toggle('hablando', hablandoYo);
    document.querySelectorAll('[data-voz-id]').forEach((el) => {
      const p = peers.get(el.dataset.vozId);
      el.classList.toggle('voz-hablando', !!(p && p.hablando) || (el.dataset.vozId === myId && hablandoYo));
    });
    if (!ui.querySelector('#voz-panel').classList.contains('hidden')) pintarPanel();
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function pintarPanel() {
    const panel = ui.querySelector('#voz-panel');
    const otros = lista.filter((x) => x.id !== myId);
    const filas = otros.length ? otros.map((x) => {
      const p = peers.get(x.id);
      const conectado = p && ['connected', 'completed'].includes(p.pc.connectionState);
      const sil = silenciados.has(x.id);
      return `<div class="voz-fila${p && p.hablando ? ' hablando' : ''}">
        <span>${p && p.hablando ? '🔊' : x.mic ? '🎤' : '🎧'} ${esc(nombres[x.id] || 'Alguien')}${mudosPorJuego.has(x.id) ? ' <small>(callado por el juego)</small>' : ''}${unido && !conectado ? ' <small>conectando…</small>' : ''}</span>
        <button data-silenciar="${esc(x.id)}" class="${sil ? 'on' : ''}">${sil ? '🔇 Silenciado' : 'Silenciar'}</button>
      </div>`;
    }).join('') : '<p class="voz-nadie">Nadie más prendió el audio todavía.</p>';
    panel.innerHTML = `
      <p class="voz-tit">🎙️ Audio de la sala</p>
      ${salaApagada ? '<p class="voz-nadie">El anfitrión apagó el audio de esta sala.</p>' : filas}
      <div class="voz-opciones">
        ${unido ? `<label><input type="checkbox" id="voz-ptt" ${modoPtt ? 'checked' : ''}> Mantener apretado para hablar</label>
        <label><input type="checkbox" id="voz-todos" ${todoSilenciado ? 'checked' : ''}> Silenciar a todos</label>` : ''}
        <label><input type="checkbox" id="voz-musica" ${window.Musica && Musica.activa ? 'checked' : ''}> 🎵 Música de fondo</label>
        ${unido ? '<button id="voz-salir" class="voz-salir">Salir del audio</button>' : (salaApagada ? '' : '<button id="voz-entrar" class="voz-entrar">🎤 Prender el audio</button>')}
        ${esAnfitrion ? `<button id="voz-sala" class="voz-salir">${salaApagada ? '🔊 Permitir audio en la sala' : '🔕 Apagar el audio de la sala'}</button>` : ''}
      </div>
      <p class="voz-nota">El audio va directo entre los celus: no se graba ni pasa por el servidor.</p>`;
    panel.querySelectorAll('[data-silenciar]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.silenciar;
      if (silenciados.has(id)) silenciados.delete(id); else silenciados.add(id);
      guardar(); aplicarVolumenes(); pintarPanel();
    }));
    const ptt = panel.querySelector('#voz-ptt');
    if (ptt) ptt.addEventListener('change', () => { modoPtt = ptt.checked; pttApretado = false; micAbierto = !modoPtt && !!stream; guardar(); actualizarPista(); pintar(); });
    const todos = panel.querySelector('#voz-todos');
    if (todos) todos.addEventListener('change', () => { todoSilenciado = todos.checked; aplicarVolumenes(); });
    const mus = panel.querySelector('#voz-musica');
    if (mus) mus.addEventListener('change', () => { if (window.Musica) Musica.setActiva(mus.checked); });
    const sal = panel.querySelector('#voz-salir');
    if (sal) sal.addEventListener('click', () => { salir(); });
    const ent = panel.querySelector('#voz-entrar');
    if (ent) ent.addEventListener('click', () => { unirse(); });
    const sala = panel.querySelector('#voz-sala');
    if (sala) sala.addEventListener('click', () => socket.emit('voz-sala', { apagada: !salaApagada }));
  }

  // ---------- API para app.js ----------
  window.Voz = {
    iniciar(s, id) {
      socket = s;
      myId = id;
      armarUi();
      socket.on('voz-lista', (l) => { lista = Array.isArray(l) ? l : []; if (unido && !lista.some((x) => x.id === myId)) { socket.emit('voz-unirse', { mic: !!stream }); } sincronizar(); });
      socket.on('voz-senal', recibirSenal);
      socket.on('connect', () => { if (unido) { socket.emit('voz-unirse', { mic: !!stream }); socket.emit('voz-pedir-lista'); } });
    },
    // Se llama en cada actualización de la sala.
    setSala(room) {
      const antes = enSala;
      enSala = !!room;
      if (!room) { salir(); lista = []; pintar(); return; }
      nombres = Object.fromEntries(room.players.map((p) => [p.id, p.name]));
      esAnfitrion = room.hostId === myId;
      const apagada = !!room.vozApagada;
      if (apagada && !salaApagada) salir();
      salaApagada = apagada;
      if (!antes) pintar(); else pintar();
    },
    // Reglas del juego actual: { mudos: [ids que nadie escucha], motivo }
    setReglas({ mudos = [], motivo = '' } = {}) {
      mudosPorJuego = new Set(mudos);
      const forzar = mudosPorJuego.has(myId);
      if (forzar !== forzadoMudo) { forzadoMudo = forzar; motivoMudo = motivo; actualizarPista(); pintar(); }
      aplicarVolumenes();
    },
    alHablar(f) { alHablar.push(f); },
    get unido() { return unido; },
    hablando: (id) => (id === myId ? hablandoYo : !!(peers.get(id) || {}).hablando)
  };
}());
