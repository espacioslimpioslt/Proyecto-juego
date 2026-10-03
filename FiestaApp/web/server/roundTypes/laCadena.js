// Juego "La Cadena" — memoria en equipo, al estilo "iba al mercado y
// compré...". Ejemplo: pregunta 1 → responde "sol". Pregunta 2 → antes de
// responder "nube" hay que decir "sol" (lo anterior) y recién ahí "nube".
// Pregunta 3 → hay que decir "sol, nube" y recién ahí la respuesta nueva. Así
// sucesivamente: cada respuesta nueva se agrega a la cadena que hay que
// recitar completa, en orden, antes de sumar la siguiente. Todo se dice en
// UN SOLO audio (la cadena + la respuesta nueva juntas) y el celu lo valida.
//
// Si alguien falla (la cadena que dijo no es correcta, o la respuesta nueva
// no lo es), la CADENA NO SE PIERDE: sigue intacta con lo que ya estaba
// confirmado, y le toca intentar la MISMA pregunta a la siguiente persona del
// equipo (rota sola, mismo motor común de turnos que usan los demás juegos).
// Si nadie del equipo logra extenderla en una vuelta completa (todos
// intentaron esa pregunta y fallaron), ahí sí se termina el turno del equipo
// -- se van con la cadena que lograron armar. El puntaje es el largo de esa
// cadena.
//
// Los equipos NO comparten la misma tanda de preguntas: como se recita en voz
// alta delante de todos, si tuvieran las mismas, el que juega segundo ya
// habría escuchado las respuestas del primero. La cadena del equipo que está
// jugando se ve en la pantalla de todos (incluido el rival) para que sigan
// el hilo, aunque la gracia sea recitarla de memoria sin mirar.

const { loadDecks, pickDeck, shuffle, shuffleOptions } = require('../contentLoader');
const { resolver } = require('../opciones');

const type = 'la-cadena';
const label = 'La Cadena';
const estimateSecondsPerRound = 100;

const SEGUNDOS_POR_ESLABON = 5;

const decks = loadDecks('varios', 'la-cadena');

