// Juego "Tutifruti" — el clasico de escribir palabras por categoria que
// empiecen con una letra al azar, contrarreloj. A diferencia de los otros
// juegos, ACA TODOS LOS EQUIPOS ESCRIBEN A LA VEZ (no es por turnos) — es lo
// que le da la tension al juego real. Reparte segundos para el rosco final.
//
// Una sola letra se jugaba en segundos y la prueba quedaba demasiado corta,
// asi que esto son VARIAS rondas seguidas (letras distintas, sin repetir):
// se escribe, se revisa y se puntua igual que antes, pero al terminar una
// letra arranca la siguiente sola, acumulando puntos y segundos de todas.
//
// Validacion: cada palabra se compara contra un banco de palabras por
// categoria. Si esta en el banco, se valida sola. Si no esta pero empieza con
// la letra correcta, queda "dudosa" y el anfitrion (representando lo que
// discutio el grupo en voz alta) la acepta o la rechaza antes de puntuar.

const { loadDecks } = require('../contentLoader');
const { resolver } = require('../opciones');

const type = 'tutifruti';
const label = 'Tutifruti';
const estimateSecondsPerRound = 90;
const simultaneous = true; // no hay "activeEntrant" unico: todos escriben juntos

const SEGUNDOS_POR_PUNTO = 4;
const PUNTOS_UNICA = 2;
const PUNTOS_REPETIDA = 1;

// Sin mazos propios por dificultad, lo que cambia es el tiempo para escribir
// cada letra, el pool de letras posibles (en dificil se suman letras poco
// comunes, que fuerzan a pensar mas) y cuantas letras se juegan en total.
const DIFICULTAD_MECANICA = {
  facil: { segundos: 80, letras: 'ACMPST'.split(''), rondas: 5 },
  normal: { segundos: 60, letras: 'ABCDEFGHIJLMNOPRSTUV'.split(''), rondas: 7 },
  dificil: { segundos: 40, letras: 'ABCDEFGHIJLMNÑOPQRSTUVYZ'.split(''), rondas: 9 }
};
function mecanica(difficulty) {
  return DIFICULTAD_MECANICA[difficulty] || DIFICULTAD_MECANICA.normal;
}

const decks = loadDecks('el-rosco', 'tutifruti');
const banco = decks[0] ? decks[0].data.categorias : {};
const categorias = Object.keys(banco);

