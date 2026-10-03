// Juego "¿Donde Estaba?" — inspirado en la prueba de memoria del programa.
// Se muestra un panel de 9 casillas con palabras de un mismo tema durante unos
// segundos; despues las casillas se tapan y hay que recordar donde estaba cada
// palabra. Reparte segundos para el rosco final.

const { loadDecks, pickDeck, shuffle } = require('../contentLoader');

const type = 'donde-estaba';
const label = '¿Dónde Estaba?';
const estimateSecondsPerRound = 90;

const SEGUNDOS_POR_ACIERTO = 6;
const PREGUNTAS_POR_RONDA = 6;

// Sin mazos propios por dificultad, lo que cambia es cuanto tiempo hay para
// memorizar el panel antes de que se tape.
const SEGUNDOS_MEMORIZANDO = { facil: 12, normal: 8, dificil: 5 };
function segundosMemorizando(difficulty) {
  return SEGUNDOS_MEMORIZANDO[difficulty] || SEGUNDOS_MEMORIZANDO.normal;
}

const decks = loadDecks('el-rosco', 'donde-estaba');

function createRound({ entrantIds, usedDeckIds = [], region, adultsOnly, difficulty }) {
  const deck = pickDeck(decks, usedDeckIds, { region, adultsOnly, difficulty });
  const panel = deck ? shuffle(deck.data.panels)[0] : null;
  // Cada casilla es una imagen (emoji + su nombre), no una palabra suelta.
  const items = panel ? shuffle(panel.items).slice(0, 9) : [];

  // El orden de preguntas: que casilla se pide en cada turno.
  const asks = shuffle(items.map((it, i) => ({ item: it, cell: i }))).slice(0, PREGUNTAS_POR_RONDA);

  const entrants = {};
  entrantIds.forEach((id) => { entrants[id] = { correct: 0, secondsWon: 0 }; });

  return {
    gameType: type,
    deckId: deck ? deck.id : null,
    theme: deck ? deck.data.theme : null,
    topic: panel ? panel.topic : null,
    items,
    asks,
    index: 0,
    revealSecondsLeft: segundosMemorizando(difficulty),
    revealMaxSeconds: segundosMemorizando(difficulty),
    entrants,
    activeEntrant: entrantIds[0] || null,
    lastFeedback: null,
    finished: false
  };
}

// Mientras dura la fase de memorizar, el panel se ve. Despues se tapa.
function tick(state) {
  if (state.finished) return;
  if (state.revealSecondsLeft > 0) state.revealSecondsLeft -= 1;
}

function passTurn(state) {
  const ids = Object.keys(state.entrants);
  const i = ids.indexOf(state.activeEntrant);
  state.activeEntrant = ids[(i + 1) % ids.length];
}

// La "respuesta" es el numero de casilla que el equipo elige (0 a 8).
function answer(state, entrantId, cellIndex) {
  if (state.finished) return { error: 'Este juego ya termino.' };
  if (state.revealSecondsLeft > 0) return { error: 'Todavia estan memorizando el panel.' };
  if (entrantId !== state.activeEntrant) return { error: 'No es el turno de tu equipo.' };

  const ask = state.asks[state.index];
  if (!ask) return { error: 'No hay pregunta activa.' };

  const isCorrect = cellIndex === ask.cell;
  const entrant = state.entrants[entrantId];
  if (isCorrect) {
    entrant.correct += 1;
    entrant.secondsWon += SEGUNDOS_POR_ACIERTO;
  }
  state.lastFeedback = {
    entrantId,
    result: isCorrect ? 'correct' : 'wrong',
    correctCell: ask.cell,
    item: ask.item,
    secondsWon: isCorrect ? SEGUNDOS_POR_ACIERTO : 0
  };

  state.index += 1;
  passTurn(state); // alterna siempre, para que memoricen todos por igual
  if (state.index >= state.asks.length) state.finished = true;
  return {};
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.correct]));
}

function carryOver(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.secondsWon]));
}

function publicView(state) {
  const memorizando = state.revealSecondsLeft > 0;
  const ask = state.asks[state.index] || null;
  return {
    type,
    label,
    theme: state.theme,
    topic: state.topic,
    // Las imagenes solo viajan mientras se estan memorizando o al terminar.
    items: memorizando || state.finished ? state.items : null,
    memorizando,
    revealSecondsLeft: state.revealSecondsLeft,
    revealMaxSeconds: state.revealMaxSeconds,
    askItem: !memorizando && ask ? ask.item : null,
    number: Math.min(state.index + 1, state.asks.length),
    total: state.asks.length,
    entrants: Object.fromEntries(Object.entries(state.entrants)
      .map(([id, e]) => [id, { correct: e.correct, secondsWon: e.secondsWon }])),
    activeEntrant: state.activeEntrant,
    lastFeedback: state.lastFeedback,
    finished: state.finished,
    secondsPerHit: SEGUNDOS_POR_ACIERTO
  };
}

module.exports = { type, label, estimateSecondsPerRound, createRound, answer, tick, scores, carryOver, publicView };
