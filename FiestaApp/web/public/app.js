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
  const previo = currentScreenId;
  currentScreenId = id;
  document.querySelectorAll('.screen').forEach((el) => el.classList.add('hidden'));
  const target = $(id);
  target.classList.remove('hidden');
  $('app').classList.toggle('wide-app', id === 'screen-start');
  $('bottom-tabs').classList.toggle('visible', id === 'screen-start');

  // Transición suave solo cuando de verdad se cambia de pantalla -- no en cada
  // actualización de estado dentro de la misma pantalla (evita reiniciar la
  // animación una vez por segundo mientras corre un reloj, por ejemplo).
  if (changed && previo !== null) {
    // Cortina de luz + "whoosh" al pasar de una sección a otra.
    const cortina = $('curtain');
    cortina.classList.remove('run');
    void cortina.offsetWidth;
    cortina.classList.add('run');
    if (window.Sfx) Sfx.play('whoosh');
  }
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
  { icon: '🔡', name: 'La Ruleta de Letras', tagline: 'Adiviná la frase oculta, letra por letra.', categories: ['familia', 'pareja'] },
  { icon: '⛓️', name: 'La Cadena', tagline: 'Trivia en equipo con un banco que se vota entre todos.', categories: ['amigos'] },
  { icon: '🎤', name: 'A Toda Voz', tagline: 'Karaoke con puntaje por afinación o jurado en vivo.', categories: ['amigos', 'pareja'] },
  { icon: '🕵️', name: 'El Cazador', tagline: 'Escondida en una casa virtual en 3D — el más ambicioso.', categories: ['amigos', 'ninos'] },
  { icon: '🎵', name: 'Adiviná la Canción', tagline: 'En pausa: hay que resolver el tema de derechos musicales primero.', categories: ['amigos', 'pareja'], paused: true }
];

// Categorías de los programas ya construidos (el servidor no las manda, son
// editoriales — a medida que haya más programas reales esto se puede mover
// al manifest.json de cada uno).
const REAL_CATEGORIES = {
  'el-rosco': ['cartelera', 'familia', 'amigos'],
  'ahora-caigo': ['cartelera', 'familia', 'amigos'],
  varios: ['cartelera', 'amigos', 'pareja'],
  'gran-premio': ['cartelera', 'amigos', 'familia', 'ninos'],
  casino: ['cartelera', 'casino', 'amigos', 'pareja']
};
const REAL_ICONS = { 'el-rosco': '🎡', 'ahora-caigo': '🗼', varios: '🕵️', 'gran-premio': '🏎️', casino: '🎰' };

// Color propio de cada Programa (portada, escenario y botones).
const PROGRAM_THEME = {
  'el-rosco': ['#ffb23f', '#ff6b3d'],
  'ahora-caigo': ['#3de6ff', '#5b8dd6'],
  varios: ['#ff3d7f', '#8b5cff'],
  'gran-premio': ['#ff4d5e', '#3de6ff'],
  casino: ['#ffd23f', '#1f7a46']
};
function themeFor(id) { return PROGRAM_THEME[id] || ['#8b5cff', '#3de6ff']; }

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
  const reel = $('create-reel');
  const [ca, cb] = themeFor(program.id);
  reel.style.setProperty('--pa', ca);
  reel.style.setProperty('--pb', cb);
  reel.innerHTML = window.Reels ? Reels.reelHtml(program) : '';
  if (window.Reels) Reels.observarReels(reel);
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
      <div class="poster-art" style="--pa:${themeFor(program.id)[0]};--pb:${themeFor(program.id)[1]}">${window.Reels ? Reels.reelHtml(program) : program.icon}</div>
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

// ---------- Hero: escenario + programa destacado que rota ----------
// Arriba de todo, un "estudio de TV": en celus que pueden, un escenario 3D
// (public/fx/stage3d.js) con el objeto de cada Programa; si no, luces en
// CSS. El Programa destacado cambia solo cada 8 segundos (o tocando los
// puntitos), como la portada de una plataforma de streaming.
let heroDestacados = [];
let heroIndex = 0;
let heroTimer = null;
let heroStage = null;
const HERO_MS = 8000;

function puede3D() {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) { return false; }
}

function iniciarEscenario3D() {
  if (heroStage !== null || !puede3D()) return;
  heroStage = false; // "cargando": no se pide dos veces
  import('./fx/stage3d.js')
    .then((m) => {
      heroStage = m.createStage($('hero-canvas'));
      const actual = heroDestacados[heroIndex];
      if (actual) heroStage.setProgram(actual.id);
      $('hero').classList.add('has-3d');
    })
    .catch(() => { heroStage = false; });
}

function mostrarHero(i) {
  if (!heroDestacados.length) return;
  heroIndex = (i + heroDestacados.length) % heroDestacados.length;
  const p = heroDestacados[heroIndex];
  const [a, b] = themeFor(p.id);
  const hero = $('hero');
  hero.style.setProperty('--hero-a', a);
  hero.style.setProperty('--hero-b', b);

  const juegos = (p.gameLabels || []).map((g) => `<span class="hero-game">${g.icon} ${esc(g.label)}</span>`).join('');
  const content = $('hero-content');
  content.classList.remove('hero-in');
  void content.offsetWidth; // reinicia la animación de entrada
  content.innerHTML = `
    <p class="hero-tag"><span class="live-dot"></span>En vivo · ${heroIndex + 1} de ${heroDestacados.length}</p>
    <h1 class="hero-title">${esc(p.name)}</h1>
    <p class="hero-lede">${esc(p.tagline || '')}</p>
    <div class="hero-meta">
      <span class="hero-chip">👥 ${p.minPlayers}–${p.maxPlayers} jugadores</span>
      <span class="hero-chip">🎬 ${(p.gameLabels || []).length} ${(p.gameLabels || []).length === 1 ? 'prueba' : 'pruebas'}</span>
    </div>
    <div class="hero-games">${juegos}</div>
    <div class="hero-ctas">
      <button class="hero-btn play" id="hero-play">▶ Jugar ahora</button>
      <button class="hero-btn info" id="hero-info">Ver todos</button>
    </div>`;
  content.classList.add('hero-in');
  $('hero-play').addEventListener('click', () => { if (window.Sfx) Sfx.play('pop'); openProgram(p); });
  $('hero-info').addEventListener('click', () => {
    document.getElementById('row-cartelera')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('hero-dots').innerHTML = heroDestacados.map((x, k) =>
    `<button class="hero-dot${k === heroIndex ? ' on' : ''}" data-k="${k}" aria-label="${esc(x.name)}"><i style="animation-duration:${HERO_MS}ms"></i></button>`).join('');
  if (heroStage) heroStage.setProgram(p.id);
}

function programarRotacionHero() {
  clearInterval(heroTimer);
  if (heroDestacados.length < 2) return;
  heroTimer = setInterval(() => {
    // currentScreenId es null mientras no se navegó: la portada es la pantalla inicial.
    if ((currentScreenId || 'screen-start') === 'screen-start' && !document.hidden) mostrarHero(heroIndex + 1);
  }, HERO_MS);
}

function renderHero(all) {
  heroDestacados = all.filter((p) => p.playable);
  if (!heroDestacados.length) return;
  mostrarHero(heroIndex);
  programarRotacionHero();
  iniciarEscenario3D();
}

$('hero-dots').addEventListener('click', (e) => {
  const dot = e.target.closest('.hero-dot');
  if (!dot) return;
  mostrarHero(Number(dot.dataset.k));
  programarRotacionHero();
});

// Deslizar el destacado con el dedo, como un carrusel.
(function () {
  let x0 = null;
  const hero = $('hero');
  hero.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  hero.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) { mostrarHero(heroIndex + (dx < 0 ? 1 : -1)); programarRotacionHero(); }
  });
}());

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
  renderRow(container, 'row-casino', '🎰 Noche de casino', ALL_PROGRAMS.filter((p) => p.categories.includes('casino')));
  renderRow(container, 'row-familia', '👨‍👩‍👧 Para jugar en familia', ALL_PROGRAMS.filter((p) => p.categories.includes('familia')));
  renderRow(container, 'row-amigos', '🎉 Para la previa con amigos', ALL_PROGRAMS.filter((p) => p.categories.includes('amigos')));
  renderRow(container, 'row-pareja', '💑 Para jugar en pareja', ALL_PROGRAMS.filter((p) => p.categories.includes('pareja')));
  renderRow(container, 'row-ninos', '🧒 Para los más chicos', ALL_PROGRAMS.filter((p) => p.categories.includes('ninos')));
  renderRow(container, 'row-proximamente', '🔜 Próximamente en la galería', ALL_PROGRAMS.filter((p) => !p.playable));
  if (window.Reels) Reels.observarReels(container);
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

// Botón de sonido en la barra de arriba (queda guardado en el celu).
function pintarBotonSonido() {
  const on = !window.Sfx || Sfx.activo;
  $('btn-sound').textContent = on ? '🔊' : '🔇';
  $('btn-sound').setAttribute('aria-label', on ? 'Silenciar sonidos' : 'Activar sonidos');
}
$('btn-sound').addEventListener('click', () => {
  if (window.Sfx) Sfx.setActivo(!Sfx.activo);
  pintarBotonSonido();
});
pintarBotonSonido();
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

function sendConfig(extra = {}) {
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
    selectedGames,
    tiempoRespuesta: Number($('config-tiempo-respuesta').value),
    gameOptions: leerAjustesJuegos(),
    ...extra
  });
}

// Ajustes de cada juego elegidos en la sala: { juego: { opcion: valor } }.
function leerAjustesJuegos() {
  const out = {};
  // Solo lo que difiere de lo que da la dificultad: así, si después se
  // cambia la dificultad, lo que no se tocó a mano se acomoda solo.
  document.querySelectorAll('#config-ajustes select[data-juego]').forEach((sel) => {
    if (sel.value === sel.dataset.defecto) return;
    const g = sel.dataset.juego;
    out[g] = out[g] || {};
    out[g][sel.dataset.opcion] = sel.value;
  });
  return out;
}

// Tarjetas de formato ("Rápida", "Familia"...): un toque llena todo.
function renderFormatos() {
  const cont = $('config-formatos');
  const todos = [...(room.formatos || []), { id: 'personalizada', nombre: '⚙️ Personalizada', desc: 'Elegí cada detalle' }];
  const key = todos.map((f) => f.id).join() + room.formato;
  if (cont.dataset.key === key) return;
  cont.dataset.key = key;
  cont.innerHTML = todos.map((f) => `
    <button type="button" class="formato${room.formato === f.id ? ' on' : ''}" data-formato="${f.id}">
      <b>${f.nombre}</b><small>${f.desc}</small>
    </button>`).join('');
}
$('config-formatos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-formato]');
  if (!b) return;
  if (window.Sfx) Sfx.play('pop');
  if (b.dataset.formato === 'personalizada') {
    $('config-ajustes-wrap').open = true;
    sendConfig();
  } else {
    sendConfig({ formato: b.dataset.formato });
  }
});

// Selectores de los ajustes de cada juego del Programa. Se rearman solo si
// cambia qué juegos/opciones hay (no en cada actualización: si no, se cerraba
// el selector que alguien estaba usando).
function renderAjustesJuegos() {
  const cont = $('config-ajustes');
  const juegos = room.ajustesJuegos || [];
  $('config-ajustes-wrap').classList.toggle('hidden', !juegos.length);
  const key = juegos.map((j) => j.id + ':' + j.opciones.map((o) => o.id + o.porDefecto).join()).join('|');
  if (cont.dataset.key !== key) {
    cont.dataset.key = key;
    cont.innerHTML = juegos.map((j) => `
      <div class="ajuste-juego">
        <p class="aj-name">${j.icon} ${esc(j.label)}</p>
        ${j.opciones.map((o) => `
          <label>${esc(o.label)}
            <select data-juego="${j.id}" data-opcion="${o.id}" data-defecto="${esc(String(o.porDefecto))}">
              ${o.valores.map((v) => `<option value="${esc(String(v.v))}">${esc(v.label)}${String(v.v) === String(o.porDefecto) ? ' (por defecto)' : ''}</option>`).join('')}
            </select>
          </label>`).join('')}
      </div>`).join('');
  }
  cont.querySelectorAll('select[data-juego]').forEach((sel) => {
    if (document.activeElement === sel) return;
    const juego = juegos.find((j) => j.id === sel.dataset.juego);
    const op = juego && juego.opciones.find((o) => o.id === sel.dataset.opcion);
    const elegido = ((room.gameOptions || {})[sel.dataset.juego] || {})[sel.dataset.opcion];
    sel.value = String(elegido !== undefined ? elegido : op.porDefecto);
  });
}
$('config-ajustes').addEventListener('change', () => sendConfig());
[
  'config-program', 'config-rounds', 'config-time', 'config-region', 'config-difficulty', 'config-adults',
  'config-test', 'config-test-names-a', 'config-test-names-b', 'config-tiempo-respuesta'
].forEach((id) => $(id).addEventListener('change', () => sendConfig()));

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
  // Programas con otra unidad (ej. Gran Premio: 1, 2 o 3 carreras).
  const mapaRondas = room.rondasSegunCantidad;
  const [uno, varios] = room.nombreRonda || ['prueba', 'pruebas'];
  [...$('config-rounds').options].forEach((o) => {
    const n = mapaRondas ? mapaRondas[o.value] : Number(o.value);
    o.textContent = `${n} ${n === 1 ? uno : varios}`;
  });
  $('config-rounds-label').firstChild.textContent = `Cantidad de ${varios} `;
  // Si la cantidad no cambia nada (ej. Noche de Casino: siempre una mesa), no se muestra.
  const unaSola = mapaRondas && new Set(Object.values(mapaRondas)).size === 1;

  // Programas "pick" (Varios): se tildan los juegos a mano, no se sortea una
  // cantidad, y no hay rosco final que gaste el tiempo base.
  const esPick = room.sequenceMode === 'pick';
  $('config-rounds-label').classList.toggle('hidden', esPick || unaSola);
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

  const trSelect = $('config-tiempo-respuesta');
  if (trSelect.dataset.filled !== 'yes' && room.tiemposRespuesta) {
    trSelect.innerHTML = room.tiemposRespuesta
      .map((t) => `<option value="${t}">${t ? `${t} segundos` : 'Sin límite'}</option>`).join('');
    trSelect.dataset.filled = 'yes';
  }
  if (document.activeElement !== trSelect) trSelect.value = String(room.tiempoRespuesta || 0);
  renderFormatos();
  renderAjustesJuegos();

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
      : ['impostor', 'encuesta', 'caja-fuerte', 'verdadero-falso', 'torre', 'aguante', 'casita-robada', 'chocadores', 'ruleta'].includes(round.type) ? `${state.points || 0} pts`
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
    if (!esRosco) bumpIfChanged(`${room.code}-${room.currentRoundNumber}-${entrantId}`, main, box.querySelector('.tb-time'));
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

let dondeEstabaMemo = null;
let dondeRecienTapado = false;
function boardDondeEstaba(round, container) {
  const ask = round.askItem;
  // Solo la primera vez que se tapa el panel las cartas "se dan vuelta".
  dondeRecienTapado = dondeEstabaMemo === true && !round.memorizando;
  dondeEstabaMemo = round.memorizando;
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
    let cls = 'grid-cell' + (visible ? '' : ' hidden-cell') + (!visible && dondeRecienTapado ? ' flip-in' : '') + (visible && round.memorizando ? ' memo' : '');
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
  if (window.Sfx) Sfx.play(fb.result === 'correct' ? 'acierto' : 'error');
  const texto = fb.result === 'correct' ? (fb.secondsWon ? `+${fb.secondsWon}s` : '¡Bien!') : (fb.timeout ? '⏱ ¡Tiempo!' : '✗');
  flyToBank(texto, fb.entrantId, fb.result === 'correct');
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
  'escalera-final': '🪜',
  impostor: '🕵️',
  encuesta: '📊',
  'caja-fuerte': '💼',
  'verdadero-falso': '⚡',
  torre: '🧱',
  aguante: '🚦',
  'casita-robada': '🃏',
  chocadores: '🏎️',
  ruleta: '🎰'
};

