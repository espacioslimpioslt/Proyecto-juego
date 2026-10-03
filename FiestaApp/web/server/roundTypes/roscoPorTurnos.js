// Tipo de ronda: el rosco por turnos, como en el programa real.
//
// Reglas que respeta:
// - Cada equipo tiene su propio banco de tiempo, que corre SOLO cuando es su turno.
// - Acierto: suma punto y sigue jugando (mantiene el turno).
// - Error: se marca en rojo y el turno pasa al otro equipo.
// - Pasapalabra: la letra queda pendiente para despues y el turno pasa.
// - Cuando a un equipo se le acaba el tiempo, queda afuera; el otro sigue solo.
// - El tiempo que sobra se ARRASTRA a los siguientes juegos del Programa: asi
//   funciona el programa real, donde se llega al rosco con el tiempo ganado antes.

const { loadDecks, pickDeck, shuffleOptions } = require('../contentLoader');

const type = 'rosco-por-turnos';
const label = 'El Rosco';

// Un rosco completo es un juego largo, no una pregunta suelta.
const estimateSecondsPerRound = 150;

// Tiempo base que recibe cada equipo al empezar un rosco.
// En el programa real el tiempo se GANA en las pruebas anteriores del Programa y
// se gasta aca. Este base existe para cuando el rosco se juega suelto (Modo Azar
// o Juegos Varios), donde no hay juegos previos de los que arrastrar tiempo.
const BASE_TIME_SECONDS = 75;

const decks = loadDecks('el-rosco', 'rosco');

function availableThemes() {
  return decks.map((d) => ({ id: d.id, theme: d.theme, regions: d.regions, minAge: d.minAge }));
}

// Crea el estado de un rosco nuevo.
// - `carryOver`: tiempo que cada equipo se gano en juegos anteriores del Programa.
// - `baseTimeSeconds`: tiempo base configurado por el anfitrion. Importa sobre todo
//   cuando el rosco se juega suelto (Modo Azar / Juegos Varios), donde no hay
//   juegos previos de los que arrastrar tiempo.
// - `usedDeckIds`: temas que ya salieron en esta partida, para no repetirlos.
function createRound({ entrantIds, carryOver = {}, baseTimeSeconds = BASE_TIME_SECONDS, usedDeckIds = [], region, adultsOnly, difficulty }) {
  const deck = pickDeck(decks, usedDeckIds, { region, adultsOnly, difficulty });
  const letters = deck ? deck.data.letters : [];
  const shuffled = letters.map((item) => ({ ...item, ...shuffleOptions(item) }));

  const entrants = {};
  entrantIds.forEach((id) => {
    entrants[id] = {
      timeLeft: baseTimeSeconds + (carryOver[id] || 0),
      results: Object.fromEntries(letters.map((item) => [item.letter, 'pending'])),
      position: 0,
      out: false
    };
  });

  return {
    deckId: deck ? deck.id : null,
    theme: deck ? deck.data.theme : null,
    letters: shuffled.map(({ letter, clueType, clue, options }) => ({ letter, clueType, clue, options })),
    solutions: shuffled.map((item) => item.correctIndex),
    entrants,
    activeEntrant: entrantIds[0] || null,
    lastFeedback: null, // { entrantId, letter, result }
    finished: false
  };
}

function activeState(state) {
  return state.entrants[state.activeEntrant];
}

// Busca la proxima letra pendiente de ese equipo, arrancando despues de `from`.
// Da la vuelta al rosco -- por eso "pasapalabra" funciona: la letra vuelve luego.
function nextPendingPosition(state, entrant, from) {
  const total = state.letters.length;
  for (let step = 1; step <= total; step++) {
    const idx = (from + step) % total;
    if (entrant.results[state.letters[idx].letter] === 'pending') return idx;
  }
  return -1;
}

function letterAt(state, position) {
  return state.letters[position];
}

// Pasa el turno al siguiente equipo que siga con tiempo y letras pendientes.
function passTurn(state) {
  const ids = Object.keys(state.entrants);
  const startIdx = ids.indexOf(state.activeEntrant);
  for (let step = 1; step <= ids.length; step++) {
    const candidate = ids[(startIdx + step) % ids.length];
    const entrant = state.entrants[candidate];
    if (!entrant.out && entrant.position !== -1) {
      state.activeEntrant = candidate;
      return;
    }
  }
  state.finished = true;
}

