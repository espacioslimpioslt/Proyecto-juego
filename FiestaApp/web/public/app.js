// Identidad de este celu para el servidor. NO es la conexion: si se corta
// (pantalla bloqueada, cambio de app, wifi que va y viene) el socket nuevo
// manda el mismo playerId + secreto y el servidor le devuelve su lugar en la
// sala. Vive en sessionStorage (por pestaña): sobrevive a recargar la página,
// y dos pestañas del mismo navegador siguen siendo dos jugadores distintos.
function randomId() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
}
function loadIdentity() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('soyparticipante:id'));
    if (saved && saved.playerId && saved.secret) return saved;
  } catch { /* sin storage: identidad nueva */ }
  const fresh = { playerId: randomId(), secret: randomId() };
  try { sessionStorage.setItem('soyparticipante:id', JSON.stringify(fresh)); } catch { /* sigue sin guardar */ }
  return fresh;
}
const identity = loadIdentity();
const socket = io({ auth: identity });

const myId = identity.playerId;
let room = null;
let lastRoundKey = null;
let catalog = [];
let chosenProgramId = null;
let voiceEnabled = true; // se ajusta abajo, una vez que se leen las preferencias
let lastSpokenKey = null;
let soupSelectionByTeam = {}; // primera casilla marcada, por equipo (cada uno tiene su propia sopa)

const $ = (id) => document.getElementById(id);

// Todo texto que escribe un jugador (nombres, palabras de Tutifruti) pasa por
// aca antes de meterlo en innerHTML: si no, un nombre como "<b>hola</b>" se
// dibujaba como HTML en el celu de todos.
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ---------- Preferencias por defecto (guardadas en este celu) ----------
// No es una cuenta -- vive en localStorage de este navegador nomás. Sirve
// para no tener que tocar región / mayores / voz cada vez que se arma una
// sala nueva desde el mismo celu.
const PREFS_KEY = 'soyparticipante:prefs';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}
function savePrefs() { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }
const prefs = Object.assign({ region: 'global', adultsOnly: false, voice: true, difficulty: 'normal' }, loadPrefs());
voiceEnabled = prefs.voice;

let currentScreenId = null;

function showScreen(id) {
  const changed = id !== currentScreenId;
  currentScreenId = id;
  document.querySelectorAll('.screen').forEach((el) => el.classList.add('hidden'));
  const target = $(id);
  target.classList.remove('hidden');
  $('app').classList.toggle('wide-app', id === 'screen-start');
  $('bottom-tabs').classList.toggle('visible', id === 'screen-start');

  // Transición suave solo cuando de verdad se cambia de pantalla -- no en cada
  // actualización de estado dentro de la misma pantalla (evita reiniciar la
  // animación una vez por segundo mientras corre un reloj, por ejemplo).
  if (changed) {
    target.classList.remove('screen-enter');
    void target.offsetWidth;
    target.classList.add('screen-enter');
  }
}

