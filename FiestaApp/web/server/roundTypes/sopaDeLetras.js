// Juego "Sopa de Letras" — inspirado en la prueba de paneles del programa.
// Panel de 7x7 con palabras escondidas de un mismo tema, en horizontal o
// vertical. Para marcar una palabra se toca la primera y la ultima letra.
// Reparte segundos para el rosco final.
//
// Cada equipo tiene su PROPIA copia independiente del mismo panel (mismas
// letras, mismas palabras a buscar) y la resuelve por su cuenta, a su
// ritmo, al mismo tiempo que el otro equipo -- no comparten el pool de
// palabras encontradas, encontrar "PERRO" en la copia de un equipo no se lo
// saca al otro. Gana el que termina de encontrar TODAS sus palabras en menos
// tiempo.

const { loadDecks, pickDeck, shuffle } = require('../contentLoader');
const { resolver } = require('../opciones');

const type = 'sopa-de-letras';
const label = 'Sopa de Letras';
const estimateSecondsPerRound = 120;
const simultaneous = true; // los dos equipos resuelven su propia copia al mismo tiempo
const skipMemberGate = true; // cualquiera del equipo puede marcar palabras, no solo el de turno

const SEGUNDOS_POR_ACIERTO = 8;

// Errar tambien resta segundos (a su propio reloj, ya no a uno compartido),
// para que convenga marcar solo cuando estan seguros y no tirar a lo loco.
const SEGUNDOS_PENALIDAD_ERROR = 5;

// Bono para el equipo que termina TODO su panel mas rapido (entre los que
// realmente llegan a terminar).
const SEGUNDOS_BONUS_VELOCIDAD = 15;

const ABC = 'ABCDEFGHILMNOPRSTUVZ';

const decks = loadDecks('el-rosco', 'sopa-de-letras');

// Rango valido de la celda inicial para una direccion dada: si el delta es
// +1 la palabra crece "hacia adelante" asi que tiene que arrancar temprano;
// si es -1 crece "hacia atras" asi que tiene que arrancar tarde; si es 0 no
// hay restriccion en esa dimension.
function rangeFor(dim, delta, length) {
  if (delta === 1) return [0, dim - length];
  if (delta === -1) return [length - 1, dim - 1];
  return [0, dim - 1];
}

// Intenta colocar una palabra en el panel. Horizontal/vertical siempre "para
// adelante"; en dificultad dificil tambien se prueba al reves (derecha a
// izquierda, abajo hacia arriba) para que se lean invertidas en la grilla.
function place(grid, word, size, alReves) {
  const dirSet = alReves ? [[0, 1], [1, 0], [0, -1], [-1, 0]] : [[0, 1], [1, 0]];
  const dirs = shuffle(dirSet); // [fila, columna]
  for (const [dr, dc] of dirs) {
    const [minR, maxR] = rangeFor(size, dr, word.length);
    const [minC, maxC] = rangeFor(size, dc, word.length);
    if (maxR < minR || maxC < minC) continue;

    const spots = [];
    for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) spots.push([r, c]);

    for (const [r0, c0] of shuffle(spots)) {
      let ok = true;
      for (let i = 0; i < word.length; i++) {
        const cell = grid[r0 + dr * i][c0 + dc * i];
        if (cell !== null && cell !== word[i]) { ok = false; break; }
      }
      if (!ok) continue;

      const cells = [];
      for (let i = 0; i < word.length; i++) {
        const r = r0 + dr * i;
        const c = c0 + dc * i;
        grid[r][c] = word[i];
        cells.push(r * size + c);
      }
      return cells;
    }
  }
  return null;
}

function buildPanel(panel, size, alReves) {
  const grid = Array.from({ length: size }, () => Array(size).fill(null));
  const placed = [];

  // En dificultad "facil" el panel es mas chico (6x6): si alguna palabra del
  // tema no entra, se la deja afuera en vez de romper -- puede pasar con
  // palabras largas en una grilla reducida.
  for (const word of panel.words) {
    const upper = word.toUpperCase();
    if (upper.length > size) continue;
    const cells = place(grid, upper, size, alReves);
    if (cells) placed.push({ word: upper, cells });
  }

  // Se rellenan los huecos con letras al azar.
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === null) grid[r][c] = ABC[Math.floor(Math.random() * ABC.length)];
    }
  }

  return { grid: grid.flat(), words: placed };
}

// Ajustes que el anfitrión puede elegir en la sala (ver server/opciones.js).
// Si no elige, cada uno sale de la dificultad.
const opciones = [
  { id: 'tamano', label: 'Tamaño del panel', valores: [[6, '6×6'], [7, '7×7'], [9, '9×9']], porDificultad: { facil: 6, normal: 7, dificil: 9 } },
  { id: 'segundos', label: 'Tiempo máximo', valores: [[60, '1 min'], [90, '1 min 30 s'], [120, '2 min'], [150, '2 min 30 s']], porDificultad: { facil: 120, normal: 90, dificil: 90 } },
  { id: 'alReves', label: 'Palabras al revés', valores: [['no', 'No'], ['si', 'Sí']], porDificultad: { facil: 'no', normal: 'no', dificil: 'si' } }
];