function norm(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Comprueba que el audio dicho contenga, EN ORDEN, toda la cadena confirmada
// seguida de la respuesta nueva (tolera muletillas de por medio).
function chequearDicho(dicho, secuenciaEsperada) {
  const texto = norm(dicho);
  let cursor = 0;
  for (const palabra of secuenciaEsperada) {
    const p = norm(palabra);
    const idx = texto.indexOf(p, cursor);
    if (idx === -1) return false;
    cursor = idx + p.length;
  }
  return true;
}

// "nube" como palabra suelta dentro de lo dicho (no como parte de otra).
function contienePalabra(texto, palabra) {
  const t = ` ${norm(texto).replace(/[^a-z0-9ñ]+/g, ' ')} `;
  const p = norm(palabra).replace(/[^a-z0-9ñ]+/g, ' ').trim();
  return !!p && t.includes(` ${p} `);
}

// Ajustes que el anfitrión puede elegir en la sala (ver server/opciones.js).
// Si no elige, cada uno sale de la dificultad.
const opciones = [
  { id: 'preguntas', label: 'Largo máximo de la cadena', valores: [[6, '6'], [10, '10'], [15, '15']], porDificultad: { facil: 6, normal: 10, dificil: 15 } }
];

function createRound({ entrantIds, rosters = {}, usedDeckIds = [], region, adultsOnly, difficulty, opciones: elegidas }) {
  const o = resolver(opciones, elegidas, difficulty);
  const m = { preguntas: o.preguntas };
  const deck = pickDeck(decks, usedDeckIds, { region, adultsOnly, difficulty });
  const pool = deck ? shuffle(deck.data.questions) : [];

  // Recorte disjunto por equipo: el equipo 0 se lleva el primer bloque del
  // mazo mezclado, el equipo 1 el siguiente, etc. -- nunca se pisan.
  const questionsByTeam = {};
  entrantIds.forEach((id, i) => {
    const start = i * m.preguntas;
    questionsByTeam[id] = pool.slice(start, start + m.preguntas).map((q) => ({ ...q, ...shuffleOptions(q) }));
  });

  const entrants = {};
  entrantIds.forEach((id) => {
    entrants[id] = { chain: [], helpShuffled: [], secondsWon: 0, done: false };
  });

  const order = [...entrantIds];

  return {
    gameType: type,
    deckId: deck ? deck.id : null,
    theme: deck ? deck.data.theme : null,
    difficulty: difficulty || 'normal',
    rosters,
    questionsByTeam,
    order,
    attemptIndex: 0,
    step: 0, // pregunta actual del equipo activo (0-based) -- NO avanza hasta que alguien la responda bien
    attemptsThisStep: 0, // cuantos integrantes ya intentaron esta pregunta sin lograrlo
    entrants,
    activeEntrant: order[0] || null,
    lastFeedback: null,
    finished: false
  };
}

// Termina el turno del equipo activo (agotó su tanda, o nadie pudo extender
// la cadena en una vuelta completa) y pasa al siguiente, o termina el juego.
function endAttempt(state) {
  const entrant = state.entrants[state.activeEntrant];
  if (entrant) entrant.done = true;

  state.attemptIndex += 1;
  if (state.attemptIndex >= state.order.length) {
    state.finished = true;
    return;
  }
  state.activeEntrant = state.order[state.attemptIndex];
  state.step = 0;
  state.attemptsThisStep = 0;
}

// payload = { recitar: 'texto reconocido: cadena + respuesta nueva, todo junto' }
function answer(state, entrantId, payload) {
  if (state.finished) return { error: 'Este juego ya termino.' };
  if (entrantId !== state.activeEntrant) return { error: 'No es el turno de tu equipo.' };

  const dicho = payload && typeof payload === 'object' ? payload.recitar : null;
  if (typeof dicho !== 'string' || !dicho.trim()) return { error: 'No se reconoció nada dicho.' };

  const misPreguntas = state.questionsByTeam[state.activeEntrant] || [];
  const q = misPreguntas[state.step];
  if (!q) return { error: 'No hay pregunta activa.' };

  const entrant = state.entrants[entrantId];
  const respuestaNueva = q.options[q.correctIndex];
  const secuenciaEsperada = [...entrant.chain, respuestaNueva];

  // Si en el audio aparecen OTRAS opciones de la pregunta, no vale: si no,
  // alcanzaba con decir las 4 opciones seguidas para acertar siempre.
  const otrasOpciones = q.options.filter((o, i) => i !== q.correctIndex
    && norm(o) !== norm(respuestaNueva)
    && !entrant.chain.some((c) => norm(c) === norm(o))); // las de la cadena si hay que decirlas
  const dijoOtras = otrasOpciones.some((o) => contienePalabra(dicho, o));

  if (!dijoOtras && chequearDicho(dicho, secuenciaEsperada)) {
    entrant.chain.push(respuestaNueva);
    entrant.helpShuffled = shuffle(entrant.chain);
    entrant.secondsWon = entrant.chain.length * SEGUNDOS_POR_ESLABON;
    state.attemptsThisStep = 0;
    state.lastFeedback = { entrantId, result: 'correct', correctOption: respuestaNueva, chainLength: entrant.chain.length };
    state.step += 1;
    if (state.step >= misPreguntas.length) endAttempt(state); // completó toda su tanda
  } else {
    // La cadena NO se pierde -- sigue igual. Le toca intentar la MISMA
    // pregunta al siguiente integrante (la rotación la hace sola el motor
    // común, avanza despues de cada intento, acierte o no).
    state.attemptsThisStep += 1;
    state.lastFeedback = { entrantId, result: 'wrong', correctOption: respuestaNueva, heard: dicho };
    const rosterSize = (state.rosters[state.activeEntrant] || []).length || 1;
    if (state.attemptsThisStep >= rosterSize) endAttempt(state); // dio toda la vuelta y nadie pudo
  }
  return {};
}

// Red de seguridad manual del anfitrion, por si el reconocimiento de voz
// falla con algo que en realidad se dijo bien -- da la respuesta por buena.
function judge(state, payload) {
  if (state.finished) return { error: 'Este juego ya termino.' };
  if (!payload || !payload.confirmarManual) return { error: 'Acción no reconocida.' };

  const entrantId = state.activeEntrant;
  const misPreguntas = state.questionsByTeam[entrantId] || [];
  const q = misPreguntas[state.step];
  if (!q) return { error: 'No hay pregunta activa.' };

  const entrant = state.entrants[entrantId];
  const respuestaNueva = q.options[q.correctIndex];
  entrant.chain.push(respuestaNueva);
  entrant.helpShuffled = shuffle(entrant.chain);
  entrant.secondsWon = entrant.chain.length * SEGUNDOS_POR_ESLABON;
  state.attemptsThisStep = 0;
  state.lastFeedback = { entrantId, result: 'correct-manual', correctOption: respuestaNueva, chainLength: entrant.chain.length };
  state.step += 1;
  if (state.step >= misPreguntas.length) endAttempt(state);
  return {};
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.chain.length]));
}

