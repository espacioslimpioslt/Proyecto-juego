// Juego "El Impostor" — todos reciben la misma palabra secreta menos uno, el
// impostor, que no la sabe. Por turnos, cada uno escribe UNA pista que tenga
// que ver con la palabra (sin decirla); las pistas aparecen en la pantalla de
// todos. Después se vota quién es el impostor.
//
// Lo propio de esta versión:
// - Las pistas se ESCRIBEN y se ven en todos los celus: funciona igual en el
//   living que a distancia, sin videollamada.
// - Cada celu recibe solo lo suyo (privateView): la palabra nunca le llega al
//   impostor, ni siquiera escondida.
// - "Robo final": si el impostor queda atrapado, tiene una última chance de
//   robarse el caso adivinando la palabra entre 6 opciones. Lo arbitra el
//   servidor, no el anfitrión (que también juega).
// - En difícil, "a ciegas": el impostor recibe una palabra PARECIDA de la
//   misma categoría y no sabe que es el impostor.
// - Juego individual con puntaje por equipo: cada voto acertado suma para el
//   equipo de quien votó, y el impostor suma para el suyo si escapa o roba.

const { loadDecks, pickDeck, shuffle } = require('../contentLoader');
const { resolver } = require('../opciones');

const type = 'impostor';
const label = 'El Impostor';
const estimateSecondsPerRound = 360;
const simultaneous = true; // en la votación todos actúan a la vez
const skipMemberGate = true; // el juego decide quién puede actuar en cada momento
const minJugadores = 3; // con 2 no hay a quién sospechar

const SEG_PISTA = 45;
const SEG_VOTACION = 60;
const SEG_ROBO = 25;
const SEG_REVELACION = 20;

const PUNTOS_VOTO_CORRECTO = 1;
const PUNTOS_IMPOSTOR_ESCAPA = 3;
const PUNTOS_ROBO = 3;
const SEGUNDOS_POR_PUNTO = 4;

const OPCIONES_ROBO = 6;

const decks = loadDecks('varios', 'impostor');

