// Juego "Palabras Cruzadas" — inspirado en la prueba de crucigrama del programa.
// Hay una palabra base en horizontal y varias palabras que la cruzan en vertical.
// Reparte segundos para el rosco final.
//
// Cada equipo tiene su PROPIO tablero independiente (misma base, mismas
// cruzadas, mismo orden) y lo resuelve por su cuenta, al mismo tiempo que el
// otro equipo -- no comparten el progreso, resolver una cruzada en el
// tablero de un equipo no afecta el del otro. Gana el que termina de
// resolver TODO su tablero en menos tiempo.

const { loadDecks, pickDeck, shuffle, shuffleOptions } = require('../contentLoader');

const type = 'palabras-cruzadas';
const label = 'Palabras Cruzadas';
const estimateSecondsPerRound = 100;
const simultaneous = true; // los dos equipos resuelven su propio tablero al mismo tiempo
const skipMemberGate = true; // cualquiera del equipo puede responder, no solo el de turno

const SEGUNDOS_POR_ACIERTO = 7;

// Bono para el equipo que termina TODO su tablero mas rapido (entre los que
// realmente llegan a terminar).
const SEGUNDOS_BONUS_VELOCIDAD = 15;

// Sin mazos propios por dificultad (no hay contenido "mas dificil" en sí),
// la dificultad ajusta el tiempo maximo para resolver el tablero entero.
const DIFICULTAD_MECANICA = {
  facil: { segundosMax: 150 },
  normal: { segundosMax: 110 },
  dificil: { segundosMax: 80 }
};
function mecanica(difficulty) {
  return DIFICULTAD_MECANICA[difficulty] || DIFICULTAD_MECANICA.normal;
}

const decks = loadDecks('el-rosco', 'palabras-cruzadas');

function createRound({ entrantIds, usedDeckIds = [], region, adultsOnly, difficulty }) {
  const m = mecanica(difficulty);
  const deck = pickDeck(decks, usedDeckIds, { region, adultsOnly, difficulty });
  const board = deck ? shuffle(deck.data.boards)[0] : null;

  // Mismo orden de cruzadas para los dos (mismo desafío, justo), pero cada
  // equipo arma su PROPIA copia con su propio progreso de resuelto/no.
  const crossOrder = board
    ? shuffle(board.crosses).map((c) => ({ ...c, ...shuffleOptions(c) }))
    : [];

  const entrants = {};
  entrantIds.forEach((id) => {
    entrants[id] = {
      crosses: crossOrder.map((c) => ({ ...c, solved: false })),
      index: 0,
      secondsWon: 0,
      finished: false,
      finishSeconds: null // segundos transcurridos cuando termino TODO su tablero; null si no llego
    };
  });

  return {
    gameType: type,
    deckId: deck ? deck.id : null,
    theme: deck ? deck.data.theme : null,
    topic: board ? board.topic : null,
    base: board ? board.base : null,
    totalCrosses: crossOrder.length,
    secondsElapsed: 0,
    maxSeconds: m.segundosMax,
    entrants,
    lastFeedback: null,
    finished: entrantIds.length < 1 || crossOrder.length === 0,
    simultaneous
  };
}

// Corre el reloj general. Si se acaba el tiempo maximo, los equipos que no
// llegaron a terminar quedan asi (sin bonus de velocidad) y se cierra la prueba.
function tick(state) {
  if (state.finished) return;
  state.secondsElapsed += 1;
  if (state.secondsElapsed >= state.maxSeconds) {
    Object.values(state.entrants).forEach((e) => { e.finished = true; });
    state.finished = true;
  }
}

function answer(state, entrantId, optionIndex) {
  if (state.finished) return { error: 'Este juego ya termino.' };
  const entrant = state.entrants[entrantId];
  if (!entrant) return { error: 'Tu equipo no está en esta partida.' };
  if (entrant.finished) return { error: 'Tu equipo ya terminó su tablero.' };

  const cross = entrant.crosses[entrant.index];
  if (!cross) return { error: 'No hay palabra activa.' };

  const isCorrect = optionIndex === cross.correctIndex;
  if (isCorrect) {
    cross.solved = true;
    entrant.secondsWon += SEGUNDOS_POR_ACIERTO;
  }
  state.lastFeedback = {
    entrantId,
    result: isCorrect ? 'correct' : 'wrong',
    correctOption: cross.options[cross.correctIndex]
  };

  entrant.index += 1;
  if (entrant.index >= entrant.crosses.length) {
    entrant.finished = true;
    entrant.finishSeconds = state.secondsElapsed;
    if (Object.values(state.entrants).every((e) => e.finished)) state.finished = true;
  }
  return {};
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.entrants)
    .map(([id, e]) => [id, e.crosses.filter((c) => c.solved).length]));
}

// Segundos ganados: los de cada acierto, mas un bono extra para el equipo
// mas rapido en terminar todo el tablero.
function carryOver(state) {
  let mejorTiempo = null;
  let mejorEntrant = null;
  Object.entries(state.entrants).forEach(([id, e]) => {
    if (e.finishSeconds !== null && (mejorTiempo === null || e.finishSeconds < mejorTiempo)) {
      mejorTiempo = e.finishSeconds;
      mejorEntrant = id;
    }
  });

  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => {
    const segundos = e.secondsWon + (id === mejorEntrant ? SEGUNDOS_BONUS_VELOCIDAD : 0);
    return [id, segundos];
  }));
}

function publicView(state) {
  return {
    type,
    label,
    simultaneous,
    theme: state.theme,
    topic: state.topic,
    base: state.base,
    totalCrosses: state.totalCrosses,
    secondsElapsed: state.secondsElapsed,
    maxSeconds: state.maxSeconds,
    entrants: Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, {
      // Se dibuja en el tablero solo cuando ya fue resuelta.
      crosses: e.crosses.map((c, i) => ({
        clue: c.clue,
        baseIndex: c.baseIndex,
        wordIndex: c.wordIndex,
        length: c.word.length,
        solved: c.solved,
        word: c.solved ? c.word : null,
        isCurrent: i === e.index
      })),
      number: Math.min(e.index + 1, state.totalCrosses || 1),
      question: !e.finished && e.crosses[e.index]
        ? { clue: e.crosses[e.index].clue, options: e.crosses[e.index].options }
        : null,
      secondsWon: e.secondsWon,
      finished: e.finished,
      finishSeconds: e.finishSeconds
    }])),
    lastFeedback: state.lastFeedback,
    finished: state.finished,
    secondsPerHit: SEGUNDOS_POR_ACIERTO,
    speedBonusSeconds: SEGUNDOS_BONUS_VELOCIDAD
  };
}

module.exports = {
  type, label, estimateSecondsPerRound, simultaneous, skipMemberGate,
  createRound, answer, tick, scores, carryOver, publicView
};
