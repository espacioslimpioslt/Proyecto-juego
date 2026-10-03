// Juego "Verdadero o Falso" — relámpago: aparece una afirmación y TODOS los
// equipos contestan a la vez, contra reloj. Acertar suma; el primer equipo en
// acertar suma un bonus. Después se revela la respuesta con un dato curioso.
//
// Cualquier integrante del equipo puede tocar (no hay "el de turno"): vale el
// primer toque de cada equipo, así que hay que ponerse de acuerdo rápido.

const { loadDecks, pickDeck, shuffle } = require('../contentLoader');
const { resolver } = require('../opciones');

const type = 'verdadero-falso';
const label = 'Verdadero o Falso';
const estimateSecondsPerRound = 150;
const simultaneous = true;
const skipMemberGate = true;

const SEG_REVELAR = 5;
const PUNTOS_ACIERTO = 2;
const BONUS_PRIMERO = 1;

const decks = loadDecks('varios', 'verdadero-falso');

const opciones = [
  { id: 'preguntas', label: 'Afirmaciones', valores: [[8, '8'], [12, '12'], [16, '16']], porDificultad: { facil: 8, normal: 12, dificil: 16 } },
  { id: 'segundos', label: 'Segundos para contestar', valores: [[5, '5'], [8, '8'], [12, '12']], porDificultad: { facil: 12, normal: 8, dificil: 5 } }
];

function empezarPregunta(state) {
  state.fase = 'pregunta';
  state.segundos = state.segundosPorPregunta;
  state.respuestas = {}; // entrantId -> { verdadero, orden }
  Object.values(state.entrants).forEach((e) => { e.submitted = false; });
}

function revelar(state) {
  const q = state.preguntas[state.index];
  const correctos = Object.entries(state.respuestas)
    .filter(([, r]) => r.verdadero === q.verdadero)
    .sort((a, b) => a[1].orden - b[1].orden);
  correctos.forEach(([id], i) => {
    const pts = PUNTOS_ACIERTO + (i === 0 && Object.keys(state.entrants).length > 1 ? BONUS_PRIMERO : 0);
    state.entrants[id].points += pts;
    state.entrants[id].aciertos += 1;
    state.respuestas[id].puntos = pts;
  });
  state.fase = 'revelar';
  state.segundos = SEG_REVELAR;
  state.lastFeedback = { result: correctos.length ? 'correct' : 'wrong', entrantId: correctos.length ? correctos[0][0] : null, pregunta: state.index };
}

function siguiente(state) {
  state.index += 1;
  if (state.index >= state.preguntas.length) {
    state.finished = true;
    return;
  }
  empezarPregunta(state);
}

function createRound({ entrantIds, usedDeckIds = [], region, adultsOnly, difficulty, opciones: elegidas }) {
  const o = resolver(opciones, elegidas, difficulty);
  const deck = pickDeck(decks, usedDeckIds, { region, adultsOnly, difficulty });
  const preguntas = deck ? shuffle(deck.data.afirmaciones).slice(0, o.preguntas) : [];
  const entrants = {};
  entrantIds.forEach((id) => { entrants[id] = { points: 0, aciertos: 0, secondsWon: 0, submitted: false }; });
  const state = {
    gameType: type,
    deckId: deck ? deck.id : null,
    theme: deck ? deck.data.theme : null,
    preguntas,
    segundosPorPregunta: o.segundos,
    index: 0,
    orden: 0,
    entrants,
    activeEntrant: null,
    lastFeedback: null,
    finished: !preguntas.length || entrantIds.length < 1
  };
  if (!state.finished) empezarPregunta(state);
  return state;
}

// payload: { verdadero: true | false }
function answer(state, entrantId, payload) {
  if (state.finished) return { error: 'Este juego ya terminó.' };
  if (state.fase !== 'pregunta') return { error: 'Esperá la próxima afirmación.' };
  const e = state.entrants[entrantId];
  if (!e) return { error: 'No estás en este juego.' };
  if (state.respuestas[entrantId]) return { error: 'Tu equipo ya contestó.' };
  const p = payload || {};
  if (typeof p.verdadero !== 'boolean') return { error: '¿Verdadero o falso?' };
  state.orden += 1;
  state.respuestas[entrantId] = { verdadero: p.verdadero, orden: state.orden };
  e.submitted = true;
  if (Object.keys(state.respuestas).length >= Object.keys(state.entrants).length) revelar(state);
  return {};
}

// Anfitrión: pasar a la siguiente sin esperar la revelación.
function judge(state, payload) {
  if (state.finished) return { error: 'Este juego ya terminó.' };
  if (payload && payload.siguiente && state.fase === 'revelar') {
    siguiente(state);
    return {};
  }
  return { error: 'Acción no reconocida.' };
}

function tick(state) {
  if (state.finished) return;
  state.segundos -= 1;
  if (state.segundos > 0) return;
  if (state.fase === 'pregunta') revelar(state);
  else siguiente(state);
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.points]));
}

function carryOver(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.secondsWon]));
}

function publicView(state) {
  const q = state.preguntas[state.index] || null;
  const revelada = state.fase === 'revelar';
  return {
    type,
    label,
    theme: state.theme,
    number: Math.min(state.index + 1, state.preguntas.length),
    total: state.preguntas.length,
    fase: state.fase,
    segundos: Math.max(state.segundos || 0, 0),
    segundosPorPregunta: state.segundosPorPregunta,
    afirmacion: q ? q.texto : null,
    // La respuesta y lo que contestó cada equipo solo viajan al revelar.
    verdadero: revelada && q ? q.verdadero : null,
    dato: revelada && q ? q.dato || null : null,
    respuestas: Object.fromEntries(Object.entries(state.respuestas || {}).map(([id, r]) => [id, revelada ? r : { listo: true }])),
    activeEntrant: null,
    entrants: Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, { points: e.points, aciertos: e.aciertos, secondsWon: 0, submitted: e.submitted }])),
    lastFeedback: state.lastFeedback,
    finished: state.finished
  };
}

module.exports = {
  type, label, estimateSecondsPerRound, simultaneous, skipMemberGate, opciones,
  createRound, answer, judge, tick, scores, carryOver, publicView
};