// ---------- Capa "show" común a todos los juegos ----------
// Identidad de cada prueba (color + cómo se juega en una línea), la
// presentación con cuenta regresiva al arrancar cada prueba, puntos que
// "vuelan" al marcador y confeti en los finales.
const GAME_THEME = {
  'rosco-por-turnos': ['#ffb23f', '#ff6b3d'],
  'eligi-una': ['#3de6ff', '#5b8dd6'],
  'la-silla': ['#ffd23f', '#ff9f1c'],
  'donde-estaba': ['#3ddc84', '#1fb6a6'],
  'sopa-de-letras': ['#8b5cff', '#3de6ff'],
  'palabras-cruzadas': ['#ff3d7f', '#8b5cff'],
  tutifruti: ['#ff6b3d', '#ff3d7f'],
  'la-cadena': ['#3de6ff', '#3ddc84'],
  'adivina-la-cancion': ['#ff3d7f', '#ffb23f'],
  mimica: ['#ffd23f', '#3ddc84'],
  'palabra-prohibida': ['#ff4d5e', '#ff9f1c'],
  'duelo-torres': ['#5b8dd6', '#e0637a'],
  'escalera-final': ['#ffb23f', '#3de6ff'],
  impostor: ['#ff3d7f', '#8b5cff'],
  encuesta: ['#3de6ff', '#ffb23f'],
  'caja-fuerte': ['#ffd23f', '#3ddc84'],
  'verdadero-falso': ['#3ddc84', '#ff4d5e'],
  torre: ['#3de6ff', '#8b5cff'],
  aguante: ['#ff4d5e', '#ffb23f'],
  'casita-robada': ['#ffd23f', '#ff3d7f'],
  chocadores: ['#ff4d5e', '#3de6ff'],
  ruleta: ['#ffd23f', '#1f7a46']
};
const GAME_HOWTO = {
  'rosco-por-turnos': 'Una palabra por letra. Acertás y seguís; errás o pasás y le toca al otro. El reloj corre solo en tu turno.',
  'eligi-una': 'Diez preguntas por equipo, cuatro opciones. Cada acierto suma segundos para la final.',
  'la-silla': 'Cinco preguntas que empiezan con la misma letra. Con dos errores, se corta.',
  'donde-estaba': 'Memoricen el panel. Cuando se tape, digan dónde estaba cada imagen.',
  'sopa-de-letras': 'Cada equipo, su propia sopa. Tocá la primera y la última letra de cada palabra. Gana el más rápido.',
  'palabras-cruzadas': 'Completen las palabras que cruzan la base. Cada equipo, su tablero, al mismo tiempo.',
  tutifruti: 'Una letra, seis categorías. ¡El primero en completar todo corta a los demás!',
  'la-cadena': 'Recitá la cadena completa y sumá un eslabón nuevo, todo de un tirón.',
  'adivina-la-cancion': 'Un equipo pone música, el otro adivina. ¡Tocá el botón apenas la sepas!',
  mimica: 'Uno actúa en silencio, el otro equipo adivina en voz alta.',
  'palabra-prohibida': 'Describí la palabra sin decir ninguna de las prohibidas.',
  'duelo-torres': 'Uno contra uno, preguntas alternadas. El primero que se equivoca, cae.',
  'escalera-final': 'Subí escalón por escalón. Si caés, volvés al último que plantaste.',
  impostor: 'Todos tienen la misma palabra... menos uno. Den pistas y descubran al impostor.',
  encuesta: 'Adivinen las respuestas más populares. Con 3 errores, el otro equipo puede robar el pozo.',
  'caja-fuerte': 'Elijan su caja y abran las demás. La Banca ofrece: ¿trato o no trato?',
  'verdadero-falso': 'Todos contestan a la vez. Acertar suma 2; el primero en acertar, 1 más.',
  torre: 'Tocá para soltar el bloque. Lo que sobra se corta: ¡apilen la torre más alta!',
  aguante: 'Semáforo de largada: tocá apenas se apaguen las luces. Puntos como en la F1, suman para tu equipo.',
  'casita-robada': 'Tirá una carta: si hay iguales en la mesa, las levantás; si coincide con la casita rival, ¡se la robás!',
  chocadores: 'Tu celu es el volante: levantá la parte de arriba para acelerar, la de abajo para retroceder, y ladealo para doblar. ¡Chocá a los rivales y sumá vueltas para tu equipo!',
  ruleta: 'Todos arrancan con 1.000 fichas. Apostá en el paño, mirá girar la ruleta y cobrá. Gana el que más fichas junta.'
};
function gameTheme(type) { return GAME_THEME[type] || ['#ffb23f', '#ff3d7f']; }

// Encabezado de la prueba: ícono, nombre y "1 / 3" con el color del juego.
function renderGameHeader(round) {
  const [a, b] = gameTheme(round.type);
  const screen = $('screen-playing');
  screen.style.setProperty('--game-a', a);
  screen.style.setProperty('--game-b', b);
  $('playing-round-label').innerHTML = `
    <span class="gh-icon">${GAME_TYPE_ICONS[round.type] || '🎮'}</span>
    <span class="gh-name">${esc(round.label || '')}</span>
    ${room.turnoRestante !== null && room.turnoRestante !== undefined
    ? `<span class="gh-timer${room.turnoRestante <= 5 ? ' danger' : ''}" title="Tiempo para responder">⏱ ${room.turnoRestante}</span>` : ''}
    <span class="gh-step">${room.currentRoundNumber}<small>/${room.totalRounds}</small></span>`;
}

// Presentación al arrancar cada prueba: ícono grande, nombre, cómo se juega
// y 3-2-1. Se puede saltear tocando. No frena al servidor: es solo pantalla.
let introShownFor = null;
function maybeRoundIntro(round, roundKey) {
  if (introShownFor === roundKey) return;
  introShownFor = roundKey;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const [a, b] = gameTheme(round.type);
  const intro = document.createElement('div');
  intro.className = 'round-intro';
  intro.style.setProperty('--game-a', a);
  intro.style.setProperty('--game-b', b);
  intro.innerHTML = `
    <div class="ri-rays"></div>
    <div class="ri-body">
      <p class="ri-step">Prueba ${room.currentRoundNumber} de ${room.totalRounds}</p>
      <div class="ri-icon">${GAME_TYPE_ICONS[round.type] || '🎮'}</div>
      <h2 class="ri-name">${esc(round.label || '')}</h2>
      <p class="ri-howto">${GAME_HOWTO[round.type] || ''}</p>
      <div class="ri-count"><span>3</span><span>2</span><span>1</span><span>¡YA!</span></div>
    </div>`;
  const cerrar = () => { intro.classList.add('out'); setTimeout(() => intro.remove(), 400); };
  intro.addEventListener('click', cerrar);
  document.body.appendChild(intro);
  if (window.Sfx) { Sfx.play('redoble'); setTimeout(() => Sfx.play('turno'), 2300); }
  setTimeout(cerrar, 2900);
}

// Marcador: cuando cambia un número, "salta".
const lastBankValues = {};
function bumpIfChanged(key, value, el) {
  if (lastBankValues[key] !== undefined && lastBankValues[key] !== value) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
  lastBankValues[key] = value;
}

// Puntos que vuelan desde el tablero hasta el marcador del equipo.
function flyToBank(text, entrantId, good) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const board = document.querySelector('#game-board .board');
  const banks = [...document.querySelectorAll('#time-banks .time-bank')];
  const ids = Object.keys((room.round || {}).entrants || {});
  const target = banks[ids.indexOf(entrantId)];
  if (!board) return;
  const from = board.getBoundingClientRect();
  const fly = document.createElement('div');
  fly.className = 'fly-points' + (good ? '' : ' bad');
  fly.textContent = text;
  fly.style.left = `${from.left + from.width / 2}px`;
  fly.style.top = `${from.top + from.height / 2}px`;
  document.body.appendChild(fly);
  requestAnimationFrame(() => {
    if (target && good) {
      const to = target.getBoundingClientRect();
      fly.style.transform = `translate(${to.left + to.width / 2 - (from.left + from.width / 2)}px, ${to.top + to.height / 2 - (from.top + from.height / 2)}px) scale(0.6)`;
    } else {
      fly.style.transform = 'translate(0, -60px)';
    }
    fly.classList.add('go');
  });
  setTimeout(() => fly.remove(), 1100);
}

// Confeti en canvas (sin librerías). Se dispara en finales y podios.
function confetti(segundos = 2.8) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  document.body.appendChild(c);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const colores = ['#ffb23f', '#ff3d7f', '#3de6ff', '#8b5cff', '#3ddc84', '#ffffff'];
  const piezas = Array.from({ length: 160 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 80, y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 13 - 4,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
    w: 6 + Math.random() * 6, h: 4 + Math.random() * 4, col: colores[Math.floor(Math.random() * colores.length)]
  }));
  const t0 = performance.now();
  (function paso(t) {
    const vivo = (t - t0) / 1000 < segundos;
    g.clearRect(0, 0, innerWidth, innerHeight);
    piezas.forEach((p) => {
      p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r);
      g.fillStyle = p.col; g.globalAlpha = vivo ? 1 : 0.6;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
    });
    if (vivo) requestAnimationFrame(paso); else c.remove();
  }(t0));
}

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

