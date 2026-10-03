// Juego "Aguante" — reflejos con el semáforo de largada de la Fórmula 1: se
// prenden cinco luces rojas de a una, y en un momento al azar se apagan.
// Hay que tocar apenas se apagan. Tocar antes es "largada en falso".
//
// Juegan TODOS a la vez, cada uno desde su celu (no hay "el de turno"). En
// cada largada se ordena a todos por tiempo de reacción y se reparten puntos
// como en la F1 (25, 18, 15...). Los puntos de cada uno suman para su equipo:
// como en la F1, gana el equipo, no una persona sola.
//
// El tiempo de reacción lo mide cada celu desde que ESE celu apagó las luces,
// así la demora de internet no favorece a nadie (a todos les llega la orden
// un poco tarde, pero cada uno se mide contra su propia pantalla).

const { resolver } = require('../opciones');

const type = 'aguante';
const label = 'Aguante';
const estimateSecondsPerRound = 90;
const simultaneous = true;
const skipMemberGate = true;

const PUNTOS_F1 = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const MS_POR_LUZ = 700;
const LUCES = 5;
const SEG_RESULTADO = 6;
const MS_MAXIMO = 3000; // después de esto ya no cuenta como reacción

const opciones = [
  { id: 'largadas', label: 'Largadas', valores: [[3, '3'], [5, '5'], [8, '8']], porDificultad: { facil: 3, normal: 5, dificil: 8 } },
  { id: 'trampas', label: 'Luces trampa', valores: [['no', 'No'], ['si', 'Sí']], porDificultad: { facil: 'no', normal: 'no', dificil: 'si' } }
];

function empezarLargada(state) {
  // Las luces se prenden de a una y, después de una espera al azar, se apagan.
  const espera = 400 + Math.floor(Math.random() * 2600);
  const apagaEnMs = LUCES * MS_POR_LUZ + espera;
  // Luz trampa: un destello amarillo antes de la largada real. Tocar ahí
  // también es largada en falso.
  const trampaEnMs = state.conTrampas && Math.random() < 0.6
    ? MS_POR_LUZ * 2 + Math.floor(Math.random() * (apagaEnMs - MS_POR_LUZ * 2 - 300))
    : null;
  state.fase = 'luces';
  state.serie += 1;
  state.plan = { serie: state.serie, msPorLuz: MS_POR_LUZ, luces: LUCES, apagaEnMs, trampaEnMs, maximoMs: MS_MAXIMO };
  state.segundosLuces = 0;
  state.limiteSegundos = Math.ceil((apagaEnMs + MS_MAXIMO) / 1000) + 3; // margen para la demora de internet
  state.toques = {}; // playerId -> { ms } | { falsa: true }
}

function jugadores(state) {
  return Object.entries(state.rosters).flatMap(([entrant, lista]) => lista.map((p) => ({ ...p, entrant })));
}

function faltanTocar(state) {
  return jugadores(state).filter((j) => !state.toques[j.id] && !String(j.id).startsWith('test:'));
}

function cerrarLargada(state) {
  const todos = jugadores(state);
  const validos = todos
    .filter((p) => state.toques[p.id] && Number.isFinite(state.toques[p.id].ms))
    .sort((a, b) => state.toques[a.id].ms - state.toques[b.id].ms);
  const tabla = todos.map((p) => {
    const t = state.toques[p.id] || null;
    const puesto = validos.findIndex((v) => v.id === p.id);
    const puntos = puesto >= 0 ? (PUNTOS_F1[puesto] || 0) : 0;
    state.entrants[p.entrant].points += puntos;
    if (t && Number.isFinite(t.ms)) {
      const mejor = state.mejores[p.id];
      if (mejor === undefined || t.ms < mejor) state.mejores[p.id] = t.ms;
    }
    return {
      id: p.id,
      name: p.name,
      entrant: p.entrant,
      ms: t && Number.isFinite(t.ms) ? t.ms : null,
      falsa: !!(t && t.falsa),
      puesto: puesto >= 0 ? puesto + 1 : null,
      puntos
    };
  }).sort((a, b) => (a.puesto || 99) - (b.puesto || 99));
  state.tabla = tabla;
  state.fase = 'resultado';
  state.segundosResultado = SEG_RESULTADO;
  const ganador = tabla[0] && tabla[0].puesto === 1 ? tabla[0] : null;
  state.lastFeedback = { result: ganador ? 'correct' : 'wrong', entrantId: ganador ? ganador.entrant : null, largada: state.largada };
}

function siguiente(state) {
  state.largada += 1;
  if (state.largada > state.totalLargadas) {
    state.finished = true;
    return;
  }
  empezarLargada(state);
}