function carryOver(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.secondsWon]));
}

function publicView(state) {
  const misPreguntas = state.questionsByTeam[state.activeEntrant] || [];
  const q = misPreguntas[state.step] || null;
  const entrant = state.entrants[state.activeEntrant] || {};
  const rosterSize = (state.rosters[state.activeEntrant] || []).length || 1;
  return {
    type,
    label,
    theme: state.theme,
    total: misPreguntas.length,
    number: Math.min(state.step + 1, misPreguntas.length || 1),
    // Ayuda segun dificultad -- en facil se ve la cadena ordenada (solo hay
    // que decirla bien, no memorizar el orden); en normal se ve pero
    // desordenada (hay que saber el orden de memoria, no las palabras); en
    // dificil no se ve nada, hay que recordar todo. Se manda a TODOS
    // (incluido el rival) para que sigan el hilo y se enganchen -- la gracia
    // es que quien recita lo diga de memoria sin mirar, no que sea secreto.
    chain: state.difficulty === 'dificil' ? []
      : state.difficulty === 'normal' ? (entrant.helpShuffled || [])
        : (entrant.chain || []),
    chainOrdenada: state.difficulty !== 'normal',
    chainLength: (entrant.chain || []).length,
    attemptsThisStep: state.attemptsThisStep,
    rosterSize,
    question: q ? { clue: q.clue, options: q.options } : null,
    entrants: Object.fromEntries(Object.entries(state.entrants)
      .map(([id, e]) => [id, { chainLength: e.chain.length, secondsWon: e.secondsWon, done: e.done }])),
    activeEntrant: state.activeEntrant,
    lastFeedback: state.lastFeedback,
    finished: state.finished,
    secondsPerEslabon: SEGUNDOS_POR_ESLABON
  };
}

// Cambio quien esta disponible: la vuelta "todos intentaron y nadie pudo"
// se cuenta sobre los que estan, no sobre los que se fueron.
function onRosterChange(state, rosters) {
  state.rosters = rosters;
}

// Reloj para responder (lo maneja el motor, si el anfitrión lo activó): si
// se acaba el tiempo del turno, cuenta como respuesta equivocada y sigue.
function turnoEnEspera(state) {
  return !state.finished;
}

function alVencerTurno(state) {
  if (!turnoEnEspera(state)) return;
  answer(state, state.activeEntrant, { recitar: '(se acabó el tiempo)' });
}

module.exports = { type, label, estimateSecondsPerRound, opciones, createRound, alVencerTurno, turnoEnEspera, answer, onRosterChange, judge, scores, carryOver, publicView };