// La letra sale como en una tragamonedas: pasan letras rápido y frena en la
// que tocó. Solo la primera vez que aparece cada letra.
let tutiSlotShown = null;
function tutiSlotMachine(el, letra, key) {
  if (!el || tutiSlotShown === key) return;
  tutiSlotShown = key;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const abc = 'ABCDEFGHIJLMNOPRSTUV';
  el.classList.add('spinning');
  let n = 0;
  const vueltas = 16;
  const tick = () => {
    n += 1;
    if (n >= vueltas) {
      el.textContent = letra;
      el.classList.remove('spinning');
      el.classList.add('landed');
      if (window.Sfx) Sfx.play('acierto');
      return;
    }
    el.textContent = abc[Math.floor(Math.random() * abc.length)];
    if (window.Sfx && n % 2 === 0) Sfx.play('pop');
    setTimeout(tick, 40 + n * 9); // frena de a poco
  };
  tick();
}

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
  tutiSlotMachine(box.querySelector('.tuti-letter'), round.letter, `${roundKey}-${round.rondaActual}`);

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
    ${round.phase === 'buzzing' ? `<div class="eq" aria-hidden="true">${'<i></i>'.repeat(14)}</div>` : ''}
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

  const esCampeonTurno = round.turnoDe === 'campeon';
  const nombreEnTurno = esCampeonTurno ? round.campeonName : round.retadorName;
  const idEnTurno = esCampeonTurno ? round.campeonId : round.retadorId;
  const equipoEnTurno = esCampeonTurno ? round.campeonTeam : round.retadorTeam;

  const box = document.createElement('div');
  box.className = 'board';
  // Cara a cara: el campeón (con corona) contra el retador; brilla el que
  // tiene que responder. Debajo de cada uno, las torres ganadas.
  const lado = (team, nombre, rol, enTurno) => {
    const e = round.entrants[team] || {};
    const torres = '🗼'.repeat(Math.min(e.torres || 0, 8)) || '—';
    return `<div class="vs-side${enTurno ? ' on' : ''}" style="--team-color:${teamColor(team) || 'var(--accent)'}">
      <div class="vs-avatar">${esc((nombre || '?').charAt(0).toUpperCase())}${rol === 'campeon' ? '<span class="vs-crown">👑</span>' : ''}</div>
      <p class="vs-name">${esc(nombre || '...')}</p>
      <p class="vs-team">${esc(entrantLabel(team))}</p>
      <p class="vs-towers">${torres}</p>
    </div>`;
  };
  box.innerHTML = `
    <p class="board-topic">${round.theme || 'Duelo de Torres'} · Duelo ${round.number} de ${round.total}</p>
    <div class="vs-stage">
      ${lado(round.campeonTeam, round.campeonName, 'campeon', esCampeonTurno)}
      <span class="vs-badge">VS</span>
      ${lado(round.retadorTeam, round.retadorName, 'retador', !esCampeonTurno)}
    </div>
    <p class="board-counter">Responde ${esc(nombreEnTurno || '...')} · cada torre suma ${round.secondsPerTorre}s</p>
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
// ---------- El Impostor (pistas escritas por turno, votación, robo final) ----------
// El reloj manda una actualización por segundo: si reconstruyéramos todo en
// cada una, se borraría la pista que alguien está escribiendo. Se rearma solo
// cuando cambia algo de verdad (fase, turno, pistas, votos) y el resto de las
// veces solo se actualiza el reloj.
let impostorBuiltFor = null;
let impostorComo = null; // modo prueba: por quién vota el anfitrión

function impostorJugador(round, id) {
  return (round.jugadores || []).find((p) => p.id === id) || null;
}

function impostorNombreHtml(round, id, fallback) {
  const p = impostorJugador(round, id);
  const color = p ? teamColor(p.team) : null;
  return `<span class="imp-name"${color ? ` style="--team-color:${color}"` : ''}>${esc(p ? p.name : fallback || '?')}</span>`;
}

function impostorTitular(round) {
  switch (round.phase) {
    case 'pistas': return round.turnoNombre
      ? `Pista de ${esc(round.turnoNombre)} — vuelta ${round.vuelta} de ${round.totalVueltas}`
      : 'Ronda de pistas';
    case 'votacion': return '🗳 ¿Quién es el impostor?';
    case 'robo': return `🚨 ¡Atraparon a ${esc(round.impostorName || '')}! Última chance de robar el caso`;
    case 'revelacion': return '🎬 Revelación';
    default: return '';
  }
}

function impostorTimerTexto(round) {
  return `⏱ ${formatTime(Math.max(round.secondsLeft, 0))}`;
}

// La carta secreta: hay que mantenerla apretada para verla, así el de al lado
// no espía de reojo. Se tapa sola al soltar.
function impostorCartaSecreta(privado) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'imp-card';
  let dorso;
  if (privado.rol === 'impostor') {
    dorso = `<strong class="imp-card-title">🕵️ Sos el impostor</strong>
      <small>${privado.categoria ? `Categoría: <b>${esc(privado.categoria)}</b>. ` : ''}No sabés la palabra: escuchá las pistas y disimulá.</small>`;
  } else if (privado.rol === 'tripulante') {
    dorso = `<small>Tu palabra es</small><strong class="imp-card-word">${esc(privado.palabra)}</strong>
      <small>Dá pistas que la rodeen sin decirla.</small>`;
  } else {
    dorso = '<small>Estás mirando este caso.</small>';
  }
  card.innerHTML = `
    <span class="imp-card-front">🔒 Mantené apretado para ver tu palabra</span>
    <span class="imp-card-back">${dorso}</span>`;
  const ver = (e) => { e.preventDefault(); card.classList.add('revealed'); };
  const tapar = () => card.classList.remove('revealed');
  card.addEventListener('pointerdown', ver);
  ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach((ev) => card.addEventListener(ev, tapar));
  card.addEventListener('contextmenu', (e) => e.preventDefault());
  card.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') ver(e); });
  card.addEventListener('keyup', tapar);
  return card;
}

function renderImpostor(round, container, roundKey) {
  const iAmTestHost = room.testMode && myId === room.hostId;
  const iAmHost = myId === room.hostId;
  const privado = round.privado || {};

  if (round.faltanJugadores) {
    container.innerHTML = '<div class="board"><p class="board-clue">El Impostor necesita al menos 3 jugadores.</p></div>';
    return;
  }

  const buildKey = [roundKey, round.number, round.phase, round.turnoDe, (round.pistas || []).length,
    (round.yaVotaron || []).length, privado.miVoto || '', round.roboGuess || '', impostorComo || ''].join('|');
  if (buildKey === impostorBuiltFor) {
    const t = $('imp-timer');
    if (t) t.textContent = impostorTimerTexto(round);
    const bar = $('imp-bar');
    if (bar) bar.innerHTML = progressBarHtml(round.secondsLeft, round.secondsMax);
    return;
  }
  const pistasAntes = impostorBuiltFor && impostorBuiltFor.split('|')[0] === roundKey
    ? Number(impostorBuiltFor.split('|')[4]) : 0;
  impostorBuiltFor = buildKey;
  container.innerHTML = '';

  const modoTexto = { 'con-categoria': 'Con categoría', 'sin-categoria': 'Sin categoría', 'a-ciegas': 'A ciegas' }[round.modo] || '';
  const box = document.createElement('div');
  box.className = 'board imp-board';
  box.innerHTML = `
    <p class="board-topic">Caso ${round.number} de ${round.total} · ${modoTexto}</p>
    <p class="board-clue">${impostorTitular(round)}</p>
    ${round.categoria && round.phase !== 'revelacion' ? `<p class="imp-categoria">Categoría: <b>${esc(round.categoria)}</b></p>` : ''}
    ${round.phase !== 'revelacion' ? `<p class="board-counter" id="imp-timer">${impostorTimerTexto(round)}</p><div id="imp-bar">${progressBarHtml(round.secondsLeft, round.secondsMax)}</div>` : ''}
  `;
  container.appendChild(box);

  // Carta secreta (o, en modo prueba, todo a la vista para poder probar).
  if (round.phase !== 'revelacion') {
    if (privado.modoPrueba) {
      const info = document.createElement('p');
      info.className = 'imp-prueba muted';
      info.innerHTML = `Modo prueba — impostor: <b>${esc(privado.impostorName)}</b> · palabra: <b>${esc(privado.palabra)}</b>`
        + (privado.palabraImpostor ? ` · la del impostor: <b>${esc(privado.palabraImpostor)}</b>` : '');
      container.appendChild(info);
    } else if (privado.rol) {
      container.appendChild(impostorCartaSecreta(privado));
    }
  }

  // Una fila por jugador con todas sus pistas, en el orden en que hablan: es
  // más corto que una pista por renglón y sirve más para deducir ("¿quién
  // dijo cosas que no pegan?"). En la votación, se vota tocando la fila.
  const pistas = round.pistas || [];
  const jugadores = round.jugadores || [];
  const yaVotaron = new Set(round.yaVotaron || []);
  let votante = myId;
  if (round.phase === 'votacion' && iAmTestHost) {
    const pendientes = jugadores.filter((p) => !yaVotaron.has(p.id));
    if (!impostorComo || !jugadores.some((p) => p.id === impostorComo)) impostorComo = (pendientes[0] || jugadores[0] || {}).id;
    votante = impostorComo;
    const sel = document.createElement('label');
    sel.className = 'imp-como';
    sel.innerHTML = `Votando como <select id="imp-como">${jugadores.map((p) =>
      `<option value="${esc(p.id)}"${p.id === impostorComo ? ' selected' : ''}>${esc(p.name)}${yaVotaron.has(p.id) ? ' ✔' : ''}</option>`).join('')}</select>`;
    container.appendChild(sel);
    sel.querySelector('select').addEventListener('change', (e) => { impostorComo = e.target.value; impostorBuiltFor = null; renderPlaying(); });
  }
  const puedeVotar = round.phase === 'votacion' && (iAmTestHost || jugadores.some((p) => p.id === myId));
  const lista = document.createElement('div');
  lista.className = 'imp-clues' + (puedeVotar ? ' votando' : '');
  jugadores.forEach((j) => {
    const suyas = pistas.map((p, i) => ({ ...p, i })).filter((p) => p.id === j.id);
    const escribiendo = round.phase === 'pistas' && round.turnoDe === j.id;
    const chips = suyas.map((p) => `<span class="imp-chip${p.i >= pistasAntes ? ' nueva' : ''}${p.skipped ? ' salteada' : ''}">${p.skipped ? 'pasó' : esc(p.text)}</span>`).join('')
      + (escribiendo ? '<span class="imp-chip escribiendo">✍️ escribiendo…</span>' : '');
    const votable = puedeVotar && j.id !== votante;
    const row = document.createElement(votable ? 'button' : 'div');
    const elegido = round.phase === 'votacion' && !iAmTestHost && privado.miVoto === j.id;
    row.className = 'imp-row' + (escribiendo ? ' activo' : '') + (votable ? ' votable' : '') + (elegido ? ' elegido' : '')
      + (round.phase === 'revelacion' && j.id === round.impostorId ? ' impostor' : '');
    const color = teamColor(j.team);
    if (color) row.style.setProperty('--team-color', color);
    row.innerHTML = `${impostorNombreHtml(round, j.id, j.name)}<span class="imp-chips">${chips || '<span class="imp-chip vacia">—</span>'}</span>`
      + (round.phase === 'votacion' && yaVotaron.has(j.id) ? '<span class="imp-voto-ok" title="Ya votó">✔</span>' : '')
      + (votable ? `<span class="imp-votar">${elegido ? 'Tu voto' : 'Votar'}</span>` : '')
      + (round.phase === 'revelacion' && j.id === round.impostorId ? '<span class="imp-votar imp-badge">🕵️ Impostor</span>' : '');
    if (votable) {
      row.type = 'button';
      row.addEventListener('click', () => {
        socket.emit('submit-answer', iAmTestHost ? { voto: j.id, como: votante } : { voto: j.id });
        if (iAmTestHost) impostorComo = null; // pasa solo al siguiente que falta votar
      });
    }
    lista.appendChild(row);
  });
  container.appendChild(lista);

  const acciones = document.createElement('div');
  acciones.className = 'imp-actions';
  container.appendChild(acciones);
  let msg = '';

  if (round.phase === 'pistas') {
    const meToca = round.turnoDe === myId;
    if (meToca || iAmTestHost) {
      if (meToca && navigator.vibrate) navigator.vibrate(120);
      if (meToca && window.Sfx) Sfx.play('turno');
      const form = document.createElement('form');
      form.className = 'imp-form';
      form.innerHTML = `
        <input id="imp-input" type="text" maxlength="30" autocomplete="off"
          placeholder="${iAmTestHost && !meToca ? `Pista de ${esc(round.turnoNombre)}` : 'Tu pista (sin decir la palabra)'}" />
        <button class="btn btn-solid" type="submit">Mandar</button>`;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = $('imp-input').value.trim();
        if (val) socket.emit('submit-answer', { pista: val });
      });
      acciones.appendChild(form);
      setTimeout(() => { const i = $('imp-input'); if (i) i.focus(); }, 50);
      msg = meToca ? '¡Te toca! Una pista corta (hasta 3 palabras).' : `Modo prueba — escribís por ${round.turnoNombre}.`;
    } else {
      msg = `Le toca a ${round.turnoNombre || '...'}.`;
    }
    if (iAmHost) {
      const skip = document.createElement('button');
      skip.className = 'btn btn-ghost mimica-safety';
      skip.textContent = '⏭ Saltar este turno';
      skip.addEventListener('click', () => socket.emit('judge-word', { saltarTurno: true }));
      acciones.appendChild(skip);
    }
  } else if (round.phase === 'votacion') {
    msg = (puedeVotar ? 'Tocá a quien sospechás. ' : '') + `Votaron ${yaVotaron.size} de ${jugadores.length}.`
      + (!iAmTestHost && privado.miVoto ? ' Podés cambiar tu voto hasta que se cierre.' : '');
    if (iAmHost) {
      const cerrar = document.createElement('button');
      cerrar.className = 'btn btn-ghost mimica-safety';
      cerrar.textContent = 'Cerrar la votación ya';
      cerrar.addEventListener('click', () => socket.emit('judge-word', { cerrarVotacion: true }));
      acciones.appendChild(cerrar);
    }
  } else if (round.phase === 'robo') {
    const soyElImpostor = round.impostorId === myId;
    if (soyElImpostor || iAmTestHost) {
      const p = document.createElement('p');
      p.className = 'imp-robo-titulo';
      p.textContent = soyElImpostor ? '¡Te atraparon! Si adivinás la palabra, te robás el caso:' : `Robo de ${round.impostorName}: ¿cuál era la palabra?`;
      acciones.appendChild(p);
      const grid = document.createElement('div');
      grid.className = 'imp-vote-grid';
      (round.roboOptions || []).forEach((w, i) => {
        const b = document.createElement('button');
        b.className = 'imp-vote';
        b.textContent = w;
        b.addEventListener('click', () => socket.emit('submit-answer', { robo: i }));
        grid.appendChild(b);
      });
      acciones.appendChild(grid);
      msg = 'Elegí rápido: el reloj corre.';
    } else {
      msg = `${round.impostorName} está intentando adivinar la palabra para robarse el caso…`;
    }
  } else if (round.phase === 'revelacion') {
    const r = round.resultado || {};
    const titulo = r.robado ? '🦹 ¡Se robó el caso adivinando la palabra!'
      : r.atrapado ? '🎯 ¡Lo atraparon!'
        : r.empate ? '🤝 Empate en la votación: el impostor se escapa'
          : `😈 Se escapó: acusaron a ${esc(r.acusadoName || '')}`;
    const votos = Object.entries(round.votos || {})
      .map(([v, t]) => `<li>${impostorNombreHtml(round, v)} → ${impostorNombreHtml(round, t)}</li>`).join('');
    const reveal = document.createElement('div');
    reveal.className = 'imp-reveal';
    reveal.innerHTML = `
      <p class="imp-reveal-label">El impostor era</p>
      <p class="imp-reveal-name">${impostorNombreHtml(round, round.impostorId, round.impostorName)}</p>
      <p class="imp-reveal-word">La palabra era <b>${esc(round.palabra || '')}</b>${round.categoria ? ` (${esc(round.categoria)})` : ''}</p>
      ${round.palabraImpostor ? `<p class="imp-reveal-word">Al impostor le tocó <b>${esc(round.palabraImpostor)}</b>, sin saber que era el impostor</p>` : ''}
      <p class="imp-reveal-result">${titulo}</p>
      ${votos ? `<ul class="imp-votos">${votos}</ul>` : ''}
      <p class="muted sm-desc">Cada voto acertado suma ${round.puntos.votoCorrecto} para tu equipo · el impostor suma ${round.puntos.escapa} si escapa o ${round.puntos.robo} si roba.</p>`;
    acciones.appendChild(reveal);
    if (iAmHost) {
      const sig = document.createElement('button');
      sig.className = 'btn btn-solid';
      sig.textContent = round.number >= round.total ? 'Terminar ▶' : 'Siguiente caso ▶';
      sig.addEventListener('click', () => socket.emit('judge-word', { siguienteCaso: true }));
      acciones.appendChild(sig);
    }
    msg = `Sigue solo en ${Math.max(round.secondsLeft, 0)} s.`;
    narrate(`impostor-revela-${roundKey}-${round.number}`, `El impostor era ${round.impostorName}. La palabra era ${round.palabra}.`);
  }

  if (round.phase === 'pistas' && (round.pistas || []).length === 0) {
    narrate(`impostor-caso-${roundKey}-${round.number}`, `Caso ${round.number}. Miren su palabra en secreto. ¡Que empiecen las pistas!`);
  }
  $('playing-turn-msg').textContent = msg;
}

// ---------- La Encuesta (tablero de respuestas, cruces y robo) ----------
// El reloj para responder manda una actualización por segundo: el formulario
// se rearma solo cuando cambia algo de verdad, para no borrar lo que se
// está escribiendo.
let encuestaBuiltFor = null;
let encuestaVerOcultas = false;

function renderEncuesta(round, container, roundKey) {
  const iAmHost = myId === room.hostId;
  const puedo = myTurnNow(round);
  const fichasKey = (round.fichas || []).map((f) => (f.revelada ? 1 : 0)).join('');
  const buildKey = [roundKey, round.number, round.fase, round.activeEntrant, fichasKey, round.cruces,
    JSON.stringify(round.ultimo || {}), encuestaVerOcultas,
    ((room.currentMembers || {})[round.activeEntrant] || {}).id].join('|');
  if (buildKey === encuestaBuiltFor) {
    // Solo cambia la cuenta regresiva: se actualiza el texto, sin redibujar
    // (si no, el botón "Siguiente" se recreaba justo cuando lo tocaban).
    if (round.fase === 'resultado') $('playing-turn-msg').textContent = `Sigue solo en ${round.segundosResultado} s.`;
    return;
  }
  encuestaBuiltFor = buildKey;
  container.innerHTML = '';

  const cruces = Array.from({ length: round.maxCruces }, (_, i) =>
    `<span class="enc-x${i < round.cruces ? ' on' : ''}">✗</span>`).join('');
  const box = document.createElement('div');
  box.className = 'board';
  box.innerHTML = `
    <p class="board-topic">Pregunta ${round.number} de ${round.total}${round.multiplicador > 1 ? ' · <b class="enc-doble">¡VALE DOBLE!</b>' : ''}</p>
    <p class="enc-pregunta">${esc(round.pregunta || '')}</p>
    <div class="enc-meta">
      <span class="enc-cruces">${cruces}</span>
      <span class="enc-pozo">Pozo <b>${round.pozo}</b></span>
    </div>`;
  container.appendChild(box);

  // Tablero de fichas
  const tablero = document.createElement('div');
  tablero.className = 'enc-tablero';
  (round.fichas || []).forEach((f) => {
    const el = document.createElement('div');
    const color = f.por ? teamColor(f.por) : null;
    el.className = 'enc-ficha' + (f.revelada ? ' revelada' : '') + (!f.revelada && f.texto ? ' sobrante' : '');
    if (color) el.style.setProperty('--team-color', color);
    el.innerHTML = f.texto
      ? `<span class="enc-n">${f.n}</span><span class="enc-t">${esc(f.texto)}</span><span class="enc-p">${f.puntos}</span>`
      : `<span class="enc-n grande">${f.n}</span>`;
    tablero.appendChild(el);
  });
  container.appendChild(tablero);

  // Lo último que se dijo
  if (round.ultimo && round.fase !== 'resultado') {
    const u = round.ultimo;
    const p = document.createElement('p');
    p.className = 'enc-ultimo ' + (u.acierto ? 'ok' : u.repetida ? 'rep' : 'mal');
    p.innerHTML = `${esc(entrantLabel(u.team))} dijo <b>"${esc(u.texto)}"</b> ${u.acierto ? '✔' : u.repetida ? '— ya estaba, digan otra' : '✗'}`;
    container.appendChild(p);
  }

  const acciones = document.createElement('div');
  acciones.className = 'imp-actions';
  container.appendChild(acciones);
  let msg = '';

  if (round.fase === 'resultado') {
    const gano = round.ganadorPregunta;
    const banner = document.createElement('div');
    banner.className = 'enc-resultado';
    banner.innerHTML = gano
      ? `<b>${esc(entrantLabel(gano))}</b> se lleva <b>${round.pozo}</b> puntos${round.control !== gano ? ' <span>¡robado!</span>' : ''}`
      : 'Nadie se lleva el pozo';
    acciones.appendChild(banner);
    if (iAmHost) {
      const sig = document.createElement('button');
      sig.className = 'btn btn-solid';
      sig.textContent = round.number >= round.total ? 'Terminar ▶' : 'Siguiente pregunta ▶';
      sig.addEventListener('click', () => socket.emit('judge-word', { siguiente: true }));
      acciones.appendChild(sig);
    }
    msg = `Sigue solo en ${round.segundosResultado} s.`;
  } else {
    if (round.fase === 'robo') {
      const robo = document.createElement('p');
      robo.className = 'enc-robo';
      robo.innerHTML = `🚨 ¡ROBO! <b>${esc(entrantLabel(round.activeEntrant))}</b> tiene una sola chance de llevarse el pozo`;
      acciones.appendChild(robo);
    }
    if (puedo) {
      const form = document.createElement('form');
      form.className = 'imp-form';
      form.innerHTML = `<input id="enc-input" type="text" maxlength="40" autocomplete="off" placeholder="${round.fase === 'robo' ? 'Su respuesta para robar' : 'Tu respuesta'}" />
        <button class="btn btn-solid" type="submit">Decir</button>`;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = $('enc-input').value.trim();
        if (v) socket.emit('submit-answer', { respuesta: v });
      });
      acciones.appendChild(form);
      setTimeout(() => { const i = $('enc-input'); if (i) i.focus(); }, 50);
      msg = round.fase === 'robo' ? '¡Una sola chance! Pónganse de acuerdo y escriban.' : '¡Te toca! Escribí una respuesta popular.';
    } else {
      const onDuty = (room.currentMembers || {})[round.activeEntrant];
      msg = `Responde ${entrantLabel(round.activeEntrant)}${onDuty ? ` — ${onDuty.name}` : ''}...`;
    }
    // Anfitrión: ver las respuestas ocultas (a propósito) para arbitrar.
    if (iAmHost && round.privado && round.privado.ocultas) {
      const t = document.createElement('button');
      t.className = 'btn btn-ghost mimica-safety';
      t.textContent = encuestaVerOcultas ? '🙈 Ocultar respuestas' : '🔒 Ver respuestas para arbitrar (las vas a ver vos)';
      t.addEventListener('click', () => { encuestaVerOcultas = !encuestaVerOcultas; encuestaBuiltFor = null; renderPlaying(); });
      acciones.appendChild(t);
      if (encuestaVerOcultas) {
        const lista = document.createElement('div');
        lista.className = 'enc-arbitro';
        lista.innerHTML = '<p class="muted">Si lo que dijeron es una de estas, tocala para darla por buena:</p>';
        round.privado.ocultas.forEach((o) => {
          const b = document.createElement('button');
          b.className = 'btn btn-ghost';
          b.textContent = `✔ ${o.texto}`;
          b.addEventListener('click', () => socket.emit('judge-word', { revelar: o.i }));
          lista.appendChild(b);
        });
        acciones.appendChild(lista);
      }
    }
  }
  $('playing-turn-msg').textContent = msg;
}

// ---------- Caja Fuerte (¿trato o no trato?) ----------
// Se redibuja solo si cambió algo (no con cada segundo del reloj): si no, un
// toque justo en ese momento caía sobre una caja que ya no existía.
let cajaBuiltFor = null;
function renderCajaFuerte(round, container, roundKey) {
  const abiertas = (round.cajas || []).map((c) => (c.abierta ? 1 : 0)).join('');
  const buildKey = [roundKey, round.number, round.fase, round.miCaja, abiertas, round.oferta, round.activeEntrant,
    ((room.currentMembers || {})[round.activeEntrant] || {}).id].join('|');
  if (buildKey === cajaBuiltFor) {
    if (round.fase === 'final') $('playing-turn-msg').textContent = `Sigue solo en ${round.segundosFinal} s.`;
    return;
  }
  cajaBuiltFor = buildKey;
  container.innerHTML = '';
  const puedo = myTurnNow(round);
  const equipo = esc(entrantLabel(round.activeEntrant));
  const textos = {
    elegir: `${equipo}: elijan <b>SU caja</b>. No se abre hasta el final.`,
    abrir: `${equipo}: abran <b>${round.abrirEnTanda}</b> ${round.abrirEnTanda === 1 ? 'caja' : 'cajas'} más`,
    oferta: '📞 Suena el teléfono... <b>la Banca hace una oferta</b>',
    final: '🎬 Final del tablero'
  };
  const box = document.createElement('div');
  box.className = 'board';
  box.innerHTML = `
    <p class="board-topic">Tablero ${round.number} de ${round.total} · juega ${equipo}</p>
    <p class="board-clue">${textos[round.fase] || ''}</p>`;
  container.appendChild(box);

  const mesa = document.createElement('div');
  mesa.className = 'cf-mesa';
  // Premios en juego (tachados los que ya salieron)
  const premios = round.premios || [];
  const mitad = Math.ceil(premios.length / 2);
  const col = (lista) => lista.map((p) => `<span class="cf-premio${p.enJuego ? '' : ' fuera'}${p.v >= 15 ? ' alto' : ''}">${p.v}</span>`).join('');
  mesa.innerHTML = `
    <div class="cf-premios"><div>${col(premios.slice(0, mitad))}</div><div>${col(premios.slice(mitad))}</div></div>
    <div class="cf-cajas"></div>`;
  const grid = mesa.querySelector('.cf-cajas');
  (round.cajas || []).forEach((c) => {
    const b = document.createElement('button');
    const esMia = c.n === round.miCaja;
    b.className = 'cf-caja' + (c.abierta ? ' abierta' : '') + (esMia ? ' mia' : '') + (c.valor !== null && c.valor >= 15 ? ' alto' : '');
    b.innerHTML = c.abierta || (esMia && c.valor !== null)
      ? `<span class="cf-num">${c.n}</span><b>${c.valor}</b>`
      : `<span class="cf-num">${c.n}</span>${esMia ? '<small>TU CAJA</small>' : '💼'}`;
    const elegible = puedo && ((round.fase === 'elegir') || (round.fase === 'abrir' && !c.abierta && !esMia));
    b.disabled = !elegible;
    if (elegible) b.addEventListener('click', () => { if (window.Sfx) Sfx.play('pop'); socket.emit('submit-answer', { caja: c.n }); });
    grid.appendChild(b);
  });
  container.appendChild(mesa);

  const acciones = document.createElement('div');
  acciones.className = 'imp-actions';
  container.appendChild(acciones);
  let msg = puedo ? '¡Les toca! Decidan en voz alta.' : `Decide ${equipo}...`;

  if (round.fase === 'oferta') {
    const of = document.createElement('div');
    of.className = 'cf-oferta';
    of.innerHTML = `<p>La Banca ofrece</p><b>${round.oferta}</b><span>puntos por tu caja</span>
      ${round.ofertas.length > 1 ? `<small>Ofertas anteriores: ${round.ofertas.slice(0, -1).join(' · ')}</small>` : ''}`;
    acciones.appendChild(of);
    if (puedo) {
      const fila = document.createElement('div');
      fila.className = 'cf-decision';
      fila.innerHTML = '<button class="cf-trato">🤝 TRATO</button><button class="cf-notrato">✋ NO TRATO</button>';
      fila.querySelector('.cf-trato').addEventListener('click', () => socket.emit('submit-answer', { trato: true }));
      fila.querySelector('.cf-notrato').addEventListener('click', () => socket.emit('submit-answer', { trato: false }));
      acciones.appendChild(fila);
      msg = '¿Trato o no trato?';
    }
  }
  if (round.fase === 'final' && round.resultado) {
    const r = round.resultado;
    const fin = document.createElement('div');
    fin.className = 'cf-final';
    fin.innerHTML = r.como === 'trato'
      ? `<p>Aceptaron el trato por <b>${r.puntos}</b></p><p>Su caja tenía <b>${r.valorSuCaja}</b> ${r.valorSuCaja > r.puntos ? '😱 ¡tenían más!' : '😎 ¡buen negocio!'}</p>`
      : `<p>Llegaron hasta el final: su caja tenía</p><b class="cf-grande">${r.valorSuCaja}</b>`;
    acciones.appendChild(fin);
    if (myId === room.hostId) {
      const sig = document.createElement('button');
      sig.className = 'btn btn-solid';
      sig.textContent = round.number >= round.total ? 'Terminar ▶' : 'Siguiente equipo ▶';
      sig.addEventListener('click', () => socket.emit('judge-word', { siguiente: true }));
      acciones.appendChild(sig);
    }
    msg = `Sigue solo en ${round.segundosFinal} s.`;
    if (lastCajaFinal !== `${room.code}-${room.currentRoundNumber}-${round.number}`) {
      lastCajaFinal = `${room.code}-${room.currentRoundNumber}-${round.number}`;
      if (r.puntos >= 10) confetti(1.8);
    }
  }
  $('playing-turn-msg').textContent = msg;
}
let lastCajaFinal = null;

// ---------- Verdadero o Falso ----------
// Todos contestan a la vez: dos botones gigantes, una barra de tiempo, y al
// revelar, la respuesta con el dato curioso y lo que eligió cada equipo.
let vfBuiltFor = null;
let vfSonado = null;
function renderVerdaderoFalso(round, container, roundKey) {
  const iAmTestHost = room.testMode && myId === room.hostId;
  const miEntrant = myEntrantId();
  const resp = round.respuestas || {};
  const buildKey = [roundKey, round.number, round.fase, Object.keys(resp).sort().join(',')].join('|');
  const pendientes = Object.keys(round.entrants).filter((id) => !resp[id]);
  const actualizarReloj = () => {
    const seg = $('vf-seg');
    if (seg) seg.textContent = round.segundos;
    const barra = $('vf-barra');
    if (barra) barra.style.width = `${Math.max(0, (round.segundos / round.segundosPorPregunta) * 100)}%`;
    if (round.fase === 'revelar') $('playing-turn-msg').textContent = `Sigue solo en ${round.segundos} s.`;
  };
  if (buildKey === vfBuiltFor) { actualizarReloj(); return; }
  vfBuiltFor = buildKey;
  container.innerHTML = '';

  const box = document.createElement('div');
  box.className = 'board vf-board' + (round.fase === 'revelar' ? (round.verdadero ? ' vf-es-v' : ' vf-es-f') : '');
  box.innerHTML = `
    <p class="board-topic">Afirmación ${round.number} de ${round.total}${round.fase === 'pregunta' ? ` · ⏳ <span id="vf-seg">${round.segundos}</span>s` : ''}</p>
    ${round.fase === 'pregunta' ? '<div class="timer-bar"><div class="timer-bar-fill" id="vf-barra"></div></div>' : ''}
    <p class="vf-afirmacion">${esc(round.afirmacion || '')}</p>
    ${round.fase === 'revelar' ? `<p class="vf-veredicto">${round.verdadero ? '✅ VERDADERO' : '❌ FALSO'}</p>
      ${round.dato ? `<p class="vf-dato">💡 ${esc(round.dato)}</p>` : ''}` : ''}`;
  container.appendChild(box);

  // Cómo va cada equipo: "pensando", "listo" o, al revelar, qué eligió.
  const chips = document.createElement('div');
  chips.className = 'vf-equipos';
  chips.innerHTML = Object.keys(round.entrants).map((id) => {
    const r = resp[id];
    const color = teamColor(id) || 'var(--accent)';
    let estado = '🤔';
    if (r && round.fase === 'pregunta') estado = '✔';
    if (round.fase === 'revelar') {
      estado = !r ? '—' : `${r.verdadero ? 'V' : 'F'} ${r.puntos ? `<b>+${r.puntos}</b>` : '✗'}`;
    }
    const ok = round.fase === 'revelar' && r && r.verdadero === round.verdadero;
    return `<span class="vf-chip${r ? ' listo' : ''}${ok ? ' ok' : ''}" style="--team-color:${color}">${esc(entrantLabel(id))} · ${estado}</span>`;
  }).join('');
  container.appendChild(chips);

  let msg = '';
  if (round.fase === 'pregunta') {
    const yaContesto = miEntrant && resp[miEntrant];
    const puedo = iAmTestHost ? pendientes.length > 0 : (miEntrant && round.entrants[miEntrant] && !yaContesto);
    if (puedo) {
      const fila = document.createElement('div');
      fila.className = 'vf-botones';
      fila.innerHTML = '<button class="vf-btn vf-v">✅<span>VERDADERO</span></button><button class="vf-btn vf-f">❌<span>FALSO</span></button>';
      const mandar = (v) => {
        fila.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        if (window.Sfx) Sfx.play('pop');
        socket.emit('submit-answer', iAmTestHost ? { verdadero: v, asEntrant: pendientes[0] } : { verdadero: v });
      };
      fila.querySelector('.vf-v').addEventListener('click', () => mandar(true));
      fila.querySelector('.vf-f').addEventListener('click', () => mandar(false));
      container.appendChild(fila);
      msg = iAmTestHost ? `Modo prueba — contestando por ${entrantLabel(pendientes[0])}.`
        : room.teamsEnabled ? '¡Rápido! Vale el primer toque de tu equipo.' : '¡Rápido!';
    } else {
      msg = yaContesto ? 'Listo. Esperando a los demás...' : 'Mirá cómo contestan...';
    }
  } else if (round.fase === 'revelar') {
    if (myId === room.hostId) {
      const sig = document.createElement('button');
      sig.className = 'btn btn-solid vf-siguiente';
      sig.textContent = round.number >= round.total ? 'Terminar ▶' : 'Siguiente ▶';
      sig.addEventListener('click', () => socket.emit('judge-word', { siguiente: true }));
      container.appendChild(sig);
    }
    const clave = `${roundKey}-${round.number}`;
    if (vfSonado !== clave) {
      vfSonado = clave;
      const mio = miEntrant && resp[miEntrant];
      if (window.Sfx && mio) Sfx.play(mio.verdadero === round.verdadero ? 'acierto' : 'error');
      else if (window.Sfx) Sfx.play('whoosh');
    }
    msg = `Sigue solo en ${round.segundos} s.`;
  }
  $('playing-turn-msg').textContent = msg;
  actualizarReloj();
}

// ---------- Aguante (semáforo de largada F1) ----------
// Las luces se animan en cada celu con el plan que manda el servidor; el
// tiempo de reacción se mide contra la propia pantalla (justo para todos).
let aguanteBuiltFor = null;
let aguanteTimers = [];
let aguanteApagadoEn = null;
let aguanteYaToque = false;
let aguanteSonidoRes = null;

function limpiarAguante() {
  aguanteTimers.forEach(clearTimeout);
  aguanteTimers = [];
}

function renderAguante(round, container, roundKey) {
  const buildKey = [roundKey, round.serie, round.fase].join('|');
  const nombre = (id) => {
    const p = room.players.find((x) => x.id === id);
    return p ? p.name : '?';
  };
  const actualizarTocaron = () => {
    const el = $('ag-tocaron');
    if (el) el.innerHTML = (round.tocaron || []).map((id) => `<span class="ag-chip">✔ ${esc(nombre(id))}</span>`).join('');
    if (round.fase === 'resultado') $('playing-turn-msg').textContent = `Sigue solo en ${round.segundosResultado} s.`;
  };
  if (buildKey === aguanteBuiltFor) { actualizarTocaron(); return; }
  aguanteBuiltFor = buildKey;
  limpiarAguante();
  container.innerHTML = '';

  const box = document.createElement('div');
  box.className = 'board ag-board';
  const pods = Array.from({ length: 5 }, (_, i) => `<div class="ag-pod" data-i="${i}"><i></i><i></i></div>`).join('');
  box.innerHTML = `
    <p class="board-topic">Largada ${round.number} de ${round.total}</p>
    <div class="ag-semaforo" id="ag-semaforo">${pods}</div>`;
  container.appendChild(box);

  if (round.fase === 'luces' && round.plan) {
    const plan = round.plan;
    aguanteApagadoEn = null;
    aguanteYaToque = false;
    const yaToque = (round.tocaron || []).includes(myId) && !(room.testMode && myId === room.hostId);
    const zona = document.createElement('button');
    zona.className = 'ag-zona';
    zona.id = 'ag-zona';
    zona.innerHTML = '<b id="ag-texto">Esperá a que se apaguen...</b><small id="ag-sub">Tocá apenas se apaguen las luces</small>';
    container.appendChild(zona);
    const tocaron = document.createElement('div');
    tocaron.className = 'ag-tocaron';
    tocaron.id = 'ag-tocaron';
    container.appendChild(tocaron);

    const semaforo = $('ag-semaforo');
    const prender = (i) => {
      const pod = semaforo.querySelector(`.ag-pod[data-i="${i}"]`);
      if (pod) pod.classList.add('on');
      if (window.Sfx) Sfx.play('pop');
    };
    for (let i = 0; i < plan.luces; i++) aguanteTimers.push(setTimeout(() => prender(i), (i + 1) * plan.msPorLuz));
    if (plan.trampaEnMs !== null && plan.trampaEnMs !== undefined) {
      aguanteTimers.push(setTimeout(() => {
        semaforo.classList.add('trampa');
        aguanteTimers.push(setTimeout(() => semaforo.classList.remove('trampa'), 260));
      }, plan.trampaEnMs));
    }
    aguanteTimers.push(setTimeout(() => {
      aguanteApagadoEn = performance.now();
      semaforo.classList.add('apagado');
      semaforo.querySelectorAll('.ag-pod').forEach((p) => p.classList.remove('on'));
      if (!aguanteYaToque) {
        zona.classList.add('ya');
        $('ag-texto').textContent = '¡YA!';
        $('ag-sub').textContent = '¡Tocá!';
      }
      if (window.Sfx) Sfx.play('whoosh');
    }, plan.apagaEnMs));

    if (yaToque) {
      aguanteYaToque = true;
      zona.disabled = true;
      $('ag-texto').textContent = 'Ya tocaste';
      $('ag-sub').textContent = 'Esperando a los demás...';
    }
    zona.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (aguanteYaToque) return;
      aguanteYaToque = true;
      zona.disabled = true;
      zona.classList.remove('ya');
      if (aguanteApagadoEn === null) {
        zona.classList.add('falsa');
        $('ag-texto').textContent = '🚫 ¡Largada en falso!';
        $('ag-sub').textContent = 'Tocaste antes de que se apaguen';
        if (window.Sfx) Sfx.play('error');
        socket.emit('submit-answer', { falsa: true, serie: plan.serie });
      } else {
        const ms = Math.round(performance.now() - aguanteApagadoEn);
        zona.classList.add('hecho');
        $('ag-texto').textContent = `⏱ ${(ms / 1000).toFixed(3)} s`;
        $('ag-sub').textContent = ms < 250 ? '¡Reflejos de piloto!' : ms < 400 ? '¡Bien!' : 'Uh, un poco lento';
        socket.emit('submit-answer', { ms, serie: plan.serie });
      }
    });
    const enJuego = Object.values(room.round.entrants || {}).length;
    $('playing-turn-msg').textContent = room.testMode && myId === room.hostId
      ? 'Modo prueba — tocás por el próximo jugador que falte.'
      : enJuego ? 'Todos juegan a la vez. Los puntos de cada uno suman para su equipo.' : '';
  } else if (round.fase === 'resultado') {
    $('ag-semaforo').classList.add('apagado');
    const porEquipo = {};
    (round.tabla || []).forEach((f) => { porEquipo[f.entrant] = (porEquipo[f.entrant] || 0) + f.puntos; });
    const tabla = document.createElement('div');
    tabla.className = 'ag-tabla';
    tabla.innerHTML = (round.tabla || []).map((f) => {
      const color = teamColor(f.entrant) || 'var(--accent)';
      const tiempo = f.ms !== null ? `${(f.ms / 1000).toFixed(3)} s` : f.falsa ? '🚫 en falso' : '— no tocó';
      const medalla = f.puesto && f.puesto <= 3 ? MEDALS[f.puesto - 1] : (f.puesto ? `${f.puesto}°` : '');
      return `<div class="ag-fila${f.id === myId ? ' yo' : ''}" style="--team-color:${color}">
        <span class="ag-pos">${medalla}</span><span class="ag-nom">${esc(f.name)}${room.teamsEnabled ? ` <small>${esc(entrantLabel(f.entrant))}</small>` : ''}</span>
        <span class="ag-ms">${tiempo}</span><b class="ag-pts">${f.puntos ? `+${f.puntos}` : ''}</b></div>`;
    }).join('');
    container.appendChild(tabla);
    if (room.teamsEnabled) {
      const eq = document.createElement('p');
      eq.className = 'ag-equipos';
      eq.innerHTML = Object.entries(porEquipo).sort((a, b) => b[1] - a[1])
        .map(([id, pts]) => `<span style="color:${teamColor(id) || 'var(--accent)'}">${esc(entrantLabel(id))} +${pts}</span>`).join(' · ');
      container.appendChild(eq);
    }
    if (myId === room.hostId) {
      const sig = document.createElement('button');
      sig.className = 'btn btn-solid ag-siguiente';
      sig.textContent = round.number >= round.total ? 'Terminar ▶' : 'Próxima largada ▶';
      sig.addEventListener('click', () => socket.emit('judge-word', { siguiente: true }));
      container.appendChild(sig);
    }
    const clave = `${roundKey}-${round.serie}`;
    if (aguanteSonidoRes !== clave) {
      aguanteSonidoRes = clave;
      const mio = (round.tabla || []).find((f) => f.id === myId);
      if (window.Sfx) Sfx.play(mio && mio.puesto === 1 ? 'fanfarria' : 'redoble');
      if (mio && mio.puesto === 1) confetti(1.4);
    }
  }
  actualizarTocaron();
}

// ---------- Cartas españolas (las usa Casita Robada; sirven para otros) ----------
const PALO_ICONO = { oros: '🪙', copas: '🏆', espadas: '⚔️', bastos: '🪵' };
const FIGURA = { 10: 'Sota', 11: 'Caballo', 12: 'Rey' };
function cartaHtml(c, { extra = '', attrs = '' } = {}) {
  if (!c) return '<div class="carta vacia"></div>';
  return `<div class="carta palo-${c.palo} ${extra}" ${attrs} data-id="${c.id}">
    <span class="cn">${c.n}</span><span class="cp">${PALO_ICONO[c.palo] || ''}</span>
    ${FIGURA[c.n] ? `<small class="cf">${FIGURA[c.n]}</small>` : ''}<span class="cn abajo">${c.n}</span></div>`;
}

// ---------- Casita Robada ----------
let casitaBuiltFor = null;
let casitaSel = null; // id de la carta elegida en mi mano
let casitaVistas = new Set(); // cartas ya dibujadas (para animar solo las nuevas)
let casitaUltimaJugada = null;
let casitaEraMiTurno = false;

function renderCasitaRobada(round, container, roundKey) {
  const privado = round.privado || {};
  const mano = privado.mano || [];
  const iAmTestHost = room.testMode && myId === room.hostId;
  const miTurno = round.turnoDe && (round.turnoDe === myId || iAmTestHost);
  if (casitaSel && !mano.some((c) => c.id === casitaSel)) casitaSel = null;
  const buildKey = [roundKey, round.jugada, round.turnoDe, mano.map((c) => c.id).join(','), casitaSel].join('|');
  if (buildKey === casitaBuiltFor) return;
  casitaBuiltFor = buildKey;
  if (!String(casitaVistas.roundKey || '').startsWith(roundKey)) { casitaVistas = new Set(); casitaVistas.roundKey = roundKey; }

  const nuevaJugada = casitaUltimaJugada !== `${roundKey}-${round.jugada}`;
  casitaUltimaJugada = `${roundKey}-${round.jugada}`;
  const anim = (c) => (casitaVistas.has(c.id) ? '' : 'entra');
  const sel = mano.find((c) => c.id === casitaSel) || null;
  const jugador = (round.jugadores || []).find((j) => j.id === round.turnoDe);
  const yo = (round.jugadores || []).find((j) => j.id === (iAmTestHost ? round.turnoDe : myId));
  const miEquipo = yo ? yo.entrant : myEntrantId();

  container.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'board cr-board';

  // Casitas de cada equipo (pila con la carta de arriba a la vista)
  const casitas = Object.entries(round.casitas || {}).map(([id, k]) => {
    const color = teamColor(id) || 'var(--accent)';
    const robable = sel && id !== miEquipo && k.arriba && k.arriba.n === sel.n;
    const capas = Math.min(k.cantidad, 6);
    return `<button class="cr-casita${robable ? ' robable' : ''}${id === miEquipo ? ' mia' : ''}" data-casita="${esc(id)}" style="--team-color:${color};--capas:${capas}" ${robable ? '' : 'disabled'}>
      <span class="cr-pila">${k.arriba ? cartaHtml(k.arriba, { extra: anim(k.arriba) }) : '<div class="carta vacia">🏠</div>'}</span>
      <span class="cr-dueno">${esc(entrantLabel(id))}</span>
      <b class="cr-cant">${k.cantidad}</b>
      ${robable ? '<span class="cr-robar">¡Robala!</span>' : ''}
    </button>`;
  }).join('');

  const mesa = (round.mesa || []).map((c) => cartaHtml(c, { extra: `${anim(c)}${sel && c.n === sel.n ? ' brilla' : ''}` })).join('');
  box.innerHTML = `
    <p class="board-topic">Mano ${round.number} de ${round.total} · 🂠 quedan ${round.mazo} en el mazo</p>
    <div class="cr-casitas">${casitas}</div>
    <p class="cr-titulo">Mesa</p>
    <div class="cr-mesa">${mesa || '<span class="muted">La mesa está vacía</span>'}</div>`;
  container.appendChild(box);

  // Lo último que pasó
  const u = round.ultimo;
  if (u && u.tipo) {
    const p = document.createElement('p');
    p.className = `cr-ultimo ${u.tipo}${nuevaJugada ? ' nuevo' : ''}`;
    p.innerHTML = u.tipo === 'robo'
      ? `🏠💥 <b>${esc(u.nombre)}</b> le robó la casita a <b>${esc(entrantLabel(u.a))}</b> con un ${u.carta.n}`
      : u.tipo === 'levanta' ? `✋ <b>${esc(u.nombre)}</b> levantó ${u.cantidad} cartas con un ${u.carta.n}`
        : `🃏 <b>${esc(u.nombre)}</b> tiró un ${u.carta.n} a la mesa`;
    if (u.reparto) p.innerHTML += ' · <span class="cr-reparto">¡Se repartió de nuevo!</span>';
    container.appendChild(p);
  }

  // Turnos
  const turnos = document.createElement('div');
  turnos.className = 'cr-turnos';
  turnos.innerHTML = (round.jugadores || []).map((j) => `<span class="cr-jug${j.id === round.turnoDe ? ' activo' : ''}" style="--team-color:${teamColor(j.entrant) || 'var(--accent)'}">${esc(j.name)} <small>${'🂠'.repeat(Math.min(j.cartas, 4))}</small></span>`).join('');
  container.appendChild(turnos);

  // Mi mano
  const zonaMano = document.createElement('div');
  zonaMano.className = 'cr-mano' + (miTurno ? ' mi-turno' : '');
  zonaMano.innerHTML = mano.map((c, i) => cartaHtml(c, {
    extra: `${anim(c)}${c.id === casitaSel ? ' elegida' : ''}`,
    attrs: `style="--i:${i};--n:${mano.length}" role="button" tabindex="0"`
  })).join('') || '<span class="muted">Sin cartas — esperá el próximo reparto</span>';
  container.appendChild(zonaMano);
  if (miTurno) {
    zonaMano.querySelectorAll('.carta').forEach((el) => el.addEventListener('click', () => {
      casitaSel = casitaSel === el.dataset.id ? null : el.dataset.id;
      if (window.Sfx) Sfx.play('pop');
      renderCasitaRobada(room.round, container, roundKey);
    }));
  }

  // Acciones con la carta elegida
  let msg;
  if (miTurno && sel) {
    const acciones = document.createElement('div');
    acciones.className = 'cr-acciones';
    const iguales = (round.mesa || []).filter((c) => c.n === sel.n).length;
    const robables = Object.entries(round.casitas || {}).filter(([id, k]) => id !== miEquipo && k.arriba && k.arriba.n === sel.n);
    let html = robables.map(([id, k]) => `<button class="btn cr-btn-robar" data-a="${esc(id)}">🏠💥 Robar casita de ${esc(entrantLabel(id))} (${k.cantidad})</button>`).join('');
    if (iguales) html += `<button class="btn btn-solid cr-btn-mesa">✋ Levantar ${iguales} de la mesa</button>`;
    html += `<button class="btn btn-ghost cr-btn-tirar">🃏 Tirar a la mesa</button>`;
    acciones.innerHTML = html;
    const jugar = (payload) => { socket.emit('submit-answer', { carta: sel.id, ...payload }); casitaSel = null; };
    acciones.querySelectorAll('.cr-btn-robar').forEach((b) => b.addEventListener('click', () => jugar({ accion: 'robar', a: b.dataset.a })));
    const bm = acciones.querySelector('.cr-btn-mesa');
    if (bm) bm.addEventListener('click', () => jugar({ accion: 'mesa' }));
    acciones.querySelector('.cr-btn-tirar').addEventListener('click', () => jugar({ accion: 'tirar' }));
    container.appendChild(acciones);
    // Que se vean la mano y los botones juntos, sin tener que bajar a buscarlos.
    requestAnimationFrame(() => acciones.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    // También se puede robar tocando la casita que brilla.
    box.querySelectorAll('.cr-casita.robable').forEach((b) => b.addEventListener('click', () => jugar({ accion: 'robar', a: b.dataset.casita })));
    msg = robables.length ? '¡Podés robar una casita!' : iguales ? 'Levantá de la mesa o tirala.' : 'No hay iguales: tirala a la mesa.';
  } else if (miTurno) {
    msg = iAmTestHost ? `Modo prueba — jugás por ${jugador ? jugador.name : ''}. Elegí una carta.` : '¡Te toca! Elegí una carta de tu mano.';
  } else {
    msg = jugador ? `Juega ${jugador.name} (${entrantLabel(jugador.entrant)})...` : '';
  }
  $('playing-turn-msg').textContent = msg;

  // Sonidos y efectos, una vez por jugada
  if (nuevaJugada && u && u.tipo && window.Sfx) {
    if (u.tipo === 'robo') { Sfx.play('whoosh'); Sfx.play('acierto'); confetti(1.2); } else if (u.tipo === 'levanta') Sfx.play('acierto'); else Sfx.play('pop');
  }
  if (miTurno && !casitaEraMiTurno && window.Sfx && !iAmTestHost) Sfx.play('turno');
  casitaEraMiTurno = !!miTurno;

  [...(round.mesa || []), ...mano, ...Object.values(round.casitas || {}).map((k) => k.arriba).filter(Boolean)]
    .forEach((c) => casitaVistas.add(c.id));
}

// ---------- Autos Chocadores (Gran Premio) ----------
// La escena y la física viven en public/fx/chocadores3d.js. Acá: la
// calibración del "volante" (giroscopio), el semáforo, el marcador en vivo,
// el podio, y el canal rápido de posiciones ('autos').
let gp = null; // { carrera, control, roundKey, wakeLock }
let gpCargando = null;
let gpPuntos = {};
let gpVistos = new Set();

function cerrarCarrera() {
  if (!gp) return;
  if (gp.carrera) gp.carrera.destruir();
  if (gp.control) gp.control.destruir();
  if (gp.wakeLock) gp.wakeLock.release().catch(() => {});
  if (gp.timer) clearInterval(gp.timer);
  gp = null;
  $('screen-playing').classList.remove('modo-carrera');
}

function gpAviso(texto, clase = '') {
  const el = $('gp-aviso');
  if (!el) return;
  el.textContent = texto;
  el.className = `gp-aviso mostrar ${clase}`;
  clearTimeout(gpAviso.t);
  gpAviso.t = setTimeout(() => { el.className = 'gp-aviso'; }, 1400);
}

socket.on('autos', (pos) => {
  if (!gp || !gp.carrera) return;
  gp.carrera.recibir(pos);
  gpPuntos = pos.puntos || {};
  const marcador = $('gp-marcador');
  if (marcador) {
    marcador.innerHTML = Object.entries(gpPuntos).sort((a, b) => b[1] - a[1])
      .map(([id, pts]) => `<span style="--team-color:${teamColor(id) || 'var(--accent)'}"><b>${pts}</b> ${esc(entrantLabel(id))}</span>`).join('');
  }
  (pos.eventos || []).forEach((ev) => {
    const clave = `${ev.tipo}-${ev.id}-${ev.t}`;
    if (gpVistos.has(clave)) return;
    gpVistos.add(clave);
    if (ev.tipo === 'golpe' && ev.id === myId) { gpAviso('💥 ¡Golpe! +3', 'bien'); if (window.Sfx) Sfx.play('acierto'); }
    else if (ev.tipo === 'golpe' && ev.a === myId) { gpAviso('😵 ¡Te chocaron!', 'mal'); if (window.Sfx) Sfx.play('error'); }
    else if (ev.tipo === 'vuelta' && ev.id === myId) { gpAviso(`🏁 ¡Vuelta ${ev.n}! +10`, 'bien'); if (window.Sfx) Sfx.play('turno'); }
  });
});

async function gpPedirWakeLock() {
  try { if (gp && navigator.wakeLock && !gp.wakeLock) gp.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* sin bloqueo de pantalla */ }
}

function renderChocadores(round, container, roundKey) {
  $('screen-playing').classList.add('modo-carrera');
  const iAmHost = myId === room.hostId;
  const iAmTestHost = room.testMode && iAmHost;
  const yoPiloto = (round.pilotos || []).find((p) => p.id === myId);

  if (!gp || gp.roundKey !== roundKey || !$('gp-escena')) {
    cerrarCarrera();
    gp = { roundKey };
    gpVistos = new Set();
    container.innerHTML = `
      <div class="gp-escena" id="gp-escena">
        <div class="gp-hud">
          <span class="gp-reloj" id="gp-reloj">--:--</span>
          <div class="gp-marcador" id="gp-marcador"></div>
          <span class="gp-vueltas" id="gp-vueltas"></span>
        </div>
        <div class="gp-semaforo hidden" id="gp-semaforo">${'<i></i>'.repeat(5)}</div>
        <div class="gp-aviso" id="gp-aviso"></div>
        <div class="gp-tablero" id="gp-tablero"><div class="gp-vel"><i id="gp-vel"></i></div><div class="gp-dir"><i id="gp-dir"></i></div></div>
        <div class="gp-panel" id="gp-panel"></div>
      </div>`;
    if (!gpCargando) gpCargando = import('./fx/chocadores3d.js');
    gpCargando.then((mod) => {
      if (!gp || gp.roundKey !== roundKey || gp.carrera) return;
      const r = room.round;
      gp.mod = mod;
      gp.control = mod.crearControl();
      try {
        gp.carrera = mod.crearCarrera($('gp-escena'), {
          miId: myId,
          pista: r.pista,
          obst: r.obst,
          velMax: r.velMax,
          choques: r.choques,
          pilotos: r.pilotos,
          colorDe: (id) => teamColor(id) || '#ffb23f',
          control: gp.control,
          enviar: (d) => socket.volatile.emit('auto', d),
          golpeado: (id) => socket.emit('auto-golpe', id),
          aviso: (t) => gpAviso(t),
          hud: (h) => {
            const vel = $('gp-vel'); const dir = $('gp-dir');
            if (vel) { vel.style.height = `${Math.round(Math.abs(h.acel) * 100)}%`; vel.classList.toggle('reversa', h.acel < 0); }
            if (dir) dir.style.left = `${50 + h.giro * 45}%`;
            const v = $('gp-vueltas');
            if (v && yoPiloto) v.textContent = `🏁 ${h.vueltas} ${h.vueltas === 1 ? 'vuelta' : 'vueltas'}${h.trompo ? ' · 😵' : h.turbo ? ' · 🚀' : h.aceite ? ' · 🛢️' : ''}`;
            const med = $('gp-medidor-acel');
            if (med) { med.style.width = `${Math.round(Math.abs(h.acel) * 100)}%`; med.classList.toggle('reversa', h.acel < 0); }
            const etq = $('gp-medidor-etq'); if (etq) etq.textContent = h.acel < -0.05 ? '◀ Marcha atrás' : 'Acelerador';
            const g = $('gp-medidor-giro'); if (g) g.style.left = `${50 + h.giro * 45}%`;
          }
        });
        gp.carrera.setFase(room.round.fase);
      } catch (e) {
        $('gp-panel').innerHTML = '<p>No se pudo abrir la pista 3D en este celu.</p>';
      }
      renderChocadores(room.round, container, roundKey);
    }).catch(() => { $('gp-panel').innerHTML = '<p>No se pudo cargar la pista.</p>'; });
  }

  if (gp.carrera) { gp.carrera.actualizarPilotos(round.pilotos); gp.carrera.setFase(round.fase); }
  const reloj = $('gp-reloj');
  const mm = Math.floor(round.segundos / 60); const ss = String(round.segundos % 60).padStart(2, '0');
  reloj.textContent = round.fase === 'carrera' ? `${mm}:${ss}` : round.fase === 'calibrar' ? '🎮' : round.fase === 'largada' ? '🚦' : '🏁';
  reloj.classList.toggle('poco', round.fase === 'carrera' && round.segundos <= 10);
  if (!Object.keys(gpPuntos).length || round.fase !== 'carrera') {
    $('gp-marcador').innerHTML = Object.entries(round.entrants).sort((a, b) => b[1].points - a[1].points)
      .map(([id, e]) => `<span style="--team-color:${teamColor(id) || 'var(--accent)'}"><b>${e.points}</b> ${esc(entrantLabel(id))}</span>`).join('');
  }

  // Semáforo de largada
  const sem = $('gp-semaforo');
  if (round.fase === 'largada') {
    if (sem.classList.contains('hidden')) {
      sem.classList.remove('hidden', 'verde');
      const luces = sem.querySelectorAll('i');
      luces.forEach((l) => l.classList.remove('on'));
      luces.forEach((l, i) => setTimeout(() => { l.classList.add('on'); if (window.Sfx) Sfx.play('pop'); }, 300 + i * 650));
    }
  } else if (round.fase === 'carrera' && !sem.classList.contains('hidden') && !sem.classList.contains('verde')) {
    sem.classList.add('verde');
    sem.querySelectorAll('i').forEach((l) => l.classList.remove('on'));
    if (window.Sfx) Sfx.play('whoosh');
    gpAviso('¡YA! 🏁', 'bien');
    setTimeout(() => sem.classList.add('hidden'), 900);
  }
  if (round.fase === 'carrera' || round.fase === 'largada') gpPedirWakeLock();

  // Panel: calibración / podio
  const panel = $('gp-panel');
  const panelKey = [round.fase, (round.pilotos || []).map((p) => (p.listo ? 1 : 0)).join(''), !!(gp.control && gp.control.hayGiro)].join('|');
  if (round.fase === 'calibrar') {
    if (panel.dataset.key !== panelKey) {
      panel.dataset.key = panelKey;
      const listos = (round.pilotos || []).map((p) => `<span class="gp-chip${p.listo ? ' listo' : ''}" style="--team-color:${teamColor(p.entrant) || 'var(--accent)'}">${p.listo ? '✔' : '⏳'} ${esc(p.name)}</span>`).join('');
      const yaListo = yoPiloto && yoPiloto.listo;
      panel.className = 'gp-panel calibrar';
      panel.innerHTML = `
        <h3>🎮 Tu celu es el volante</h3>
        <ol class="gp-instr">
          <li>Sostenelo <b>en vertical</b>, con las dos manos.</li>
          <li><b>Levantá la parte de arriba</b> (hasta 45°) para acelerar a fondo. <b>Plano</b> frena.</li>
          <li><b>Levantá la parte de abajo</b> para ir marcha atrás.</li>
          <li><b>Ladealo</b> a la izquierda o a la derecha para doblar.</li>
        </ol>
        <div class="gp-medidores">
          <div class="gp-medidor"><small id="gp-medidor-etq">Acelerador</small><span><i id="gp-medidor-acel"></i></span></div>
          <div class="gp-medidor giro"><small>Volante</small><span><i id="gp-medidor-giro"></i></span></div>
        </div>
        <p class="gp-nota" id="gp-nota">${gp.control && gp.control.hayGiro ? '✅ Volante activo: probalo y mirá cómo se mueven las barras.' : 'Tocá "Activar volante" para usar el giroscopio. En una compu: flechas o WASD (abajo/S = marcha atrás).'}</p>
        <div class="gp-botones">
          ${gp.control && gp.control.hayGiro ? '' : '<button class="btn btn-ghost" id="gp-activar">🎮 Activar volante</button>'}
          ${yoPiloto || iAmTestHost ? `<button class="btn btn-solid" id="gp-listo" ${yaListo && !iAmTestHost ? 'disabled' : ''}>${yaListo && !iAmTestHost ? '✔ ¡Listo! Esperando...' : '✅ ¡Estoy listo!'}</button>` : '<p class="muted">Entraste con la carrera armada: mirás esta y corrés la próxima.</p>'}
          ${iAmHost ? '<button class="btn btn-ghost" id="gp-largar">🚦 Largar ya</button>' : ''}
        </div>
        <div class="gp-chips">${listos}</div>`;
      const act = $('gp-activar');
      if (act) {
        act.addEventListener('click', async () => {
          const ok = gp.mod ? await gp.mod.pedirPermisoGiroscopio() : true;
          setTimeout(() => {
            const nota = $('gp-nota');
            if (!nota) return;
            if (gp && gp.control && gp.control.hayGiro) { panel.dataset.key = ''; renderChocadores(room.round, container, roundKey); }
            else nota.textContent = ok ? 'No detectamos giroscopio en este equipo. En una compu: flechas o WASD.' : 'Hay que permitir el acceso al movimiento para manejar.';
          }, 600);
        });
      }
      const listo = $('gp-listo');
      if (listo) listo.addEventListener('click', async () => {
        if (gp && gp.mod && !(gp.control && gp.control.hayGiro)) await gp.mod.pedirPermisoGiroscopio();
        socket.emit('submit-answer', { listo: true });
      });
      const largar = $('gp-largar');
      if (largar) largar.addEventListener('click', () => socket.emit('judge-word', { largar: true }));
    }
    // Si el giroscopio se activa solo (Android, sin pedir permiso), se redibuja.
    if (!gp.timer) gp.timer = setInterval(() => { if (gp && gp.control && gp.control.hayGiro && $('gp-activar') && room && room.round && room.round.fase === 'calibrar') { panel.dataset.key = ''; renderChocadores(room.round, container, roundKey); } }, 1000);
  } else if (round.fase === 'fin') {
    if (panel.dataset.key !== panelKey) {
      panel.dataset.key = panelKey;
      panel.className = 'gp-panel fin';
      const equipos = Object.entries(round.entrants).sort((a, b) => b[1].points - a[1].points);
      const pilotos = [...(round.pilotos || [])].sort((a, b) => (b.vueltas * round.puntosVuelta + b.golpes * round.puntosGolpe) - (a.vueltas * round.puntosVuelta + a.golpes * round.puntosGolpe));
      panel.innerHTML = `
        <h3>🏁 ¡Bandera a cuadros!</h3>
        <div class="gp-podio">${equipos.map(([id, e], i) => `<div class="gp-escalon p${i + 1}" style="--team-color:${teamColor(id) || 'var(--accent)'}">
          <span class="gp-medalla">${MEDALS[i] || ''}</span><b>${esc(entrantLabel(id))}</b><span>${e.points} pts</span><small>${e.vueltas} vueltas · ${e.golpes} golpes</small></div>`).join('')}</div>
        <div class="gp-pilotos">${pilotos.map((p) => `<div style="--team-color:${teamColor(p.entrant) || 'var(--accent)'}"><span>${esc(p.name)}</span><span>🏁 ${p.vueltas} · 💥 ${p.golpes}${p.mejorVuelta ? ` · ⏱ ${p.mejorVuelta.toFixed(1)}s` : ''}</span></div>`).join('')}</div>
        ${iAmHost ? '<button class="btn btn-solid" id="gp-seguir">Ver resultados ▶</button>' : ''}`;
      const seguir = $('gp-seguir');
      if (seguir) seguir.addEventListener('click', () => socket.emit('judge-word', { siguiente: true }));
      if (window.Sfx) Sfx.play('fanfarria');
      confetti(2);
    }
  } else {
    panel.className = 'gp-panel';
    panel.innerHTML = '';
    panel.dataset.key = '';
  }
  $('gp-tablero').classList.toggle('hidden', !(yoPiloto && (round.fase === 'carrera' || round.fase === 'largada')));

  let msg = '';
  if (round.fase === 'calibrar') msg = 'Calibren el volante y toquen "Listo". Arranca cuando estén todos.';
  else if (round.fase === 'largada') msg = 'Atentos al semáforo...';
  else if (round.fase === 'carrera') msg = yoPiloto ? 'Chocá a los rivales, esquivá conos y aceite. ¡Tu equipo suma por vueltas y golpes!' : 'Mirando la carrera...';
  $('playing-turn-msg').textContent = msg;
}

// ---------- Ruleta (Noche de Casino) ----------
// Tres momentos, todos a pantalla completa:
//   1) apuestas: el paño entero (0 a 36, docenas, columnas y sencillas);
//   2) giro: la ruleta 3D (public/fx/ruleta3d.js) y la bola que cae;
//   3) pago: la cámara "baja" al paño (zoom sobre el número), se pagan las
//      ganadoras y la banca se lleva las perdedoras.
const RL_ROJOS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const RL_COLORES_JUG = ['#ffd23f', '#3de6ff', '#ff3d7f', '#3ddc84', '#8b5cff', '#ff9f1c', '#e0637a', '#5b8dd6', '#ffffff', '#b5e48c'];
let rl = null; // { roundKey, ficha, modo, pendiente, ruleta, serieGiro, serieVista, mesaKey }

function rlColorJugador(id) {
  const i = ((room.round && room.round.jugadores) || []).findIndex((j) => j.id === id);
  return RL_COLORES_JUG[Math.max(i, 0) % RL_COLORES_JUG.length];
}
const rlFmt = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : String(n));

function cerrarRuleta() {
  const ov = $('rl-overlay');
  if (ov) ov.remove();
  if (!rl) return;
  if (rl.ruleta) rl.ruleta.destruir();
  clearTimeout(rl.tPago);
  rl = null;
}

function rlArmarPano() {
  // Grilla vertical (para celu): 0 arriba, 12 filas de 3, "2 a 1" abajo;
  // docenas a la izquierda y apuestas sencillas a la derecha.
  let html = '<div class="rl-cel rl-cero" data-tipo="pleno" data-n="0" style="grid-column:2/5;grid-row:1"><b>0</b></div>';
  for (let n = 1; n <= 36; n++) {
    const fila = Math.ceil(n / 3) + 1; const col = ((n - 1) % 3) + 2;
    html += `<div class="rl-cel rl-num ${RL_ROJOS.has(n) ? 'rojo' : 'negro'}" data-tipo="pleno" data-n="${n}" style="grid-column:${col};grid-row:${fila}"><b>${n}</b></div>`;
  }
  [1, 2, 3].forEach((d) => { html += `<div class="rl-cel rl-afuera rl-docena" data-tipo="docena" data-valor="${d}" style="grid-column:1;grid-row:${(d - 1) * 4 + 2}/span 4"><span>${d}ª 12</span></div>`; });
  [1, 2, 3].forEach((c) => { html += `<div class="rl-cel rl-afuera rl-columna" data-tipo="columna" data-valor="${c}" style="grid-column:${c + 1};grid-row:14"><span>2 a 1</span></div>`; });
  const simples = [['falta', '1-18'], ['par', 'PAR'], ['rojo', '<i class="rl-rombo rojo"></i>'], ['negro', '<i class="rl-rombo negro"></i>'], ['impar', 'IMPAR'], ['pasa', '19-36']];
  simples.forEach(([t, txt], i) => { html += `<div class="rl-cel rl-afuera rl-simple" data-tipo="${t}" style="grid-column:5;grid-row:${i * 2 + 2}/span 2"><span>${txt}</span></div>`; });
  return html;
}

// Dónde se dibuja la ficha de cada apuesta (centro del lugar en el paño).
function rlLugar(grilla, ap) {
  const base = grilla.getBoundingClientRect();
  const celda = (sel) => { const el = grilla.querySelector(sel); return el ? el.getBoundingClientRect() : null; };
  const centro = (r) => ({ x: r.left + r.width / 2 - base.left, y: r.top + r.height / 2 - base.top });
  const num = (n) => celda(`.rl-cel[data-n="${n}"]`);
  if (ap.tipo === 'pleno') { const r = num(ap.nums[0]); return r && centro(r); }
  if (['docena', 'columna'].includes(ap.tipo)) { const r = celda(`.rl-cel[data-tipo="${ap.tipo}"][data-valor="${ap.clave.split(':')[1]}"]`); return r && centro(r); }
  if (['rojo', 'negro', 'par', 'impar', 'falta', 'pasa'].includes(ap.tipo)) { const r = celda(`.rl-cel[data-tipo="${ap.tipo}"]`); return r && centro(r); }
  // Caballo, calle y cuadro: entre los números que cubre.
  const rects = ap.nums.map(num).filter(Boolean);
  if (!rects.length) return null;
  const cs = rects.map(centro);
  const p = { x: cs.reduce((a, c) => a + c.x, 0) / cs.length, y: cs.reduce((a, c) => a + c.y, 0) / cs.length };
  if (ap.tipo === 'calle') p.x = rects[0].left - base.left; // sobre la línea del costado
  return p;
}

function rlDibujarFichas(round, capa, grilla, { pago = null } = {}) {
  capa.innerHTML = '';
  (round.mesa || []).forEach((ap) => {
    const p = rlLugar(grilla, ap);
    if (!p) return;
    const mio = ap.de[myId] || 0;
    const otros = Object.keys(ap.de).filter((id) => id !== myId);
    const el = document.createElement('div');
    const gana = pago !== null && ap.nums.includes(pago);
    el.className = `rl-ficha${mio ? ' mia' : ''}${pago !== null ? (gana ? ' gana' : ' pierde') : ''}`;
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.style.setProperty('--c', mio ? '#ffd23f' : rlColorJugador(otros[0]));
    el.innerHTML = `<b>${rlFmt(mio || ap.total)}</b>${otros.length && mio ? `<i>+${otros.length}</i>` : ''}`;
    el.title = Object.entries(ap.de).map(([id, m]) => `${(round.jugadores.find((j) => j.id === id) || {}).name}: ${m}`).join(' · ');
    capa.appendChild(el);
  });
}

function rlApuestaDesdeToque(cel) {
  const tipo = cel.dataset.tipo;
  if (tipo !== 'pleno') return { tipo, valor: Number(cel.dataset.valor) };
  const n = Number(cel.dataset.n);
  if (rl.modo === 'pleno' || n === 0) {
    if (n === 0 && rl.modo === 'caballo' && rl.pendiente) return null;
    return { tipo: 'pleno', nums: [n] };
  }
  if (rl.modo === 'calle') return { tipo: 'calle', valor: Math.ceil(n / 3) };
  if (rl.modo === 'cuadro') {
    let v = ((n - 1) % 3) + 1 === 3 ? n - 1 : n;
    if (Math.ceil(v / 3) === 12) v -= 3;
    return { tipo: 'cuadro', valor: v };
  }
  return null; // caballo: se arma con dos toques
}

function renderRuleta(round, container, roundKey) {
  const iAmHost = myId === room.hostId;
  const yo = (round.jugadores || []).find((j) => j.id === myId);
  if (!rl || rl.roundKey !== roundKey || !$('rl-overlay')) {
    cerrarRuleta();
    rl = { roundKey, ficha: (round.fichas || [25])[2] || 25, modo: 'pleno', pendiente: null };
    // El paño va directo en <body>: dentro del juego, las animaciones de la
    // pantalla hacen que "position: fixed" no cubra toda la pantalla.
    container.innerHTML = '<div class="rl-lugar"></div>';
    const cont = document.createElement('div');
    document.body.appendChild(cont);
    cont.outerHTML = `
      <div class="rl-overlay" id="rl-overlay">
        <header class="rl-head">
          <div class="rl-saldo"><small>Tus fichas</small><b id="rl-saldo">—</b></div>
          <div class="rl-centro"><span id="rl-tirada"></span><div class="rl-hist" id="rl-hist"></div></div>
          <div class="rl-tiempo"><b id="rl-seg"></b><small id="rl-estado"></small></div>
          <div class="rl-barra"><i id="rl-barra"></i></div>
        </header>
        <div class="rl-cuerpo" id="rl-cuerpo">
          <div class="rl-zoom" id="rl-zoom"><div class="rl-pano" id="rl-pano">${rlArmarPano()}</div><div class="rl-capa" id="rl-capa"></div></div>
          <div class="rl-rueda hidden" id="rl-rueda"><div class="rl-numero" id="rl-numero"></div></div>
          <div class="rl-resultados hidden" id="rl-resultados"></div>
        </div>
        <footer class="rl-pie" id="rl-pie">
          <div class="rl-modos" id="rl-modos">
            ${[['pleno', 'Pleno'], ['caballo', 'Caballo'], ['calle', 'Calle'], ['cuadro', 'Cuadro']].map(([m, t]) => `<button data-modo="${m}" class="${m === 'pleno' ? 'on' : ''}">${t}</button>`).join('')}
          </div>
          <div class="rl-fichas" id="rl-fichas">
            ${(round.fichas || []).map((f) => `<button class="rl-fichabtn v${f}${f === rl.ficha ? ' on' : ''}" data-f="${f}">${rlFmt(f)}</button>`).join('')}
          </div>
          <div class="rl-acciones">
            <button id="rl-deshacer" title="Deshacer">↩</button>
            <button id="rl-limpiar" title="Sacar todo">🗑</button>
            <button id="rl-repetir" title="Repetir la anterior">🔁</button>
            <button id="rl-listo" class="rl-listo">✅ Listo</button>
            ${iAmHost ? '<button id="rl-novamas" class="rl-novamas">¡No va más!</button>' : ''}
          </div>
        </footer>
      </div>`;
    // Toques en el paño
    $('rl-pano').addEventListener('click', (e) => {
      const cel = e.target.closest('.rl-cel');
      if (!cel || !room.round || room.round.fase !== 'apuestas') return;
      const ap = rlApuestaDesdeToque(cel);
      if (ap) {
        socket.emit('submit-answer', { apostar: ap, monto: rl.ficha });
        if (window.Sfx) Sfx.play('pop');
        rl.pendiente = null;
        $('rl-pano').querySelectorAll('.pendiente').forEach((x) => x.classList.remove('pendiente'));
        return;
      }
      // Caballo: primer toque marca, segundo (vecino) apuesta.
      const n = Number(cel.dataset.n);
      if (rl.pendiente === null || rl.pendiente === n) {
        rl.pendiente = rl.pendiente === n ? null : n;
        cel.classList.toggle('pendiente', rl.pendiente === n);
        return;
      }
      const par = [rl.pendiente, n].sort((a, b) => a - b);
      $('rl-pano').querySelectorAll('.pendiente').forEach((x) => x.classList.remove('pendiente'));
      rl.pendiente = null;
      socket.emit('submit-answer', { apostar: { tipo: 'caballo', nums: par }, monto: rl.ficha });
    });
    $('rl-modos').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      rl.modo = b.dataset.modo; rl.pendiente = null;
      $('rl-modos').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      $('rl-pano').querySelectorAll('.pendiente').forEach((x) => x.classList.remove('pendiente'));
      $('rl-pano').dataset.modo = rl.modo;
    });
    $('rl-fichas').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      rl.ficha = Number(b.dataset.f);
      $('rl-fichas').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    });
    $('rl-deshacer').addEventListener('click', () => socket.emit('submit-answer', { quitar: true }));
    $('rl-limpiar').addEventListener('click', () => socket.emit('submit-answer', { limpiar: true }));
    $('rl-repetir').addEventListener('click', () => socket.emit('submit-answer', { repetir: true }));
    $('rl-listo').addEventListener('click', () => socket.emit('submit-answer', { listo: true }));
    const nvm = $('rl-novamas');
    if (nvm) nvm.addEventListener('click', () => socket.emit('judge-word', { cerrar: true }));
    window.addEventListener('resize', () => { if (rl && room && room.round && room.round.type === 'ruleta') { rl.mesaKey = null; renderRuleta(room.round, container, roundKey); } });
  }

  // Cabecera: saldo, tirada, historial, tiempo
  $('rl-saldo').textContent = yo ? yo.saldo.toLocaleString('es-AR') : '—';
  $('rl-tirada').textContent = `Tirada ${round.number} de ${round.total}`;
  $('rl-hist').innerHTML = (round.historial || []).slice(0, 8).map((n) => `<span class="${n === 0 ? 'verde' : RL_ROJOS.has(n) ? 'rojo' : 'negro'}">${n}</span>`).join('');
  $('rl-seg').textContent = round.fase === 'apuestas' ? round.segundos : '';
  $('rl-estado').textContent = round.fase === 'apuestas' ? `apostado ${yo ? yo.apostado : 0}` : round.fase === 'giro' ? '¡No va más!' : 'pagando';
  $('rl-barra').style.width = round.fase === 'apuestas' ? `${(round.segundos / round.segundosApuestas) * 100}%` : '0%';
  $('rl-barra').classList.toggle('poco', round.fase === 'apuestas' && round.segundos <= 5);
  const ov = $('rl-overlay');
  ov.dataset.fase = round.fase;

  const pano = $('rl-pano'); const capa = $('rl-capa'); const zoom = $('rl-zoom');
  const rueda = $('rl-rueda'); const res = $('rl-resultados');

  if (round.fase === 'apuestas') {
    rueda.classList.add('hidden');
    res.classList.add('hidden');
    zoom.classList.remove('hidden', 'acercar');
    zoom.style.transformOrigin = '';
    pano.querySelectorAll('.ganador').forEach((x) => x.classList.remove('ganador'));
    const mesaKey = `${round.serie}|${JSON.stringify(round.mesa)}`;
    if (rl.mesaKey !== mesaKey) { rl.mesaKey = mesaKey; requestAnimationFrame(() => rlDibujarFichas(round, capa, pano)); }
    $('rl-pie').classList.toggle('hidden', !yo);
    $('rl-listo').textContent = yo && yo.listo ? '✔ Listo' : '✅ Listo';
    $('rl-listo').disabled = !!(yo && yo.listo);
    $('rl-repetir').disabled = !(yo && yo.puedeRepetir);
    if (rl.serieVista !== round.serie) {
      rl.serieVista = round.serie;
      if (window.Sfx) Sfx.play('turno');
    }
  } else if (round.fase === 'giro') {
    $('rl-pie').classList.add('hidden');
    zoom.classList.add('hidden');
    res.classList.add('hidden');
    rueda.classList.remove('hidden');
    const num = $('rl-numero');
    if (rl.serieGiro !== round.serie) {
      rl.serieGiro = round.serie;
      num.className = 'rl-numero';
      num.textContent = '';
      if (window.Sfx) Sfx.play('redoble');
      import('./fx/ruleta3d.js').then((mod) => {
        if (!rl || rl.roundKey !== roundKey) return;
        if (!rl.ruleta) rl.ruleta = mod.crearRuleta(rueda);
        const n = round.numero;
        const tarde = round.segundos < 4; // entró tarde: se muestra sin animación
        const anunciar = () => {
          num.textContent = `${n} ${n === 0 ? 'VERDE' : RL_ROJOS.has(n) ? 'ROJO' : 'NEGRO'}`;
          num.className = `rl-numero mostrar ${n === 0 ? 'verde' : RL_ROJOS.has(n) ? 'rojo' : 'negro'}`;
          if (window.Sfx) Sfx.play('acierto');
        };
        if (tarde) { rl.ruleta.mostrar(n); anunciar(); } else rl.ruleta.girar(n, 7000, anunciar);
      }).catch(() => { num.textContent = String(round.numero); num.className = 'rl-numero mostrar'; });
    }
  } else if (round.fase === 'pago') {
    rueda.classList.add('hidden');
    $('rl-pie').classList.add('hidden');
    zoom.classList.remove('hidden');
    const n = round.numero;
    const clave = `pago-${round.serie}`;
    if (rl.pagoVisto !== clave) {
      rl.pagoVisto = clave;
      res.classList.add('hidden');
      // Acercamiento al paño: zoom sobre el número ganador.
      pano.querySelectorAll('.ganador').forEach((x) => x.classList.remove('ganador'));
      const celGan = pano.querySelector(`.rl-cel[data-n="${n}"]`);
      if (celGan) celGan.classList.add('ganador');
      requestAnimationFrame(() => {
        rlDibujarFichas(round, capa, pano, { pago: n });
        if (celGan) {
          const z = zoom.getBoundingClientRect(); const c = celGan.getBoundingClientRect();
          zoom.style.transformOrigin = `${c.left + c.width / 2 - z.left}px ${c.top + c.height / 2 - z.top}px`;
        }
        zoom.classList.remove('acercar');
        void zoom.offsetWidth;
        zoom.classList.add('acercar');
      });
      // Después del zoom: la banca levanta lo perdido y paga lo ganado.
      clearTimeout(rl.tPago);
      rl.tPago = setTimeout(() => {
        if (!rl) return;
        capa.querySelectorAll('.rl-ficha.pierde').forEach((f) => f.classList.add('retirar'));
        capa.querySelectorAll('.rl-ficha.gana').forEach((f) => f.classList.add('cobrar'));
        const mio = yo && yo.resultado;
        if (window.Sfx) Sfx.play(mio && mio.neto > 0 ? 'fanfarria' : 'whoosh');
        if (mio && mio.ganado > 0) confetti(1.5);
        rl.tPago = setTimeout(() => {
          if (!rl || !room.round || room.round.fase !== 'pago') return;
          const filas = [...room.round.jugadores].sort((a, b) => ((b.resultado || {}).neto || 0) - ((a.resultado || {}).neto || 0)).map((j) => {
            const r = j.resultado || { neto: 0, apostado: 0 };
            return `<div class="rl-res${j.id === myId ? ' yo' : ''}" style="--c:${rlColorJugador(j.id)}"><span>${esc(j.name)}</span><span class="${r.neto > 0 ? 'mas' : r.neto < 0 ? 'menos' : ''}">${r.neto > 0 ? '+' : ''}${r.neto.toLocaleString('es-AR')}</span><b>${j.saldo.toLocaleString('es-AR')}</b></div>`;
          }).join('');
          res.innerHTML = `<h3><span class="rl-bola ${n === 0 ? 'verde' : RL_ROJOS.has(n) ? 'rojo' : 'negro'}">${n}</span> Resultado de la tirada</h3>
            <div class="rl-res cab"><span>Jugador</span><span>Esta tirada</span><b>Fichas</b></div>${filas}
            ${myId === room.hostId ? `<button class="btn btn-solid" id="rl-siguiente">${round.number >= round.total ? 'Ver ganador ▶' : 'Próxima tirada ▶'}</button>` : ''}`;
          res.classList.remove('hidden');
          const sig = $('rl-siguiente');
          if (sig) sig.addEventListener('click', () => socket.emit('judge-word', { siguiente: true }));
        }, 1500);
      }, 2200);
    }
  }

  let msg = '';
  if (round.fase === 'apuestas') msg = yo ? (rl.modo === 'caballo' ? 'Caballo: tocá dos números vecinos.' : 'Elegí una ficha y tocá el paño para apostar.') : 'Mirás la mesa (entraste con el juego empezado).';
  $('playing-turn-msg').textContent = msg;
}

// ---------- La Torre (3D) ----------
// La escena 3D vive en public/fx/torre3d.js y se carga solo cuando se juega.
// El tablero se arma una vez por juego; en cada actualización solo cambian
// los textos y la escena se pone al día sola.
let torre3d = null;
let torreBuiltFor = null;
let torreSonido = null;
let torreFinalKey = null;
let torreFallback = null;

function cerrarTorre() {
  if (torre3d) { torre3d.destruir(); torre3d = null; }
  if (torreFallback) { torreFallback.destruir(); torreFallback = null; }
  torreBuiltFor = null;
}

function hueDeEquipo(id) {
  const ids = Object.keys((room.round && room.round.entrants) || {});
  return [205, 345, 140, 45, 275, 15][Math.max(ids.indexOf(id), 0) % 6];
}

// Sin WebGL: una versión plana (de costado) con la misma regla.
function torrePlana(stage, onSoltar) {
  stage.classList.add('torre-2d');
  const pista = document.createElement('div');
  pista.className = 't2-pista';
  pista.innerHTML = '<div class="t2-arriba"></div><div class="t2-movil"></div>';
  stage.appendChild(pista);
  let datos = null; let desde = 0; let congelado = null; let vivo = true; let puede = false; let serie = null;
  const escala = (v) => `${50 + (v / 28) * 100}%`;
  function cuadro() {
    if (!vivo) return;
    requestAnimationFrame(cuadro);
    if (!datos) return;
    const p = congelado !== null ? congelado : posMovil((performance.now() - desde) / 1000, datos.velocidad, datos.rango);
    pista.querySelector('.t2-movil').style.left = escala(p);
  }
  requestAnimationFrame(cuadro);
  const tocar = () => {
    if (!puede || !datos || congelado !== null) return;
    congelado = posMovil((performance.now() - desde) / 1000, datos.velocidad, datos.rango);
    onSoltar(congelado);
  };
  stage.addEventListener('pointerdown', tocar);
  return {
    actualizar(round, opts) {
      puede = !!opts.puedeSoltar;
      const arriba = (round.bloques || [])[round.bloques.length - 1];
      if (!round.movil || !arriba) { datos = null; return; }
      const lado = round.movil.eje === 'x' ? 'w' : 'd';
      const tam = arriba[lado];
      const top = pista.querySelector('.t2-arriba');
      top.style.left = escala(arriba[round.movil.eje]);
      top.style.width = `${(tam / 28) * 100}%`;
      pista.querySelector('.t2-movil').style.width = `${(tam / 28) * 100}%`;
      if (round.movil.serie !== serie) { serie = round.movil.serie; datos = round.movil; desde = performance.now(); congelado = null; }
    },
    destruir() { vivo = false; stage.removeEventListener('pointerdown', tocar); pista.remove(); }
  };
}
function posMovil(seg, vel, rango) {
  const p = (seg * vel) % (4 * rango);
  return p < 2 * rango ? -rango + p : 3 * rango - p;
}

function renderTorre(round, container, roundKey) {
  const puedo = myTurnNow(round) && round.fase === 'apilar';
  if (torreBuiltFor !== roundKey || !$('torre-stage')) {
    cerrarTorre();
    torreBuiltFor = roundKey;
    container.innerHTML = `
      <div class="board torre-board">
        <p class="board-topic" id="torre-topic"></p>
        <div class="torre-stage" id="torre-stage">
          <div class="torre-hud" id="torre-hud"></div>
          <p class="torre-tap" id="torre-tap"></p>
        </div>
        <div id="torre-final"></div>
      </div>`;
    const stage = $('torre-stage');
    const soltar = (pos) => {
      if (window.Sfx) Sfx.play('pop');
      socket.emit('submit-answer', { pos });
    };
    const conWebGL = (() => {
      try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
    })();
    if (conWebGL) {
      import('./fx/torre3d.js').then((mod) => {
        if (torreBuiltFor !== roundKey || torre3d) return;
        torre3d = mod.crearTorre(stage, { onSoltar: soltar });
        if (room && room.round && room.round.type === 'torre') renderTorre(room.round, container, roundKey);
      }).catch(() => {
        if (torreBuiltFor === roundKey && !torreFallback) torreFallback = torrePlana(stage, soltar);
      });
    } else {
      torreFallback = torrePlana(stage, soltar);
    }
  }

  const altura = Math.max((round.bloques || []).length - 1, 0);
  const equipo = entrantLabel(round.activeEntrant);
  $('torre-topic').innerHTML = `Torre ${round.number} de ${round.total} · construye <b style="color:${teamColor(round.activeEntrant) || 'var(--accent)'}">${esc(equipo)}</b>`;
  $('torre-hud').innerHTML = `<span class="th-altura"><b>${altura}</b><small>bloques</small></span>${round.combo > 1 ? `<span class="th-combo">🔥 x${round.combo}</span>` : ''}`;
  $('torre-tap').textContent = puedo ? '👆 Tocá para soltar' : '';
  $('torre-tap').classList.toggle('activo', puedo);

  const opts = { puedeSoltar: puedo, hue: hueDeEquipo(round.activeEntrant), clave: round.activeEntrant };
  if (torre3d) torre3d.actualizar(round, opts);
  if (torreFallback) torreFallback.actualizar(round, opts);

  // Sonidos: uno por bloque apoyado.
  const fb = round.lastFeedback || {};
  if (torreSonido !== round.serie) {
    const primera = torreSonido === null;
    torreSonido = round.serie;
    if (!primera && window.Sfx) {
      if (fb.result === 'perfecto') Sfx.play('perfecto', fb.combo);
      else if (round.fase === 'apilar') Sfx.play('bloque');
    }
  }

  const final = $('torre-final');
  let msg;
  if (round.fase === 'fin' && round.resultado) {
    const r = round.resultado;
    const clave = `${roundKey}-${round.number}`;
    if (torreFinalKey !== clave) {
      torreFinalKey = clave;
      const motivo = r.motivo === 'tiempo' ? '⏱ Se quedaron quietos y la torre se cayó.' : r.motivo === 'tope' ? '🏆 ¡Llegaron al tope!' : '💥 ¡Se cayó!';
      final.innerHTML = `<div class="torre-resultado">
        <p>${motivo}</p>
        <b>${r.altura}</b><span>bloques${r.perfectos ? ` + ${r.perfectos} perfectos` : ''} = <b>${r.puntos} pts</b></span>
      </div>`;
      if (myId === room.hostId) {
        const sig = document.createElement('button');
        sig.className = 'btn btn-solid';
        sig.textContent = round.number >= round.total ? 'Terminar ▶' : 'Próxima torre ▶';
        sig.addEventListener('click', () => socket.emit('judge-word', { siguiente: true }));
        final.appendChild(sig);
      }
      if (window.Sfx) Sfx.play(r.motivo === 'tope' || r.altura >= 10 ? 'fanfarria' : 'error');
      if (r.altura >= 10) confetti(1.8);
    }
    msg = `Sigue solo en ${round.segundosFin} s.`;
  } else {
    if (final.innerHTML) final.innerHTML = '';
    torreFinalKey = null;
    const onDuty = (room.currentMembers || {})[round.activeEntrant];
    if (room.testMode && myId === room.hostId) msg = `Modo prueba — soltás por ${equipo}.`;
    else if (puedo) msg = '¡Te toca soltar este bloque!';
    else if (round.activeEntrant === myEntrantId() && onDuty) msg = `Suelta ${onDuty.name}, de tu equipo. ¡Avisale cuándo!`;
    else msg = `Construye ${equipo}${onDuty ? ` — suelta ${onDuty.name}` : ''}...`;
    if (round.quietoRestante !== null && round.quietoRestante <= 5) msg += ` ⚠️ ${round.quietoRestante} s para soltar`;
  }
  $('playing-turn-msg').textContent = msg;
}

function renderEscalera(round, container) {
  container.innerHTML = '';
  const iAmHost = myId === room.hostId;
  const iAmTestHost = room.testMode && iAmHost;
  const miEquipo = myEntrantId();
  const puedoJugar = iAmTestHost || miEquipo === round.activeEntrant;

  // Una escalera vertical por equipo: escalón alcanzado iluminado, el
  // plantado con bandera, y la del equipo que sube, brillando.
  const escaleras = Object.entries(round.entrants).map(([id, e]) => {
    const pasos = Array.from({ length: round.totalEscalones }, (_, i) => {
      const n = round.totalEscalones - i;
      const cls = ['ld-step', n <= (e.step || 0) ? 'on' : '', n === e.banked && e.banked ? 'banked' : '', n === (e.step || 0) ? 'top' : ''].join(' ');
      return `<span class="${cls}"><i>${n}</i>${n === e.banked && e.banked ? '<b>🏳</b>' : ''}</span>`;
    }).join('');
    return `<div class="ladder${id === round.activeEntrant ? ' active' : ''}${e.out ? ' out' : ''}" style="--team-color:${teamColor(id) || 'var(--accent)'}">
      <div class="ld-steps">${pasos}</div>
      <p class="ld-name">${esc(entrantLabel(id))}</p>
      <p class="ld-time">${e.out ? (e.banked ? `🏳 ${e.banked}` : 'afuera') : formatTime(e.timeLeft || 0)}</p>
    </div>`;
  }).join('');

  const box = document.createElement('div');
  box.className = 'board';
  box.innerHTML = `
    <p class="board-topic">${round.theme || 'Escalera Final'}</p>
    <p class="board-clue">Sube ${entrantLabel(round.activeEntrant)} — escalón ${(round.entrants[round.activeEntrant] || {}).step || 0} de ${round.totalEscalones}</p>
    <div class="ladder-duo">${escaleras}</div>
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

  renderGameHeader(round);
  maybeRoundIntro(round, roundKey);

  // Siempre visible: cuánto tiempo lleva acumulado cada equipo para el rosco
  // final — es la mecánica central de El Rosco. En Programas sin rosco final
  // (ej. Varios) no aplica: ahí el puntaje ya se ve directo en los scores.
  const esFinalAhora = JUEGOS_CON_RELOJ_FINAL.includes(round.type);
  const banner = $('carry-banner');
  if (room.hasFinalGame && !esFinalAhora && room.timeCarryOver) {
    banner.classList.remove('hidden');
    banner.innerHTML = '<span class="cb-label">⏱ Tiempo para la final</span>' + Object.entries(room.timeCarryOver)
      .map(([id, seg]) => `<span class="cb-chip" style="--team-color:${teamColor(id) || 'var(--accent)'}">${esc(entrantLabel(id))} <b>${formatTime(seg)}</b></span>`).join('');
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

  // El Impostor: cada uno ve algo distinto (su palabra o su rol) y hay un
  // campo de texto que no se puede rearmar en cada segundo -- flujo propio.
  if (round.type === 'impostor') {
    $('btn-pasapalabra').classList.add('hidden');
    $('playing-options').innerHTML = '';
    renderImpostor(round, container, roundKey);
    applyGameIdentity(round);
    maybeFlashFeedback(round);
    return;
  }

  // La Encuesta y Caja Fuerte: tableros propios (formulario que no se
  // puede rearmar cada segundo / cajas para tocar).
  if (round.type === 'encuesta' || round.type === 'caja-fuerte') {
    $('btn-pasapalabra').classList.add('hidden');
    $('playing-options').innerHTML = '';
    if (round.type === 'encuesta') renderEncuesta(round, container, roundKey);
    else renderCajaFuerte(round, container, roundKey);
    applyGameIdentity(round);
    maybeFlashFeedback(round);
    return;
  }

  // Verdadero o Falso (todos a la vez) y La Torre (escena 3D): flujos propios.
  if (['verdadero-falso', 'torre', 'aguante', 'casita-robada', 'chocadores', 'ruleta'].includes(round.type)) {
    $('btn-pasapalabra').classList.add('hidden');
    $('playing-options').innerHTML = '';
    if (round.type === 'chocadores') { renderChocadores(round, container, roundKey); applyGameIdentity(round); return; }
    if (round.type === 'ruleta') { renderRuleta(round, container, roundKey); applyGameIdentity(round); return; }
    if (round.type === 'verdadero-falso') renderVerdaderoFalso(round, container, roundKey);
    else if (round.type === 'casita-robada') renderCasitaRobada(round, container, roundKey);
    else if (round.type === 'aguante') renderAguante(round, container, roundKey);
    else renderTorre(round, container, roundKey);
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
    row.style.setProperty('--i', i);
    const color = teamColor(entrantId);
    if (color) row.style.setProperty('--team-color', color);
    const delta = showDelta && room.lastRoundPoints ? room.lastRoundPoints[entrantId] : null;
    const deltaText = delta ? ` (+${delta})` : '';
    const medal = MEDALS[i] ? `${MEDALS[i]} ` : '';
    row.innerHTML = `<span>${medal}${entrantLabel(entrantId)}</span><span>${points} pts${deltaText}</span>`;
    container.appendChild(row);
  });
}

