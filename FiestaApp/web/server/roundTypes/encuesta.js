// Juego "La Encuesta" — inspirado en los programas de "le preguntamos a 100
// personas": hay una pregunta con las respuestas más populares ocultas en un
// tablero, cada una con sus puntos. El equipo con el control va diciendo
// respuestas (de a una, rotando quién contesta): cada acierto destapa una
// ficha y suma al pozo; cada error es una cruz. Con 3 cruces, el OTRO equipo
// tiene una sola chance de robar: si acierta cualquiera de las que quedan, se
// lleva el pozo entero; si no, se lo queda el equipo que tenía el control.
//
// Las respuestas se escriben y el servidor las reconoce aunque estén escritas
// distinto ("perro", "un perrito", "perros"): sin tildes, sin artículos, con
// plurales y diminutivos simples, alias en el contenido y hasta un error de
// tipeo en palabras largas. Si igual no la toma, el anfitrión puede darla por
// buena tocando la ficha correspondiente.

const { loadDecks, pickDeck, shuffle } = require('../contentLoader');
const { resolver } = require('../opciones');

const type = 'encuesta';
const label = 'La Encuesta';
const estimateSecondsPerRound = 300;
const skipMemberGate = false; // contesta el de turno del equipo que juega

const CRUCES = 3;
const SEG_RESULTADO = 8;
const PUNTOS_A_SEGUNDOS = 0.1; // por si se usa en un Programa con final por tiempo

// Ajustes que el anfitrión puede elegir en la sala (ver server/opciones.js).
// Si no elige, cada uno sale de la dificultad.
const opciones = [
  { id: 'preguntas', label: 'Preguntas', valores: [[2, '2'], [4, '4'], [6, '6']], porDificultad: { facil: 4, normal: 4, dificil: 6 } },
  { id: 'final', label: 'Última pregunta', valores: [['simple', 'Puntos normales'], ['doble', 'Vale doble']], porDefecto: 'doble' }
];

const decks = loadDecks('varios', 'encuesta');

const ARTICULOS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'mi', 'su', 'tu']);

function norm(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .split(/\s+/).filter((w) => w && !ARTICULOS.has(w))
    .map(raiz)
    .join(' ');
}

// Raíz simple de cada palabra: saca plurales y diminutivos comunes, para que
// "perritos", "perros" y "perro" cuenten igual.
function raiz(w) {
  let r = w;
  if (r.length > 5 && /(it|cit)(o|a)s?$/.test(r)) r = r.replace(/(c?it)(o|a)s?$/, '');
  else if (r.length > 4 && r.endsWith('es')) r = r.slice(0, -2);
  else if (r.length > 3 && r.endsWith('s')) r = r.slice(0, -1);
  if (r.length > 3 && /[aeo]$/.test(r)) r = r.slice(0, -1);
  return r;
}

function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

// ¿Lo dicho coincide con esta respuesta (o alguno de sus alias)?
function coincide(dicho, respuesta) {
  const d = norm(dicho);
  if (!d) return false;
  return [respuesta.texto, ...(respuesta.alias || [])].some((a) => {
    const n = norm(a);
    if (!n) return false;
    if (d === n) return true;
    // "una sombrilla grande" contiene "sombrilla"
    if (` ${d} `.includes(` ${n} `) || (n.length >= 4 && ` ${n} `.includes(` ${d} `) && d.length >= 4)) return true;
    // un error de tipeo en palabras largas
    return n.length >= 6 && distancia(d, n) <= 1;
  });
}

function otro(state, team) {
  return state.order.find((id) => id !== team) || team;
}

function iniciarPregunta(state) {
  const q = state.preguntas[state.index];
  state.pregunta = q.pregunta;
  state.respuestas = q.respuestas.map((r) => ({ ...r, revelada: false, por: null }));
  state.cruces = 0;
  state.pozo = 0;
  state.fase = 'juego';
  // El control alterna en cada pregunta.
  state.control = state.order[state.index % state.order.length];
  state.activeEntrant = state.control;
  state.multiplicador = state.index === state.preguntas.length - 1 && state.dobleFinal ? 2 : 1;
  state.ultimo = null;
  state.ganadorPregunta = null;
}