function showError(msg) {
  const toast = $('error-toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(showError._t);
  showError._t = setTimeout(() => toast.classList.add('hidden'), 3500);
}

function me() {
  return room ? room.players.find((p) => p.id === myId) : null;
}

function myEntrantId() {
  const player = me();
  if (!player) return null;
  return room.teamsEnabled ? player.team : player.id;
}

function entrantLabel(entrantId) {
  if (room.teamsEnabled) return entrantId;
  const player = room.players.find((p) => p.id === entrantId);
  return player ? player.name : entrantId;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatEstimate(seconds) {
  if (!seconds) return '';
  return `Dura aproximadamente ${Math.round(seconds / 60)} min.`;
}

// Barra visual para cualquier reloj de juego (además del número), para que la
// urgencia se sienta de un vistazo y no haya que leer el conteo.
function progressBarHtml(current, max) {
  if (!max) return '';
  const pct = Math.max(0, Math.min(100, (current / max) * 100));
  const danger = pct <= 25 ? ' danger' : '';
  return `<div class="timer-bar"><div class="timer-bar-fill${danger}" style="width:${pct}%"></div></div>`;
}

// ---------- Conductor con voz (Web Speech API, nativa del navegador) ----------
function speak(text) {
  if (!voiceEnabled || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'es-ES';
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}

// Lee algo una sola vez, y solo en el celu del anfitrión, para que se escuche
// una vez en la sala y no una vez por cada teléfono.
function narrate(key, text) {
  if (myId !== room.hostId || key === lastSpokenKey) return;
  lastSpokenKey = key;
  speak(text);
}

// ---------- Portada estilo streaming: hero + filas horizontales ----------

// Programas ya diseñados (ver Docs/PLAN_APP_FIESTA.md) pero todavía no
// construidos. Es contenido de marketing nomás — no crean sala ni hacen nada
// al tocarlos, solo muestran que la galería sigue creciendo.
const UPCOMING = [
  { icon: '💰', name: 'Comodines', tagline: 'Trivia con ayudas para arriesgar todo o guardar lo ganado.', categories: ['familia', 'amigos'] },
  { icon: '🔒', name: 'La Caja Fuerte', tagline: 'Puro riesgo: elegís cajas y el juego te ofrece un trato.', categories: ['familia', 'ninos'] },
  { icon: '🔡', name: 'La Ruleta de Letras', tagline: 'Adiviná la frase oculta, letra por letra.', categories: ['familia', 'pareja'] },
  { icon: '⛓️', name: 'La Cadena', tagline: 'Trivia en equipo con un banco que se vota entre todos.', categories: ['amigos'] },
  { icon: '🎤', name: 'A Toda Voz', tagline: 'Karaoke con puntaje por afinación o jurado en vivo.', categories: ['amigos', 'pareja'] },
  { icon: '🕵️', name: 'El Cazador', tagline: 'Escondida en una casa virtual en 3D — el más ambicioso.', categories: ['amigos', 'ninos'] },
  { icon: '🎵', name: 'Adiviná la Canción', tagline: 'En pausa: hay que resolver el tema de derechos musicales primero.', categories: ['amigos', 'pareja'], paused: true }
];

// Categorías de los programas ya construidos (el servidor no las manda, son
// editoriales — a medida que haya más programas reales esto se puede mover
// al manifest.json de cada uno).
const REAL_CATEGORIES = { 'el-rosco': ['cartelera', 'familia', 'amigos'] };
const REAL_ICONS = { 'el-rosco': '🎡' };

const GRADIENTS = [
  'linear-gradient(135deg,#3a2a6d,#7a3b69)',
  'linear-gradient(135deg,#1f3a5f,#3c6e8f)',
  'linear-gradient(135deg,#5c2a2a,#9c4a3a)',
  'linear-gradient(135deg,#2a5c3f,#4a9c6a)',
  'linear-gradient(135deg,#5c4a1f,#c98a2e)',
  'linear-gradient(135deg,#2a2a5c,#5a4a9c)',
  'linear-gradient(135deg,#4a1f3a,#9c2e6a)'
];
function gradientFor(id) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return GRADIENTS[hash % GRADIENTS.length];
}

let ALL_PROGRAMS = [];

function buildAllPrograms() {
  const real = catalog.map((p) => ({
    id: p.id,
    name: p.name,
    tagline: p.tagline,
    description: p.description,
    icon: REAL_ICONS[p.id] || '🎮',
    playable: true,
    minPlayers: p.minPlayers,
    maxPlayers: p.maxPlayers,
    categories: REAL_CATEGORIES[p.id] || ['cartelera'],
    gameLabels: p.gameLabels
  }));
  const upcoming = UPCOMING.map((p, i) => ({
    id: `soon-${i}`,
    name: p.name,
    tagline: p.tagline,
    icon: p.icon,
    playable: false,
    paused: !!p.paused,
    categories: p.categories
  }));
  return [...real, ...upcoming];
}

function openProgram(program) {
  if (!program.playable) {
    return showError(`"${program.name}" está en camino — todavía no se puede jugar.`);
  }
  chosenProgramId = program.id;
  $('create-title').textContent = program.name;
  $('create-program-desc').textContent = program.description || '';
  $('create-games').innerHTML = (program.gameLabels || [])
    .map((g) => `<span>${g.icon} ${g.label}</span>`).join('');
  showScreen('screen-create');
}

function posterHtml(program, rank) {
  const sub = program.playable
    ? `${program.minPlayers}–${program.maxPlayers} jug.`
    : (program.paused ? 'En pausa' : 'Próximamente');
  const posterButton = `
    <button class="poster${program.playable ? '' : ' locked'}" data-id="${program.id}" aria-label="${program.name}">
      <div class="poster-art" style="background:${gradientFor(program.id)}">${program.icon}</div>
      ${!program.playable ? `<span class="poster-badge">${program.paused ? 'En pausa' : 'Próximamente'}</span><span class="poster-lock">🔒</span>` : ''}
    </button>
  `;
  return `
    <div class="poster-cell${rank != null ? ' ranked' : ''}${program.playable ? '' : ' locked'}">
      ${rank != null
        ? `<div class="poster-row"><span class="rank-num">${rank}</span>${posterButton}</div>`
        : posterButton}
      <div class="poster-caption">
        <p class="pc-title">${program.name}</p>
        <p class="pc-sub">${sub}</p>
      </div>
    </div>
  `;
}

function renderHero(all) {
  const featured = all.find((p) => p.playable) || all[0];
  if (!featured) return;
  const hero = $('hero');
  hero.style.background = gradientFor(featured.id);
  hero.innerHTML = `
    <span class="hero-icon-bg">${featured.icon}</span>
    <div class="hero-content">
      <p class="hero-tag">🔴 En cartelera ahora</p>
      <h1 class="hero-title">${featured.name}</h1>
      <div class="hero-meta">
        <b>● Jugable ya</b>
        <span>${featured.minPlayers}–${featured.maxPlayers} jugadores</span>
        <span>${(featured.gameLabels || []).length} pruebas</span>
      </div>
      <p class="hero-lede">${featured.description || ''}</p>
      <div class="hero-ctas">
        <button class="hero-btn play" id="hero-play">▶ Jugar ahora</button>
        <button class="hero-btn info" id="hero-info">ℹ Más información</button>
      </div>
    </div>
  `;
  $('hero-play').addEventListener('click', () => openProgram(featured));
  $('hero-info').addEventListener('click', () => {
    document.getElementById('row-cartelera')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function renderRow(container, id, title, items, ranked) {
  if (!items.length) return;
  const row = document.createElement('div');
  row.className = 'row';
  row.id = id;
  row.innerHTML = `
    <div class="row-head">
      <h2 class="row-title"><span class="row-bar"></span>${title}</h2>
      <button class="row-seeall" type="button">Ver todas</button>
    </div>
    <div class="row-scroll${ranked ? ' ranked' : ''}">
      ${items.map((p, i) => posterHtml(p, ranked ? i + 1 : null)).join('')}
    </div>
  `;
  row.querySelector('.row-seeall').addEventListener('click', () => {
    row.querySelector('.row-scroll').scrollBy({ left: 400, behavior: 'smooth' });
  });
  container.appendChild(row);
}

function renderRows() {
  ALL_PROGRAMS = buildAllPrograms();
  renderHero(ALL_PROGRAMS);

  const container = $('rows-container');
  container.innerHTML = '';

  // Todavía no hay datos reales de uso (recién arranca) -- se presenta como
  // "recomendados para arrancar", con el mismo formato numerado de un Top,
  // pero sin inventar un dato de popularidad que no existe.
  renderRow(container, 'row-ranking', '🔥 Recomendados para arrancar', ALL_PROGRAMS.slice(0, 5), true);
  renderRow(container, 'row-cartelera', '🎬 En cartelera', ALL_PROGRAMS.filter((p) => p.categories.includes('cartelera')));
  renderRow(container, 'row-familia', '👨‍👩‍👧 Para jugar en familia', ALL_PROGRAMS.filter((p) => p.categories.includes('familia')));
  renderRow(container, 'row-amigos', '🎉 Para la previa con amigos', ALL_PROGRAMS.filter((p) => p.categories.includes('amigos')));
  renderRow(container, 'row-pareja', '💑 Para jugar en pareja', ALL_PROGRAMS.filter((p) => p.categories.includes('pareja')));
  renderRow(container, 'row-ninos', '🧒 Para los más chicos', ALL_PROGRAMS.filter((p) => p.categories.includes('ninos')));
  renderRow(container, 'row-proximamente', '🔜 Próximamente en la galería', ALL_PROGRAMS.filter((p) => !p.playable));
}

$('rows-container').addEventListener('click', (e) => {
  const btn = e.target.closest('.poster');
  if (!btn) return;
  const program = ALL_PROGRAMS.find((p) => p.id === btn.dataset.id);
  if (program) openProgram(program);
});

async function loadCatalog() {
  try {
    const res = await fetch('/api/catalog');
    catalog = await res.json();
  } catch {
    return showError('No se pudo cargar el catálogo de programas.');
  }
  renderRows();
}
loadCatalog();

// Llegó por un link de invitación (?sala=CODIGO): directo a "Unirme" con el
// código ya cargado, solo falta el nombre.
(function abrirInvitacion() {
  const code = new URLSearchParams(location.search).get('sala');
  if (!code) return;
  $('join-code').value = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  showScreen('screen-join');
  $('join-name').focus();
  history.replaceState(null, '', location.pathname);
}());

// ---------- Menú lateral ----------
function openMenu() {
  $('side-menu').classList.add('open');
  $('menu-backdrop').classList.remove('hidden');
  $('menu-backdrop').classList.add('open');
}
function closeMenu() {
  $('side-menu').classList.remove('open');
  $('menu-backdrop').classList.remove('open');
  setTimeout(() => $('menu-backdrop').classList.add('hidden'), 200);
}
$('btn-menu-open').addEventListener('click', openMenu);
$('btn-menu-close').addEventListener('click', closeMenu);
$('menu-backdrop').addEventListener('click', closeMenu);

async function initPrefsMenu() {
  // El checkbox de voz de la sala de espera arranca con la preferencia guardada.
  $('config-voice').checked = voiceEnabled;

  $('pref-adults').checked = prefs.adultsOnly;
  $('pref-voice').checked = prefs.voice;

  try {
    const regiones = await (await fetch('/api/regions')).json();
    $('pref-region').innerHTML = regiones.map((r) => `<option value="${r.id}">${r.nombre}</option>`).join('');
    $('pref-region').value = prefs.region;
  } catch {
    // Sin conexion al cargar el menu no es grave -- se puede reintentar despues.
  }

  try {
    const dificultades = await (await fetch('/api/difficulties')).json();
    $('pref-difficulty').innerHTML = dificultades.map((d) => `<option value="${d.id}">${d.nombre}</option>`).join('');
    $('pref-difficulty').value = prefs.difficulty;
  } catch {
    // idem
  }
}
initPrefsMenu();

$('pref-region').addEventListener('change', (e) => { prefs.region = e.target.value; savePrefs(); });
$('pref-difficulty').addEventListener('change', (e) => { prefs.difficulty = e.target.value; savePrefs(); });
$('pref-adults').addEventListener('change', (e) => { prefs.adultsOnly = e.target.checked; savePrefs(); });
$('pref-voice').addEventListener('change', (e) => {
  prefs.voice = e.target.checked;
  savePrefs();
  // Tambien actualiza la sesion actual, no solo la proxima sala.
  voiceEnabled = prefs.voice;
  $('config-voice').checked = prefs.voice;
});

$('btn-go-join').addEventListener('click', () => showScreen('screen-join'));
document.querySelectorAll('.btn-back').forEach((btn) => {
  btn.addEventListener('click', () => showScreen(btn.dataset.back));
});

$('btn-create-submit').addEventListener('click', () => {
  const name = $('create-name').value.trim();
  if (!name) return showError('Poné tu nombre primero.');
  socket.emit('create-room', {
    name,
    programId: chosenProgramId,
    prefs: { region: prefs.region, adultsOnly: prefs.adultsOnly, difficulty: prefs.difficulty }
  });
});

$('btn-join-submit').addEventListener('click', () => {
  const code = $('join-code').value.trim().toUpperCase();
  const name = $('join-name').value.trim();
  if (!code || !name) return showError('Completá el código y tu nombre.');
  socket.emit('join-room', { code, name });
});

// ---------- Lobby / configuración ----------
// "Juan, María, Pedro" -> ["Juan", "María", "Pedro"], sin vacíos.
function parseTestNames(value) {
  return String(value || '').split(',').map((n) => n.trim()).filter(Boolean);
}

function sendConfig() {
  $('config-test-names').classList.toggle('hidden', !$('config-test').checked);
  const selectedGames = Array.from($('config-game-picker-list').querySelectorAll('input[data-game-id]:checked'))
    .map((input) => input.dataset.gameId);
  socket.emit('set-config', {
    programId: $('config-program').value,
    roundCount: Number($('config-rounds').value),
    teamsEnabled: true,
    testMode: $('config-test').checked,
    baseTimeSeconds: Number($('config-time').value),
    region: $('config-region').value,
    adultsOnly: $('config-adults').checked,
    difficulty: $('config-difficulty').value,
    testNamesA: parseTestNames($('config-test-names-a').value),
    testNamesB: parseTestNames($('config-test-names-b').value),
    selectedGames
  });
}
[
  'config-program', 'config-rounds', 'config-time', 'config-region', 'config-difficulty', 'config-adults',
  'config-test', 'config-test-names-a', 'config-test-names-b'
].forEach((id) => $(id).addEventListener('change', sendConfig));

// Programas "pick" (ej. Varios): en vez de sortear una cantidad de pruebas,
// el anfitrión tilda a mano cuáles quiere jugar. Arranca con todo tildado
// (menos clicks si quiere jugarlas todas) y sincroniza ese default apenas se
// arma la lista.
function renderGamePicker() {
  const catProgram = catalog.find((p) => p.id === room.programId);
  const list = $('config-game-picker-list');
  if (list.dataset.filledFor !== room.programId) {
    list.innerHTML = '';
    const gameIds = (catProgram && catProgram.games) || [];
    const gameLabels = (catProgram && catProgram.gameLabels) || [];
    gameIds.forEach((gameId, i) => {
      const g = gameLabels[i] || { label: gameId, icon: '🎮' };
      const row = document.createElement('label');
      row.className = 'checkbox-row';
      row.innerHTML = `<input type="checkbox" data-game-id="${gameId}" checked> ${g.icon} ${g.label}`;
      row.querySelector('input').addEventListener('change', sendConfig);
      list.appendChild(row);
    });
    list.dataset.filledFor = room.programId;
    sendConfig(); // sincroniza el default "todo tildado" con el servidor
  } else {
    list.querySelectorAll('input[data-game-id]').forEach((input) => {
      input.checked = (room.selectedGames || []).includes(input.dataset.gameId);
    });
  }
}

$('config-voice').addEventListener('change', (e) => {
  voiceEnabled = e.target.checked;
  if (!voiceEnabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
});

$('btn-start-game').addEventListener('click', () => socket.emit('start-game'));
$('config-locked').addEventListener('change', (e) => socket.emit('lock-room', { locked: e.target.checked }));

// ---------- Invitar por link (WhatsApp) ----------
// El link lleva el codigo de la sala: quien lo abre cae directo en "Unirme"
// con el codigo ya cargado, y solo tiene que poner su nombre. Asi se suman
// los que estan lejos (hijos, parientes, amigos) sin dictar codigos.
function inviteLink() {
  return `${location.origin}/?sala=${encodeURIComponent(room.code)}`;
}
$('btn-invite-whatsapp').addEventListener('click', () => {
  if (!room) return;
  const texto = `¡Vení a jugar a Soy Participante! Entrá acá: ${inviteLink()} (código ${room.code})`;
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
});
$('btn-copy-link').addEventListener('click', async () => {
  if (!room) return;
  try {
    await navigator.clipboard.writeText(inviteLink());
    showError('Link copiado. Pegalo en el grupo de WhatsApp.');
  } catch {
    showError(`Mandá este link: ${inviteLink()}`);
  }
});

function renderLobby() {
  $('lobby-code').textContent = room.code;

  $('lobby-players').innerHTML = '';
  room.players.forEach((p) => {
    const li = document.createElement('li');
    const label = p.name + (p.id === room.hostId ? ' (anfitrión)' : '') + (p.team ? ` — ${p.team}` : '')
      + (p.connected ? '' : ' · 📵 se le cortó, esperando que vuelva');
    li.innerHTML = `<span>${esc(label)}</span>`;
    li.classList.toggle('offline', !p.connected);
    if (myId === room.hostId && p.id !== room.hostId) {
      const btn = document.createElement('button');
      btn.textContent = 'Sacar';
      btn.addEventListener('click', () => socket.emit('kick-player', { playerId: p.id }));
      li.appendChild(btn);
    }
    $('lobby-players').appendChild(li);
  });

  const iAmHost = myId === room.hostId;
  $('config-locked').checked = !!room.locked;
  $('lobby-host-controls').classList.toggle('hidden', !iAmHost);
  $('lobby-waiting-msg').classList.toggle('hidden', iAmHost);
  if (!iAmHost) return;

  const select = $('config-program');
  if (select.dataset.filled !== 'yes') {
    select.innerHTML = room.availablePrograms.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
    select.dataset.filled = 'yes';
  }
  if (room.programId) select.value = room.programId;
  if (room.roundCount) $('config-rounds').value = String(room.roundCount);

  // Programas "pick" (Varios): se tildan los juegos a mano, no se sortea una
  // cantidad, y no hay rosco final que gaste el tiempo base.
  const esPick = room.sequenceMode === 'pick';
  $('config-rounds-label').classList.toggle('hidden', esPick);
  $('config-game-picker').classList.toggle('hidden', !esPick);
  $('config-time-label').classList.toggle('hidden', !room.hasFinalGame);
  $('config-time-desc').classList.toggle('hidden', !room.hasFinalGame);
  if (esPick && room.programId) renderGamePicker();

  $('config-test').checked = room.testMode;
  $('config-test-names').classList.toggle('hidden', !room.testMode);
  const namesA = $('config-test-names-a');
  const namesB = $('config-test-names-b');
  if (document.activeElement !== namesA) namesA.value = (room.testNamesA || []).join(', ');
  if (document.activeElement !== namesB) namesB.value = (room.testNamesB || []).join(', ');
  $('config-adults').checked = room.adultsOnly;
  if (room.baseTimeSeconds) $('config-time').value = String(room.baseTimeSeconds);

  const regionSelect = $('config-region');
  if (regionSelect.dataset.filled !== 'yes' && room.regionesDisponibles) {
    regionSelect.innerHTML = room.regionesDisponibles
      .map((r) => `<option value="${r.id}">${r.nombre}</option>`).join('');
    regionSelect.dataset.filled = 'yes';
  }
  if (room.region) regionSelect.value = room.region;

  const difficultySelect = $('config-difficulty');
  if (difficultySelect.dataset.filled !== 'yes' && room.dificultadesDisponibles) {
    difficultySelect.innerHTML = room.dificultadesDisponibles
      .map((d) => `<option value="${d.id}">${d.nombre}</option>`).join('');
    difficultySelect.dataset.filled = 'yes';
  }
  if (room.difficulty) difficultySelect.value = room.difficulty;

  $('config-estimate').textContent = formatEstimate(room.estimatedSeconds);

  const teams = new Set(room.players.map((p) => p.team).filter(Boolean));
  const enough = room.testMode || teams.size >= 2;
  $('btn-start-game').disabled = !room.programId || !enough;
  $('btn-start-game').textContent = enough ? 'Empezar' : 'Esperando a que se sume alguien más...';
}

// Colores de equipo, consistentes en todas las pantallas de juego (marcador,
// turnos, resultados) -- así cada equipo se reconoce de un vistazo, no solo
// por el nombre. `assignTeamsAutomatically` en el servidor siempre nombra los
// equipos así, por eso alcanza con una tabla fija.
const TEAM_COLORS = { 'Equipo A': '#5b8dd6', 'Equipo B': '#e0637a' };
function teamColor(entrantId) {
  return TEAM_COLORS[entrantId] || null;
}

// ---------- Marcador superior de cada prueba ----------
// Juegos finales con reloj propio por equipo (el Rosco, la Escalera Final):
// se muestra el tiempo restante en vez de los segundos ganados.
const JUEGOS_CON_RELOJ_FINAL = ['rosco-por-turnos', 'escalera-final'];

function renderBanks(round) {
  const container = $('time-banks');
  container.innerHTML = '';
  const esRosco = JUEGOS_CON_RELOJ_FINAL.includes(round.type);

  Object.entries(round.entrants).forEach(([entrantId, state]) => {
    const box = document.createElement('div');
    const isActive = entrantId === round.activeEntrant;
    box.className = 'time-bank'
      + (isActive ? ' active' : '')
      + (state.out || state.done ? ' out' : '')
      + (esRosco && state.timeLeft <= 10 && !state.out ? ' low' : '');
    const color = teamColor(entrantId);
    if (color) box.style.setProperty('--team-color', color);

    const onDuty = (room.currentMembers || {})[entrantId];
    // 📵 = se le cortó la conexión; su turno lo toma el siguiente del equipo
    // hasta que vuelva.
    const members = (room.teamsEnabled ? room.players.filter((p) => p.team === entrantId) : [])
      .map((p) => {
        const n = esc(p.name) + (p.connected ? '' : ' 📵');
        return onDuty && onDuty.id === p.id ? `<strong>${n}</strong>` : n;
      });

    // En el rosco se muestra el reloj; en las pruebas, los segundos ganados.
    const main = esRosco
      ? formatTime(state.timeLeft)
      : `+${state.secondsWon || 0}s`;

    // La Silla muestra las vidas que le quedan al equipo.
    const lives = round.erroresPermitidos !== undefined && state.errors !== undefined
      ? `<span class="tb-lives">${'●'.repeat(Math.max(round.erroresPermitidos - state.errors, 0))}${'○'.repeat(Math.min(state.errors, round.erroresPermitidos))}</span>`
      : '';

    box.innerHTML = `
      <span class="tb-name">${entrantLabel(entrantId)}</span>
      <span class="tb-time">${main}</span>
      ${lives}
      ${members.length ? `<span class="tb-members">${members.join(', ')}</span>` : ''}
    `;
    container.appendChild(box);
  });
}

// ---------- Tableros por juego ----------
const CLUE_LABELS = {
  empieza: (l) => `Empieza con "${l}"`,
  contiene: (l) => `Contiene la letra "${l}"`,
  termina: (l) => `Termina con "${l}"`
};
const CLUE_SHORT = { empieza: 'EMPIEZA CON', contiene: 'CONTIENE LA', termina: 'TERMINA CON' };

function boardRosco(round, container) {
  const iControlAll = room.testMode && myId === room.hostId;
  const shownEntrant = iControlAll ? round.activeEntrant : myEntrantId();
  const myState = round.entrants[shownEntrant] || round.entrants[round.activeEntrant];
  const item = round.currentLetter;
  const currentLetter = item ? item.letter : null;
  const total = round.letters.length;

  const wheel = document.createElement('div');
  wheel.className = 'rosco-wheel';

  round.letters.forEach((letter, i) => {
    const angle = (i / total) * 2 * Math.PI - Math.PI / 2;
    const x = 50 + 42 * Math.cos(angle);
    const y = 50 + 42 * Math.sin(angle);
    const dot = document.createElement('div');
    const result = myState ? myState.results[letter] : 'pending';
    const isCurrent = letter === currentLetter && round.activeEntrant === shownEntrant;
    dot.className = 'rosco-letter ' + result + (isCurrent ? ' current' : '');
    dot.style.left = `${x}%`;
    dot.style.top = `${y}%`;
    dot.textContent = letter;
    wheel.appendChild(dot);
  });

  const center = document.createElement('div');
  center.className = 'rosco-center';
  center.innerHTML = item
    ? `<div><div class="rc-letter">${currentLetter}</div><div class="rc-hint">${CLUE_SHORT[item.clueType] || CLUE_SHORT.empieza}</div></div>`
    : '<div class="rc-hint">Rosco terminado</div>';
  wheel.appendChild(center);
  container.appendChild(wheel);

  if (item) {
    const box = document.createElement('div');
    box.className = 'board';
    const label = (CLUE_LABELS[item.clueType] || CLUE_LABELS.empieza)(item.letter);
    box.innerHTML = `<p class="board-clue"><strong>${label}</strong><br>${item.clue}</p>`;
    container.appendChild(box);
    narrate(`rosco-${round.activeEntrant}-${item.letter}`, `${label}. ${item.clue}`);
  }
  return item ? item.options : null;
}

function boardEligiUna(round, container) {
  const q = round.question;
  const box = document.createElement('div');
  box.className = 'board';
  box.innerHTML = `
    <p class="board-topic">${round.theme || 'Elegí Una'}</p>
    <p class="board-clue">${q ? q.clue : 'Prueba terminada'}</p>
    <p class="board-counter">Pregunta ${round.number} de ${round.total} · cada acierto suma ${round.secondsPerHit}s</p>
  `;
  container.appendChild(box);
  if (q) narrate(`eligi-${round.number}`, q.clue);
  return q ? q.options : null;
}

function boardLaSilla(round, container) {
  const q = round.question;
  const active = round.entrants[round.activeEntrant] || {};

  const box = document.createElement('div');
  box.className = 'board';
  const steps = Array.from({ length: round.total || 5 }, (_, i) => {
    const cls = i < round.number - 1 ? 'silla-step' : (i === round.number - 1 ? 'silla-step current' : 'silla-step');
    return `<span class="${cls}">${i + 1}</span>`;
  }).join('');

  box.innerHTML = `
    <p class="board-topic">Todas empiezan con...</p>
    <div class="silla-letter">${round.letter || '?'}</div>
    <p class="board-clue">${q ? q.clue : 'Tanda terminada'}</p>
    <div class="silla-chain">${steps}</div>
    <p class="board-counter">Pregunta ${round.number} de ${round.total} · quedan ${Math.max(round.erroresPermitidos - (active.errors || 0), 0)} vidas</p>
  `;
  container.appendChild(box);
  if (q) narrate(`silla-${round.activeEntrant}-${round.number}`, `Empieza con ${round.letter}. ${q.clue}`);
  return q ? q.options : null;
}

function boardDondeEstaba(round, container) {
  const ask = round.askItem;
  const box = document.createElement('div');
  box.className = 'board';
  box.innerHTML = round.memorizando
    ? `<p class="board-topic">${round.topic || ''}</p>
       <p class="board-clue">¡Memoricen dónde está cada imagen!</p>
       <p class="board-counter">Se tapa en ${round.revealSecondsLeft}s</p>
       ${progressBarHtml(round.revealSecondsLeft, round.revealMaxSeconds)}`
    : `<p class="board-topic">${round.topic || ''}</p>
       <p class="board-clue">¿Dónde estaba esto?</p>
       <p class="memo-ask-emoji">${ask ? ask.emoji : '❔'}</p>
       <p class="board-clue">${ask ? ask.label : '...'}</p>
       <p class="board-counter">Pregunta ${round.number} de ${round.total} · cada acierto suma ${round.secondsPerHit}s</p>`;
  container.appendChild(box);

  const grid = document.createElement('div');
  grid.className = 'grid-panel cols-3';
  const feedback = round.lastFeedback;

  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('button');
    const visible = round.items && round.items[i];
    let cls = 'grid-cell' + (visible ? '' : ' hidden-cell');
    if (feedback && feedback.correctCell === i) cls += ' correct';
    cell.className = cls;
    cell.textContent = visible ? visible.emoji : '';
    cell.disabled = round.memorizando || !myTurnNow(round);
    cell.addEventListener('click', () => socket.emit('submit-answer', { cellIndex: i }));
    grid.appendChild(cell);
  }
  container.appendChild(grid);

  if (round.memorizando) narrate(`memo-${round.topic}`, `Memoricen el panel de ${round.topic}.`);
  else if (ask) narrate(`memo-${round.number}`, `¿Dónde estaba ${ask.label}?`);
  return null; // no usa botones de opción
}

// Cada equipo tiene su PROPIA sopa (mismo panel, progreso independiente) y
// las resuelven al mismo tiempo -- no hay "de quién es el turno", por eso ya
// no hace falta ocultar la grilla (nadie se adelanta viéndola, no comparten
// el pool de palabras encontradas).
let sopaBuiltFor = null;

function renderSopaGrid(round, container, entrantId, { conEtiqueta, testHint }) {
  const entrant = round.entrants[entrantId];
  if (!entrant) return;

  const wrap = document.createElement('div');
  wrap.className = 'soup-team-wrap';
  if (conEtiqueta) {
    const label = document.createElement('p');
    label.className = 'muted';
    label.textContent = entrantLabel(entrantId);
    wrap.appendChild(label);
  }

  const foundCells = new Set();
  entrant.words.forEach((w) => { if (w.cells) w.cells.forEach((c) => foundCells.add(c)); });

  const grid = document.createElement('div');
  grid.className = 'soup-grid';
  grid.style.gridTemplateColumns = `repeat(${round.size}, 1fr)`;

  round.grid.forEach((letter, i) => {
    const cell = document.createElement('button');
    const found = foundCells.has(i);
    const sel = soupSelectionByTeam[entrantId] === i;
    cell.className = 'soup-cell' + (found ? ' found' : '') + (sel ? ' selected' : '');
    cell.textContent = letter;
    cell.disabled = entrant.finished || round.finished;
    cell.addEventListener('click', () => {
      if (soupSelectionByTeam[entrantId] == null) {
        soupSelectionByTeam[entrantId] = i;
        render();
      } else if (soupSelectionByTeam[entrantId] === i) {
        soupSelectionByTeam[entrantId] = null;
        render();
      } else {
        const from = soupSelectionByTeam[entrantId];
        soupSelectionByTeam[entrantId] = null;
        socket.emit('submit-answer', testHint ? { from, to: i, asEntrant: entrantId } : { from, to: i });
      }
    });
    grid.appendChild(cell);
  });
  wrap.appendChild(grid);

  const list = document.createElement('div');
  list.className = 'word-list';
  list.innerHTML = entrant.words
    .map((w) => `<span class="word-chip${w.found ? ' found' : ''}">${w.word}</span>`)
    .join('');
  wrap.appendChild(list);

  const estado = document.createElement('p');
  estado.className = 'muted';
  estado.textContent = entrant.finished
    ? (entrant.finishSeconds !== null ? `¡Completo en ${formatTime(entrant.finishSeconds)}!` : 'Se acabó el tiempo sin terminar.')
    : `${entrant.wordsFound} de ${round.totalWords} encontradas`;
  wrap.appendChild(estado);

  container.appendChild(wrap);
}

function renderSopaDeLetras(round, container, roundKey) {
  const miEquipo = myEntrantId();
  const iAmTestHost = room.testMode && myId === room.hostId;

  const progresoKey = Object.entries(round.entrants)
    .map(([id, e]) => `${id}:${e.wordsFound}:${e.finished}`).join('|');
  const buildKey = `${roundKey}-${progresoKey}`;
  if (sopaBuiltFor === buildKey && $('sopa-timeleft')) {
    const restante = Math.max(0, round.maxSeconds - round.secondsElapsed);
    $('sopa-timeleft').textContent = formatTime(restante);
    const bar = $('sopa-timebar');
    if (bar) {
      const pct = Math.max(0, Math.min(100, (restante / round.maxSeconds) * 100));
      bar.style.width = `${pct}%`;
      bar.classList.toggle('danger', pct <= 25);
    }
    return;
  }
  sopaBuiltFor = buildKey;
  container.innerHTML = '';

  const restante = Math.max(0, round.maxSeconds - round.secondsElapsed);
  const box = document.createElement('div');
  box.className = 'board';
  box.innerHTML = `
    <p class="board-topic">${round.topic || ''}</p>
    <p class="board-clue">Marcá la primera y la última letra de una palabra de la lista. Si te equivocás se restan ${round.penaltySeconds}s — marcá solo si estás seguro. Gana el equipo que encuentra TODAS sus palabras más rápido.</p>
    <p class="board-counter">⏳ <span id="sopa-timeleft">${formatTime(restante)}</span> restantes · cada acierto suma ${round.secondsPerHit}s</p>
    <div class="timer-bar"><div class="timer-bar-fill" id="sopa-timebar" style="width:100%"></div></div>
  `;
  container.appendChild(box);

  if (iAmTestHost) {
    Object.keys(round.entrants).forEach((id) => renderSopaGrid(round, container, id, { conEtiqueta: true, testHint: true }));
  } else {
    renderSopaGrid(round, container, miEquipo, { conEtiqueta: false, testHint: false });
    // Progreso del rival (cuántas lleva, o si ya terminó) sin mostrar SU
    // tablero -- alcanza para seguir la carrera, no hace falta más.
    Object.keys(round.entrants).filter((id) => id !== miEquipo).forEach((id) => {
      const e = round.entrants[id];
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = e.finished
        ? (e.finishSeconds !== null ? `${entrantLabel(id)} ya terminó en ${formatTime(e.finishSeconds)}.` : `${entrantLabel(id)} no llegó a terminar.`)
        : `${entrantLabel(id)}: ${e.wordsFound} de ${round.totalWords} encontradas.`;
      container.appendChild(p);
    });
  }

  narrate(`sopa-${round.topic}`, `Sopa de letras. Busquen palabras de ${round.topic}.`);
}

// Cada equipo tiene su PROPIO tablero (misma base, mismas cruzadas, progreso
// independiente) y lo resuelven al mismo tiempo -- por eso, igual que Sopa
// de Letras, tiene su propio flujo con caché en vez del genérico.
let cruzadasBuiltFor = null;

function renderCruzadasBoard(round, container, entrantId, { conEtiqueta, testHint }) {
  const entrant = round.entrants[entrantId];
  if (!entrant) return;
  const base = round.base;

  const wrap = document.createElement('div');
  wrap.className = 'soup-team-wrap';

  if (conEtiqueta) {
    const label = document.createElement('p');
    label.className = 'muted';
    label.textContent = entrantLabel(entrantId);
    wrap.appendChild(label);
  }

  const q = entrant.question;
  const info = document.createElement('p');
  info.className = 'board-clue';
  info.textContent = entrant.finished
    ? (entrant.finishSeconds !== null ? `¡Tablero completo en ${formatTime(entrant.finishSeconds)}!` : 'Se acabó el tiempo sin terminar.')
    : (q ? q.clue : '');
  wrap.appendChild(info);

  if (base) {
    // Se dibuja la palabra base en horizontal y las cruzadas colgando en vertical.
    const maxAbajo = Math.max(...entrant.crosses.map((c) => c.length - c.wordIndex - 1), 0);
    const maxArriba = Math.max(...entrant.crosses.map((c) => c.wordIndex), 0);
    const board = document.createElement('div');
    board.className = 'cross-board';

    for (let fila = -maxArriba; fila <= maxAbajo; fila++) {
      const row = document.createElement('div');
      row.className = 'cross-row';
      for (let col = 0; col < base.word.length; col++) {
        const cell = document.createElement('div');
        if (fila === 0) {
          cell.className = 'cross-cell base';
          cell.textContent = base.word[col];
        } else {
          const cross = entrant.crosses.find((c) => c.baseIndex === col
            && fila >= -c.wordIndex && fila <= c.length - c.wordIndex - 1);
          if (!cross) {
            cell.className = 'cross-cell empty';
          } else {
            const letterIdx = cross.wordIndex + fila;
            const solved = cross.solved && cross.word;
            cell.className = 'cross-cell ' + (solved ? 'solved' : 'slot') + (cross.isCurrent ? ' current' : '');
            cell.textContent = solved ? cross.word[letterIdx] : '';
          }
        }
        row.appendChild(cell);
      }
      board.appendChild(row);
    }
    wrap.appendChild(board);
  }

  if (q) {
    const opciones = document.createElement('div');
    opciones.className = 'options-grid';
    q.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.textContent = opt;
      btn.addEventListener('click', () => {
        socket.emit('submit-answer', testHint ? { answerIndex: i, asEntrant: entrantId } : { answerIndex: i });
      });
      opciones.appendChild(btn);
    });
    wrap.appendChild(opciones);
    narrate(`cruzada-${entrantId}-${entrant.number}`, q.clue);
  }

  container.appendChild(wrap);
}

function renderPalabrasCruzadas(round, container, roundKey) {
  const miEquipo = myEntrantId();
  const iAmTestHost = room.testMode && myId === room.hostId;

  const progresoKey = Object.entries(round.entrants)
    .map(([id, e]) => `${id}:${e.number}:${e.finished}`).join('|');
  const buildKey = `${roundKey}-${progresoKey}`;
  if (cruzadasBuiltFor === buildKey && $('cruzadas-timeleft')) {
    const restante = Math.max(0, round.maxSeconds - round.secondsElapsed);
    $('cruzadas-timeleft').textContent = formatTime(restante);
    const bar = $('cruzadas-timebar');
    if (bar) {
      const pct = Math.max(0, Math.min(100, (restante / round.maxSeconds) * 100));
      bar.style.width = `${pct}%`;
      bar.classList.toggle('danger', pct <= 25);
    }
    return;
  }
  cruzadasBuiltFor = buildKey;
  container.innerHTML = '';

  const restante = Math.max(0, round.maxSeconds - round.secondsElapsed);
  const box = document.createElement('div');
  box.className = 'board';
  box.innerHTML = `
    <p class="board-topic">${round.topic || ''}</p>
    <p class="board-counter">⏳ <span id="cruzadas-timeleft">${formatTime(restante)}</span> restantes · cada acierto suma ${round.secondsPerHit}s</p>
    <div class="timer-bar"><div class="timer-bar-fill" id="cruzadas-timebar" style="width:100%"></div></div>
  `;
  container.appendChild(box);

  if (iAmTestHost) {
    Object.keys(round.entrants).forEach((id) => renderCruzadasBoard(round, container, id, { conEtiqueta: true, testHint: true }));
  } else {
    renderCruzadasBoard(round, container, miEquipo, { conEtiqueta: false, testHint: false });
    // Progreso del rival sin mostrar su tablero -- alcanza para la carrera.
    Object.keys(round.entrants).filter((id) => id !== miEquipo).forEach((id) => {
      const e = round.entrants[id];
      const resueltas = e.crosses.filter((c) => c.solved).length;
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = e.finished
        ? (e.finishSeconds !== null ? `${entrantLabel(id)} ya terminó en ${formatTime(e.finishSeconds)}.` : `${entrantLabel(id)} no llegó a terminar.`)
        : `${entrantLabel(id)}: ${resueltas} de ${round.totalCrosses} resueltas.`;
      container.appendChild(p);
    });
  }
}

function boardLaCadena(round, container) {
  const box = document.createElement('div');
  box.className = 'board';

  const q = round.question;
  const cadenaHtml = round.chain.length
    ? `<ol class="cadena-chain${round.chainOrdenada ? '' : ' cadena-desordenada'}">${round.chain.map((a) => `<li>${a}</li>`).join('')}</ol>`
    : '';
  const ayudaTexto = !round.chain.length ? ''
    : round.chainOrdenada
      ? '<p class="muted">Ayuda: están en el orden correcto, solo hay que decirlas bien.</p>'
      : '<p class="muted">Ayuda: están desordenadas — hay que saber en qué orden van.</p>';
  const intentosTexto = round.attemptsThisStep > 0
    ? `<p class="muted cadena-intentos">⚠ Ya falló ${round.attemptsThisStep} de ${round.rosterSize} del equipo en esta pregunta — la cadena sigue intacta, pero si fallan todos se termina el turno.</p>`
    : '';

  box.innerHTML = `
    <p class="board-topic">${round.theme || 'La Cadena'}</p>
    <p class="board-clue">${q ? q.clue : 'Tanda terminada'}</p>
    <p class="board-counter">Pregunta ${round.number} de ${round.total} · cadena actual: ${round.chainLength} · cada eslabón suma ${round.secondsPerEslabon}s</p>
    ${cadenaHtml}
    ${ayudaTexto}
    ${intentosTexto}
  `;
  container.appendChild(box);

  if (!q) return null;

  const opciones = document.createElement('div');
  opciones.className = 'options-grid cadena-options';
  q.options.forEach((opt) => {
    const card = document.createElement('div');
    card.className = 'option-btn option-display';
    card.textContent = opt;
    opciones.appendChild(card);
  });
  container.appendChild(opciones);

  if (myTurnNow(round)) {
    const hint = document.createElement('p');
    hint.className = 'muted';
    hint.textContent = round.chainLength
      ? 'Recitá en voz alta, en orden, toda la cadena hasta ahora y después la respuesta nueva — todo en un solo audio.'
      : 'Decí en voz alta la respuesta de esta pregunta.';
    container.appendChild(hint);

    const micWrap = document.createElement('div');
    micWrap.className = 'mimica-mic-wrap';
    const micBtn = document.createElement('button');
    micBtn.className = 'cancion-buzzer mimica-mic';
    micBtn.textContent = '🎤 Recitar y responder';
    micBtn.addEventListener('click', () => {
      micBtn.textContent = '🎤 Escuchando...';
      micBtn.disabled = true;
      const soportado = startVoiceListening(
        (text) => socket.emit('submit-answer', { recitar: text }),
        () => { micBtn.textContent = '🎤 Recitar y responder'; micBtn.disabled = false; }
      );
      if (!soportado) {
        micBtn.textContent = '🎤 Recitar y responder';
        micBtn.disabled = false;
      }
    });
    micWrap.appendChild(micBtn);

    // Botón manual SIEMPRE visible, no solo cuando falta soporte de voz: el
    // reconocimiento puede fallar en la práctica (permisos, mic, navegador)
    // aunque la API exista, y hace falta una forma confiable de mandar la
    // respuesta pase lo que pase.
    const or = document.createElement('p');
    or.className = 'muted mimica-mic-or';
    or.textContent = 'o escribí lo que dijiste y mandalo con el botón:';
    micWrap.appendChild(or);
    const row = document.createElement('div');
    row.className = 'tuti-input-row';
    row.innerHTML = '<input type="text" id="cadena-recitar-fallback" maxlength="300" placeholder="Escribí lo que dijiste, en orden...">';
    const send = document.createElement('button');
    send.className = 'btn btn-solid';
    send.textContent = '📤 Mandar respuesta';
    const enviarManual = () => {
      const input = document.getElementById('cadena-recitar-fallback');
      const val = input ? input.value : '';
      if (val.trim()) socket.emit('submit-answer', { recitar: val });
    };
    send.addEventListener('click', enviarManual);
    row.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') enviarManual(); });
    micWrap.appendChild(row);
    micWrap.appendChild(send);
    container.appendChild(micWrap);
  } else {
    const wait = document.createElement('p');
    wait.className = 'muted';
    wait.textContent = `Le toca a ${entrantLabel(round.activeEntrant)}.`;
    container.appendChild(wait);
  }

  if (myId === room.hostId) {
    const safety = document.createElement('button');
    safety.className = 'btn btn-ghost mimica-safety';
    safety.textContent = '✔ Dar por buena esta respuesta igual';
    safety.addEventListener('click', () => socket.emit('judge-word', { confirmarManual: true }));
    container.appendChild(safety);
  }

  narrate(`cadena-${round.activeEntrant}-${round.number}`, q.clue);
  return null; // se responde por voz, no con botones de opción
}

// Destello verde/rojo sobre el tablero cuando llega un resultado nuevo
// (acierto o error) -- da feedback visual inmediato, no solo texto.
let lastFlashedFeedback = null;
function maybeFlashFeedback(round) {
  const fb = round.lastFeedback;
  if (!fb || (fb.result !== 'correct' && fb.result !== 'wrong')) return;
  const key = `${round.type}-${JSON.stringify(fb)}`;
  if (key === lastFlashedFeedback) return;
  lastFlashedFeedback = key;

  const board = document.querySelector('#game-board .board');
  if (!board) return;
  board.classList.remove('flash-correct', 'flash-wrong');
  void board.offsetWidth; // fuerza el reflow para poder reiniciar la animación
  board.classList.add(fb.result === 'correct' ? 'flash-correct' : 'flash-wrong');
}

const BOARDS = {
  'rosco-por-turnos': boardRosco,
  'eligi-una': boardEligiUna,
  'la-silla': boardLaSilla,
  'donde-estaba': boardDondeEstaba,
  'la-cadena': boardLaCadena
};

// Cada prueba tiene su propio ícono e identidad de color (mismo sistema de
// gradientes que las tarjetas de la portada), para que no todas se vean
// iguales una vez adentro del juego.
const GAME_TYPE_ICONS = {
  'rosco-por-turnos': '🎡',
  'eligi-una': '🎯',
  'la-silla': '🪑',
  'donde-estaba': '🖼️',
  'sopa-de-letras': '🔤',
  'palabras-cruzadas': '🧩',
  tutifruti: '🍇',
  'la-cadena': '🔗',
  'adivina-la-cancion': '🎵',
  mimica: '🎭',
  'palabra-prohibida': '🤐',
  'duelo-torres': '🗼',
  'escalera-final': '🪜'
};

// Se llama DESPUÉS de dibujar el tablero (no antes): el ícono y el color se
// aplican sobre la tarjeta ".board" real que cada juego acaba de crear, no
// sobre el contenedor exterior -- así el CSS (".board::before") lo puede leer
// con attr(), que no mira hacia los ancestros.
function applyGameIdentity(round) {
  const container = $('game-board');
  container.style.setProperty('--game-gradient', gradientFor(round.type));
  const board = container.querySelector('.board');
  if (board) board.dataset.gameIcon = GAME_TYPE_ICONS[round.type] || '🎮';
}

// ---------- Tutifruti (dictado por voz, escritura simultánea) ----------
function tutifrutiCanAct(round) {
  if (room.testMode && myId === room.hostId) return true;
  const onDuty = (room.currentMembers || {})[myEntrantId()];
  return !onDuty || onDuty.id === myId;
}

// El servidor manda una actualización por segundo mientras se escribe (para
// que el contador baje en la pantalla de todos). Si reconstruyéramos el
// formulario entero en cada una de esas actualizaciones, se perdía lo que la
// persona venía tipeando apenas un segundo antes. Por eso solo se arma una vez
// por ronda/estado, y las actualizaciones de segundo a segundo solo tocan el
// contador de texto.
let tutiFormBuiltFor = null;

// En Modo Prueba (un solo celu probando la partida entera) hay que poder
// completar las respuestas de CADA equipo, uno por uno -- a diferencia de los
// juegos por turnos, Tutifruti no tiene "de quien es el turno" porque todos
// escriben a la vez. Este es el equipo que el anfitrión está completando ahora.
let testTutiTeam = null;

// Como en el juego real: el primer equipo que manda "grita ¡Basta!" y frena a
// los demás en seco. Guarda para qué ronda ya se disparó el bloqueo automático,
// para no reenviar en cada actualización de segundo a segundo.
let tutiAutoLockKey = null;

function renderTutifrutiWriting(round, container, roundKey) {
  // Tutifruti ahora son varias letras seguidas dentro de la misma prueba
  // (roundKey no cambia entre letras, solo entre pruebas de El Rosco) -- para
  // que la cache de esta pantalla y el auto-bloqueo se reinicien en cada
  // letra nueva, hace falta una clave que incluya en qué letra estamos.
  const letraKey = `${roundKey}-L${round.rondaActual}`;
  const iAmTestHost = room.testMode && myId === room.hostId;

  if (iAmTestHost) {
    // Se para en el primer equipo que todavía no mandó nada.
    if (!testTutiTeam || (round.entrants[testTutiTeam] || {}).submitted) {
      testTutiTeam = Object.keys(round.entrants).find((id) => !round.entrants[id].submitted)
        || Object.keys(round.entrants)[0];
    }
  }
  const actingAs = iAmTestHost ? testTutiTeam : myEntrantId();
  const canAct = iAmTestHost ? true : tutifrutiCanAct(round);
  const myState = round.entrants[actingAs] || {};
  const submitted = myState.submitted;

  // En Modo Prueba el bloqueo automático no aplica: una sola persona va
  // completando equipo por equipo a propósito, no puede "escribir a la vez"
  // contra sí misma. En una partida real (celus distintos) si algún otro
  // equipo ya mandó, se manda ya mismo lo que este equipo tenga tipeado —
  // nadie sigue escribiendo después de que alguien terminó primero.
  const otroYaMando = Object.entries(round.entrants).some(([id, e]) => id !== actingAs && e.submitted);
  if (!iAmTestHost && otroYaMando && !submitted && canAct && tutiAutoLockKey !== letraKey) {
    tutiAutoLockKey = letraKey;
    const answers = {};
    round.categorias.forEach((cat) => {
      const el = document.getElementById(`tuti-${cat}`);
      answers[cat] = el ? el.value : '';
    });
    socket.emit('submit-answer', { answers });
  }

  const formKey = `${letraKey}-writing-${submitted}-${canAct}-${actingAs}-${otroYaMando}`;

  if (tutiFormBuiltFor === formKey && $('tuti-timeleft')) {
    $('tuti-timeleft').textContent = round.timeLeft;
    const bar = $('tuti-timebar');
    if (bar) {
      const pct = Math.max(0, Math.min(100, (round.timeLeft / round.timeMaxSeconds) * 100));
      bar.style.width = `${pct}%`;
      bar.classList.toggle('danger', pct <= 25);
    }
    const enviados = Object.values(round.entrants).filter((e) => e.submitted).length;
    $('playing-turn-msg').textContent = otroYaMando
      ? '¡Un equipo ya terminó! Se corta la escritura para todos.'
      : `${enviados} de ${Object.keys(round.entrants).length} equipos ya enviaron.`;
    return;
  }
  tutiFormBuiltFor = formKey;
  container.innerHTML = ''; // recién acá: solo cuando de verdad hace falta reconstruir

  const box = document.createElement('div');
  box.className = 'board';
  box.innerHTML = `
    <p class="board-topic">Tutifruti — letra ${round.rondaActual} de ${round.totalRondas}</p>
    <div class="tuti-letter">${round.letter}</div>
    <p class="board-counter">⏳ <span id="tuti-timeleft">${round.timeLeft}</span>s para escribir · todo tiene que empezar con "${round.letter}" · el primer equipo en completar las 6 y mandar corta a los demás</p>
    <div class="timer-bar"><div class="timer-bar-fill" id="tuti-timebar" style="width:100%"></div></div>
  `;
  container.appendChild(box);

  if (iAmTestHost) {
    const switcher = document.createElement('div');
    switcher.className = 'tuti-team-switch';
    switcher.innerHTML = `<p class="muted">Modo prueba — completando por:</p>`;
    Object.keys(round.entrants).forEach((id) => {
      const btn = document.createElement('button');
      const done = round.entrants[id].submitted;
      btn.type = 'button';
      btn.className = 'tuti-team-pill' + (id === actingAs ? ' active' : '') + (done ? ' done' : '');
      btn.textContent = entrantLabel(id) + (done ? ' ✓' : '');
      btn.addEventListener('click', () => { testTutiTeam = id; tutiFormBuiltFor = null; render(); });
      switcher.appendChild(btn);
    });
    container.appendChild(switcher);
  }

  const form = document.createElement('div');
  form.className = 'tuti-form';
  round.categorias.forEach((cat) => {
    const row = document.createElement('div');
    row.className = 'tuti-field';
    row.innerHTML = `
      <label>${cat}</label>
      <div class="tuti-input-row">
        <input type="text" id="tuti-${cat}" maxlength="40" placeholder="${round.letter}..." ${submitted || !canAct || (otroYaMando && !iAmTestHost) ? 'disabled' : ''}>
      </div>
    `;
    form.appendChild(row);
  });
  container.appendChild(form);

  const submitBtn = document.createElement('button');
  submitBtn.className = 'btn btn-solid';
  if (submitted) {
    // Como en el juego real: el primero que manda le "grita ¡Basta!" al resto.
    // Si mi equipo mandó porque otro terminó primero, se lo aclaramos — si fui
    // yo el primero, también, porque ahora soy quien frenó a los demás.
    submitBtn.textContent = iAmTestHost
      ? `${entrantLabel(actingAs)} ya envió`
      : (otroYaMando
        ? '¡Otro equipo terminó primero! Tus respuestas se mandaron tal como estaban.'
        : '¡Mandaste primero! Los demás equipos se quedan con lo que tenían escrito.');
    submitBtn.disabled = true;
  } else if (!canAct) {
    submitBtn.textContent = 'Le toca escribir a otro de tu equipo';
    submitBtn.disabled = true;
  } else if (otroYaMando && !iAmTestHost) {
    submitBtn.textContent = 'Mandando tus respuestas...';
    submitBtn.disabled = true;
  } else {
    submitBtn.textContent = iAmTestHost ? `Enviar respuestas de ${entrantLabel(actingAs)}` : 'Enviar respuestas';

    // Si nadie mandó todavía, ESTE envío sería el que corta a los demás — no
    // se habilita hasta completar las 6 categorías, para no poder cortarle la
    // escritura al resto con solo una o dos (el servidor también lo exige,
    // esto es solo para que no llegue ni a intentarlo).
    const requiereCompleto = !otroYaMando;
    const camposInput = () => round.categorias.map((cat) => document.getElementById(`tuti-${cat}`));
    const estaCompleto = () => camposInput().every((el) => el && el.value.trim());
    const actualizarHabilitado = () => {
      submitBtn.disabled = requiereCompleto && !estaCompleto();
      submitBtn.title = submitBtn.disabled ? 'Completá las 6 categorías para mandar primero' : '';
    };
    camposInput().forEach((el) => { if (el) el.addEventListener('input', actualizarHabilitado); });
    actualizarHabilitado();

    submitBtn.addEventListener('click', () => {
      const answers = {};
      round.categorias.forEach((cat) => {
        answers[cat] = (document.getElementById(`tuti-${cat}`) || {}).value || '';
      });
      socket.emit('submit-answer', iAmTestHost ? { answers, asEntrant: actingAs } : { answers });
    });
  }
  container.appendChild(submitBtn);

  const enviados = Object.values(round.entrants).filter((e) => e.submitted).length;
  $('playing-turn-msg').textContent = otroYaMando
    ? '¡Un equipo ya terminó! Se corta la escritura para todos.'
    : `${enviados} de ${Object.keys(round.entrants).length} equipos ya enviaron.`;
}

function renderTutifrutiReview(round, container) {
  container.innerHTML = ''; // acá sí se reconstruye siempre: no hay texto que perder
  const box = document.createElement('div');
  box.className = 'board';
  const quedan = round.pendingJudgements.length;
  box.innerHTML = `
    <p class="board-topic">Tutifruti — letra ${round.letter} (${round.rondaActual} de ${round.totalRondas})</p>
    <p class="board-clue">${quedan ? 'Revisando las palabras dudosas...' : 'Calculando puntaje...'}</p>
  `;
  container.appendChild(box);

  const wrap = document.createElement('div');
  wrap.className = 'tuti-review';

  round.categorias.forEach((cat) => {
    const catBox = document.createElement('div');
    catBox.className = 'tuti-review-cat';
    catBox.innerHTML = `<h4>${cat}</h4>`;

    Object.entries(round.entrants).forEach(([entrantId, e]) => {
      const word = (e.answers && e.answers[cat]) || '';
      const pending = round.pendingJudgements.find((p) => p.entrantId === entrantId && p.category === cat);
      const item = document.createElement('div');
      item.className = 'tuti-review-item' + (pending ? ' pending' : '');
      item.innerHTML = `<span class="tri-team">${esc(entrantLabel(entrantId))}</span><span class="tri-word">${esc(word) || '—'}</span>`;

      if (pending && myId === room.hostId) {
        const yes = document.createElement('button');
        yes.className = 'btn-ghost tri-btn';
        yes.textContent = '✔ Vale';
        yes.addEventListener('click', () => socket.emit('judge-word', { entrantId, category: cat, accept: true }));
        const no = document.createElement('button');
        no.className = 'btn-ghost tri-btn';
        no.textContent = '✘ No vale';
        no.addEventListener('click', () => socket.emit('judge-word', { entrantId, category: cat, accept: false }));
        item.appendChild(yes);
        item.appendChild(no);
      } else if (pending) {
        const w = document.createElement('span');
        w.className = 'tri-waiting';
        w.textContent = 'el anfitrión está resolviendo esta...';
        item.appendChild(w);
      }
      catBox.appendChild(item);
    });
    wrap.appendChild(catBox);
  });
  container.appendChild(wrap);
  $('playing-turn-msg').textContent = myId === room.hostId
    ? 'Miren las palabras dudosas en voz alta y decidí si valen.'
    : 'El anfitrión está revisando las palabras dudosas con el grupo.';
}

function renderTutifruti(round, container, roundKey) {
  if (round.phase === 'writing') renderTutifrutiWriting(round, container, roundKey);
  else { tutiFormBuiltFor = null; tutiAutoLockKey = null; renderTutifrutiReview(round, container); }
}

// ---------- Adiviná la Canción (roles cruzados, música de cada equipo) ----------
// Un equipo pone la música (desde su propio celu/parlante, la app no
// reproduce nada), el otro compite por saber qué es -- cualquiera de sus
// integrantes puede responder, no un representante fijo, por eso tiene su
// propio flujo en vez del genérico de opciones (que exige "el de turno").
function renderCancion(round, container) {
  container.innerHTML = '';
  const iAmTestHost = room.testMode && myId === room.hostId;
  const miEquipo = myEntrantId();

  const marcador = Object.entries(round.entrants)
    .map(([id, e]) => `<span class="cancion-score">${entrantLabel(id)}: ${e.wins} 🏆 (+${e.secondsWon}s)</span>`)
    .join('');

  const stateText = round.phase === 'buzzing'
    ? `🎧 Le toca poner música a ${entrantLabel(round.djTeam)} (una canción cualquiera, desde su propio celu o parlante) — ${entrantLabel(round.guessingTeam)} compite por saber cuál es.`
    : `Alguien de ${entrantLabel(round.guessingTeam)} está respondiendo en voz alta — el anfitrión confirma.`;

  const box = document.createElement('div');
  box.className = 'board';
  box.innerHTML = `
    <p class="board-topic">Adiviná la Canción</p>
    <p class="board-clue">${stateText}</p>
    <p class="board-counter">Canción ${round.number} de ${round.total} · cada acierto suma ${round.secondsPerAcierto}s</p>
    <div class="cancion-scoreboard">${marcador}</div>
  `;
  container.appendChild(box);

  if (round.phase === 'buzzing') {
    const meTocaAdivinar = iAmTestHost || miEquipo === round.guessingTeam;
    if (meTocaAdivinar) {
      const btn = document.createElement('button');
      btn.className = 'cancion-buzzer';
      const color = teamColor(round.guessingTeam);
      if (color) btn.style.setProperty('--team-color', color);
      btn.textContent = '🙋 ¡La sé, quiero responder!';
      btn.addEventListener('click', () => socket.emit('submit-answer', { intento: true }));
      container.appendChild(btn);
    } else {
      const wait = document.createElement('p');
      wait.className = 'muted';
      wait.textContent = `Le toca poner música a tu equipo — elijan una canción y reprodúzcanla para que ${entrantLabel(round.guessingTeam)} adivine.`;
      container.appendChild(wait);
    }
  } else if (myId === room.hostId) {
    const btns = document.createElement('div');
    btns.className = 'cadena-judge';
    const ok = document.createElement('button');
    ok.className = 'btn btn-solid';
    ok.textContent = '✔ Acertó';
    ok.addEventListener('click', () => socket.emit('judge-word', { ok: true }));
    const fail = document.createElement('button');
    fail.className = 'btn btn-ghost';
    fail.textContent = '✘ No era';
    fail.addEventListener('click', () => socket.emit('judge-word', { ok: false }));
    btns.appendChild(ok);
    btns.appendChild(fail);
    container.appendChild(btns);
  } else {
    const wait = document.createElement('p');
    wait.className = 'muted';
    wait.textContent = 'El anfitrión está confirmando la respuesta.';
    container.appendChild(wait);
  }

  if (myId === room.hostId) {
    const skip = document.createElement('button');
    skip.className = 'btn btn-ghost mimica-safety';
    skip.textContent = '⏭ Saltar esta canción (nadie la sabe)';
    skip.addEventListener('click', () => socket.emit('judge-word', { skip: true }));
    container.appendChild(skip);
  }

  $('playing-turn-msg').textContent = round.phase === 'buzzing'
    ? `Le toca escuchar y responder a ${entrantLabel(round.guessingTeam)}.`
    : 'Confirmando la respuesta...';
}

// ---------- Reconocimiento de voz (compartido: Mímica y La Cadena) ----------
// Ambos juegos necesitan escuchar y validar algo dicho en voz alta -- helper
// genérico en vez de repetir la integración con la Web Speech API dos veces.
let activeVoiceRecognition = null;

function stopVoiceListening() {
  if (activeVoiceRecognition) {
    try { activeVoiceRecognition.stop(); } catch (e) { /* ya estaba parado */ }
    activeVoiceRecognition = null;
  }
}

function startVoiceListening(onResult, onDone) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) return false; // sin soporte -- el llamador debe mostrar el campo de texto de respaldo
  stopVoiceListening();
  const rec = new Ctor();
  rec.lang = 'es-AR';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    const text = e.results[0] && e.results[0][0] ? e.results[0][0].transcript : '';
    if (text) onResult(text);
  };
  rec.onend = () => { activeVoiceRecognition = null; if (onDone) onDone(); };
  rec.onerror = () => { activeVoiceRecognition = null; if (onDone) onDone(); };
  activeVoiceRecognition = rec;
  try {
    rec.start();
  } catch (e) {
    // Puede tirar sincrónico si el navegador bloquea el mic (ej. no es un
    // contexto seguro: http en una IP de LAN en vez de localhost/https) --
    // sin este catch el botón quedaba trabado en "Escuchando..." para siempre.
    activeVoiceRecognition = null;
    return false;
  }
  return true;
}