function checkFinished(state) {
  const someoneCanPlay = Object.values(state.entrants).some((e) => !e.out && e.position !== -1);
  if (!someoneCanPlay) state.finished = true;
  return state.finished;
}

// Respuesta de opcion multiple sobre la letra actual del equipo activo.
function answer(state, entrantId, optionIndex) {
  if (state.finished) return { error: 'El rosco ya termino.' };
  if (entrantId !== state.activeEntrant) return { error: 'No es el turno de tu equipo.' };
  const entrant = activeState(state);
  if (entrant.out || entrant.position === -1) return { error: 'Tu equipo ya no puede jugar este rosco.' };

  const item = letterAt(state, entrant.position);
  const isCorrect = state.solutions[entrant.position] === optionIndex;
  entrant.results[item.letter] = isCorrect ? 'correct' : 'wrong';
  state.lastFeedback = { entrantId, letter: item.letter, result: isCorrect ? 'correct' : 'wrong' };

  entrant.position = nextPendingPosition(state, entrant, entrant.position);

  // Acierto = sigue jugando el mismo equipo. Error = pasa el turno.
  if (!isCorrect) passTurn(state);
  else if (entrant.position === -1) passTurn(state); // completo su rosco

  checkFinished(state);
  return {};
}

function pasapalabra(state, entrantId) {
  if (state.finished) return { error: 'El rosco ya termino.' };
  if (entrantId !== state.activeEntrant) return { error: 'No es el turno de tu equipo.' };
  const entrant = activeState(state);
  if (entrant.out || entrant.position === -1) return { error: 'Tu equipo ya no puede jugar este rosco.' };
  const item = letterAt(state, entrant.position);
  state.lastFeedback = { entrantId, letter: item.letter, result: 'passed' };

  entrant.position = nextPendingPosition(state, entrant, entrant.position);
  passTurn(state);
  checkFinished(state);
  return {};
}

// Se llama una vez por segundo desde el motor: descuenta del equipo activo.
function tick(state) {
  if (state.finished || !state.activeEntrant) return;
  const entrant = activeState(state);
  if (!entrant || entrant.out) return;

  entrant.timeLeft -= 1;
  if (entrant.timeLeft <= 0) {
    entrant.timeLeft = 0;
    entrant.out = true;
    state.lastFeedback = { entrantId: state.activeEntrant, result: 'timeout' };
    passTurn(state);
    checkFinished(state);
  }
}

function scores(state) {
  const result = {};
  Object.entries(state.entrants).forEach(([id, entrant]) => {
    result[id] = Object.values(entrant.results).filter((r) => r === 'correct').length;
  });
  return result;
}

// Tiempo sobrante que se arrastra al proximo juego del Programa.
function carryOver(state) {
  const result = {};
  Object.entries(state.entrants).forEach(([id, entrant]) => {
    result[id] = entrant.timeLeft;
  });
  return result;
}

// Vista que se manda a los clientes. Mientras se juega no viaja la respuesta
// correcta; al terminar el rosco si, para poder mostrar el repaso.
function publicView(state) {
  const entrant = state.activeEntrant ? state.entrants[state.activeEntrant] : null;
  const currentLetter = entrant && entrant.position !== -1 ? state.letters[entrant.position] : null;

  return {
    type,
    label,
    theme: state.theme,
    letters: state.letters.map((l) => l.letter),
    entrants: Object.fromEntries(
      Object.entries(state.entrants).map(([id, e]) => [id, {
        timeLeft: e.timeLeft,
        results: e.results,
        out: e.out,
        done: e.position === -1
      }])
    ),
    activeEntrant: state.activeEntrant,
    currentLetter,
    lastFeedback: state.lastFeedback,
    finished: state.finished,
    solutions: state.finished ? state.solutions.map((idx, i) => state.letters[i].options[idx]) : null
  };
}

module.exports = {
  type,
  label,
  estimateSecondsPerRound,
  BASE_TIME_SECONDS,
  availableThemes,
  createRound,
  answer,
  pasapalabra,
  tick,
  scores,
  carryOver,
  publicView
};