function revelar(state, i, team) {
  const r = state.respuestas[i];
  if (!r || r.revelada) return false;
  r.revelada = true;
  r.por = team;
  state.pozo += r.puntos * state.multiplicador;
  return true;
}

function cerrarPregunta(state, ganador) {
  state.ganadorPregunta = ganador;
  if (ganador) {
    state.entrants[ganador].points += state.pozo;
    state.entrants[ganador].secondsWon = Math.round(state.entrants[ganador].points * PUNTOS_A_SEGUNDOS);
  }
  state.fase = 'resultado';
  state.segundosResultado = SEG_RESULTADO;
  state.lastFeedback = { result: ganador ? 'correct' : 'wrong', entrantId: ganador, pozo: state.pozo, pregunta: state.index + 1 };
}

function siguiente(state) {
  state.index += 1;
  if (state.index >= state.preguntas.length) {
    state.finished = true;
    return;
  }
  iniciarPregunta(state);
}

function todasReveladas(state) {
  return state.respuestas.every((r) => r.revelada);
}

function createRound({ entrantIds, usedDeckIds = [], region, adultsOnly, difficulty, opciones: elegidas }) {
  const o = resolver(opciones, elegidas, difficulty);
  const deck = pickDeck(decks, usedDeckIds, { region, adultsOnly, difficulty });
  const preguntas = deck ? shuffle(deck.data.encuestas).slice(0, o.preguntas) : [];

  const entrants = {};
  entrantIds.forEach((id) => { entrants[id] = { points: 0, secondsWon: 0 }; });

  const state = {
    gameType: type,
    deckId: deck ? deck.id : null,
    theme: deck ? deck.data.theme : null,
    order: [...entrantIds],
    preguntas,
    dobleFinal: o.final === 'doble',
    index: 0,
    entrants,
    lastFeedback: null,
    finished: entrantIds.length < 2 || !preguntas.length
  };
  if (!state.finished) iniciarPregunta(state);
  return state;
}

// payload: { respuesta: 'texto' }
function answer(state, entrantId, payload) {
  if (state.finished) return { error: 'Este juego ya terminó.' };
  if (state.fase === 'resultado') return { error: 'Ya se cerró esta pregunta.' };
  if (entrantId !== state.activeEntrant) return { error: 'No es el turno de tu equipo.' };
  const texto = String((payload && payload.respuesta) || '').replace(/[<>&"'`]/g, '').trim().slice(0, 40);
  if (!texto) return { error: 'Escribí una respuesta.' };

  const i = state.respuestas.findIndex((r) => !r.revelada && coincide(texto, r));
  const repetida = i === -1 && state.respuestas.some((r) => r.revelada && coincide(texto, r));
  state.ultimo = { team: entrantId, texto, acierto: i !== -1, repetida };

  if (state.fase === 'robo') {
    // Una sola chance: si acierta se lleva el pozo, si no, el que tenía el control.
    if (i !== -1) {
      revelar(state, i, entrantId);
      cerrarPregunta(state, entrantId);
    } else {
      cerrarPregunta(state, state.control);
    }
    return {};
  }

  if (i !== -1) {
    revelar(state, i, entrantId);
    state.lastFeedback = { result: 'correct', entrantId, texto: state.respuestas[i].texto, puntos: state.respuestas[i].puntos };
    if (todasReveladas(state)) cerrarPregunta(state, entrantId);
    return {};
  }

  if (repetida) {
    state.lastFeedback = { result: 'repetida', entrantId, texto };
    return {}; // ya estaba en el tablero: no suma cruz, que diga otra
  }

  state.cruces += 1;
  state.lastFeedback = { result: 'wrong', entrantId, texto, cruces: state.cruces };
  if (state.cruces >= CRUCES) {
    state.fase = 'robo';
    state.activeEntrant = otro(state, state.control);
  }
  return {};
}

// Anfitrión: dar por buena una respuesta que el reconocimiento no tomó
// (tocando la ficha), o pasar a la siguiente pregunta sin esperar.
function judge(state, payload) {
  if (state.finished) return { error: 'Este juego ya terminó.' };
  const p = payload || {};
  if (p.siguiente) {
    if (state.fase !== 'resultado') return { error: 'Todavía no se cerró esta pregunta.' };
    siguiente(state);
    return {};
  }
  if (p.revelar !== undefined) {
    if (state.fase === 'resultado') return { error: 'Ya se cerró esta pregunta.' };
    const i = Number(p.revelar);
    const team = state.activeEntrant;
    // Si lo último fue una cruz por esa misma respuesta mal reconocida, se saca.
    if (state.ultimo && !state.ultimo.acierto && !state.ultimo.repetida && state.fase === 'juego' && state.cruces > 0) {
      state.cruces -= 1;
    }
    if (!revelar(state, i, team)) return { error: 'Esa ficha ya está destapada.' };
    state.ultimo = { team, texto: state.respuestas[i].texto, acierto: true, manual: true };
    if (state.fase === 'robo') {
      cerrarPregunta(state, team);
    } else {
      state.lastFeedback = { result: 'correct', entrantId: team, texto: state.respuestas[i].texto, puntos: state.respuestas[i].puntos };
      if (todasReveladas(state)) cerrarPregunta(state, team);
    }
    return {};
  }
  return { error: 'Acción no reconocida.' };
}

function tick(state) {
  if (state.finished || state.fase !== 'resultado') return;
  state.segundosResultado -= 1;
  if (state.segundosResultado <= 0) siguiente(state);
}

// Reloj para responder: si se acaba, es una cruz (o, en el robo, se pierde).
function turnoEnEspera(state) {
  return !state.finished && state.fase !== 'resultado';
}

function alVencerTurno(state) {
  if (!turnoEnEspera(state)) return;
  if (state.fase === 'robo') {
    state.ultimo = { team: state.activeEntrant, texto: '(sin respuesta)', acierto: false };
    cerrarPregunta(state, state.control);
    return;
  }
  state.cruces += 1;
  state.ultimo = { team: state.activeEntrant, texto: '(sin respuesta)', acierto: false };
  state.lastFeedback = { result: 'wrong', entrantId: state.activeEntrant, cruces: state.cruces };
  if (state.cruces >= CRUCES) {
    state.fase = 'robo';
    state.activeEntrant = otro(state, state.control);
  }
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.points]));
}