// ---------- Mímica (roles cruzados: uno actúa, cualquiera del otro equipo adivina por voz) ----------
// El reloj manda una actualización por segundo mientras se actúa. Si
// reconstruyéramos toda la pantalla en cada una, cortaríamos el
// reconocimiento de voz que puede estar escuchando en ese momento (mismo
// problema que ya resolvimos en Tutifruti) -- por eso también cachea por
// clave de estado y solo el segundero se actualiza en el camino corto.
let mimicaBuiltFor = null;

function renderMimica(round, container, roundKey) {
  const buildKey = `${roundKey}-${round.phase}-${round.actorId}-${round.currentWord}-${round.number}`;

  if (mimicaBuiltFor === buildKey && $('mimica-timeleft')) {
    $('mimica-timeleft').textContent = round.secondsLeft;
    const bar = $('mimica-timebar');
    if (bar) {
      const pct = Math.max(0, Math.min(100, (round.secondsLeft / round.segundosPorBloque) * 100));
      bar.style.width = `${pct}%`;
      bar.classList.toggle('danger', pct <= 25);
    }
    return;
  }
  mimicaBuiltFor = buildKey;
  stopVoiceListening();
  container.innerHTML = '';

  const iAmHost = myId === room.hostId;
  const iAmActor = myId === round.actorId;
  const myTeam = myEntrantId();
  const soyDelEquipoQueAdivina = myTeam === round.guessingTeam;
  const soyDelEquipoQueActua = myTeam === round.actorTeam;

  const marcador = Object.entries(round.entrants)
    .map(([id, e]) => `<span class="cancion-score">${entrantLabel(id)}: ${e.correct} 🎯 (+${e.secondsWon}s)</span>`)
    .join('');

  const box = document.createElement('div');
  box.className = 'board';
  box.innerHTML = `
    <p class="board-topic">Mímica</p>
    <p class="board-clue">Actúa ${entrantLabel(round.actorTeam)} · adivina ${entrantLabel(round.guessingTeam)}</p>
    <p class="board-counter">Bloque ${round.number} de ${round.total}${round.phase === 'acting' ? ` · ⏳ <span id="mimica-timeleft">${round.secondsLeft}</span>s` : ''} · cada acierto suma ${round.secondsPerAcierto}s</p>
    ${round.phase === 'acting' ? '<div class="timer-bar"><div class="timer-bar-fill" id="mimica-timebar" style="width:100%"></div></div>' : ''}
    <div class="cancion-scoreboard">${marcador}</div>
  `;
  container.appendChild(box);

  if (round.phase === 'choosing-actor') {
    if (soyDelEquipoQueActua && iAmHost) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = `¿Cómo elegimos quién de ${entrantLabel(round.actorTeam)} actúa este bloque?`;
      container.appendChild(p);
    }
    if (iAmHost) {
      const wrap = document.createElement('div');
      wrap.className = 'cadena-judge';
      const azar = document.createElement('button');
      azar.className = 'btn btn-solid';
      azar.textContent = '🎲 Al azar';
      azar.addEventListener('click', () => socket.emit('judge-word', { elegirModo: 'azar' }));
      const rot = document.createElement('button');
      rot.className = 'btn btn-ghost';
      rot.textContent = '🔄 Rotativo';
      rot.addEventListener('click', () => socket.emit('judge-word', { elegirModo: 'rotativo' }));
      wrap.appendChild(azar);
      wrap.appendChild(rot);
      container.appendChild(wrap);
    } else {
      const wait = document.createElement('p');
      wait.className = 'muted';
      wait.textContent = `El anfitrión está eligiendo quién de ${entrantLabel(round.actorTeam)} actúa.`;
      container.appendChild(wait);
    }
  } else {
    // phase === 'acting'
    const iAmTestHost = room.testMode && iAmHost;

    // Modo prueba: el anfitrión controla a todos, así que ve el secreto Y el
    // control de adivinar a la vez (no puede "ser" solo un jugador puntual).
    if (iAmActor || iAmTestHost) {
      const reveal = document.createElement('div');
      reveal.className = 'mimica-actor-reveal dice-reveal';
      reveal.innerHTML = `
        <p class="muted">${iAmTestHost ? `Actúa ${esc(round.actorName)} — esto es lo que tiene que mimicar:` : '¡Te toca actuar! Nadie más puede ver esto:'}</p>
        <div class="mimica-secret-word">${round.currentWord || '…'}</div>
      `;
      container.appendChild(reveal);

      const pasar = document.createElement('button');
      pasar.className = 'btn btn-ghost';
      pasar.textContent = '⏭ Pasar';
      pasar.addEventListener('click', () => socket.emit('submit-answer',
        iAmTestHost ? { pasar: true, asEntrant: round.actorTeam } : { pasar: true }));
      container.appendChild(pasar);
    }
    if (soyDelEquipoQueAdivina || iAmTestHost) {
      const micWrap = document.createElement('div');
      micWrap.className = 'mimica-mic-wrap';
      const micBtn = document.createElement('button');
      micBtn.className = 'cancion-buzzer mimica-mic';
      micBtn.textContent = iAmTestHost ? `🎤 Responder por ${entrantLabel(round.guessingTeam)}` : '🎤 ¡Sé la respuesta!';
      micBtn.addEventListener('click', () => {
        const textoOriginal = micBtn.textContent;
        micBtn.textContent = '🎤 Escuchando...';
        micBtn.disabled = true;
        const payload = (text) => (iAmTestHost ? { guess: text, asEntrant: round.guessingTeam } : { guess: text });
        const soportado = startVoiceListening(
          (text) => socket.emit('submit-answer', payload(text)),
          () => { micBtn.textContent = textoOriginal; micBtn.disabled = false; }
        );
        if (!soportado) {
          micBtn.textContent = textoOriginal;
          micBtn.disabled = false;
        }
      });
      micWrap.appendChild(micBtn);

      // Botón manual SIEMPRE visible, no solo cuando falta soporte de voz: el
      // reconocimiento puede fallar en la práctica (permisos, mic, navegador)
      // aunque la API exista, y hace falta una forma confiable de responder.
      const or = document.createElement('p');
      or.className = 'muted mimica-mic-or';
      or.textContent = 'o escribí lo que dijiste y mandalo con el botón:';
      micWrap.appendChild(or);
      const row = document.createElement('div');
      row.className = 'tuti-input-row';
      row.innerHTML = '<input type="text" id="mimica-guess-fallback" maxlength="40" placeholder="Escribí lo que dijiste...">';
      const send = document.createElement('button');
      send.className = 'btn btn-solid';
      send.textContent = '📤 Mandar respuesta';
      const enviarManual = () => {
        const input = document.getElementById('mimica-guess-fallback');
        const val = input ? input.value : '';
        if (val.trim()) socket.emit('submit-answer', iAmTestHost ? { guess: val, asEntrant: round.guessingTeam } : { guess: val });
      };
      send.addEventListener('click', enviarManual);
      row.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') enviarManual(); });
      micWrap.appendChild(row);
      micWrap.appendChild(send);
      container.appendChild(micWrap);
    }
    if (!iAmActor && !soyDelEquipoQueAdivina && !iAmTestHost) {
      const wait = document.createElement('p');
      wait.className = 'muted';
      wait.textContent = soyDelEquipoQueActua
        ? `¡Que actúe ${round.actorName}! Ayudalo mirando en silencio, no se puede hablar.`
        : `Le toca adivinar a ${entrantLabel(round.guessingTeam)}.`;
      container.appendChild(wait);
    }

    if (iAmHost) {
      const safety = document.createElement('button');
      safety.className = 'btn btn-ghost mimica-safety';
      safety.textContent = '✔ Dar por válida esta palabra igual';
      safety.addEventListener('click', () => socket.emit('judge-word', { confirmarManual: true }));
      container.appendChild(safety);
    }
  }

  $('playing-turn-msg').textContent = round.phase === 'choosing-actor'
    ? 'Eligiendo quién actúa este bloque...'
    : (iAmActor ? '¡Actuá! Nadie puede hablar mientras el otro equipo adivina.' : `Actúa ${round.actorName || '...'}`);
}