// Quién ganó un juego puntual (además del acumulado del programa).
function ganadorDe(puntos) {
  const lista = Object.entries(puntos || {}).sort((a, b) => b[1] - a[1]);
  if (!lista.length) return null;
  const empatados = lista.filter(([, p]) => p === lista[0][1]);
  return { ids: empatados.map(([id]) => id), puntos: lista[0][1], empate: empatados.length > 1 };
}
function textoGanador(g) {
  if (!g) return '';
  if (g.empate) return `Empate entre ${g.ids.map((id) => esc(entrantLabel(id))).join(' y ')} (${g.puntos} pts)`;
  const color = teamColor(g.ids[0]) || 'var(--accent)';
  return `<b style="color:${color}">${esc(entrantLabel(g.ids[0]))}</b> (${g.puntos} pts)`;
}

let lastRoundConfetti = null;
function renderRoundResult() {
  const g = ganadorDe(room.lastRoundPoints);
  $('roundresult-ganador').innerHTML = g
    ? `<span class="jg-copa">${g.empate ? '🤝' : '🏅'}</span><span>${g.empate ? '' : 'Ganó este juego: '}${textoGanador(g)}</span>` : '';
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
  if (leader && lastRoundConfetti !== `${room.code}-${room.currentRoundNumber}`) {
    lastRoundConfetti = `${room.code}-${room.currentRoundNumber}`;
    confetti(1.6);
  }
  if (leader) {
    narrate(`fin-${room.currentRoundNumber}`,
      `Termina ${round.label || 'la prueba'}. Va ganando ${entrantLabel(leader[0])} con ${leader[1]} puntos.`);
  }
}