function norm(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Primera letra para comparar con la letra sorteada. Igual que norm() (sin
// tildes ni mayusculas) pero respetando la Ñ: norm() la convierte en N, y
// con la letra Ñ se aceptaba "Naranja".
function inicial(s) {
  const c = String(s || '').trim().toLowerCase().charAt(0);
  return c === 'ñ' ? 'ñ' : norm(c);
}

function estaEnElBanco(categoria, palabra) {
  const lista = banco[categoria] || [];
  return lista.some((w) => norm(w) === norm(palabra));
}

// Elige una letra que todavia no se haya usado en esta partida de Tutifruti
// (ni las de rondas anteriores de la sala, para no repetir entre pruebas).
function elegirLetra(m, usadas) {
  const disponibles = m.letras.filter((l) => !usadas.includes(l));
  const pool = disponibles.length ? disponibles : m.letras;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Arranca una letra nueva: sortea la letra, reinicia el reloj y lo que cada
// equipo escribio -- pero NO los puntos/segundos, esos se acumulan entre
// letras durante toda la prueba.
function iniciarLetra(state, m) {
  const letter = elegirLetra(m, state.usedLettersInternal);
  state.usedLettersInternal.push(letter);
  state.letter = letter;
  state.phase = 'writing';
  state.timeLeft = m.segundos;
  state.timeMaxSeconds = m.segundos;
  state.pendingJudgements = [];
  Object.values(state.entrants).forEach((e) => { e.answers = {}; e.submitted = false; });
}

// Ajustes que el anfitrión puede elegir en la sala (ver server/opciones.js).
// Si no elige, cada uno sale de la dificultad.
const opciones = [
  { id: 'letras', label: 'Cantidad de letras', valores: [[3, '3'], [5, '5'], [7, '7'], [9, '9']], porDificultad: { facil: 5, normal: 7, dificil: 9 } },
  { id: 'segundos', label: 'Segundos por letra', valores: [[30, '30 s'], [45, '45 s'], [60, '1 min'], [80, '1 min 20 s']], porDificultad: { facil: 80, normal: 60, dificil: 45 } }
];

function createRound({ entrantIds, usedLetters = [], difficulty, opciones: elegidas }) {
  const o = resolver(opciones, elegidas, difficulty);
  const m = { ...mecanica(difficulty), segundos: o.segundos, rondas: o.letras };

  const entrants = {};
  entrantIds.forEach((id) => {
    entrants[id] = { answers: {}, submitted: false, points: 0, secondsWon: 0 };
  });

  const state = {
    gameType: type,
    difficulty,
    m,
    totalRondas: m.rondas,
    rondaActual: 0, // 0-based
    usedLettersInternal: [...usedLetters],
    letter: null,
    categorias,
    entrants,
    phase: 'writing', // writing -> reviewing
    timeLeft: 0,
    timeMaxSeconds: m.segundos,
    pendingJudgements: [],
    lastFeedback: null,
    finished: false,
    simultaneous
  };
  iniciarLetra(state, m);
  return state;
}

function allSubmitted(state) {
  return Object.values(state.entrants).every((e) => e.submitted);
}

// Arma la cola de palabras "dudosas" (no estan en el banco pero cumplen la
// letra) para que el anfitrion las resuelva antes de puntuar.
function beginReview(state) {
  state.phase = 'reviewing';
  const pending = [];
  categorias.forEach((cat) => {
    Object.entries(state.entrants).forEach(([entrantId, entrant]) => {
      const palabra = (entrant.answers[cat] || '').trim();
      if (!palabra) return;
      if (inicial(palabra) !== inicial(state.letter)) return; // letra incorrecta, invalida directo
      if (!estaEnElBanco(cat, palabra)) {
        pending.push({ entrantId, category: cat, word: palabra, decided: null });
      }
    });
  });
  state.pendingJudgements = pending;
  if (pending.length === 0) resolveScores(state);
}

// Una vez que no quedan palabras dudosas sin resolver, se calcula el puntaje:
// invalida = 0, valida y unica en su categoria = PUNTOS_UNICA, valida pero
// repetida con otro equipo = PUNTOS_REPETIDA (igual que el juego de mesa real).
function resolveScores(state) {
  categorias.forEach((cat) => {
    const validas = {}; // entrantId -> palabra normalizada, solo si es valida
    Object.entries(state.entrants).forEach(([entrantId, entrant]) => {
      const palabra = (entrant.answers[cat] || '').trim();
      if (!palabra || inicial(palabra) !== inicial(state.letter)) return;
      const enBanco = estaEnElBanco(cat, palabra);
      const dudosa = state.pendingJudgements.find((p) => p.entrantId === entrantId && p.category === cat);
      const aceptada = dudosa ? dudosa.decided === true : enBanco;
      if (aceptada) validas[entrantId] = norm(palabra);
    });

    const conteo = {};
    Object.values(validas).forEach((w) => { conteo[w] = (conteo[w] || 0) + 1; });

    Object.entries(validas).forEach(([entrantId, palabra]) => {
      const pts = conteo[palabra] > 1 ? PUNTOS_REPETIDA : PUNTOS_UNICA;
      state.entrants[entrantId].points += pts;
    });
  });

  Object.values(state.entrants).forEach((e) => { e.secondsWon = e.points * SEGUNDOS_POR_PUNTO; });

  // Si todavia quedan letras por jugar en esta prueba, arranca la siguiente
  // sola (los puntos ya quedaron sumados arriba, no se reinician). Recien
  // cuando se jugaron todas las letras se da la prueba entera por terminada.
  state.rondaActual += 1;
  if (state.rondaActual >= state.totalRondas) {
    state.finished = true;
  } else {
    iniciarLetra(state, state.m);
  }
}

// Envio de las respuestas de un equipo (todas las categorias juntas). Como en
// el juego real, el primer equipo en mandar corta a los demas: eso lo maneja
// el cliente (public/app.js), que ni bien ve que otro equipo ya mando, manda
// automaticamente lo que su propio equipo tenia tipeado hasta ese momento.
//
// PERO el que dispara ese corte (el PRIMERO en mandar) tiene que haber
// completado TODAS las categorias -- si no, cualquiera podria cortarle la
// escritura al resto mandando con una o dos casillas nomas. Una vez que ya
// hay un envio valido (el corte ya esta en marcha), los equipos que quedan
// atrapados SI pueden mandar incompleto -- eso es justamente lo que tenian
// escrito cuando los frenaron, no una trampa.
function answer(state, entrantId, payload) {
  if (state.phase !== 'writing') return { error: 'Ya se cerró el tiempo de escritura.' };
  const entrant = state.entrants[entrantId];
  if (!entrant) return { error: 'Tu equipo no está en esta partida.' };
  if (entrant.submitted) return { error: 'Tu equipo ya envió sus respuestas.' };

  const respuestas = (payload && payload.answers) || {};
  const completo = categorias.every((cat) => String(respuestas[cat] || '').trim());
  const otroYaMando = Object.values(state.entrants).some((e) => e.submitted);
  if (!completo && !otroYaMando) {
    return { error: 'Tenés que completar las 6 categorías para mandar primero — así no le cortás la escritura a los demás con solo una o dos.' };
  }

  categorias.forEach((cat) => { entrant.answers[cat] = String(respuestas[cat] || '').replace(/[<>&"'`]/g, '').slice(0, 40); });
  entrant.submitted = true;

  if (allSubmitted(state)) beginReview(state);
  return {};
}

// El anfitrion acepta o rechaza una palabra dudosa (representa lo que
// discutio el grupo en voz alta).
function judge(state, payload) {
  if (state.phase !== 'reviewing') return { error: 'Todavía no se terminó de escribir.' };
  const { entrantId, category, accept } = payload || {};
  const item = state.pendingJudgements.find((p) => p.entrantId === entrantId && p.category === category);
  if (!item) return { error: 'Esa palabra ya fue resuelta o no existe.' };
  item.decided = !!accept;

  if (state.pendingJudgements.every((p) => p.decided !== null)) resolveScores(state);
  return {};
}

// Corre el reloj de escritura; si se acaba, se cierra la ronda igual (los
// equipos que no llegaron a mandar quedan con lo que hayan tipeado hasta ahi).
function tick(state) {
  if (state.phase !== 'writing') return;
  state.timeLeft -= 1;
  if (state.timeLeft <= 0) {
    state.timeLeft = 0;
    Object.values(state.entrants).forEach((e) => { e.submitted = true; });
    beginReview(state);
  }
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.points]));
}

function carryOver(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.secondsWon]));
}

function publicView(state) {
  return {
    type,
    label,
    simultaneous,
    letter: state.letter,
    rondaActual: state.rondaActual + 1,
    totalRondas: state.totalRondas,
    categorias: state.categorias,
    phase: state.phase,
    timeLeft: state.timeLeft,
    timeMaxSeconds: state.timeMaxSeconds,
    // Mientras se escribe, no se ven las respuestas de los demas (para no copiarse).
    entrants: Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, {
      submitted: e.submitted,
      answers: state.phase === 'reviewing' ? e.answers : (e.submitted ? {} : null),
      points: e.points,
      secondsWon: e.secondsWon
    }])),
    pendingJudgements: state.phase === 'reviewing'
      ? state.pendingJudgements.filter((p) => p.decided === null)
      : [],
    finished: state.finished,
    secondsPerPoint: SEGUNDOS_POR_PUNTO
  };
}

module.exports = {
  type, label, estimateSecondsPerRound, simultaneous,
  opciones, createRound, answer, judge, tick, scores, carryOver, publicView
};