// ---------- Palabra Prohibida (estilo Taboo, calca la estructura de Mímica) ----------
let prohibidaBuiltFor = null;

function renderPalabraProhibida(round, container, roundKey) {
  const palabraActual = round.currentCard ? round.currentCard.word : null;
  const buildKey = `${roundKey}-${round.phase}-${round.actorId}-${palabraActual}-${round.number}`;

  if (prohibidaBuiltFor === buildKey && $('prohibida-timeleft')) {
    $('prohibida-timeleft').textContent = round.secondsLeft;
    const bar = $('prohibida-timebar');
    if (bar) {
      const pct = Math.max(0, Math.min(100, (round.secondsLeft / round.segundosPorBloque) * 100));
      bar.style.width = `${pct}%`;
      bar.classList.toggle('danger', pct <= 25);
    }
    return;
  }
  prohibidaBuiltFor = buildKey;
  stopVoiceListening();
  container.innerHTML = '';

  const iAmHost = myId === room.hostId;
  const iAmActor = myId === round.actorId;
  const myTeam = myEntrantId();
  const soyDelEquipoQueAdivina = myTeam === round.guessingTeam;
  const soyDelEquipoQueActua = myTeam === round.actorTeam;

  const marcador = Object.entries(round.entrants)
    .map(([id, e]) => `<span class="cancion-score">${entrantLabel(id)}: ${e.correct} 🎯 (+${e.secondsWon}s)</span>`)
    .join('');

  const box = document.createElement('div');
  box.className = 'board';
  box.innerHTML = `
    <p class="board-topic">Palabra Prohibida</p>
    <p class="board-clue">Describe ${entrantLabel(round.actorTeam)} · adivina ${entrantLabel(round.guessingTeam)}</p>
    <p class="board-counter">Bloque ${round.number} de ${round.total}${round.phase === 'acting' ? ` · ⏳ <span id="prohibida-timeleft">${round.secondsLeft}</span>s` : ''} · cada acierto suma ${round.secondsPerAcierto}s</p>
    ${round.phase === 'acting' ? '<div class="timer-bar"><div class="timer-bar-fill" id="prohibida-timebar" style="width:100%"></div></div>' : ''}
    <div class="cancion-scoreboard">${marcador}</div>
  `;
  container.appendChild(box);

  if (round.phase === 'choosing-actor') {
    if (soyDelEquipoQueActua && iAmHost) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = `¿Cómo elegimos quién de ${entrantLabel(round.actorTeam)} describe este bloque?`;
      container.appendChild(p);
    }
    if (iAmHost) {
      const wrap = document.createElement('div');
      wrap.className = 'cadena-judge';
      const azar = document.createElement('button');
      azar.className = 'btn btn-solid';
      azar.textContent = '🎲 Al azar';
      azar.addEventListener('click', () => socket.emit('judge-word', { elegirModo: 'azar' }));
      const rot = document.createElement('button');
      rot.className = 'btn btn-ghost';
      rot.textContent = '🔄 Rotativo';
      rot.addEventListener('click', () => socket.emit('judge-word', { elegirModo: 'rotativo' }));
      wrap.appendChild(azar);
      wrap.appendChild(rot);
      container.appendChild(wrap);
    } else {
      const wait = document.createElement('p');
      wait.className = 'muted';
      wait.textContent = `El anfitrión está eligiendo quién de ${entrantLabel(round.actorTeam)} describe.`;
      container.appendChild(wait);
    }
  } else {
    // phase === 'acting'
    const iAmTestHost = room.testMode && iAmHost;
    const card = round.currentCard;

    // Modo prueba: el anfitrión controla a todos, así que ve el secreto Y el
    // control de adivinar a la vez (no puede "ser" solo un jugador puntual).
    if (iAmActor || iAmTestHost) {
      const prohibidasHtml = card
        ? `<ul class="prohibida-list">${card.forbidden.map((p) => `<li>${p}</li>`).join('')}</ul>`
        : '';
      const reveal = document.createElement('div');
      reveal.className = 'mimica-actor-reveal dice-reveal';
      reveal.innerHTML = `
        <p class="muted">${iAmTestHost ? `Describe ${esc(round.actorName)} — esto es lo que tiene que hacer adivinar:` : '¡Te toca describir! Nadie más puede ver esto:'}</p>
        <div class="mimica-secret-word">${card ? card.word : '…'}</div>
        <p class="muted">Sin decir:</p>
        ${prohibidasHtml}
      `;
      container.appendChild(reveal);

      const pasar = document.createElement('button');
      pasar.className = 'btn btn-ghost';
      pasar.textContent = '⏭ Pasar';
      pasar.addEventListener('click', () => socket.emit('submit-answer',
        iAmTestHost ? { pasar: true, asEntrant: round.actorTeam } : { pasar: true }));
      container.appendChild(pasar);
    }
    if (soyDelEquipoQueAdivina || iAmTestHost) {
      const micWrap = document.createElement('div');
      micWrap.className = 'mimica-mic-wrap';
      const micBtn = document.createElement('button');
      micBtn.className = 'cancion-buzzer mimica-mic';
      micBtn.textContent = iAmTestHost ? `🎤 Responder por ${entrantLabel(round.guessingTeam)}` : '🎤 ¡Sé la respuesta!';
      micBtn.addEventListener('click', () => {
        const textoOriginal = micBtn.textContent;
        micBtn.textContent = '🎤 Escuchando...';
        micBtn.disabled = true;
        const payload = (text) => (iAmTestHost ? { guess: text, asEntrant: round.guessingTeam } : { guess: text });
        const soportado = startVoiceListening(
          (text) => socket.emit('submit-answer', payload(text)),
          () => { micBtn.textContent = textoOriginal; micBtn.disabled = false; }
        );
        if (!soportado) {
          micBtn.textContent = textoOriginal;
          micBtn.disabled = false;
        }
      });
      micWrap.appendChild(micBtn);

      // Botón manual SIEMPRE visible, no solo cuando falta soporte de voz.
      const or = document.createElement('p');
      or.className = 'muted mimica-mic-or';
      or.textContent = 'o escribí lo que dijiste y mandalo con el botón:';
      micWrap.appendChild(or);
      const row = document.createElement('div');
      row.className = 'tuti-input-row';
      row.innerHTML = '<input type="text" id="prohibida-guess-fallback" maxlength="40" placeholder="Escribí lo que dijiste...">';
      const send = document.createElement('button');
      send.className = 'btn btn-solid';
      send.textContent = '📤 Mandar respuesta';
      const enviarManual = () => {
        const input = document.getElementById('prohibida-guess-fallback');
        const val = input ? input.value : '';
        if (val.trim()) socket.emit('submit-answer', iAmTestHost ? { guess: val, asEntrant: round.guessingTeam } : { guess: val });
      };
      send.addEventListener('click', enviarManual);
      row.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') enviarManual(); });
      micWrap.appendChild(row);
      micWrap.appendChild(send);
      container.appendChild(micWrap);
    }
    if (!iAmActor && !soyDelEquipoQueAdivina && !iAmTestHost) {
      const wait = document.createElement('p');
      wait.className = 'muted';
      wait.textContent = soyDelEquipoQueActua
        ? `¡Que describa ${round.actorName}! Ayudalo en silencio, no se puede hablar.`
        : `Le toca adivinar a ${entrantLabel(round.guessingTeam)}.`;
      container.appendChild(wait);
    }

    if (iAmHost) {
      const hostRow = document.createElement('div');
      hostRow.className = 'cadena-judge';
      const safety = document.createElement('button');
      safety.className = 'btn btn-ghost mimica-safety';
      safety.textContent = '✔ Dar por válida igual';
      safety.addEventListener('click', () => socket.emit('judge-word', { confirmarManual: true }));
      const falta = document.createElement('button');
      falta.className = 'btn btn-ghost mimica-safety';
      falta.textContent = '🚫 Dijo una prohibida';
      falta.addEventListener('click', () => socket.emit('judge-word', { falta: true }));
      hostRow.appendChild(safety);
      hostRow.appendChild(falta);
      container.appendChild(hostRow);
    }
  }

  $('playing-turn-msg').textContent = round.phase === 'choosing-actor'
    ? 'Eligiendo quién describe este bloque...'
    : (iAmActor ? '¡Describí! Nadie puede decir las prohibidas.' : `Describe ${round.actorName || '...'}`);
}

