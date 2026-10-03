// Juego "La Silla" — inspirado en la prueba de la silla del programa.
// Una tanda de 5 preguntas cuyas respuestas empiezan todas con la misma letra.
// Se juega de a un equipo por vez; con DOS errores la tanda se corta.
// Reparte segundos para el rosco final.

const { loadDecks, pickDeck, shuffle, shuffleOptions } = require('../contentLoader');
const { resolver } = require('../opciones');

const type = 'la-silla';
const label = 'La Silla';
const estimateSecondsPerRound = 90;

const SEGUNDOS_POR_ACIERTO = 6;

const decks = loadDecks('el-rosco', 'la-silla');

function buildChain(chain) {
  return {
    letter: chain.letter,
    questions: shuffle(chain.questions).map((q) => ({ ...q, ...shuffleOptions(q) }))
  };
}

// Ajustes que el anfitrión puede elegir en la sala (ver server/opciones.js).
// Si no elige, cada uno sale de la dificultad.
const opciones = [
  { id: 'vidas', label: 'Errores permitidos', valores: [[1, '1 (muerte súbita)'], [2, '2'], [3, '3']], porDificultad: { facil: 3, normal: 2, dificil: 1 } }
];

function createRound({ entrantIds, usedDeckIds = [], region, adultsOnly, difficulty, opciones: elegidas }) {
  const o = resolver(opciones, elegidas, difficulty);
  const deck = pickDeck(decks, usedDeckIds, { region, adultsOnly, difficulty });
  const chains = deck ? shuffle(deck.data.chains) : [];

  const entrants = {};
  entrantIds.forEach((id, i) => {
    entrants[id] = {
      correct: 0,
      secondsWon: 0,
      errors: 0,
      index: 0,
      chain: chains[i % Math.max(chains.length, 1)] ? buildChain(chains[i % chains.length]) : null,
      done: false
    };
  });

  return {
    gameType: type,
    deckId: deck ? deck.id : null,
    theme: deck ? deck.data.theme : null,
    entrants,
    activeEntrant: entrantIds[0] || null,
    erroresPermitidos: o.vidas,
    lastFeedback: null,
    finished: false
  };
}

// Pasa al siguiente equipo que todavia tenga tanda por jugar.
function passTurn(state) {
  const ids = Object.keys(state.entrants);
  const start = ids.indexOf(state.activeEntrant);
  for (let step = 1; step <= ids.length; step++) {
    const candidate = ids[(start + step) % ids.length];
    if (!state.entrants[candidate].done) {
      state.activeEntrant = candidate;
      return;
    }
  }
  state.finished = true;
}

function checkFinished(state) {
  if (Object.values(state.entrants).every((e) => e.done)) state.finished = true;
}

function answer(state, entrantId, optionIndex) {
  if (state.finished) return { error: 'Este juego ya termino.' };
  if (entrantId !== state.activeEntrant) return { error: 'No es el turno de tu equipo.' };

  const entrant = state.entrants[entrantId];
  if (entrant.done || !entrant.chain) return { error: 'Tu equipo ya termino su tanda.' };

  const q = entrant.chain.questions[entrant.index];
  if (!q) return { error: 'No hay pregunta activa.' };

  const isCorrect = optionIndex === q.correctIndex;
  if (isCorrect) {
    entrant.correct += 1;
    entrant.secondsWon += SEGUNDOS_POR_ACIERTO;
  } else {
    entrant.errors += 1;
  }
  state.lastFeedback = {
    entrantId,
    result: isCorrect ? 'correct' : 'wrong',
    correctOption: q.options[q.correctIndex],
    secondsWon: isCorrect ? SEGUNDOS_POR_ACIERTO : 0
  };

  entrant.index += 1;
  // Se corta la tanda por dos errores o por completar las 5 preguntas.
  if (entrant.errors >= state.erroresPermitidos || entrant.index >= entrant.chain.questions.length) {
    entrant.done = true;
    passTurn(state);
  }
  checkFinished(state);
  return {};
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.correct]));
}

function carryOver(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.secondsWon]));
}

function publicView(state) {
  const active = state.entrants[state.activeEntrant];
  const q = active && active.chain && !active.done ? active.chain.questions[active.index] : null;
  return {
    type,
    label,
    theme: state.theme,
    letter: active && active.chain ? active.chain.letter : null,
    number: active ? active.index + 1 : 0,
    total: active && active.chain ? active.chain.questions.length : 0,
    question: q ? { clue: q.clue, options: q.options } : null,
    entrants: Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, {
      correct: e.correct,
      secondsWon: e.secondsWon,
      errors: e.errors,
      done: e.done,
      letter: e.chain ? e.chain.letter : null
    }])),
    activeEntrant: state.activeEntrant,
    lastFeedback: state.lastFeedback,
    finished: state.finished,
    erroresPermitidos: state.erroresPermitidos,
    secondsPerHit: SEGUNDOS_POR_ACIERTO
  };
}

// Reloj para responder (lo maneja el motor, si el anfitrión lo activó): si
// se acaba el tiempo del turno, cuenta como respuesta equivocada y sigue.
function turnoEnEspera(state) {
  return !state.finished;
}

function alVencerTurno(state) {
  if (!turnoEnEspera(state)) return;
  answer(state, state.activeEntrant, -1);
}

module.exports = { type, label, estimateSecondsPerRound, opciones, createRound, alVencerTurno, turnoEnEspera, answer, scores, carryOver, publicView };