function norm(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Todos los que están jugando ahora, con su equipo.
function jugadores(state) {
  return Object.entries(state.rosters || {})
    .flatMap(([team, list]) => (list || []).map((p) => ({ id: p.id, name: p.name, team })));
}

function presente(state, playerId) {
  return jugadores(state).some((p) => p.id === playerId);
}

function sumar(state, team, puntos) {
  if (!state.entrants[team]) return;
  state.entrants[team].points += puntos;
  state.entrants[team].secondsWon = state.entrants[team].points * SEGUNDOS_POR_PUNTO;
}

// ---------- Casos ----------

function elegirPalabra(state) {
  const categorias = (state.categorias || []).filter((c) => (c.palabras || []).length >= OPCIONES_ROBO);
  if (!categorias.length) return null;
  const libres = categorias.filter((c) => c.palabras.some((w) => !state.usadas.includes(w)));
  const categoria = shuffle(libres.length ? libres : categorias)[0];
  const disponibles = categoria.palabras.filter((w) => !state.usadas.includes(w));
  const word = shuffle(disponibles.length ? disponibles : categoria.palabras)[0];
  const decoy = shuffle(categoria.palabras.filter((w) => w !== word))[0];
  state.usadas.push(word);
  return { categoria: categoria.nombre, palabras: categoria.palabras, word, decoy };
}

function startCaso(state) {
  const lista = jugadores(state);
  const elegida = elegirPalabra(state);
  if (lista.length < 2 || !elegida) {
    state.finished = true;
    return;
  }
  // No repetir impostor en casos seguidos, si se puede.
  const candidatos = lista.filter((p) => p.id !== state.ultimoImpostor);
  const impostor = shuffle(candidatos.length ? candidatos : lista)[0];
  state.ultimoImpostor = impostor.id;

  // El impostor nunca habla primero: sin ninguna pista para escuchar, quedaría
  // totalmente a ciegas (o, al revés, sería el que marca el tema).
  let order = shuffle(lista);
  if (order.length > 1 && order[0].id === impostor.id) order = [...order.slice(1), order[0]];

  state.caso = {
    impostorId: impostor.id,
    impostorName: impostor.name,
    impostorTeam: impostor.team,
    categoria: elegida.categoria,
    word: elegida.word,
    decoy: elegida.decoy,
    palabrasCategoria: elegida.palabras,
    order,
    turn: 0,
    totalTurns: order.length * state.m.vueltas,
    clues: [],
    votes: {},
    roboOptions: null,
    roboGuess: null,
    result: null,
    phase: 'pistas',
    secondsLeft: SEG_PISTA,
    secondsMax: SEG_PISTA
  };
  saltarAusentes(state);
}

function speakerActual(state) {
  const c = state.caso;
  if (!c || c.phase !== 'pistas' || c.turn >= c.totalTurns) return null;
  return c.order[c.turn % c.order.length];
}

// Si al que le toca no está (se fue o se le cortó), se saltea su turno.
function saltarAusentes(state) {
  const c = state.caso;
  while (c.phase === 'pistas' && c.turn < c.totalTurns && !presente(state, speakerActual(state).id)) {
    const s = speakerActual(state);
    c.clues.push({ id: s.id, name: s.name, text: null, skipped: true });
    c.turn += 1;
  }
  if (c.phase === 'pistas' && c.turn >= c.totalTurns) abrirVotacion(state);
}

function avanzarTurno(state) {
  const c = state.caso;
  c.turn += 1;
  c.secondsLeft = SEG_PISTA;
  c.secondsMax = SEG_PISTA;
  if (c.turn >= c.totalTurns) abrirVotacion(state);
  else saltarAusentes(state);
}

function abrirVotacion(state) {
  const c = state.caso;
  c.phase = 'votacion';
  c.secondsLeft = SEG_VOTACION;
  c.secondsMax = SEG_VOTACION;
}

function votantes(state) {
  const enCaso = new Set(state.caso.order.map((p) => p.id));
  return jugadores(state).filter((p) => enCaso.has(p.id));
}

function todosVotaron(state) {
  const lista = votantes(state);
  return lista.length > 0 && lista.every((p) => state.caso.votes[p.id]);
}

function resolverVotacion(state) {
  const c = state.caso;
  const conteo = {};
  Object.values(c.votes).forEach((target) => { conteo[target] = (conteo[target] || 0) + 1; });
  const max = Math.max(0, ...Object.values(conteo));
  const masVotados = Object.keys(conteo).filter((id) => conteo[id] === max);
  // Empate (o nadie votó): nadie queda acusado y el impostor escapa.
  const acusadoId = max > 0 && masVotados.length === 1 ? masVotados[0] : null;
  const atrapado = acusadoId === c.impostorId;

  const equipoDe = Object.fromEntries(c.order.map((p) => [p.id, p.team]));
  Object.entries(c.votes).forEach(([voter, target]) => {
    if (target === c.impostorId && voter !== c.impostorId) sumar(state, equipoDe[voter], PUNTOS_VOTO_CORRECTO);
  });

  const acusado = c.order.find((p) => p.id === acusadoId);
  c.result = {
    acusadoId,
    acusadoName: acusado ? acusado.name : null,
    atrapado,
    conteo,
    robado: false,
    empate: !acusadoId
  };

  if (atrapado) {
    const otras = shuffle(c.palabrasCategoria.filter((w) => w !== c.word)).slice(0, OPCIONES_ROBO - 1);
    c.roboOptions = shuffle([c.word, ...otras]);
    c.phase = 'robo';
    c.secondsLeft = SEG_ROBO;
    c.secondsMax = SEG_ROBO;
  } else {
    sumar(state, c.impostorTeam, PUNTOS_IMPOSTOR_ESCAPA);
    abrirRevelacion(state);
  }
}

function resolverRobo(state, guessIndex) {
  const c = state.caso;
  const guess = c.roboOptions && Number.isInteger(guessIndex) ? c.roboOptions[guessIndex] : null;
  c.roboGuess = guess;
  c.result.robado = guess === c.word;
  if (c.result.robado) sumar(state, c.impostorTeam, PUNTOS_ROBO);
  abrirRevelacion(state);
}

function abrirRevelacion(state) {
  const c = state.caso;
  c.phase = 'revelacion';
  c.secondsLeft = SEG_REVELACION;
  c.secondsMax = SEG_REVELACION;
  state.lastFeedback = {
    result: c.result.atrapado && !c.result.robado ? 'correct' : 'wrong',
    caso: state.casoIndex + 1
  };
}

function siguienteCaso(state) {
  state.casoIndex += 1;
  if (state.casoIndex >= state.totalCasos) {
    state.finished = true;
    return;
  }
  startCaso(state);
}

// ---------- Interfaz del motor común ----------

// Ajustes que el anfitrión puede elegir en la sala (ver server/opciones.js).
// Si no elige, cada uno sale de la dificultad.
const opciones = [
  { id: 'modo', label: 'Modo', valores: [['con-categoria', 'Con categoría'], ['sin-categoria', 'Sin categoría'], ['a-ciegas', 'A ciegas (el impostor no sabe que lo es)']], porDificultad: { facil: 'con-categoria', normal: 'sin-categoria', dificil: 'a-ciegas' } },
  { id: 'casos', label: 'Casos', valores: [[2, '2'], [3, '3'], [4, '4'], [5, '5']], porDefecto: 3 },
  { id: 'vueltas', label: 'Vueltas de pistas', valores: [[1, '1'], [2, '2'], [3, '3']], porDefecto: 2 }
];

function createRound({ entrantIds, rosters = {}, usedDeckIds = [], region, adultsOnly, difficulty, opciones: elegidas }) {
  const o = resolver(opciones, elegidas, difficulty);
  const m = {
    casos: o.casos,
    vueltas: o.vueltas,
    categoriaVisible: o.modo === 'con-categoria',
    aCiegas: o.modo === 'a-ciegas'
  };
  const deck = pickDeck(decks, usedDeckIds, { region, adultsOnly, difficulty });

  const entrants = {};
  entrantIds.forEach((id) => { entrants[id] = { points: 0, secondsWon: 0 }; });

  const state = {
    gameType: type,
    deckId: deck ? deck.id : null,
    theme: deck ? deck.data.theme : null,
    difficulty: difficulty || 'normal',
    m,
    categorias: deck ? deck.data.categorias : [],
    usadas: [],
    rosters,
    entrants,
    totalCasos: m.casos,
    casoIndex: 0,
    caso: null,
    ultimoImpostor: null,
    lastFeedback: null,
    finished: false,
    simultaneous
  };
  const total = jugadores(state).length;
  if (total < minJugadores || !deck) {
    state.finished = true;
    return state;
  }
  startCaso(state);
  return state;
}

// payload según la fase:
// - pistas:   { pista: 'texto' }       solo quien tiene el turno
// - votación: { voto: playerId }       cualquiera que esté jugando el caso
// - robo:     { robo: indiceOpcion }   solo el impostor atrapado
// En modo prueba el anfitrión actúa por cualquiera ({ como: playerId } en la votación).
function answer(state, entrantId, payload, playerId, isTestHost) {
  if (state.finished || !state.caso) return { error: 'Este juego ya terminó.' };
  const c = state.caso;
  const p = payload || {};

  if (c.phase === 'pistas') {
    const speaker = speakerActual(state);
    if (!speaker) return { error: 'No hay turno de pista ahora.' };
    if (!isTestHost && speaker.id !== playerId) return { error: `Le toca dar la pista a ${speaker.name}.` };
    const texto = String(p.pista || '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
    if (!texto) return { error: 'Escribí una pista.' };
    if (texto.split(' ').length > 3) return { error: 'La pista tiene que ser corta: hasta 3 palabras.' };
    // No se puede decir la palabra (la propia: en "a ciegas" el impostor tiene otra).
    const suPalabra = speaker.id === c.impostorId ? (state.m.aCiegas ? c.decoy : null) : c.word;
    // Tampoco un pedazo largo de ella ("manza" para "manzana").
    const dicha = norm(texto);
    const propia = suPalabra ? norm(suPalabra) : '';
    if (propia && (dicha.includes(propia) || (dicha.length >= 4 && propia.includes(dicha)))) {
      return { error: '¡Esa es la palabra! Buscá otra pista.' };
    }
    c.clues.push({ id: speaker.id, name: speaker.name, text: texto, skipped: false });
    avanzarTurno(state);
    return {};
  }

  if (c.phase === 'votacion') {
    const voterId = isTestHost && p.como ? p.como : playerId;
    const enCaso = c.order.some((x) => x.id === voterId);
    if (!enCaso) return { error: 'No estás jugando este caso.' };
    if (!c.order.some((x) => x.id === p.voto)) return { error: 'Ese jugador no está en el caso.' };
    if (p.voto === voterId) return { error: 'No podés votarte a vos mismo.' };
    c.votes[voterId] = p.voto; // se puede cambiar el voto hasta que se cierre
    if (todosVotaron(state)) resolverVotacion(state);
    return {};
  }

  if (c.phase === 'robo') {
    if (!isTestHost && playerId !== c.impostorId) return { error: 'Solo el impostor puede intentar el robo.' };
    const idx = Number(p.robo);
    if (!Number.isInteger(idx) || idx < 0 || idx >= c.roboOptions.length) return { error: 'Elegí una de las opciones.' };
    resolverRobo(state, idx);
    return {};
  }

  return { error: 'Ahora no hay nada para responder.' };
}

// Acciones del anfitrión: saltear a quien no da su pista, cerrar la votación
// antes de tiempo, o pasar al siguiente caso sin esperar el reloj.
function judge(state, payload) {
  if (state.finished || !state.caso) return { error: 'Este juego ya terminó.' };
  const c = state.caso;
  const p = payload || {};
  if (p.saltarTurno) {
    if (c.phase !== 'pistas') return { error: 'No hay un turno de pista para saltear.' };
    const s = speakerActual(state);
    if (s) c.clues.push({ id: s.id, name: s.name, text: null, skipped: true });
    avanzarTurno(state);
    return {};
  }
  if (p.cerrarVotacion) {
    if (c.phase !== 'votacion') return { error: 'No hay una votación abierta.' };
    resolverVotacion(state);
    return {};
  }
  if (p.siguienteCaso) {
    if (c.phase !== 'revelacion') return { error: 'Todavía no terminó este caso.' };
    siguienteCaso(state);
    return {};
  }
  return { error: 'Acción no reconocida.' };
}

function tick(state) {
  if (state.finished || !state.caso) return;
  const c = state.caso;
  c.secondsLeft -= 1;
  if (c.secondsLeft > 0) return;
  if (c.phase === 'pistas') {
    const s = speakerActual(state);
    if (s) c.clues.push({ id: s.id, name: s.name, text: null, skipped: true });
    avanzarTurno(state);
  } else if (c.phase === 'votacion') {
    resolverVotacion(state);
  } else if (c.phase === 'robo') {
    resolverRobo(state, null);
  } else if (c.phase === 'revelacion') {
    siguienteCaso(state);
  }
}

function onRosterChange(state, rosters) {
  state.rosters = rosters;
  const c = state.caso;
  if (state.finished || !c) return;
  if (c.phase === 'pistas') saltarAusentes(state);
  else if (c.phase === 'votacion' && todosVotaron(state)) resolverVotacion(state);
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.points]));
}

