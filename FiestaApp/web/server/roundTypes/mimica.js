// Juego "Mímica" — formato cruzado: un integrante de un equipo pasa al
// frente y actúa una palabra en silencio; CUALQUIER integrante del OTRO
// equipo (no un representante fijo) puede decir la respuesta en voz alta
// apenas la sepa. El celu de quien adivina la escucha (reconocimiento de
// voz) y valida sola contra la palabra objetivo -- por eso este juego
// necesita saber quién puntual es cada jugador (roster) y quién mandó cada
// acción (socketId), no solo "de qué equipo es", como los demás juegos.
//
// Se juega en bloques de tiempo fijo (no por cuántas palabras acierta el
// actor): cada bloque, un equipo actúa y el otro adivina; se turnan y
// alternan hasta que a todos les tocó actuar al menos una vez. El anfitrión
// elige, bloque a bloque, si quien actúa se sortea al azar (dado) o sigue el
// orden de la lista.

const { loadDecks, pickDeck, shuffle } = require('../contentLoader');

const type = 'mimica';
const label = 'Mímica';
const estimateSecondsPerRound = 150;
const simultaneous = true; // dos equipos con roles distintos conviven en la misma pantalla, no es "de a uno"
const skipMemberGate = true; // cualquiera del equipo que adivina puede mandar su intento, no solo el de turno

const SEGUNDOS_POR_ACIERTO = 4;

// Sin contenido propio para "quién adivina" (no aplica): la dificultad ajusta
// el tiempo de cada bloque y, vía mazos separados, qué tan concretas o
// abstractas son las palabras a actuar.
const DIFICULTAD_MECANICA = {
  facil: { segundosPorBloque: 150 },
  normal: { segundosPorBloque: 120 },
  dificil: { segundosPorBloque: 90 }
};
function mecanica(difficulty) {
  return DIFICULTAD_MECANICA[difficulty] || DIFICULTAD_MECANICA.normal;
}

const decks = loadDecks('varios', 'mimica');

