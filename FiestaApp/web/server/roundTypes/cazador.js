// Juego "El Cazador" — la escondida en 3D, con suspenso. En cada turno uno es
// el cazador y los demás se esconden en un escenario sorteado (la casa, la
// mansión embrujada...): debajo de la cama, en el armario, detrás de la
// cortina, abajo de la mesa, en la bañera...
//
//   1) esconder: el cazador no ve nada (cuenta); los demás buscan escondite.
//   2) cazar: el cazador camina con una linterna. Si alguien se mueve, oye
//      sus pasos. Puede REVISAR un mueble (si hay alguien: ¡pastel en la
//      cara!) o DISPARAR pintura (pocas balas): si le da a alguien que está
//      a la vista, o al mueble donde está escondido, lo atrapa.
//   3) fin: se revela dónde estaba cada uno.
// Rotan: todos son cazadores una vez. Puntos: el cazador suma por cada uno
// que atrapa y por el tiempo que le sobró si encontró a todos (el más
// rápido gana); el escondido suma si sobrevive.
//
// El movimiento corre en cada celu y la posición llega ~10 veces por segundo
// (canal 'caza-pos'); el servidor decide todo lo importante (quién está en
// qué escondite, si un disparo pega, qué ve la linterna, qué pasos se oyen),
// y a cada celu le manda solo lo que le corresponde ver.

const path = require('path');
const { resolver } = require('../opciones');
const { shuffle } = require('../contentLoader');

const MAPAS = require(path.join(__dirname, '..', '..', 'public', 'fx', 'cazador-mapas.json')).mapas;

const type = 'cazador';
const label = 'El Cazador';
const estimateSecondsPerRound = 600;
const simultaneous = true;
const skipMemberGate = true;

const R_JUGADOR = 0.35;
const ALCANCE_MUEBLE = 1.3; // distancia extra (además del tamaño del mueble) para esconderse o revisar
const VISION = 15; // hasta dónde ilumina la linterna
const CONO = (55 * Math.PI) / 180; // medio ángulo de la linterna
const OIDO = 13; // hasta dónde se oyen los pasos
const ALCANCE_DISPARO = 18;
const SEG_FIN = 8;
const VEL_MAX = 6.5;

const opciones = [
  { id: 'esconder', label: 'Tiempo para esconderse', valores: [[25, '25 s'], [35, '35 s'], [45, '45 s']], porDificultad: { facil: 45, normal: 35, dificil: 25 } },
  { id: 'cazar', label: 'Tiempo del cazador', valores: [[60, '1:00'], [90, '1:30'], [120, '2:00']], porDificultad: { facil: 120, normal: 90, dificil: 60 } },
  { id: 'pintura', label: 'Disparos de pintura', valores: [[3, '3'], [5, '5'], [8, '8']], porDificultad: { facil: 8, normal: 5, dificil: 3 } }
];