let lastFanfarria = null;
function renderResults() {
  const sorted = Object.entries(room.scores).sort((a, b) => b[1] - a[1]);
  renderScoreList($('final-scores'), sorted, false);
  const leader = sorted[0];
  if (leader) narrate('fin-programa', `Fin del programa. Gana ${entrantLabel(leader[0])}.`);
  if (leader && window.Sfx && lastFanfarria !== room.code + room.currentRoundNumber) {
    lastFanfarria = room.code + room.currentRoundNumber;
    Sfx.play('fanfarria');
    confetti(3.2);
  }

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

  // Ganador de cada juego de la noche (con más de un juego, si no es redundante).
  const historial = room.historial || [];
  $('results-por-juego').innerHTML = historial.length > 1
    ? `<p class="section-title">Ganadores por juego</p>${historial.map((h) => {
      const gj = ganadorDe(h.puntos);
      return `<div class="pj-fila"><span>${h.icon} ${esc(h.label)}</span><span>${gj ? textoGanador(gj) : '—'}</span></div>`;
    }).join('')}` : '';

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
  impostorBuiltFor = null;
  encuestaBuiltFor = null;
  cajaBuiltFor = null;
  vfBuiltFor = null;
  aguanteBuiltFor = null;
  casitaBuiltFor = null;
  cerrarCarrera();
  cerrarRuleta();
  limpiarAguante();
  cerrarTorre();
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
  // La escena 3D de La Torre se apaga apenas se deja de jugar ese juego.
  if (torreBuiltFor && (room.phase !== 'playing' || !room.round || room.round.type !== 'torre')) cerrarTorre();
  if (gp && (room.phase !== 'playing' || !room.round || room.round.type !== 'chocadores')) cerrarCarrera();
  if (rl && (room.phase !== 'playing' || !room.round || room.round.type !== 'ruleta')) cerrarRuleta();
  if (aguanteBuiltFor && (room.phase !== 'playing' || !room.round || room.round.type !== 'aguante')) { limpiarAguante(); aguanteBuiltFor = null; }

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