function norm(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Arranca un bloque nuevo: decide qué equipo actúa y cuál adivina (se
// alternan), y deja al anfitrión elegir cómo se sortea el actor.
function startBlock(state) {
  const actingTeam = state.entrantOrder[state.bloqueIndex % state.entrantOrder.length];
  const guessingTeam = state.entrantOrder.find((id) => id !== actingTeam) || actingTeam;
  state.actorTeam = actingTeam;
  state.guessingTeam = guessingTeam;
  state.actorId = null;
  state.actorName = null;
  state.phase = 'choosing-actor';
  state.secondsLeft = state.segundosPorBloque;
  state.currentWord = null;
}

// Si se acaba la cola, se reparte de nuevo en vez de cortar el turno del que
// está actuando -- el ÚNICO motivo por el que debería cambiar de actor es que
// se acabe el tiempo del bloque (tick), nunca que se acaben las palabras.
function nextWord(state) {
  if (!state.queue.length) {
    if (!state.pool.length) return null;
    state.queue = shuffle(state.pool);
  }
  return state.queue.shift();
}

function beginActing(state) {
  state.currentWord = nextWord(state);
  state.phase = 'acting';
}

// Cierra el bloque actual y arranca el siguiente, o termina el juego si ya
// actuaron todos (un bloque por persona, alternando equipos).
function endBlock(state) {
  state.bloqueIndex += 1;
  if (state.bloqueIndex >= state.totalBloques) {
    state.finished = true;
    return;
  }
  startBlock(state);
}

function createRound({ entrantIds, rosters = {}, usedDeckIds = [], region, adultsOnly, difficulty }) {
  const m = mecanica(difficulty);
  const deck = pickDeck(decks, usedDeckIds, { region, adultsOnly, difficulty });
  const words = deck ? shuffle(deck.data.words) : [];

  const entrants = {};
  entrantIds.forEach((id) => { entrants[id] = { correct: 0, secondsWon: 0 }; });

  const maxRoster = Math.max(1, ...entrantIds.map((id) => (rosters[id] || []).length || 1));

  const state = {
    gameType: type,
    deckId: deck ? deck.id : null,
    theme: deck ? deck.data.theme : null,
    rosters,
    rotIndex: {},
    entrantOrder: entrantIds,
    totalBloques: entrantIds.length * maxRoster,
    bloqueIndex: 0,
    segundosPorBloque: m.segundosPorBloque,
    pool: words, // el mazo completo -- se vuelve a repartir si la cola se vacía
    queue: [...words],
    entrants,
    lastFeedback: null,
    finished: entrantIds.length < 2
  };

  if (!state.finished) startBlock(state);
  return state;
}

// Suma el acierto al equipo que adivinó, saca la palabra actuada de la cola
// (ya se usó) y pasa a la próxima -- si no queda ninguna, cierra el bloque.
function resolverAcierto(state, entrantId) {
  const equipo = entrantId || state.guessingTeam;
  const entrant = state.entrants[equipo];
  entrant.correct += 1;
  entrant.secondsWon += SEGUNDOS_POR_ACIERTO;
  state.lastFeedback = { result: 'correct', entrantId: equipo, word: state.currentWord, secondsWon: SEGUNDOS_POR_ACIERTO };
  state.currentWord = nextWord(state);
  if (!state.currentWord) endBlock(state);
  return {};
}

// El anfitrion decide como se elige quien actua este bloque, y tiene una red
// de seguridad manual por si el reconocimiento de voz falla.
function judge(state, payload) {
  if (state.finished) return { error: 'Este juego ya termino.' };

  if (payload && payload.elegirModo) {
    if (state.phase !== 'choosing-actor') return { error: 'Ya se eligió quién actúa en este bloque.' };
    const roster = state.rosters[state.actorTeam] || [];
    if (!roster.length) return { error: 'Ese equipo no tiene integrantes para elegir.' };

    let idx;
    if (payload.elegirModo === 'azar') {
      idx = Math.floor(Math.random() * roster.length);
    } else {
      idx = (state.rotIndex[state.actorTeam] || 0) % roster.length;
      state.rotIndex[state.actorTeam] = idx + 1;
    }
    const elegido = roster[idx];
    state.actorId = elegido.id;
    state.actorName = elegido.name;
    beginActing(state);
    state.lastFeedback = { result: 'actor-elegido', entrantId: state.actorTeam, actorName: elegido.name, modo: payload.elegirModo };
    return {};
  }

  if (payload && payload.confirmarManual) {
    if (state.phase !== 'acting' || !state.currentWord) return { error: 'No hay una palabra activa para confirmar.' };
    return resolverAcierto(state);
  }

  return { error: 'Acción no reconocida.' };
}

// pasar: solo quien está actuando. guess: cualquiera del equipo que le toca
// adivinar (por eso este juego usa skipMemberGate — no hay un solo
// representante fijo por equipo).
// isTestHost: en modo prueba el anfitrion controla a todos los jugadores
// inventados desde su unico socket real, asi que su socketId no va a
// coincidir nunca con el actorId elegido -- se lo deja pasar igual.
function answer(state, entrantId, payload, socketId, isTestHost) {
  if (state.finished) return { error: 'Este juego ya termino.' };
  if (state.phase !== 'acting') return { error: 'Todavía no arrancó a actuar nadie en este bloque.' };

  if (payload && payload.pasar) {
    if (socketId !== state.actorId && !isTestHost) return { error: 'Solo quien está actuando puede pasar de palabra.' };
    state.queue.push(state.currentWord); // no se pierde, vuelve al fondo de la cola
    state.currentWord = nextWord(state);
    state.lastFeedback = { result: 'paso' };
    if (!state.currentWord) endBlock(state);
    return {};
  }

  if (payload && typeof payload.guess === 'string') {
    if (entrantId !== state.guessingTeam) return { error: 'A tu equipo no le toca adivinar en este bloque.' };
    if (socketId === state.actorId) return { error: 'El que actúa no puede adivinar.' };

    const dicho = norm(payload.guess);
    const objetivo = norm(state.currentWord);
    if (!dicho || !objetivo || !dicho.includes(objetivo)) {
      state.lastFeedback = { result: 'guess-fail', heard: payload.guess };
      return {};
    }
    return resolverAcierto(state, entrantId);
  }

  return { error: 'Acción no reconocida.' };
}

// Cuenta regresiva del bloque actual. Si se acaba, la palabra en curso vuelve
// a la cola (para otro bloque) y se pasa al siguiente actor/equipo.
function tick(state) {
  if (state.finished || state.phase !== 'acting') return;
  state.secondsLeft -= 1;
  if (state.secondsLeft <= 0) {
    state.secondsLeft = 0;
    if (state.currentWord) state.queue.push(state.currentWord);
    endBlock(state);
  }
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.correct]));
}

function carryOver(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.secondsWon]));
}

function publicView(state) {
  return {
    type,
    label,
    simultaneous,
    theme: state.theme,
    total: state.totalBloques,
    number: Math.min(state.bloqueIndex + 1, state.totalBloques || 1),
    segundosPorBloque: state.segundosPorBloque,
    phase: state.phase,
    actorId: state.actorId,
    actorName: state.actorName,
    actorTeam: state.actorTeam,
    guessingTeam: state.guessingTeam,
    currentWord: state.currentWord,
    secondsLeft: state.secondsLeft,
    entrants: Object.fromEntries(Object.entries(state.entrants)
      .map(([id, e]) => [id, { correct: e.correct, secondsWon: e.secondsWon }])),
    lastFeedback: state.lastFeedback,
    finished: state.finished,
    secondsPerAcierto: SEGUNDOS_POR_ACIERTO
  };
}

module.exports = {
  type, label, estimateSecondsPerRound, simultaneous, skipMemberGate,
  createRound, answer, judge, tick, scores, carryOver, publicView
};
