// Prueba final "Escalera Final" — inspirada en la escalera de premios del
// programa: se sube escalón a escalón respondiendo preguntas de opción
// múltiple. Si te equivocás, "caés" y volvés al último escalón que hayas
// plantado (0 si nunca plantaste) -- se pierde todo lo arriesgado desde ahí.
// En cualquier momento podés plantarte: el escalón alcanzado queda a salvo
// para siempre, pero dejás de subir.
//
// Cada equipo tiene su PROPIO reloj (el tiempo que se ganó en los duelos
// previos) y solo corre mientras es su turno -- misma mecánica que el Rosco:
// acierto sigue el mismo equipo, error o plantada pasa el turno al otro.

const { loadDecks, pickDeck, shuffleOptions } = require('../contentLoader');
const { resolver } = require('../opciones');

const type = 'escalera-final';
const label = 'Escalera Final';
const estimateSecondsPerRound = 150;

// Tiempo base por equipo si se juega suelta, sin duelos previos de los que
// arrastrar segundos (mismo rol que BASE_TIME_SECONDS en el rosco).
const BASE_TIME_SECONDS = 60;

const decks = loadDecks('ahora-caigo', 'escalera-final');

// Ajustes que el anfitrión puede elegir en la sala (ver server/opciones.js).
// Si no elige, cada uno sale de la dificultad.
const opciones = [
  { id: 'escalones', label: 'Escalones', valores: [[6, '6'], [8, '8'], [10, '10']], porDefecto: 10 }
];

function createRound({ entrantIds, carryOver = {}, baseTimeSeconds = BASE_TIME_SECONDS, usedDeckIds = [], region, adultsOnly, difficulty, opciones: elegidas }) {
  const o = resolver(opciones, elegidas, difficulty);
  const TOTAL_ESCALONES = o.escalones;
  const deck = pickDeck(decks, usedDeckIds, { region, adultsOnly, difficulty });
  const pool = deck ? deck.data.questions : [];

  // Recorte disjunto por equipo -- cada uno sube SU PROPIA escalera con
  // preguntas distintas, para que no se saquen ventaja escuchando al otro.
  const PREGUNTAS_POR_EQUIPO = TOTAL_ESCALONES + 5; // margen extra por si hay caídas y hay que repreguntar
  const questionsByTeam = {};
  entrantIds.forEach((id, i) => {
    const start = i * PREGUNTAS_POR_EQUIPO;
    questionsByTeam[id] = pool.slice(start, start + PREGUNTAS_POR_EQUIPO).map((q) => ({ ...q, ...shuffleOptions(q) }));
  });

  const entrants = {};
  entrantIds.forEach((id) => {
    entrants[id] = {
      timeLeft: baseTimeSeconds + (carryOver[id] || 0),
      step: 0, // escalón actual (0 = piso, sin subir todavía)
      banked: 0, // escalón plantado, a salvo de una caída
      qIndex: 0, // próxima pregunta a mostrar -- nunca retrocede, para no repetir
      out: false
    };
  });

  return {
    gameType: type,
    deckId: deck ? deck.id : null,
    theme: deck ? deck.data.theme : null,
    totalEscalones: TOTAL_ESCALONES,
    questionsByTeam,
    entrants,
    activeEntrant: entrantIds[0] || null,
    lastFeedback: null,
    finished: entrantIds.length < 2
  };
}

function activeState(state) {
  return state.entrants[state.activeEntrant];
}

function currentQuestion(state, entrantId) {
  const entrant = state.entrants[entrantId];
  const preguntas = state.questionsByTeam[entrantId] || [];
  return entrant ? preguntas[entrant.qIndex] || null : null;
}

// Un equipo que ya no tiene preguntas asignadas queda plantado con lo que
// subio. Antes se quedaba "jugando" sin pregunta en pantalla hasta que se le
// acababa todo el reloj (con caidas, las 15 preguntas se gastan rapido).
function plantarSiSinPreguntas(state, entrantId) {
  const entrant = state.entrants[entrantId];
  if (!entrant || entrant.out || currentQuestion(state, entrantId)) return false;
  entrant.banked = entrant.step;
  entrant.out = true;
  state.lastFeedback = { entrantId, result: 'sin-preguntas', escalon: entrant.step };
  return true;
}