function createRound({ entrantIds, usedDeckIds = [], region, adultsOnly, difficulty, opciones: elegidas }) {
  const o = resolver(opciones, elegidas, difficulty);
  const m = { size: o.tamano, segundosMax: o.segundos, alReves: o.alReves === 'si' };
  const deck = pickDeck(decks, usedDeckIds, { region, adultsOnly, difficulty });
  const panel = deck ? shuffle(deck.data.panels)[0] : null;
  const built = panel ? buildPanel(panel, m.size, m.alReves) : { grid: [], words: [] };

  // Mismo panel (mismas letras, mismas palabras) para los dos, pero cada
  // equipo tiene su PROPIA copia de progreso -- encontrar una palabra en la
  // copia de un equipo no afecta la del otro.
  const entrants = {};
  entrantIds.forEach((id) => {
    entrants[id] = {
      words: built.words.map((w) => ({ word: w.word, cells: w.cells, found: false })),
      penaltySeconds: 0,
      finished: false,
      finishSeconds: null // segundos transcurridos cuando termino TODO su panel; null si no llego
    };
  });

  return {
    gameType: type,
    deckId: deck ? deck.id : null,
    theme: deck ? deck.data.theme : null,
    topic: panel ? panel.topic : null,
    size: m.size,
    grid: built.grid,
    totalWords: built.words.length,
    secondsElapsed: 0,
    maxSeconds: m.segundosMax,
    entrants,
    lastFeedback: null,
    finished: entrantIds.length < 1 || built.words.length === 0,
    simultaneous
  };
}

function todosTerminaron(state) {
  return Object.values(state.entrants).every((e) => e.finished);
}

// Corre el reloj general. Si se acaba el tiempo maximo, los equipos que no
// llegaron a terminar quedan asi (sin bonus de velocidad, con lo que hayan
// encontrado) y se cierra la prueba entera.
function tick(state) {
  if (state.finished) return;
  state.secondsElapsed += 1;
  if (state.secondsElapsed >= state.maxSeconds) {
    Object.values(state.entrants).forEach((e) => { e.finished = true; });
    state.finished = true;
  }
}

// La "respuesta" son dos casillas: la primera y la ultima letra de la palabra.
function answer(state, entrantId, payload) {
  if (state.finished) return { error: 'Este juego ya termino.' };
  const entrant = state.entrants[entrantId];
  if (!entrant) return { error: 'Tu equipo no está en esta partida.' };
  if (entrant.finished) return { error: 'Tu equipo ya terminó su sopa.' };

  const { from, to } = payload || {};
  if (typeof from !== 'number' || typeof to !== 'number') {
    return { error: 'Marca la primera y la ultima letra de la palabra.' };
  }

  const yaEncontrada = entrant.words.find((w) => w.found
    && ((w.cells[0] === from && w.cells[w.cells.length - 1] === to)
      || (w.cells[0] === to && w.cells[w.cells.length - 1] === from)));
  if (yaEncontrada) {
    // Puede pasar si dos del mismo equipo marcan la misma palabra casi a la
    // vez -- no es un error, ya estaba encontrada, no se penaliza.
    state.lastFeedback = { entrantId, result: 'already-found', word: yaEncontrada.word };
    return {};
  }

  const hit = entrant.words.find((w) => !w.found
    && ((w.cells[0] === from && w.cells[w.cells.length - 1] === to)
      || (w.cells[0] === to && w.cells[w.cells.length - 1] === from)));

  if (hit) {
    hit.found = true;
    state.lastFeedback = { entrantId, result: 'correct', word: hit.word };
    if (entrant.words.every((w) => w.found)) {
      entrant.finished = true;
      entrant.finishSeconds = state.secondsElapsed;
      if (todosTerminaron(state)) state.finished = true;
    }
  } else {
    entrant.penaltySeconds += SEGUNDOS_PENALIDAD_ERROR;
    state.lastFeedback = { entrantId, result: 'wrong', penaltySeconds: SEGUNDOS_PENALIDAD_ERROR };
  }
  return {};
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.entrants)
    .map(([id, e]) => [id, e.words.filter((w) => w.found).length]));
}

// Segundos ganados: uno por cada palabra encontrada, menos la penalidad por
// errores, mas un bono extra para el equipo mas rapido en terminar todo.
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
    const encontradas = e.words.filter((w) => w.found).length;
    let segundos = encontradas * SEGUNDOS_POR_ACIERTO - e.penaltySeconds;
    if (id === mejorEntrant) segundos += SEGUNDOS_BONUS_VELOCIDAD;
    return [id, Math.max(0, segundos)];
  }));
}

function publicView(state) {
  return {
    type,
    label,
    simultaneous,
    theme: state.theme,
    topic: state.topic,
    size: state.size,
    grid: state.grid,
    totalWords: state.totalWords,
    secondsElapsed: state.secondsElapsed,
    maxSeconds: state.maxSeconds,
    entrants: Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, {
      words: e.words.map((w) => ({ word: w.word, found: w.found, cells: w.found ? w.cells : null })),
      wordsFound: e.words.filter((w) => w.found).length,
      penaltySeconds: e.penaltySeconds,
      finished: e.finished,
      finishSeconds: e.finishSeconds
    }])),
    lastFeedback: state.lastFeedback,
    finished: state.finished,
    secondsPerHit: SEGUNDOS_POR_ACIERTO,
    penaltySeconds: SEGUNDOS_PENALIDAD_ERROR,
    speedBonusSeconds: SEGUNDOS_BONUS_VELOCIDAD
  };
}

module.exports = {
  type, label, estimateSecondsPerRound, simultaneous, skipMemberGate,
  opciones, createRound, answer, tick, scores, carryOver, publicView
};