// ---------- Duelo de Torres (Ahora Caigo) ----------
// A diferencia de los juegos por turnos genéricos, acá hay un campeón y un
// retador puntuales (no "el que le toca dentro del equipo" del motor común),
// por eso necesita su propio flujo -- igual que Mímica necesita saber
// puntualmente quién actúa.
function renderDuelo(round, container) {
  container.innerHTML = '';
  const iAmHost = myId === room.hostId;
  const iAmTestHost = room.testMode && iAmHost;
  const miEquipo = myEntrantId();

  const marcador = Object.entries(round.entrants)
    .map(([id, e]) => `<span class="cancion-score">${entrantLabel(id)}: ${e.torres} 🗼 (+${e.secondsWon}s)</span>`)
    .join('');

  const esCampeonTurno = round.turnoDe === 'campeon';
  const nombreEnTurno = esCampeonTurno ? round.campeonName : round.retadorName;
  const idEnTurno = esCampeonTurno ? round.campeonId : round.retadorId;
  const equipoEnTurno = esCampeonTurno ? round.campeonTeam : round.retadorTeam;

  const box = document.createElement('div');
  box.className = 'board';
  box.innerHTML = `
    <p class="board-topic">${round.theme || 'Duelo de Torres'}</p>
    <p class="board-clue">👑 ${entrantLabel(round.campeonTeam)}${round.campeonName ? ` (${esc(round.campeonName)})` : ''} defiende la torre · 🗡 reta ${entrantLabel(round.retadorTeam)}${round.retadorName ? ` (${esc(round.retadorName)})` : ''}</p>
    <p class="board-counter">Duelo ${round.number} de ${round.total} · responde ${nombreEnTurno || '...'} · cada torre suma ${round.secondsPerTorre}s</p>
    <div class="cancion-scoreboard">${marcador}</div>
  `;
  container.appendChild(box);

  const q = round.question;
  if (!q) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Duelo terminado.';
    container.appendChild(p);
    return;
  }

  const clue = document.createElement('p');
  clue.className = 'board-clue';
  clue.textContent = q.clue;
  container.appendChild(clue);

  const puedoResponder = iAmTestHost || myId === idEnTurno;

  if (puedoResponder) {
    const opciones = document.createElement('div');
    opciones.className = 'options-grid';
    q.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.textContent = opt;
      btn.addEventListener('click', () => socket.emit('submit-answer', { answerIndex: i }));
      opciones.appendChild(btn);
    });
    container.appendChild(opciones);
  } else {
    const wait = document.createElement('p');
    wait.className = 'muted';
    wait.textContent = miEquipo === equipoEnTurno
      ? `Le toca a ${nombreEnTurno}, de tu equipo. Ayudalo en voz alta.`
      : `Responde ${nombreEnTurno} (${entrantLabel(equipoEnTurno)})...`;
    container.appendChild(wait);
  }

  narrate(`duelo-${round.number}-${esCampeonTurno ? 'c' : 'r'}`, q.clue);
  maybeFlashFeedback(round);

  $('playing-turn-msg').textContent = puedoResponder ? '¡Te toca a vos!' : `Responde ${nombreEnTurno || '...'}`;
}

