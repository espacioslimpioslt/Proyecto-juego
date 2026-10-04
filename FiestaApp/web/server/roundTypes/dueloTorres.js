// Juego "Duelo de Torres" — inspirado en los duelos 1 a 1 del programa: un
// "campeón" defiende su torre contra un "retador", con preguntas de opción
// múltiple que se alternan entre los dos; el primero que se equivoca "cae" y
// pierde la torre. Adaptado a 2 equipos: el equipo que gana un duelo queda
// de campeón (con el MISMO integrante, que sigue defendiendo) y el que
// pierde manda al SIGUIENTE integrante de su equipo a retar la próxima vez —
// así, dentro de un mismo equipo, todos van pasando por el rol de retador.
//
// Se juegan varios duelos seguidos (según la dificultad) con el mismo mazo de
// preguntas; cada torre ganada reparte segundos para la Escalera Final.

const { loadDecks, pickDeck, shuffle, shuffleOptions } = require('../contentLoader');
const { resolver } = require('../opciones');

const type = 'duelo-torres';
const label = 'Duelo de Torres';
const estimateSecondsPerRound = 100;
const skipMemberGate = true; // el motor de turnos comun no aplica: acá hay un campeón fijo y un retador fijo, no "el que sigue en la lista"

const SEGUNDOS_POR_TORRE = 8;

const decks = loadDecks('ahora-caigo', 'duelo-torres');

function pickDuelist(state, team) {
  const roster = state.rosters[team] || [];
  if (!roster.length) return null;
  const idx = (state.rotIndex[team] || 0) % roster.length;
  return roster[idx];
}

function advanceDuelist(state, team) {
  state.rotIndex[team] = (state.rotIndex[team] || 0) + 1;
}

// Si se acaba la cola de preguntas, se reparte de nuevo (mismo mazo
// mezclado) en vez de cortar el duelo -- un duelo termina SOLO cuando
// alguien se equivoca, nunca porque se acabaron las preguntas.
function nextQuestion(state) {
  if (!state.queue.length) {
    if (!state.pool.length) return null;
    state.queue = shuffle(state.pool);
  }
  return state.queue.shift();
}

// Arranca un duelo nuevo entre el campeón vigente y el retador vigente de
// cada equipo (sin avanzar sus índices: eso solo pasa cuando alguien pierde).
function beginDuelo(state) {
  if (state.dueloIndex >= state.totalDuelos) { state.finished = true; return; }

  const campeon = pickDuelist(state, state.campeonTeam);
  const retador = pickDuelist(state, state.retadorTeam);
  state.campeonId = campeon ? campeon.id : null;
  state.campeonName = campeon ? campeon.name : null;
  state.retadorId = retador ? retador.id : null;
  state.retadorName = retador ? retador.name : null;
  state.turnoDe = 'campeon'; // el campeón defiende primero cada duelo
  state.activeEntrant = state.campeonTeam;
  state.currentQuestion = nextQuestion(state);
  state.phase = 'duelo';
}

// Ajustes que el anfitrión puede elegir en la sala (ver server/opciones.js).
// Si no elige, cada uno sale de la dificultad.
const opciones = [
  { id: 'duelos', label: 'Cantidad de duelos', valores: [[3, '3'], [4, '4'], [5, '5'], [6, '6']], porDificultad: { facil: 3, normal: 4, dificil: 5 } }
];

function createRound({ entrantIds, rosters = {}, usedDeckIds = [], region, adultsOnly, difficulty, opciones: elegidas }) {
  const o = resolver(opciones, elegidas, difficulty);
  const m = { duelos: o.duelos };
  const deck = pickDeck(decks, usedDeckIds, { region, adultsOnly, difficulty });
  // Opciones mezcladas: si no, la correcta queda siempre en el mismo lugar.
  const pool = deck ? shuffle(deck.data.questions).map((q) => ({ ...q, ...shuffleOptions(q) })) : [];

  const entrants = {};
  entrantIds.forEach((id) => { entrants[id] = { torres: 0, secondsWon: 0 }; });

  const state = {
    gameType: type,
    deckId: deck ? deck.id : null,
    theme: deck ? deck.data.theme : null,
    rosters,
    rotIndex: {},
    totalDuelos: m.duelos,
    dueloIndex: 0,
    pool,
    queue: [...pool],
    campeonTeam: entrantIds[0] || null,
    retadorTeam: entrantIds.find((id) => id !== entrantIds[0]) || entrantIds[0] || null,
    campeonId: null,
    campeonName: null,
    retadorId: null,
    retadorName: null,
    turnoDe: null,
    activeEntrant: null,
    currentQuestion: null,
    entrants,
    lastFeedback: null,
    finished: entrantIds.length < 2 || !pool.length
  };

  if (!state.finished) beginDuelo(state);
  return state;
}