function createRound({ entrantIds, rosters = {}, difficulty, opciones: elegidas }) {
  const o = resolver(opciones, elegidas, difficulty);
  const entrants = {};
  entrantIds.forEach((id) => { entrants[id] = { points: 0, secondsWon: 0 }; });
  const state = {
    gameType: type,
    rosters: Object.fromEntries(entrantIds.map((id) => [id, (rosters[id] || []).map((p) => ({ id: p.id, name: p.name }))])),
    totalLargadas: o.largadas,
    conTrampas: o.trampas === 'si',
    largada: 1,
    serie: 0,
    entrants,
    mejores: {},
    tabla: [],
    activeEntrant: null,
    lastFeedback: null,
    finished: entrantIds.length < 1
  };
  if (!state.finished) empezarLargada(state);
  return state;
}

// Quién toca: el jugador mismo. En modo prueba el anfitrión toca por el
// primero que falte (los jugadores inventados no tocan nunca).
function quienToca(state, playerId, isTestHost) {
  const lista = jugadores(state);
  if (isTestHost) return lista.find((p) => !state.toques[p.id] && !String(p.id).startsWith('test:')) || lista.find((p) => !state.toques[p.id]);
  return lista.find((p) => p.id === playerId);
}

// payload: { ms: número } al tocar a tiempo, o { falsa: true } si tocó antes.
function answer(state, entrantId, payload, playerId, isTestHost) {
  if (state.finished) return { error: 'Este juego ya terminó.' };
  if (state.fase !== 'luces') return { error: 'Esperá la próxima largada.' };
  const p = payload || {};
  if (p.serie !== undefined && p.serie !== state.serie) return { error: 'Esa largada ya pasó.' };
  const jugador = quienToca(state, playerId, isTestHost);
  if (!jugador) return { error: 'No estás en esta largada (entraste a mitad del juego).' };
  if (state.toques[jugador.id]) return { error: 'Ya tocaste en esta largada.' };
  if (p.falsa === true) {
    state.toques[jugador.id] = { falsa: true };
  } else {
    const ms = Math.round(Number(p.ms));
    // Menos de 80 ms no es humano: se toma como que tocó antes de tiempo.
    if (!Number.isFinite(ms) || ms < 80) state.toques[jugador.id] = { falsa: true };
    else if (ms > MS_MAXIMO) state.toques[jugador.id] = { tarde: true };
    else state.toques[jugador.id] = { ms };
  }
  if (!faltanTocar(state).length) cerrarLargada(state);
  return {};
}

// Anfitrión: pasar a la próxima largada sin esperar.
function judge(state, payload) {
  if (state.finished) return { error: 'Este juego ya terminó.' };
  if (payload && payload.siguiente && state.fase === 'resultado') {
    siguiente(state);
    return {};
  }
  return { error: 'Acción no reconocida.' };
}

function tick(state) {
  if (state.finished) return;
  if (state.fase === 'luces') {
    state.segundosLuces += 1;
    if (state.segundosLuces >= state.limiteSegundos) cerrarLargada(state);
    return;
  }
  state.segundosResultado -= 1;
  if (state.segundosResultado <= 0) siguiente(state);
}

// Si alguien se va o se suma a un equipo, la lista de quién juega se pone al día.
function onRosterChange(state, rosters) {
  Object.keys(state.rosters).forEach((id) => {
    if (rosters[id]) state.rosters[id] = rosters[id].map((p) => ({ id: p.id, name: p.name }));
  });
  // Si el que faltaba tocar era el que se fue, no se lo espera.
  if (!state.finished && state.fase === 'luces' && !faltanTocar(state).length) cerrarLargada(state);
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.points]));
}

function carryOver(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.secondsWon]));
}

function publicView(state) {
  return {
    type,
    label,
    number: Math.min(state.largada, state.totalLargadas),
    total: state.totalLargadas,
    fase: state.fase,
    plan: state.fase === 'luces' ? state.plan : null,
    serie: state.serie,
    tocaron: Object.keys(state.toques || {}),
    tabla: state.fase === 'resultado' ? state.tabla : [],
    mejores: state.mejores,
    segundosResultado: state.segundosResultado || 0,
    activeEntrant: null,
    entrants: Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, { points: e.points, secondsWon: 0 }])),
    lastFeedback: state.lastFeedback,
    finished: state.finished
  };
}

module.exports = {
  type, label, estimateSecondsPerRound, simultaneous, skipMemberGate, opciones,
  createRound, answer, judge, tick, onRosterChange, scores, carryOver, publicView
};
