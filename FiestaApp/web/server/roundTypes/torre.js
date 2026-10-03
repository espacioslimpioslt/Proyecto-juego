// Juego "La Torre" — de habilidad, en 3D. Un bloque se desliza de un lado a
// otro sobre la torre; el equipo toca la pantalla para soltarlo. Lo que queda
// afuera de la torre se corta y cae, así que cada bloque es más chico que el
// anterior... salvo que caiga justo encima ("¡perfecto!"), que no recorta.
// Si se suelta totalmente afuera, la torre se termina.
//
// Cada equipo arma su propia torre, por turnos, y en cada bloque suelta un
// integrante distinto (rota el motor común de turnos). Gana la más alta.
//
// El celu del que suelta calcula dónde estaba el bloque al tocar y lo manda;
// el servidor valida el rango y hace todo el resto (recorte, perfecto, fin).

const { resolver } = require('../opciones');

const type = 'torre';
const label = 'La Torre';
const estimateSecondsPerRound = 200;

const BASE = 10; // lado del primer bloque
const RANGO = 14; // el bloque va y viene entre -RANGO y +RANGO
const TOLERANCIA_PERFECTO = 0.3;
const MAX_BLOQUES = 60;
const SEG_FIN_TORRE = 6;
const SEG_QUIETO = 15; // si nadie toca en este tiempo, la torre se cae

const VELOCIDADES = { lenta: 9, normal: 12, rapida: 16 }; // unidades por segundo, al arrancar

const opciones = [
  { id: 'velocidad', label: 'Velocidad', valores: [['lenta', 'Lenta'], ['normal', 'Normal'], ['rapida', 'Rápida']], porDificultad: { facil: 'lenta', normal: 'normal', dificil: 'rapida' } },
  { id: 'torres', label: 'Torres por equipo', valores: [[1, '1'], [2, '2']], porDificultad: { facil: 1, normal: 1, dificil: 2 } }
];

// Velocidad del bloque número n (sube con la altura, con tope).
function velocidad(state, n) {
  return Math.min(state.velocidadBase * (1 + n * 0.035), state.velocidadBase * 2.2);
}

function empezarTorre(state) {
  state.activeEntrant = state.order[state.turnoIndex % state.order.length];
  state.bloques = [{ x: 0, z: 0, w: BASE, d: BASE, perfecto: false }];
  state.combo = 0;
  state.perfectosTorre = 0;
  state.fase = 'apilar';
  state.quieto = 0;
  state.caido = null;
  state.resultado = null;
  state.serie = (state.serie || 0) + 1; // identifica cada bloque nuevo (para animar)
}

function terminarTorre(state, motivo) {
  const altura = state.bloques.length - 1;
  const puntos = altura + state.perfectosTorre;
  const e = state.entrants[state.activeEntrant];
  e.points += puntos;
  e.mejorAltura = Math.max(e.mejorAltura, altura);
  e.torres.push(altura);
  state.resultado = { altura, perfectos: state.perfectosTorre, puntos, motivo };
  state.fase = 'fin';
  state.segundosFin = SEG_FIN_TORRE;
  state.lastFeedback = { result: altura >= 8 ? 'correct' : 'wrong', entrantId: state.activeEntrant, altura };
}

function siguienteTorre(state) {
  state.turnoIndex += 1;
  if (state.turnoIndex >= state.order.length * state.torresPorEquipo) {
    state.finished = true;
    return;
  }
  empezarTorre(state);
}

function createRound({ entrantIds, difficulty, opciones: elegidas }) {
  const o = resolver(opciones, elegidas, difficulty);
  const entrants = {};
  entrantIds.forEach((id) => { entrants[id] = { points: 0, secondsWon: 0, mejorAltura: 0, torres: [] }; });
  const state = {
    gameType: type,
    order: [...entrantIds],
    torresPorEquipo: o.torres,
    velocidadBase: VELOCIDADES[o.velocidad] || VELOCIDADES.normal,
    turnoIndex: 0,
    entrants,
    lastFeedback: null,
    finished: entrantIds.length < 1
  };
  if (!state.finished) empezarTorre(state);
  return state;
}