// ---------- Escalera Final (Ahora Caigo) ----------
// Mismo espíritu que el Rosco (reloj propio por equipo, solo corre en su
// turno), pero subiendo escalones en vez de letras, y con la opción de
// plantarse para guardar el escalón a salvo de una caída futura.
function renderEscalera(round, container) {
  container.innerHTML = '';
  const iAmHost = myId === room.hostId;
  const iAmTestHost = room.testMode && iAmHost;
  const miEquipo = myEntrantId();
  const puedoJugar = iAmTestHost || miEquipo === round.activeEntrant;

  const escalones = Array.from({ length: round.totalEscalones }, (_, i) => {
    const activo = round.entrants[round.activeEntrant] || {};
    const n = i + 1;
    const cls = n <= (activo.step || 0) ? 'silla-step current' : 'silla-step';
    return `<span class="${cls}">${n}</span>`;
  }).join('');

  const box = document.createElement('div');
  box.className = 'board';
  box.innerHTML = `
    <p class="board-topic">${round.theme || 'Escalera Final'}</p>
    <p class="board-clue">Sube ${entrantLabel(round.activeEntrant)} — escalón ${(round.entrants[round.activeEntrant] || {}).step || 0} de ${round.totalEscalones}</p>
    <div class="silla-chain">${escalones}</div>
  `;
  container.appendChild(box);

  const q = round.question;
  if (!q) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Esta escalera ya terminó para este equipo.';
    container.appendChild(p);
  } else {
    const clue = document.createElement('p');
    clue.className = 'board-clue';
    clue.textContent = q.clue;
    container.appendChild(clue);

    if (puedoJugar) {
      const opciones = document.createElement('div');
      opciones.className = 'options-grid';
      q.options.forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.textContent = opt;
        btn.addEventListener('click', () => socket.emit('submit-answer', { answerIndex: i }));
        opciones.appendChild(btn);
      });
      container.appendChild(opciones);

      const banked = (round.entrants[round.activeEntrant] || {}).banked || 0;
      const plantar = document.createElement('button');
      plantar.className = 'btn btn-ghost mimica-safety';
      plantar.textContent = `🏳 Plantarse (guardar el escalón ${(round.entrants[round.activeEntrant] || {}).step || 0}${banked ? `, ya tiene a salvo el ${banked}` : ''})`;
      plantar.addEventListener('click', () => socket.emit('submit-answer', { plantarse: true }));
      container.appendChild(plantar);
    } else {
      const wait = document.createElement('p');
      wait.className = 'muted';
      wait.textContent = `Le toca subir a ${entrantLabel(round.activeEntrant)}.`;
      container.appendChild(wait);
    }
    narrate(`escalera-${round.activeEntrant}-${(round.entrants[round.activeEntrant] || {}).step || 0}`, q.clue);
  }

  maybeFlashFeedback(round);
  $('playing-turn-msg').textContent = puedoJugar ? '¡Te toca a vos!' : `Turno de ${entrantLabel(round.activeEntrant)}...`;
}