function carryOver(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.secondsWon]));
}

function publicView(state) {
  const cerrada = state.fase === 'resultado' || state.finished;
  return {
    type,
    label,
    theme: state.theme,
    number: Math.min(state.index + 1, state.preguntas.length),
    total: state.preguntas.length,
    pregunta: state.pregunta,
    fase: state.fase,
    control: state.control,
    activeEntrant: state.activeEntrant,
    cruces: state.cruces,
    maxCruces: CRUCES,
    pozo: state.pozo,
    multiplicador: state.multiplicador,
    // Las fichas solo muestran texto y puntos cuando están destapadas (o
    // cuando la pregunta se cerró: ahí se ve todo el tablero).
    fichas: (state.respuestas || []).map((r, i) => ({
      n: i + 1,
      revelada: r.revelada,
      texto: r.revelada || cerrada ? r.texto : null,
      puntos: r.revelada || cerrada ? r.puntos : null,
      por: r.por
    })),
    ultimo: state.ultimo,
    ganadorPregunta: state.ganadorPregunta,
    segundosResultado: state.segundosResultado || 0,
    entrants: Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, { points: e.points, secondsWon: e.secondsWon }])),
    lastFeedback: state.lastFeedback,
    finished: state.finished
  };
}

// El anfitrión puede necesitar ver las respuestas ocultas para arbitrar (si
// alguien dijo una bien y el reconocimiento no la tomó). Viajan solo a su
// celu, y la pantalla las muestra recién si él toca "ver para arbitrar".
function privateView(state, viewerId, isTestHost, esAnfitrion) {
  if (!esAnfitrion || state.finished || state.fase === 'resultado' || !state.respuestas) return null;
  return { ocultas: state.respuestas.map((r, i) => (r.revelada ? null : { i, texto: r.texto })).filter(Boolean) };
}

module.exports = {
  type, label, estimateSecondsPerRound, skipMemberGate, opciones,
  createRound, answer, judge, tick, turnoEnEspera, alVencerTurno, scores, carryOver, publicView, privateView,
  // para el validador y las pruebas
  coincide
};