// payload: { pos: número } — dónde estaba el bloque (sobre su eje) al tocar.
function answer(state, entrantId, payload) {
  if (state.finished) return { error: 'Este juego ya terminó.' };
  if (state.fase !== 'apilar') return { error: 'Esperá la próxima torre.' };
  if (entrantId !== state.activeEntrant) return { error: 'No es el turno de tu equipo.' };
  const pos = Number((payload || {}).pos);
  if (!Number.isFinite(pos) || Math.abs(pos) > RANGO + 0.01) return { error: 'Movimiento inválido.' };

  const n = state.bloques.length; // número del bloque que se suelta
  const arriba = state.bloques[n - 1];
  const eje = n % 2 === 1 ? 'x' : 'z';
  const lado = eje === 'x' ? 'w' : 'd';
  const centroAnterior = arriba[eje];
  const tam = arriba[lado];
  const desvio = pos - centroAnterior;
  state.quieto = 0;
  state.serie += 1;

  if (Math.abs(desvio) >= tam) {
    // Afuera por completo: se cae entero y se termina la torre.
    state.caido = { ...arriba, [eje]: pos, n, entero: true };
    terminarTorre(state, 'cayo');
    return {};
  }

  const nuevo = { x: arriba.x, z: arriba.z, w: arriba.w, d: arriba.d, perfecto: false };
  if (Math.abs(desvio) <= TOLERANCIA_PERFECTO) {
    state.combo += 1;
    state.perfectosTorre += 1;
    nuevo.perfecto = true;
    state.caido = null;
    state.lastFeedback = { result: 'perfecto', entrantId, combo: state.combo };
  } else {
    state.combo = 0;
    const queda = tam - Math.abs(desvio);
    nuevo[lado] = queda;
    nuevo[eje] = centroAnterior + desvio / 2;
    // El pedazo que sobra, para que todos lo vean caer: va del borde de la
    // torre al borde exterior del bloque soltado.
    const sobra = Math.abs(desvio);
    state.caido = {
      x: arriba.x, z: arriba.z, w: arriba.w, d: arriba.d, n,
      [lado]: sobra,
      [eje]: pos + Math.sign(desvio) * (tam / 2 - sobra / 2)
    };
    state.lastFeedback = { result: 'correct', entrantId, recorte: Math.round((sobra / tam) * 100) };
  }
  state.bloques.push(nuevo);
  if (state.bloques.length - 1 >= MAX_BLOQUES) terminarTorre(state, 'tope');
  return {};
}

// Anfitrión: pasar a la próxima torre sin esperar.
function judge(state, payload) {
  if (state.finished) return { error: 'Este juego ya terminó.' };
  if (payload && payload.siguiente && state.fase === 'fin') {
    siguienteTorre(state);
    return {};
  }
  return { error: 'Acción no reconocida.' };
}

function tick(state) {
  if (state.finished) return;
  if (state.fase === 'fin') {
    state.segundosFin -= 1;
    if (state.segundosFin <= 0) siguienteTorre(state);
    return;
  }
  state.quieto += 1;
  if (state.quieto >= SEG_QUIETO) {
    state.caido = null;
    terminarTorre(state, 'tiempo');
  }
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.points]));
}

function carryOver(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.secondsWon]));
}

function publicView(state) {
  const n = (state.bloques || []).length;
  return {
    type,
    label,
    number: Math.min(state.turnoIndex + 1, state.order.length * state.torresPorEquipo),
    total: state.order.length * state.torresPorEquipo,
    activeEntrant: state.activeEntrant,
    fase: state.fase,
    bloques: state.bloques || [],
    // Datos del bloque que se mueve ahora (eje, velocidad y rango) para animarlo.
    movil: state.fase === 'apilar' ? { n, eje: n % 2 === 1 ? 'x' : 'z', velocidad: velocidad(state, n - 1), rango: RANGO, serie: state.serie } : null,
    caido: state.caido,
    combo: state.combo || 0,
    quietoRestante: state.fase === 'apilar' ? SEG_QUIETO - state.quieto : null,
    resultado: state.resultado,
    segundosFin: state.segundosFin || 0,
    serie: state.serie,
    entrants: Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, { points: e.points, secondsWon: 0, mejorAltura: e.mejorAltura, torres: e.torres }])),
    lastFeedback: state.lastFeedback,
    finished: state.finished
  };
}

module.exports = {
  type, label, estimateSecondsPerRound, opciones,
  createRound, answer, judge, tick, scores, carryOver, publicView,
  _const: { BASE, RANGO, TOLERANCIA_PERFECTO }
};