function carryOver(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.secondsWon]));
}

// Lo que ven TODOS. Nada de la palabra ni de quién es el impostor hasta la
// revelación (en el robo ya se sabe quién es: lo atraparon).
function publicView(state) {
  const c = state.caso;
  const speaker = c ? speakerActual(state) : null;
  const revelado = c && (c.phase === 'revelacion' || state.finished);
  const atrapadoAhora = c && c.phase === 'robo';
  return {
    type,
    label,
    simultaneous,
    theme: state.theme,
    total: state.totalCasos,
    number: Math.min(state.casoIndex + 1, state.totalCasos),
    modo: state.m.aCiegas ? 'a-ciegas' : (state.m.categoriaVisible ? 'con-categoria' : 'sin-categoria'),
    faltanJugadores: !c,
    phase: c ? c.phase : null,
    secondsLeft: c ? c.secondsLeft : 0,
    secondsMax: c ? c.secondsMax : 0,
    categoria: c && (state.m.categoriaVisible || revelado) ? c.categoria : null,
    jugadores: c ? c.order.map((p) => ({ id: p.id, name: p.name, team: p.team })) : [],
    turnoDe: speaker ? speaker.id : null,
    turnoNombre: speaker ? speaker.name : null,
    vuelta: c ? Math.min(Math.floor(c.turn / Math.max(c.order.length, 1)) + 1, state.m.vueltas) : 0,
    totalVueltas: state.m.vueltas,
    pistas: c ? c.clues : [],
    yaVotaron: c ? Object.keys(c.votes) : [],
    impostorId: c && (revelado || atrapadoAhora) ? c.impostorId : null,
    impostorName: c && (revelado || atrapadoAhora) ? c.impostorName : null,
    roboOptions: c && (atrapadoAhora || revelado) ? c.roboOptions : null,
    palabra: revelado ? c.word : null,
    palabraImpostor: revelado && state.m.aCiegas ? c.decoy : null,
    votos: revelado ? c.votes : null,
    resultado: revelado || atrapadoAhora ? c.result : null,
    roboGuess: revelado ? c.roboGuess : null,
    activeEntrant: speaker ? speaker.team : null,
    entrants: Object.fromEntries(Object.entries(state.entrants)
      .map(([id, e]) => [id, { points: e.points, secondsWon: e.secondsWon }])),
    lastFeedback: state.lastFeedback,
    finished: state.finished,
    puntos: { votoCorrecto: PUNTOS_VOTO_CORRECTO, escapa: PUNTOS_IMPOSTOR_ESCAPA, robo: PUNTOS_ROBO }
  };
}

// Lo que ve CADA celu por separado. En "a ciegas" el impostor recibe
// exactamente la misma forma de datos que los demás (rol: 'tripulante' con
// una palabra): no hay nada en lo que llega a su celu que le avise.
function privateView(state, viewerId, isTestHost) {
  const c = state.caso;
  if (!c || state.finished) return null;
  if (isTestHost) {
    return {
      modoPrueba: true,
      impostorName: c.impostorName,
      palabra: c.word,
      palabraImpostor: state.m.aCiegas ? c.decoy : null,
      categoria: c.categoria
    };
  }
  if (!c.order.some((p) => p.id === viewerId)) return { rol: 'espectador' };
  const miVoto = c.votes[viewerId] || null;
  if (viewerId === c.impostorId) {
    if (state.m.aCiegas) return { rol: 'tripulante', palabra: c.decoy, miVoto };
    return { rol: 'impostor', categoria: state.m.categoriaVisible ? c.categoria : null, miVoto };
  }
  return { rol: 'tripulante', palabra: c.word, miVoto };
}

module.exports = {
  type, label, estimateSecondsPerRound, simultaneous, skipMemberGate, minJugadores,
  opciones, createRound, answer, onRosterChange, judge, tick, scores, carryOver, publicView, privateView
};