// optionIndex: la opción que eligió quien le toca responder en este momento
// (campeón o retador, según turnoDe). playerId identifica a la persona real
// que mandó la respuesta -- solo vale si es justo quien está en el duelo.
function answer(state, entrantId, optionIndex, playerId, isTestHost) {
  if (state.finished) return { error: 'Este juego ya termino.' };
  if (state.phase !== 'duelo' || !state.currentQuestion) return { error: 'No hay una pregunta activa.' };

  const esCampeonTurno = state.turnoDe === 'campeon';
  const equipoEsperado = esCampeonTurno ? state.campeonTeam : state.retadorTeam;
  const idEsperado = esCampeonTurno ? state.campeonId : state.retadorId;
  const nombreEsperado = esCampeonTurno ? state.campeonName : state.retadorName;

  if (entrantId !== equipoEsperado) return { error: 'No es el turno de tu equipo en este duelo.' };
  if (!isTestHost && playerId !== idEsperado) return { error: `Le toca responder a ${nombreEsperado}.` };

  const q = state.currentQuestion;
  const isCorrect = optionIndex === q.correctIndex;

  if (isCorrect) {
    state.lastFeedback = {
      result: 'correct', entrantId, duelista: nombreEsperado, correctOption: q.options[q.correctIndex]
    };
    // Sigue el mismo duelo: le toca responder al otro lado.
    state.turnoDe = esCampeonTurno ? 'retador' : 'campeon';
    state.activeEntrant = esCampeonTurno ? state.retadorTeam : state.campeonTeam;
    state.currentQuestion = nextQuestion(state);
    return {};
  }

  // Cae quien respondió mal -- el otro se queda (o se corona) campeón.
  const equipoQueCae = equipoEsperado;
  const equipoQueGana = equipoQueCae === state.campeonTeam ? state.retadorTeam : state.campeonTeam;
  state.entrants[equipoQueGana].torres += 1;
  state.entrants[equipoQueGana].secondsWon += SEGUNDOS_POR_TORRE;
  state.lastFeedback = {
    result: 'wrong', entrantId: equipoQueCae, ganador: equipoQueGana,
    duelista: nombreEsperado, correctOption: q.options[q.correctIndex]
  };

  // El equipo que cayó manda a su SIGUIENTE integrante la próxima vez.
  advanceDuelist(state, equipoQueCae);
  state.campeonTeam = equipoQueGana;
  state.retadorTeam = equipoQueCae;

  state.dueloIndex += 1;
  if (state.dueloIndex >= state.totalDuelos) state.finished = true;
  else beginDuelo(state);
  return {};
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.torres]));
}

function carryOver(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.secondsWon]));
}

function publicView(state) {
  return {
    type,
    label,
    theme: state.theme,
    total: state.totalDuelos,
    number: Math.min(state.dueloIndex + 1, state.totalDuelos || 1),
    phase: state.phase,
    campeonTeam: state.campeonTeam,
    campeonId: state.campeonId,
    campeonName: state.campeonName,
    retadorTeam: state.retadorTeam,
    retadorId: state.retadorId,
    retadorName: state.retadorName,
    turnoDe: state.turnoDe,
    activeEntrant: state.activeEntrant,
    question: state.currentQuestion ? { clue: state.currentQuestion.clue, options: state.currentQuestion.options } : null,
    entrants: Object.fromEntries(Object.entries(state.entrants)
      .map(([id, e]) => [id, { torres: e.torres, secondsWon: e.secondsWon }])),
    lastFeedback: state.lastFeedback,
    finished: state.finished,
    secondsPerTorre: SEGUNDOS_POR_TORRE
  };
}

// Cambio quien esta disponible (alguien se desconecto o se fue). Si justo
// era el campeon o el retador, lo reemplaza el siguiente de su equipo -- si
// no, el duelo esperaria para siempre a alguien que no esta.
function onRosterChange(state, rosters) {
  state.rosters = rosters;
  if (state.finished || state.phase !== 'duelo') return;
  const sigue = (team, id) => (rosters[team] || []).some((p) => p.id === id);
  if (!sigue(state.campeonTeam, state.campeonId)) {
    const c = pickDuelist(state, state.campeonTeam);
    state.campeonId = c ? c.id : null;
    state.campeonName = c ? c.name : null;
  }
  if (!sigue(state.retadorTeam, state.retadorId)) {
    const r = pickDuelist(state, state.retadorTeam);
    state.retadorId = r ? r.id : null;
    state.retadorName = r ? r.name : null;
  }
}

// Reloj para responder (lo maneja el motor, si el anfitrión lo activó): si
// se acaba el tiempo del turno, cuenta como respuesta equivocada y sigue.
function turnoEnEspera(state) {
  return !state.finished && state.phase === 'duelo' && !!state.currentQuestion;
}

function alVencerTurno(state) {
  if (!turnoEnEspera(state)) return;
  const esCampeon = state.turnoDe === 'campeon';
  answer(state, esCampeon ? state.campeonTeam : state.retadorTeam, -1, esCampeon ? state.campeonId : state.retadorId, true);
}

module.exports = {
  type, label, estimateSecondsPerRound, skipMemberGate,
  opciones, createRound, alVencerTurno, turnoEnEspera, answer, onRosterChange, scores, carryOver, publicView
};
