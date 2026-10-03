// Juego "Elegi Una" — inspirado en la prueba de preguntas con cuatro opciones.
// Es una de las pruebas que REPARTE segundos: cada acierto suma tiempo que
// despues se gasta en el rosco final.
//
// Cada equipo juega su PROPIA tanda de 10 preguntas (no la misma tanda
// compartida): si compartieran una sola, el primer equipo que la juega
// entera se queda con las 10 y el otro directamente no llega a jugar. Cada
// equipo responde sus 10 propias, rotando quién contesta (motor común de
// turnos, como los demás juegos), acierte o no. Gana el que más acertó.

const { loadDecks, pickDeck, shuffle, shuffleOptions } = require('../contentLoader');

const type = 'eligi-una';
const label = 'Elegí Una';
const estimateSecondsPerRound = 90;

const SEGUNDOS_POR_ACIERTO = 5;
const PREGUNTAS_POR_EQUIPO = 10;

const decks = loadDecks('el-rosco', 'eligi-una');

function createRound({ entrantIds, usedDeckIds = [], region, adultsOnly, difficulty }) {
  const deck = pickDeck(decks, usedDeckIds, { region, adultsOnly, difficulty });
  const pool = deck ? shuffle(deck.data.questions) : [];

  // Recorte disjunto por equipo: el equipo 0 se lleva el primer bloque del
  // mazo mezclado, el equipo 1 el siguiente, etc. -- nunca se pisan.
  const questionsByTeam = {};
  entrantIds.forEach((id, i) => {
    const start = i * PREGUNTAS_POR_EQUIPO;
    questionsByTeam[id] = pool.slice(start, start + PREGUNTAS_POR_EQUIPO).map((q) => ({ ...q, ...shuffleOptions(q) }));
  });

  const entrants = {};
  entrantIds.forEach((id) => { entrants[id] = { correct: 0, secondsWon: 0, done: false }; });

  const order = [...entrantIds];

  return {
    gameType: type,
    deckId: deck ? deck.id : null,
    theme: deck ? deck.data.theme : null,
    questionsByTeam,
    order,
    attemptIndex: 0,
    step: 0, // pregunta actual dentro de la tanda del equipo activo (0-based)
    entrants,
    activeEntrant: order[0] || null,
    lastFeedback: null,
    finished: false
  };
}

// Termina la tanda del equipo activo (ya respondió sus 10) y pasa al
// siguiente equipo, o termina el juego si ya jugaron todos.
function endAttempt(state) {
  const entrant = state.entrants[state.activeEntrant];
  if (entrant) entrant.done = true;

  state.attemptIndex += 1;
  if (state.attemptIndex >= state.order.length) {
    state.finished = true;
    return;
  }
  state.activeEntrant = state.order[state.attemptIndex];
  state.step = 0;
}

function answer(state, entrantId, optionIndex) {
  if (state.finished) return { error: 'Este juego ya termino.' };
  if (entrantId !== state.activeEntrant) return { error: 'No es el turno de tu equipo.' };

  const misPreguntas = state.questionsByTeam[state.activeEntrant] || [];
  const q = misPreguntas[state.step];
  if (!q) return { error: 'No hay pregunta activa.' };

  const isCorrect = optionIndex === q.correctIndex;
  const entrant = state.entrants[entrantId];
  if (isCorrect) {
    entrant.correct += 1;
    entrant.secondsWon += SEGUNDOS_POR_ACIERTO;
  }
  state.lastFeedback = {
    entrantId,
    result: isCorrect ? 'correct' : 'wrong',
    correctOption: q.options[q.correctIndex],
    secondsWon: isCorrect ? SEGUNDOS_POR_ACIERTO : 0
  };

  state.step += 1;
  if (state.step >= misPreguntas.length) endAttempt(state); // agotó su propia tanda
  return {};
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.correct]));
}

// Lo que este juego aporta al rosco final: los segundos ganados.
function carryOver(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.secondsWon]));
}

function publicView(state) {
  const misPreguntas = state.questionsByTeam[state.activeEntrant] || [];
  const q = misPreguntas[state.step] || null;
  return {
    type,
    label,
    theme: state.theme,
    total: misPreguntas.length,
    number: Math.min(state.step + 1, misPreguntas.length || 1),
    question: q ? { clue: q.clue, options: q.options } : null,
    entrants: Object.fromEntries(Object.entries(state.entrants)
      .map(([id, e]) => [id, { correct: e.correct, secondsWon: e.secondsWon, done: e.done }])),
    activeEntrant: state.activeEntrant,
    lastFeedback: state.lastFeedback,
    finished: state.finished,
    secondsPerHit: SEGUNDOS_POR_ACIERTO
  };
}

module.exports = { type, label, estimateSecondsPerRound, createRound, answer, scores, carryOver, publicView };