// ---------- Geometría ----------
function cruzaSegmento(ax, az, bx, bz, cx, cz, dx, dz) {
  // ¿El segmento A-B corta al segmento C-D? Devuelve t (0..1 sobre A-B) o null.
  const r = [bx - ax, bz - az]; const s = [dx - cx, dz - cz];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * s[1] - (cz - az) * s[0]) / den;
  const u = ((cx - ax) * r[1] - (cz - az) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
function cajaDe(m) { return { x0: m.x - m.w / 2, x1: m.x + m.w / 2, z0: m.z - m.d / 2, z1: m.z + m.d / 2 }; }
function rayoCaja(ax, az, dx, dz, c) {
  // Distancia del rayo (desde A, dirección unitaria D) a la caja, o null.
  let tmin = 0; let tmax = Infinity;
  for (const [o, d, lo, hi] of [[ax, dx, c.x0, c.x1], [az, dz, c.z0, c.z1]]) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return null; continue; }
    let t1 = (lo - o) / d; let t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
function distAMueble(x, z, m) {
  const c = cajaDe(m);
  const dx = Math.max(c.x0 - x, 0, x - c.x1); const dz = Math.max(c.z0 - z, 0, z - c.z1);
  return Math.hypot(dx, dz);
}
function hayPared(mapa, ax, az, bx, bz) {
  return mapa.paredes.some(([x1, z1, x2, z2]) => cruzaSegmento(ax, az, bx, bz, x1, z1, x2, z2) !== null);
}

// ---------- Estado ----------
function jugadoresDe(rosters, entrantIds) {
  const listas = entrantIds.map((id) => (rosters[id] || []).map((p) => ({ id: p.id, name: p.name || 'Jugador', entrant: id })));
  const max = Math.max(0, ...listas.map((l) => l.length));
  const out = [];
  for (let i = 0; i < max; i++) listas.forEach((l) => { if (l[i]) out.push(l[i]); });
  return out;
}

function empezarTurno(state) {
  const cazador = state.jugadores[state.turno];
  state.cazadorId = cazador.id;
  state.activeEntrant = cazador.entrant;
  state.mapa = state.mapasOrden[state.turno % state.mapasOrden.length];
  const mapa = MAPAS.find((m) => m.id === state.mapa);
  state.fase = 'esconder';
  state.segundos = state.segEsconder;
  state.serie += 1;
  state.pos = {};
  state.escondite = {}; // playerId -> muebleId
  state.atrapados = {}; // playerId -> { como: 'pastel' | 'pintura' | 'toque', seg }
  state.balas = state.pinturaTotal;
  state.manchas = []; // [{x, z, y, color}]
  state.ruidos = [];
  state.eventos = [];
  state.revisadoHace = 0;
  state.inicioCaza = null;
  const lugares = shuffle(mapa.escondidos);
  let k = 0;
  state.jugadores.forEach((j) => {
    if (j.id === cazador.id) state.pos[j.id] = { x: mapa.cazador[0], z: mapa.cazador[1], a: 0, t: Date.now(), quieto: true };
    else { const [x, z] = lugares[k++ % lugares.length]; state.pos[j.id] = { x, z, a: 0, t: Date.now(), quieto: true }; }
  });
  state.resumen = null;
}

function createRound({ entrantIds, rosters = {}, difficulty, opciones: elegidas }) {
  const o = resolver(opciones, elegidas, difficulty);
  const entrants = {};
  entrantIds.forEach((id) => { entrants[id] = { points: 0, secondsWon: 0 }; });
  const jugadores = jugadoresDe(rosters, entrantIds).slice(0, 8);
  const state = {
    gameType: type,
    jugadores,
    segEsconder: o.esconder,
    segCazar: o.cazar,
    pinturaTotal: o.pintura,
    mapasOrden: shuffle(MAPAS.map((m) => m.id)),
    turno: 0,
    serie: 0,
    puntos: Object.fromEntries(jugadores.map((j) => [j.id, 0])),
    historial: [],
    entrants,
    activeEntrant: null,
    lastFeedback: null,
    finished: jugadores.length < 2
  };
  if (!state.finished) empezarTurno(state);
  return state;
}

const mapaDe = (state) => MAPAS.find((m) => m.id === state.mapa);
const muebleDe = (state, id) => mapaDe(state).muebles.find((m) => m.id === id);
const escondidos = (state) => state.jugadores.filter((j) => j.id !== state.cazadorId);
const libres = (state) => escondidos(state).filter((j) => !state.atrapados[j.id]);

function atrapar(state, id, como) {
  if (state.atrapados[id]) return;
  const seg = state.inicioCaza ? Math.round((Date.now() - state.inicioCaza) / 1000) : 0;
  state.atrapados[id] = { como, seg, mueble: state.escondite[id] || null };
  delete state.escondite[id];
  const j = state.jugadores.find((x) => x.id === id);
  state.eventos.push({ tipo: 'atrapado', id, nombre: j ? j.name : '', como, t: Date.now() });
  state.lastFeedback = { result: 'correct', entrantId: state.activeEntrant, como, id };
  if (!libres(state).length) terminarCaza(state, true);
}

function terminarCaza(state, todos) {
  const usados = state.inicioCaza ? Math.round((Date.now() - state.inicioCaza) / 1000) : state.segCazar;
  const sobra = todos ? Math.max(state.segCazar - usados, 0) : 0;
  const cant = Object.keys(state.atrapados).length;
  // Cazador: 10 por cada uno y, si encontró a todos, 1 por segundo que le sobró.
  const ptsCazador = cant * 10 + sobra;
  state.puntos[state.cazadorId] += ptsCazador;
  const detalle = escondidos(state).map((j) => {
    const a = state.atrapados[j.id];
    // Escondido: 15 si sobrevivió; si no, 1 cada 6 segundos que aguantó.
    const pts = a ? Math.floor(a.seg / 6) : 15;
    state.puntos[j.id] += pts;
    return { id: j.id, name: j.name, atrapado: a ? a.como : null, seg: a ? a.seg : null, escondite: state.escondite[j.id] || (a && a.mueble) || null, pts };
  });
  // El escondite de los atrapados ya se borró: se guarda dónde los encontraron.
  state.resumen = { cazadorId: state.cazadorId, todos, segundos: todos ? usados : null, pts: ptsCazador, detalle, revelar: { ...state.escondite } };
  state.historial.push({ cazadorId: state.cazadorId, todos, segundos: todos ? usados : null, atrapados: cant, total: escondidos(state).length });
  state.fase = 'fin';
  state.segundos = SEG_FIN;
  state.serie += 1;
  actualizarPuntos(state);
}

function actualizarPuntos(state) {
  Object.values(state.entrants).forEach((e) => { e.points = 0; });
  state.jugadores.forEach((j) => { state.entrants[j.entrant].points += state.puntos[j.id]; });
}

function siguienteTurno(state) {
  state.turno += 1;
  if (state.turno >= state.jugadores.length) { state.finished = true; return; }
  empezarTurno(state);
}

// ---------- Acciones (submit-answer) ----------
// Escondido: { esconder: muebleId } | { salir: true }
// Cazador:   { revisar: muebleId } | { disparar: angulo }
function answer(state, entrantId, payload, playerId, isTestHost) {
  if (state.finished) return { error: 'Este juego ya terminó.' };
  const p = payload || {};
  let quien = playerId;
  if (isTestHost && !state.jugadores.some((j) => j.id === playerId)) quien = state.cazadorId;
  const yo = state.jugadores.find((j) => j.id === quien);
  if (!yo) return { error: 'No estás en esta partida (entraste con el juego empezado).' };
  const pos = state.pos[quien];
  const mapa = mapaDe(state);
  const esCazador = quien === state.cazadorId;

  if (p.esconder !== undefined) {
    if (esCazador) return { error: 'El cazador no se esconde.' };
    if (state.atrapados[quien]) return { error: 'Ya te atraparon.' };
    if (state.fase !== 'esconder' && state.fase !== 'cazar') return { error: 'Ahora no.' };
    const m = muebleDe(state, String(p.esconder));
    if (!m || !m.cupo) return { error: 'Ahí no te podés esconder.' };
    if (distAMueble(pos.x, pos.z, m) > ALCANCE_MUEBLE + 0.4) return { error: 'Acercate más para esconderte.' };
    const ocupado = Object.values(state.escondite).filter((x) => x === m.id).length;
    if (ocupado >= m.cupo) return { error: 'Ese escondite ya está lleno.' };
    state.escondite[quien] = m.id;
    return {};
  }
  if (p.salir) {
    if (!state.escondite[quien]) return { error: 'No estás escondido.' };
    delete state.escondite[quien];
    // Salir hace ruido.
    state.ruidos.push({ x: pos.x, z: pos.z, t: Date.now(), fuerte: true });
    return {};
  }
  if (p.revisar !== undefined) {
    if (!esCazador) return { error: 'Solo el cazador revisa.' };
    if (state.fase !== 'cazar') return { error: 'Todavía no podés buscar.' };
    const m = muebleDe(state, String(p.revisar));
    if (!m) return { error: 'Ese mueble no existe.' };
    if (distAMueble(pos.x, pos.z, m) > ALCANCE_MUEBLE + 0.4) return { error: 'Acercate más para revisar.' };
    const ahora = Date.now();
    if (ahora - state.revisadoHace < 1200) return { error: 'Esperá un segundo...' };
    state.revisadoHace = ahora;
    const adentro = Object.entries(state.escondite).filter(([, x]) => x === m.id).map(([id]) => id);
    state.eventos.push({ tipo: 'revisar', mueble: m.id, hay: adentro.length > 0, t: ahora });
    adentro.forEach((id) => atrapar(state, id, 'pastel'));
    return {};
  }
  if (p.disparar !== undefined) {
    if (!esCazador) return { error: 'Solo el cazador dispara.' };
    if (state.fase !== 'cazar') return { error: 'Todavía no podés disparar.' };
    if (state.balas <= 0) return { error: 'No te queda pintura.' };
    const ang = Number(p.disparar);
    if (!Number.isFinite(ang)) return { error: 'Disparo inválido.' };
    state.balas -= 1;
    const dx = Math.cos(ang); const dz = Math.sin(ang);
    // Lo primero que encuentra el disparo: pared, mueble o alguien a la vista.
    let mejor = { d: ALCANCE_DISPARO, cosa: null };
    mapa.paredes.forEach(([x1, z1, x2, z2]) => {
      const t = cruzaSegmento(pos.x, pos.z, pos.x + dx * ALCANCE_DISPARO, pos.z + dz * ALCANCE_DISPARO, x1, z1, x2, z2);
      if (t !== null && t * ALCANCE_DISPARO < mejor.d) mejor = { d: t * ALCANCE_DISPARO, cosa: { tipo: 'pared' } };
    });
    mapa.muebles.forEach((m) => {
      const d = rayoCaja(pos.x, pos.z, dx, dz, cajaDe(m));
      if (d !== null && d > 0.05 && d < mejor.d) mejor = { d, cosa: { tipo: 'mueble', m } };
    });
    libres(state).forEach((j) => {
      if (state.escondite[j.id]) return;
      const q = state.pos[j.id];
      const t = (q.x - pos.x) * dx + (q.z - pos.z) * dz;
      if (t <= 0 || t > mejor.d) return;
      const lado = Math.hypot(pos.x + dx * t - q.x, pos.z + dz * t - q.z);
      if (lado < 0.55) mejor = { d: t, cosa: { tipo: 'jugador', id: j.id } };
    });
    const impacto = { x: +(pos.x + dx * mejor.d).toFixed(2), z: +(pos.z + dz * mejor.d).toFixed(2), color: ['#ff3d7f', '#3de6ff', '#ffd23f', '#3ddc84', '#8b5cff'][state.balas % 5] };
    state.manchas.push(impacto);
    let acerto = false;
    if (mejor.cosa && mejor.cosa.tipo === 'jugador') { atrapar(state, mejor.cosa.id, 'pintura'); acerto = true; }
    if (mejor.cosa && mejor.cosa.tipo === 'mueble') {
      const adentro = Object.entries(state.escondite).filter(([, x]) => x === mejor.cosa.m.id).map(([id]) => id);
      if (adentro.length) { atrapar(state, adentro[0], 'pintura'); acerto = true; }
    }
    state.eventos.push({ tipo: 'disparo', ...impacto, acerto, t: Date.now() });
    return {};
  }
  return { error: 'Acción no reconocida.' };
}

// Posición que manda cada celu: [x, z, angulo]. Se valida que esté dentro del
// escenario y que no se haya "teletransportado".
function posicion(state, playerId, d) {
  if (state.finished || !Array.isArray(d)) return;
  const pos = state.pos[playerId];
  if (!pos) return;
  const esCazador = playerId === state.cazadorId;
  if (esCazador && state.fase !== 'cazar') return;
  if (state.atrapados[playerId] || state.escondite[playerId]) return;
  if (state.fase !== 'esconder' && state.fase !== 'cazar') return;
  const mapa = mapaDe(state);
  const [x, z, a] = d.map(Number);
  if (![x, z, a].every(Number.isFinite)) return;
  if (x < 0 || z < 0 || x > mapa.ancho || z > mapa.largo) return;
  const ahora = Date.now();
  const dt = Math.max((ahora - pos.t) / 1000, 0.05);
  const dist = Math.hypot(x - pos.x, z - pos.z);
  if (dist > VEL_MAX * dt + 1.2) return; // demasiado lejos de golpe
  const vel = dist / dt;
  pos.x = x; pos.z = z; pos.a = a; pos.t = ahora;
  pos.quieto = vel < 0.3;
  // Los pasos de los escondidos se oyen (más si corren).
  if (!esCazador && state.fase === 'cazar' && vel > 1.2) {
    const ult = pos.ultimoRuido || 0;
    if (ahora - ult > (vel > 3.5 ? 280 : 480)) { pos.ultimoRuido = ahora; state.ruidos.push({ x, z, t: ahora, fuerte: vel > 3.5, id: playerId }); }
  }
  // El cazador atrapa tocando a alguien que está a la vista.
  if (esCazador) {
    libres(state).forEach((j) => {
      if (state.escondite[j.id]) return;
      const q = state.pos[j.id];
      if (Math.hypot(q.x - x, q.z - z) < R_JUGADOR * 2 + 0.25) atrapar(state, j.id, 'toque');
    });
  }
}

function tick(state) {
  if (state.finished) return;
  state.segundos -= 1;
  if (state.segundos > 0) return;
  if (state.fase === 'esconder') {
    state.fase = 'cazar';
    state.segundos = state.segCazar;
    state.serie += 1;
    state.inicioCaza = Date.now();
    const mapa = mapaDe(state);
    state.pos[state.cazadorId] = { x: mapa.inicioCaza[0], z: mapa.inicioCaza[1], a: 0, t: Date.now(), quieto: true };
  } else if (state.fase === 'cazar') {
    terminarCaza(state, false);
  } else {
    siguienteTurno(state);
  }
}

// Anfitrión: pasar al próximo turno sin esperar.
function judge(state, payload) {
  if (state.finished) return { error: 'Este juego ya terminó.' };
  if (payload && payload.siguiente && state.fase === 'fin') { siguienteTurno(state); return {}; }
  return { error: 'Acción no reconocida.' };
}

// Lo que viaja ~10 veces por segundo a CADA celu, según quién es:
// - al cazador: solo los escondidos que ilumina la linterna (sin pared en
//   el medio) y los pasos que oye;
// - a los escondidos: dónde está el cazador y los demás escondidos.
function vistaRapida(state, viewerId) {
  const ahora = Date.now();
  state.ruidos = state.ruidos.filter((r) => ahora - r.t < 1500);
  state.eventos = state.eventos.filter((e) => ahora - e.t < 4000);
  const mapa = mapaDe(state);
  const caz = state.pos[state.cazadorId];
  const out = { fase: state.fase, serie: state.serie, jugadores: [], ruidos: [], eventos: state.eventos, manchas: state.manchas, balas: state.balas };
  const visto = (j) => {
    if (viewerId !== state.cazadorId || state.fase === 'fin') return true;
    if (state.escondite[j.id]) return false;
    const q = state.pos[j.id];
    const d = Math.hypot(q.x - caz.x, q.z - caz.z);
    if (d < 1.6) return true;
    if (d > VISION) return false;
    const ang = Math.atan2(q.z - caz.z, q.x - caz.x) - caz.a;
    if (Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang))) > CONO) return false;
    return !hayPared(mapa, caz.x, caz.z, q.x, q.z);
  };
  state.jugadores.forEach((j) => {
    if (j.id === viewerId) return;
    if (state.atrapados[j.id] && state.fase !== 'fin') return;
    if (j.id === state.cazadorId && state.fase === 'esconder') return;
    if (j.id !== state.cazadorId && !visto(j)) return;
    const q = state.pos[j.id];
    out.jugadores.push([j.id, +q.x.toFixed(2), +q.z.toFixed(2), +q.a.toFixed(2), state.escondite[j.id] || 0]);
  });
  if (viewerId === state.cazadorId && state.fase === 'cazar') {
    state.ruidos.forEach((r) => {
      if (Math.hypot(r.x - caz.x, r.z - caz.z) > OIDO * (r.fuerte ? 1.3 : 1)) return;
      // Se oye de dónde viene, pero no exacto.
      out.ruidos.push([+(r.x + (Math.random() - 0.5) * 1.2).toFixed(1), +(r.z + (Math.random() - 0.5) * 1.2).toFixed(1), r.fuerte ? 1 : 0, r.t]);
    });
  }
  if (viewerId !== state.cazadorId && caz) out.cazador = [+caz.x.toFixed(2), +caz.z.toFixed(2), +caz.a.toFixed(2)];
  // Para el audio por cercanía: a qué distancia (redondeada) está cada uno.
  const yo = state.pos[viewerId];
  if (yo) out.cerca = Object.fromEntries(state.jugadores.filter((j) => j.id !== viewerId && state.pos[j.id]).map((j) => [j.id, Math.round(Math.hypot(state.pos[j.id].x - yo.x, state.pos[j.id].z - yo.z))]));
  return out;
}