// ¿Puedo actuar ahora? En modo prueba el anfitrión juega por todos; si no, tiene
// que ser el turno de mi equipo Y tocarme a mí dentro del equipo.
function myTurnNow(round) {
  if (room.testMode && myId === room.hostId) return true;
  const onDuty = (room.currentMembers || {})[round.activeEntrant];
  const isMyTeam = round.activeEntrant === myEntrantId();
  return isMyTeam && (!onDuty || onDuty.id === myId);
}

function renderPlaying() {
  const round = room.round;
  if (!round) return;

  const roundKey = `${room.code}-${room.currentRoundNumber}`;
  if (roundKey !== lastRoundKey) {
    soupSelectionByTeam = {};
    lastRoundKey = roundKey;
  }

  $('playing-round-label').textContent =
    `Prueba ${room.currentRoundNumber} de ${room.totalRounds} — ${round.label || ''}`;

  // Siempre visible: cuánto tiempo lleva acumulado cada equipo para el rosco
  // final — es la mecánica central de El Rosco. En Programas sin rosco final
  // (ej. Varios) no aplica: ahí el puntaje ya se ve directo en los scores.
  const esFinalAhora = JUEGOS_CON_RELOJ_FINAL.includes(round.type);
  const banner = $('carry-banner');
  if (room.hasFinalGame && !esFinalAhora && room.timeCarryOver) {
    banner.classList.remove('hidden');
    banner.innerHTML = '⏱ Para la prueba final: ' + Object.entries(room.timeCarryOver)
      .map(([id, seg]) => `<b>${entrantLabel(id)} ${formatTime(seg)}</b>`).join(' · ');
  } else {
    banner.classList.add('hidden');
  }

  renderBanks(round);

  const container = $('game-board');

  // Tutifruti es simultáneo (todos los equipos actúan a la vez, no por turnos
  // de a uno) — tiene su propio flujo, no el de opción múltiple genérico.
  // renderTutifruti decide por su cuenta cuándo hace falta limpiar el
  // contenedor (ver comentario junto a tutiFormBuiltFor): si lo hiciéramos acá
  // siempre, cada actualización de reloj (una por segundo mientras se
  // escribe) borraba lo que la persona venía tipeando o dictando.
  if (round.type === 'tutifruti') {
    $('btn-pasapalabra').classList.add('hidden');
    $('playing-options').innerHTML = '';
    renderTutifruti(round, container, roundKey);
    applyGameIdentity(round); // después de dibujar: la tarjeta ".board" ya existe
    return;
  }

  // Adiviná la Canción: cualquiera del equipo que adivina puede responder, no
  // solo "el de turno" -- necesita su propio flujo, no el genérico.
  if (round.type === 'adivina-la-cancion') {
    $('btn-pasapalabra').classList.add('hidden');
    $('playing-options').innerHTML = '';
    renderCancion(round, container);
    applyGameIdentity(round);
    return;
  }

  // Mímica: roles cruzados (uno actúa, el otro equipo adivina) con reloj por
  // segundo -- misma razón que Tutifruti para tener su propio flujo con caché.
  if (round.type === 'mimica') {
    $('btn-pasapalabra').classList.add('hidden');
    $('playing-options').innerHTML = '';
    renderMimica(round, container, roundKey);
    applyGameIdentity(round);
    return;
  }

  // Palabra Prohibida: mismo formato de roles cruzados que Mímica.
  if (round.type === 'palabra-prohibida') {
    $('btn-pasapalabra').classList.add('hidden');
    $('playing-options').innerHTML = '';
    renderPalabraProhibida(round, container, roundKey);
    applyGameIdentity(round);
    return;
  }

  // Sopa de Letras: cada equipo resuelve su propia copia al mismo tiempo (no
  // hay "de quién es el turno"), con reloj por segundo -- mismo motivo que
  // Tutifruti/Mímica para tener su propio flujo con caché.
  if (round.type === 'sopa-de-letras') {
    $('btn-pasapalabra').classList.add('hidden');
    $('playing-options').innerHTML = '';
    renderSopaDeLetras(round, container, roundKey);
    applyGameIdentity(round);
    return;
  }

  // Palabras Cruzadas: mismo formato de carrera independiente que Sopa de Letras.
  if (round.type === 'palabras-cruzadas') {
    $('btn-pasapalabra').classList.add('hidden');
    $('playing-options').innerHTML = '';
    renderPalabrasCruzadas(round, container, roundKey);
    applyGameIdentity(round);
    return;
  }

  // Duelo de Torres: hay un campeón y un retador puntuales (no "el que le
  // toca" del motor común de turnos) -- necesita su propio flujo.
  if (round.type === 'duelo-torres') {
    $('btn-pasapalabra').classList.add('hidden');
    $('playing-options').innerHTML = '';
    renderDuelo(round, container);
    applyGameIdentity(round);
    return;
  }

  // Escalera Final: como el Rosco (reloj propio por equipo) pero con un
  // botón extra para plantarse -- necesita su propio flujo.
  if (round.type === 'escalera-final') {
    $('btn-pasapalabra').classList.add('hidden');
    $('playing-options').innerHTML = '';
    renderEscalera(round, container);
    applyGameIdentity(round);
    return;
  }

  container.innerHTML = '';
  $('playing-options').innerHTML = '';

  const board = BOARDS[round.type];
  const options = board ? board(round, container) : null;
  applyGameIdentity(round);
  maybeFlashFeedback(round);

  const puedeJugar = myTurnNow(round);

  if (options && puedeJugar) {
    options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.textContent = opt;
      btn.addEventListener('click', () => socket.emit('submit-answer', { answerIndex: i }));
      $('playing-options').appendChild(btn);
    });
  }

  $('btn-pasapalabra').classList.toggle('hidden', round.type !== 'rosco-por-turnos' || !puedeJugar || !round.currentLetter);

  const onDuty = (room.currentMembers || {})[round.activeEntrant];
  const isMyTeam = round.activeEntrant === myEntrantId();
  let msg;
  if (room.testMode && myId === room.hostId) {
    msg = `Modo prueba — jugando por ${entrantLabel(round.activeEntrant)}.`;
  } else if (puedeJugar) {
    msg = '¡Te toca a vos!';
  } else if (isMyTeam && onDuty) {
    msg = `Le toca a ${onDuty.name}, de tu equipo. Ayudalo en voz alta.`;
  } else {
    msg = `Turno de ${entrantLabel(round.activeEntrant)}${onDuty ? ` — contesta ${onDuty.name}` : ''}...`;
  }
  $('playing-turn-msg').textContent = msg;
}