// Pasa el turno al siguiente equipo que todavía pueda seguir jugando.
function passTurn(state) {
  const ids = Object.keys(state.entrants);
  const startIdx = ids.indexOf(state.activeEntrant);
  for (let step = 1; step <= ids.length; step++) {
    const candidate = ids[(startIdx + step) % ids.length];
    plantarSiSinPreguntas(state, candidate);
    if (!state.entrants[candidate].out) { state.activeEntrant = candidate; return; }
  }
  state.finished = true;
}

function checkFinished(state) {
  if (Object.values(state.entrants).every((e) => e.out)) state.finished = true;
  return state.finished;
}

// payload puede ser un número (la opción elegida) o { plantarse: true }.
function answer(state, entrantId, payload) {
  if (state.finished) return { error: 'Esta escalera ya termino.' };
  if (entrantId !== state.activeEntrant) return { error: 'No es el turno de tu equipo.' };
  const entrant = activeState(state);
  if (entrant.out) return { error: 'Tu equipo ya no puede seguir subiendo.' };

  if (payload && typeof payload === 'object' && payload.plantarse) {
    entrant.banked = entrant.step;
    entrant.out = true;
    state.lastFeedback = { entrantId, result: 'plantado', escalon: entrant.step };
    passTurn(state);
    checkFinished(state);
    return {};
  }

  const q = currentQuestion(state, entrantId);
  if (!q) {
    // Se agotaron las preguntas asignadas a este equipo (no debería pasar en
    // partidas normales, hay margen de sobra) -- se lo da por plantado con
    // lo que ya tenía a salvo, en vez de trabarlo sin poder seguir.
    entrant.banked = entrant.step;
    entrant.out = true;
    state.lastFeedback = { entrantId, result: 'sin-preguntas', escalon: entrant.step };
    passTurn(state);
    checkFinished(state);
    return {};
  }

  const optionIndex = payload;
  const isCorrect = optionIndex === q.correctIndex;
  entrant.qIndex += 1;

  if (isCorrect) {
    entrant.step += 1;
    state.lastFeedback = { entrantId, result: 'correct', escalon: entrant.step, correctOption: q.options[q.correctIndex] };
    if (entrant.step >= state.totalEscalones) {
      // Completó toda la escalera: queda a salvo en el último escalón.
      entrant.banked = entrant.step;
      entrant.out = true;
      passTurn(state);
    }
  } else {
    entrant.step = entrant.banked; // cae -- vuelve a lo último que plantó
    state.lastFeedback = { entrantId, result: 'wrong', escalonPerdido: entrant.step, correctOption: q.options[q.correctIndex] };
    passTurn(state);
  }
  // Acerto pero era su ultima pregunta: se planta solo y pasa el turno.
  if (state.activeEntrant === entrantId && plantarSiSinPreguntas(state, entrantId)) passTurn(state);
  checkFinished(state);
  return {};
}

// Se llama una vez por segundo: descuenta del equipo activo.
function tick(state) {
  if (state.finished || !state.activeEntrant) return;
  const entrant = activeState(state);
  if (!entrant || entrant.out) return;

  entrant.timeLeft -= 1;
  if (entrant.timeLeft <= 0) {
    entrant.timeLeft = 0;
    entrant.out = true;
    entrant.step = entrant.banked; // se acaba el tiempo a mitad de una subida: se pierde lo no plantado
    state.lastFeedback = { entrantId: state.activeEntrant, result: 'timeout', escalon: entrant.banked };
    passTurn(state);
    checkFinished(state);
  }
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.banked]));
}

function carryOver(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.timeLeft]));
}

function publicView(state) {
  const q = state.activeEntrant ? currentQuestion(state, state.activeEntrant) : null;
  const entrant = state.activeEntrant ? state.entrants[state.activeEntrant] : null;
  return {
    type,
    label,
    theme: state.theme,
    totalEscalones: state.totalEscalones,
    entrants: Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, {
      timeLeft: e.timeLeft, step: e.step, banked: e.banked, out: e.out
    }])),
    activeEntrant: state.activeEntrant,
    question: entrant && !entrant.out && q ? { clue: q.clue, options: q.options } : null,
    lastFeedback: state.lastFeedback,
    finished: state.finished
  };
}

module.exports = {
  type, label, estimateSecondsPerRound, BASE_TIME_SECONDS,
  opciones, createRound, answer, tick, scores, carryOver, publicView
};
