// Juego "Palabra Prohibida" (estilo Taboo) — formato cruzado, calca la
// estructura de Mímica: un integrante de un equipo describe una palabra EN
// VOZ ALTA para que su equipo la adivine, pero sin decir ninguna de las 3-4
// palabras "prohibidas" relacionadas. CUALQUIER integrante del OTRO equipo
// puede decir la respuesta apenas la sepa; el celu la escucha (reconocimiento
// de voz) y valida sola. Si quien describe dice una prohibida, el anfitrión
// (que escuchó la previa) lo marca a mano -- eso no se puede detectar solo,
// a diferencia de la respuesta final.
//
// Se juega en bloques de tiempo fijo, igual que Mímica: se turnan los
// equipos hasta que a todos les tocó describir al menos una vez. El
// anfitrión elige, bloque a bloque, si quien describe se sortea al azar o
// sigue el orden de la lista.

const { loadDecks, pickDeck, shuffle } = require('../contentLoader');

const type = 'palabra-prohibida';
const label = 'Palabra Prohibida';
const estimateSecondsPerRound = 150;
const simultaneous = true; // dos equipos con roles distintos conviven en la misma pantalla, no es "de a uno"
const skipMemberGate = true; // cualquiera del equipo que adivina puede mandar su intento, no solo el de turno

const SEGUNDOS_POR_ACIERTO = 4;

// Sin mazos propios por dificultad: la dificultad ajusta el tiempo de cada
// bloque, igual que Mímica.
const DIFICULTAD_MECANICA = {
  facil: { segundosPorBloque: 150 },
  normal: { segundosPorBloque: 120 },
  dificil: { segundosPorBloque: 90 }
};
function mecanica(difficulty) {
  return DIFICULTAD_MECANICA[difficulty] || DIFICULTAD_MECANICA.normal;
}

const decks = loadDecks('varios', 'palabra-prohibida');

function norm(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Arranca un bloque nuevo: decide qué equipo describe y cuál adivina (se
// alternan), y deja al anfitrión elegir cómo se sortea quien describe.
function startBlock(state) {
  const actingTeam = state.entrantOrder[state.bloqueIndex % state.entrantOrder.length];
  const guessingTeam = state.entrantOrder.find((id) => id !== actingTeam) || actingTeam;
  state.actorTeam = actingTeam;
  state.guessingTeam = guessingTeam;
  state.actorId = null;
  state.actorName = null;
  state.phase = 'choosing-actor';
  state.secondsLeft = state.segundosPorBloque;
  state.currentCard = null;
}

// Si se acaba la cola, se reparte de nuevo en vez de cortar el turno del que
// está describiendo -- el ÚNICO motivo por el que debería cambiar de
// describidor es que se acabe el tiempo del bloque (tick), nunca que se
// acaben las tarjetas.
function nextCard(state) {
  if (!state.queue.length) {
    if (!state.pool.length) return null;
    state.queue = shuffle(state.pool);
  }
  return state.queue.shift();
}

function beginActing(state) {
  state.currentCard = nextCard(state);
  state.phase = 'acting';
}

// Cierra el bloque actual y arranca el siguiente, o termina el juego si ya
// describieron todos (un bloque por persona, alternando equipos).
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
  const cards = deck ? shuffle(deck.data.cards) : [];

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
    pool: cards, // el mazo completo -- se vuelve a repartir si la cola se vacía
    queue: [...cards],
    entrants,
    lastFeedback: null,
    finished: entrantIds.length < 2
  };

  if (!state.finished) startBlock(state);
  return state;
}

// Suma el acierto al equipo que adivinó, saca la tarjeta de la cola (ya se
// usó) y pasa a la próxima -- si no queda ninguna, cierra el bloque.
function resolverAcierto(state, entrantId) {
  const equipo = entrantId || state.guessingTeam;
  const entrant = state.entrants[equipo];
  entrant.correct += 1;
  entrant.secondsWon += SEGUNDOS_POR_ACIERTO;
  state.lastFeedback = { result: 'correct', entrantId: equipo, word: state.currentCard.word, secondsWon: SEGUNDOS_POR_ACIERTO };
  state.currentCard = nextCard(state);
  if (!state.currentCard) endBlock(state);
  return {};
}

// Corta la tarjeta actual sin puntaje (pasar voluntario o falta marcada por
// el anfitrion) y pasa a la proxima.
function cortarTarjetaSinPuntaje(state, resultado) {
  state.lastFeedback = { result: resultado };
  state.currentCard = nextCard(state);
  if (!state.currentCard) endBlock(state);
  return {};
}

// El anfitrion decide como se elige quien describe este bloque, tiene una
// red de seguridad manual por si el reconocimiento de voz falla, y marca las
// "faltas" (dijo una palabra prohibida) -- eso solo lo puede juzgar alguien
// que escuchó la previa, no se puede detectar solo.
function judge(state, payload) {
  if (state.finished) return { error: 'Este juego ya termino.' };

  if (payload && payload.elegirModo) {
    if (state.phase !== 'choosing-actor') return { error: 'Ya se eligió quién describe en este bloque.' };
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
    if (state.phase !== 'acting' || !state.currentCard) return { error: 'No hay una tarjeta activa para confirmar.' };
    return resolverAcierto(state);
  }

  if (payload && payload.falta) {
    if (state.phase !== 'acting' || !state.currentCard) return { error: 'No hay una tarjeta activa.' };
    return cortarTarjetaSinPuntaje(state, 'falta');
  }

  return { error: 'Acción no reconocida.' };
}

// pasar: solo quien está describiendo. guess: cualquiera del equipo que le
// toca adivinar (por eso este juego usa skipMemberGate — no hay un solo
// representante fijo por equipo).
// isTestHost: en modo prueba el anfitrion controla a todos los jugadores
// inventados desde su unico socket real, asi que su socketId no va a
// coincidir nunca con el actorId elegido -- se lo deja pasar igual.
function answer(state, entrantId, payload, socketId, isTestHost) {
  if (state.finished) return { error: 'Este juego ya termino.' };
  if (state.phase !== 'acting') return { error: 'Todavía no arrancó a describir nadie en este bloque.' };

  if (payload && payload.pasar) {
    if (socketId !== state.actorId && !isTestHost) return { error: 'Solo quien está describiendo puede pasar de tarjeta.' };
    state.queue.push(state.currentCard); // no se pierde, vuelve al fondo de la cola
    return cortarTarjetaSinPuntaje(state, 'paso');
  }

  if (payload && typeof payload.guess === 'string') {
    if (entrantId !== state.guessingTeam) return { error: 'A tu equipo no le toca adivinar en este bloque.' };
    if (socketId === state.actorId) return { error: 'El que describe no puede adivinar.' };

    const dicho = norm(payload.guess);
    const objetivo = norm(state.currentCard.word);
    if (!dicho || !objetivo || !dicho.includes(objetivo)) {
      state.lastFeedback = { result: 'guess-fail', heard: payload.guess };
      return {};
    }
    return resolverAcierto(state, entrantId);
  }

  return { error: 'Acción no reconocida.' };
}

// Cuenta regresiva del bloque actual. Si se acaba, la tarjeta en curso vuelve
// a la cola (para otro bloque) y se pasa al siguiente describidor/equipo.
function tick(state) {
  if (state.finished || state.phase !== 'acting') return;
  state.secondsLeft -= 1;
  if (state.secondsLeft <= 0) {
    state.secondsLeft = 0;
    if (state.currentCard) state.queue.push(state.currentCard);
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
    currentCard: state.currentCard, // { word, forbidden } -- el cliente decide a quien mostrarselo
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