// ---------- Resultado de la prueba ----------
$('btn-pasapalabra').addEventListener('click', () => socket.emit('pasapalabra'));
$('btn-continue').addEventListener('click', () => socket.emit('continue-game'));

const MEDALS = ['🥇', '🥈', '🥉'];

function renderScoreList(container, sorted, showDelta) {
  container.innerHTML = '';
  sorted.forEach(([entrantId, points], i) => {
    const row = document.createElement('div');
    row.className = 'score-row' + (i === 0 && sorted.length > 1 ? ' leader' : '');
    const color = teamColor(entrantId);
    if (color) row.style.setProperty('--team-color', color);
    const delta = showDelta && room.lastRoundPoints ? room.lastRoundPoints[entrantId] : null;
    const deltaText = delta ? ` (+${delta})` : '';
    const medal = MEDALS[i] ? `${MEDALS[i]} ` : '';
    row.innerHTML = `<span>${medal}${entrantLabel(entrantId)}</span><span>${points} pts${deltaText}</span>`;
    container.appendChild(row);
  });
}

function renderRoundResult() {
  const sorted = Object.entries(room.scores).sort((a, b) => b[1] - a[1]);
  renderScoreList($('roundresult-scores'), sorted, true);

  const iAmHost = myId === room.hostId;
  $('btn-continue').classList.toggle('hidden', !iAmHost);
  $('roundresult-waiting-msg').classList.toggle('hidden', iAmHost);

  const round = room.round || {};
  const esUltima = room.currentRoundNumber >= room.totalRounds;
  $('roundresult-title').textContent = `Fin de ${round.label || 'la prueba'}`;

  // El dato que importa: cuánto tiempo se llevan al rosco final. En
  // Programas sin rosco final (Varios) no aplica -- el puntaje ya se ve
  // abajo en la lista de scores, alcanza con eso.
  if (room.hasFinalGame && !esUltima && room.timeCarryOver) {
    const banco = Object.entries(room.timeCarryOver)
      .map(([id, seg]) => `${entrantLabel(id)}: ${formatTime(seg)}`).join(' · ');
    $('roundresult-correct').textContent = `Tiempo acumulado para la prueba final → ${banco}`;
  } else {
    $('roundresult-correct').textContent = '';
  }

  const leader = sorted[0];
  if (leader) {
    narrate(`fin-${room.currentRoundNumber}`,
      `Termina ${round.label || 'la prueba'}. Va ganando ${entrantLabel(leader[0])} con ${leader[1]} puntos.`);
  }
}

function renderResults() {
  const sorted = Object.entries(room.scores).sort((a, b) => b[1] - a[1]);
  renderScoreList($('final-scores'), sorted, false);
  const leader = sorted[0];
  if (leader) narrate('fin-programa', `Fin del programa. Gana ${entrantLabel(leader[0])}.`);

  const banner = $('winner-banner');
  if (leader) {
    const color = teamColor(leader[0]);
    banner.innerHTML = `
      <span class="wb-trophy">🏆</span>
      <span class="wb-name" style="color:${color || 'var(--accent)'}">${esc(entrantLabel(leader[0]))}</span>
      <span class="wb-sub">se llevó la noche con ${leader[1]} puntos${room.endedEarly
    ? ' (el programa terminó antes: el otro equipo se quedó sin jugadores)' : ''}</span>
    `;
    // Se reinicia la animación de entrada cada vez que se llega a esta pantalla.
    banner.classList.remove('animate-in');
    void banner.offsetWidth;
    banner.classList.add('animate-in');
  } else {
    banner.innerHTML = '';
  }

  // Sin esto la pantalla de resultados era un callejón sin salida.
  $('btn-play-again').classList.toggle('hidden', myId !== room.hostId);

  const suggestions = $('results-suggestions');
  if (suggestions && ALL_PROGRAMS.length) {
    // Estilo "también en cartelera": se sugieren los próximos programas de la
    // galería, con la misma tarjeta póster que se usa en la portada.
    const items = ALL_PROGRAMS.filter((p) => !p.playable).slice(0, 6);
    suggestions.innerHTML = items.map((p) => posterHtml(p, null)).join('');
  }
}

$('btn-play-again').addEventListener('click', () => socket.emit('play-again'));

$('btn-back-home').addEventListener('click', () => {
  // Se avisa que se va de verdad: si solo se cortara la conexion, el
  // servidor le guardaria el lugar y lo volveria a meter en la sala.
  socket.emit('leave-room');
  room = null;
  lastRoundKey = null;
  tutiFormBuiltFor = null;
  tutiAutoLockKey = null;
  mimicaBuiltFor = null;
  prohibidaBuiltFor = null;
  sopaBuiltFor = null;
  cruzadasBuiltFor = null;
  stopVoiceListening();
  $('room-code-badge').classList.add('hidden');
  showScreen('screen-start');
});

// Las tarjetas de "también en cartelera" en resultados usan el mismo click
// delegado que la portada (jugables abren sala nueva, bloqueadas avisan).
$('results-suggestions').addEventListener('click', (e) => {
  const btn = e.target.closest('.poster');
  if (!btn) return;
  const program = ALL_PROGRAMS.find((p) => p.id === btn.dataset.id);
  if (program) openProgram(program);
});

// ---------- Render general ----------
function render() {
  if (!room) return;

  $('room-code-badge').textContent = room.code;
  $('room-code-badge').classList.remove('hidden');

  if (room.phase === 'lobby' || room.phase === 'config') {
    renderLobby();
    showScreen('screen-lobby');
  } else if (room.phase === 'playing') {
    renderPlaying();
    showScreen('screen-playing');
  } else if (room.phase === 'roundResult') {
    renderRoundResult();
    showScreen('screen-roundResult');
  } else if (room.phase === 'results') {
    renderResults();
    showScreen('screen-results');
  }
}

socket.on('room-update', (state) => { room = state; render(); });
socket.on('room-error', (msg) => showError(msg));
socket.on('kicked', () => {
  room = null;
  $('room-code-badge').classList.add('hidden');
  showScreen('screen-start');
  showError('El anfitrión te sacó de la sala.');
});