function onRosterChange(state, rosters) {
  // Si el cazador se va, se termina su turno; si se va un escondido, sale del turno.
  const siguen = new Set(Object.values(rosters).flat().map((p) => p.id));
  if (state.fase === 'esconder' || state.fase === 'cazar') {
    if (!siguen.has(state.cazadorId)) { terminarCaza(state, false); return; }
  }
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.points]));
}
function carryOver(state) {
  return Object.fromEntries(Object.keys(state.entrants).map((id) => [id, 0]));
}

function publicView(state) {
  const caz = state.jugadores.find((j) => j.id === state.cazadorId);
  return {
    type,
    label,
    number: state.turno + 1,
    total: state.jugadores.length,
    fase: state.fase,
    segundos: Math.max(state.segundos, 0),
    serie: state.serie,
    mapa: state.mapa,
    cazadorId: state.cazadorId,
    cazadorNombre: caz ? caz.name : '',
    jugadores: state.jugadores.map((j) => ({ ...j, puntos: state.puntos[j.id], atrapado: state.atrapados[j.id] ? state.atrapados[j.id].como : null })),
    pinturaTotal: state.pinturaTotal,
    resumen: state.fase === 'fin' ? state.resumen : null,
    historial: state.historial,
    activeEntrant: state.activeEntrant,
    entrants: Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, { points: e.points, secondsWon: 0 }])),
    lastFeedback: state.lastFeedback,
    finished: state.finished
  };
}

// Cada uno ve su propia posición de arranque y su escondite.
function privateView(state, viewerId) {
  const pos = state.pos && state.pos[viewerId];
  return { pos: pos ? [pos.x, pos.z, pos.a] : null, escondite: (state.escondite || {})[viewerId] || null };
}

module.exports = {
  type, label, estimateSecondsPerRound, simultaneous, skipMemberGate, opciones,
  createRound, answer, judge, tick, onRosterChange, scores, carryOver, publicView, privateView,
  posicion, vistaRapida,
  _geo: { cruzaSegmento, rayoCaja, distAMueble, hayPared, MAPAS }
};
