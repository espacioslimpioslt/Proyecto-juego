const { resolver } = require('../opciones');
// Juego "Adiviná la Canción" — roles cruzados, como Mímica. Cada ronda, UN
// equipo hace de "DJ" (cualquiera de sus integrantes reproduce una canción
// cualquiera desde SU PROPIO celu/parlante -- Spotify, YouTube, lo que
// tengan) y el OTRO equipo compite por saber qué es: cualquiera de ellos
// (no un representante fijo) presiona para responder en voz alta. El
// anfitrión confirma si acertó. Los roles se invierten en cada canción, así
// que todos ponen música y todos adivinan en algún momento.
//
// La app NUNCA aloja ni reproduce audio con copyright -- solo corre quién le
// toca escuchar, el botón para responder y el puntaje.

const type = 'adivina-la-cancion';
const label = 'Adiviná la Canción';
const estimateSecondsPerRound = 90;
const skipMemberGate = true; // cualquiera del equipo que adivina puede presionar, no solo el de turno

const SEGUNDOS_POR_ACIERTO = 6;

// Ajustes que el anfitrión puede elegir en la sala (ver server/opciones.js).
// Si no elige, cada uno sale de la dificultad.
const opciones = [
  { id: 'canciones', label: 'Canciones', valores: [[5, '5'], [7, '7'], [9, '9'], [11, '11']], porDificultad: { facil: 5, normal: 7, dificil: 9 } }
];

function createRound({ entrantIds, difficulty, opciones: elegidas }) {
  const o = resolver(opciones, elegidas, difficulty);
  const m = { duelos: o.canciones };
  const entrants = {};
  entrantIds.forEach((id) => { entrants[id] = { wins: 0, secondsWon: 0 }; });

  const djTeam = entrantIds[0] || null;
  const guessingTeam = entrantIds.find((id) => id !== djTeam) || djTeam;

  return {
    gameType: type,
    totalDuels: m.duelos,
    duelIndex: 0, // 0-based, cancion actual
    djTeam,
    guessingTeam,
    activeEntrant: guessingTeam, // para que Modo Prueba sepa por quien jugar
    phase: 'buzzing', // buzzing -> answering -> se resuelve (acierto, error o salteo) y pasa a la proxima
    buzzedBy: null,
    entrants,
    lastFeedback: null,
    finished: entrantIds.length < 2
  };
}

// Pasa a la proxima cancion e invierte quien es DJ y quien adivina.
function nextDuel(state) {
  state.duelIndex += 1;
  const djAnterior = state.djTeam;
  state.djTeam = state.guessingTeam;
  state.guessingTeam = djAnterior;
  state.activeEntrant = state.guessingTeam;
  state.phase = 'buzzing';
  state.buzzedBy = null;
  if (state.duelIndex >= state.totalDuels) state.finished = true;
}

// Presionar para responder -- solo vale para el equipo que le toca adivinar
// en esta cancion (cualquiera de sus integrantes, gracias a skipMemberGate).
function answer(state, entrantId) {
  if (state.finished) return { error: 'Este juego ya termino.' };
  if (state.phase !== 'buzzing') return { error: 'Ya hay alguien respondiendo esta canción.' };
  if (entrantId !== state.guessingTeam) return { error: 'A tu equipo le toca poner la música, no adivinar.' };
  state.buzzedBy = entrantId;
  state.phase = 'answering';
  state.lastFeedback = { entrantId, result: 'buzzed' };
  return {};
}

// El anfitrion confirma si acerto. Acierto, error o salteo: en los TRES casos
// la cancion se da por resuelta y se pasa a la proxima -- cada cancion gasta
// un cupo de la tanda pase lo que pase, si no, terminar el juego dependeria
// de acertar exactamente `total` veces (podria no terminar nunca).
function judge(state, payload) {
  if (state.finished) return { error: 'Este juego ya termino.' };

  if (payload && payload.skip) {
    state.lastFeedback = { entrantId: state.guessingTeam, result: 'skipped' };
    nextDuel(state);
    return {};
  }

  if (state.phase !== 'answering') return { error: 'Todavía nadie presionó para responder.' };
  const ok = !!(payload && payload.ok);

  if (ok) {
    const entrant = state.entrants[state.guessingTeam];
    entrant.wins += 1;
    entrant.secondsWon += SEGUNDOS_POR_ACIERTO;
    state.lastFeedback = { entrantId: state.guessingTeam, result: 'correct', secondsWon: SEGUNDOS_POR_ACIERTO };
  } else {
    state.lastFeedback = { entrantId: state.guessingTeam, result: 'wrong' };
  }
  nextDuel(state);
  return {};
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.wins]));
}

function carryOver(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.secondsWon]));
}

function publicView(state) {
  return {
    type,
    label,
    total: state.totalDuels,
    number: Math.min(state.duelIndex + 1, state.totalDuels || 1),
    phase: state.phase,
    djTeam: state.djTeam,
    guessingTeam: state.guessingTeam,
    activeEntrant: state.activeEntrant,
    buzzedBy: state.buzzedBy,
    entrants: Object.fromEntries(Object.entries(state.entrants)
      .map(([id, e]) => [id, { wins: e.wins, secondsWon: e.secondsWon }])),
    lastFeedback: state.lastFeedback,
    finished: state.finished,
    secondsPerAcierto: SEGUNDOS_POR_ACIERTO
  };
}

module.exports = {
  type, label, estimateSecondsPerRound, skipMemberGate,
  opciones, createRound, answer, judge, scores, carryOver, publicView
};
