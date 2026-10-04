// Juego "Ruleta" — ruleta europea (un solo cero) con fichas de juego (no hay
// plata real). Todos arrancan con el mismo saldo; en cada tirada hay un
// tiempo para apostar sobre el paño, después gira la ruleta, sale un número
// y se paga a los que acertaron. Al final de todas las tiradas gana el que
// tiene más fichas (con equipos: la suma de las fichas del equipo).
//
// Apuestas y pagos (los de cualquier casino):
//   pleno (1 número) 35 a 1 · caballo (2) 17 a 1 · calle (3) 11 a 1 ·
//   cuadro (4) 8 a 1 · docena / columna 2 a 1 ·
//   rojo / negro / par / impar / falta (1-18) / pasa (19-36) 1 a 1.
// Con el 0 pierden todas las apuestas sencillas, docenas y columnas.
//
// Las fichas se descuentan al apostar; al pagar, el ganador recibe lo
// apostado más el premio.

const crypto = require('crypto');
const { resolver } = require('../opciones');

const type = 'ruleta';
const label = 'Ruleta';
const estimateSecondsPerRound = 420;
const simultaneous = true;
const skipMemberGate = true;

const SALDO_INICIAL = 1000;
const FICHAS = [5, 10, 25, 100, 500];
const SEG_GIRO = 9;
const SEG_PAGO = 12;
const ROJOS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

const PAGOS = { pleno: 35, caballo: 17, calle: 11, cuadro: 8, docena: 2, columna: 2, rojo: 1, negro: 1, par: 1, impar: 1, falta: 1, pasa: 1 };

const opciones = [
  { id: 'tiradas', label: 'Tiradas', valores: [[5, '5'], [8, '8'], [12, '12']], porDificultad: { facil: 5, normal: 8, dificil: 12 } },
  { id: 'segundos', label: 'Tiempo para apostar', valores: [[20, '20 s'], [30, '30 s'], [45, '45 s']], porDificultad: { facil: 45, normal: 30, dificil: 20 } }
];

const fila = (n) => Math.ceil(n / 3); // 1..12
const col = (n) => ((n - 1) % 3) + 1; // 1..3

// Arma (y valida) una apuesta: devuelve { clave, tipo, nums } o null.
function armarApuesta(a) {
  if (!a || typeof a !== 'object') return null;
  const tipo = String(a.tipo || '');
  const nums = Array.isArray(a.nums) ? [...new Set(a.nums.map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 36).sort((x, y) => x - y) : [];
  const v = Number(a.valor);
  switch (tipo) {
    case 'pleno':
      if (nums.length !== 1) return null;
      return { clave: `pleno:${nums[0]}`, tipo, nums };
    case 'caballo': {
      if (nums.length !== 2) return null;
      const [x, y] = nums;
      const ok = (x === 0 && y >= 1 && y <= 3)
        || (x > 0 && y - x === 3)
        || (x > 0 && y - x === 1 && fila(x) === fila(y));
      return ok ? { clave: `caballo:${x}-${y}`, tipo, nums } : null;
    }
    case 'calle': {
      if (!Number.isInteger(v) || v < 1 || v > 12) return null;
      return { clave: `calle:${v}`, tipo, nums: [v * 3 - 2, v * 3 - 1, v * 3] };
    }
    case 'cuadro': {
      // Se identifica por el número de arriba a la izquierda (columnas 1 o 2, filas 1..11).
      if (!Number.isInteger(v) || v < 1 || v > 32 || col(v) === 3) return null;
      return { clave: `cuadro:${v}`, tipo, nums: [v, v + 1, v + 3, v + 4] };
    }
    case 'docena':
      if (![1, 2, 3].includes(v)) return null;
      return { clave: `docena:${v}`, tipo, nums: Array.from({ length: 12 }, (_, i) => (v - 1) * 12 + i + 1) };
    case 'columna':
      if (![1, 2, 3].includes(v)) return null;
      return { clave: `columna:${v}`, tipo, nums: Array.from({ length: 12 }, (_, i) => i * 3 + v) };
    case 'rojo': case 'negro': case 'par': case 'impar': case 'falta': case 'pasa': {
      const todos = Array.from({ length: 36 }, (_, i) => i + 1);
      const f = { rojo: (n) => ROJOS.has(n), negro: (n) => !ROJOS.has(n), par: (n) => n % 2 === 0, impar: (n) => n % 2 === 1, falta: (n) => n <= 18, pasa: (n) => n >= 19 }[tipo];
      return { clave: tipo, tipo, nums: todos.filter(f) };
    }
    default:
      return null;
  }
}

function empezarApuestas(state) {
  state.fase = 'apuestas';
  state.segundos = state.segundosApuestas;
  state.serie += 1;
  state.numero = null;
  state.resultados = {};
  state.listos = {};
  state.jugadores.forEach((j) => { state.apuestas[j.id] = []; state.pila[j.id] = []; });
}

function totalApostado(state, id) {
  return (state.apuestas[id] || []).reduce((a, x) => a + x.monto, 0);
}

function cerrarApuestas(state) {
  state.fase = 'giro';
  state.segundos = SEG_GIRO;
  state.serie += 1;
  state.numero = crypto.randomInt(37);
  state.historial.unshift(state.numero);
  state.historial = state.historial.slice(0, 15);
  // Se guardan para el botón "repetir" de la tirada siguiente.
  state.jugadores.forEach((j) => { if ((state.apuestas[j.id] || []).length) state.ultimas[j.id] = state.apuestas[j.id].map((x) => ({ ...x })); });
}

// El pago se hace cuando la cámara llega al paño (fase 'pago').
function pagar(state) {
  const n = state.numero;
  state.jugadores.forEach((j) => {
    const lista = state.apuestas[j.id] || [];
    let ganado = 0;
    const ganadoras = [];
    lista.forEach((x) => {
      if (x.nums.includes(n)) {
        ganado += x.monto * (PAGOS[x.tipo] + 1);
        ganadoras.push(x.clave);
      }
    });
    const apostado = lista.reduce((a, x) => a + x.monto, 0);
    state.saldos[j.id] += ganado;
    state.resultados[j.id] = { apostado, ganado, neto: ganado - apostado, ganadoras };
  });
  state.fase = 'pago';
  state.segundos = SEG_PAGO;
  state.serie += 1;
  actualizarPuntos(state);
  const mejor = Object.entries(state.resultados).sort((a, b) => b[1].neto - a[1].neto)[0];
  state.lastFeedback = mejor && mejor[1].neto > 0 ? { result: 'correct', entrantId: (state.jugadores.find((j) => j.id === mejor[0]) || {}).entrant } : null;
}

function actualizarPuntos(state) {
  Object.keys(state.entrants).forEach((id) => { state.entrants[id].points = 0; });
  state.jugadores.forEach((j) => { state.entrants[j.entrant].points += state.saldos[j.id]; });
}

function siguienteTirada(state) {
  state.tirada += 1;
  const conFichas = state.jugadores.filter((j) => state.saldos[j.id] >= FICHAS[0]);
  if (state.tirada > state.totalTiradas || !conFichas.length) {
    state.finished = true;
    return;
  }
  empezarApuestas(state);
}

function createRound({ entrantIds, rosters = {}, difficulty, opciones: elegidas }) {
  const o = resolver(opciones, elegidas, difficulty);
  const entrants = {};
  entrantIds.forEach((id) => { entrants[id] = { points: 0, secondsWon: 0 }; });
  const jugadores = entrantIds.flatMap((id) => (rosters[id] || []).map((p) => ({ id: p.id, name: p.name, entrant: id })));
  const state = {
    gameType: type,
    jugadores,
    saldos: Object.fromEntries(jugadores.map((j) => [j.id, SALDO_INICIAL])),
    apuestas: {},
    pila: {}, // orden en que cada uno puso sus fichas (para "deshacer")
    ultimas: {},
    resultados: {},
    listos: {},
    historial: [],
    totalTiradas: o.tiradas,
    segundosApuestas: o.segundos,
    tirada: 1,
    serie: 0,
    numero: null,
    entrants,
    activeEntrant: null,
    lastFeedback: null,
    finished: jugadores.length < 1
  };
  actualizarPuntos(state);
  if (!state.finished) empezarApuestas(state);
  return state;
}

function quien(state, playerId, isTestHost) {
  const j = state.jugadores.find((x) => x.id === playerId);
  if (j) return j;
  return isTestHost ? state.jugadores[0] : null;
}

// payload: { apostar: { tipo, nums?, valor? }, monto } | { quitar: true } |
// { limpiar: true } | { repetir: true } | { listo: true }
function answer(state, entrantId, payload, playerId, isTestHost) {
  if (state.finished) return { error: 'Este juego ya terminó.' };
  if (state.fase !== 'apuestas') return { error: '¡No va más! Esperá la próxima tirada.' };
  const j = quien(state, playerId, isTestHost);
  if (!j) return { error: 'No estás en esta mesa (entraste con el juego empezado).' };
  const p = payload || {};
  const mias = state.apuestas[j.id] = state.apuestas[j.id] || [];

  if (p.apostar) {
    const ap = armarApuesta(p.apostar);
    if (!ap) return { error: 'Esa apuesta no vale.' };
    const monto = Number(p.monto);
    if (!FICHAS.includes(monto)) return { error: 'Ficha inválida.' };
    if (monto > state.saldos[j.id]) return { error: 'No te alcanzan las fichas.' };
    state.saldos[j.id] -= monto;
    const ya = mias.find((x) => x.clave === ap.clave);
    if (ya) ya.monto += monto;
    else mias.push({ ...ap, monto });
    (state.pila[j.id] = state.pila[j.id] || []).push({ clave: ap.clave, monto });
  } else if (p.quitar) {
    const ult = (state.pila[j.id] || []).pop();
    if (!ult) return { error: 'No hay apuestas para sacar.' };
    const x = mias.find((y) => y.clave === ult.clave);
    if (x) {
      x.monto -= ult.monto;
      state.saldos[j.id] += ult.monto;
      if (x.monto <= 0) mias.splice(mias.indexOf(x), 1);
    }
  } else if (p.limpiar) {
    state.saldos[j.id] += totalApostado(state, j.id);
    state.apuestas[j.id] = [];
    state.pila[j.id] = [];
  } else if (p.repetir) {
    const ult = state.ultimas[j.id] || [];
    const total = ult.reduce((a, x) => a + x.monto, 0);
    if (!ult.length) return { error: 'No hay apuestas anteriores para repetir.' };
    if (total > state.saldos[j.id]) return { error: 'No te alcanzan las fichas para repetir.' };
    state.saldos[j.id] -= total;
    ult.forEach((x) => {
      const ya = mias.find((y) => y.clave === x.clave);
      if (ya) ya.monto += x.monto; else mias.push({ ...x });
      (state.pila[j.id] = state.pila[j.id] || []).push({ clave: x.clave, monto: x.monto });
    });
  } else if (p.listo) {
    state.listos[j.id] = true;
    const faltan = state.jugadores.filter((x) => !state.listos[x.id] && !String(x.id).startsWith('test:') && state.saldos[x.id] + totalApostado(state, x.id) >= FICHAS[0]);
    if (!faltan.length) cerrarApuestas(state);
    return {};
  } else {
    return { error: 'Acción no reconocida.' };
  }
  delete state.listos[j.id];
  actualizarPuntos(state);
  return {};
}

// Anfitrión: "¡No va más!" (cerrar antes) o pasar a la próxima tirada.
function judge(state, payload) {
  if (state.finished) return { error: 'Este juego ya terminó.' };
  const p = payload || {};
  if (p.cerrar && state.fase === 'apuestas') { cerrarApuestas(state); return {}; }
  if (p.siguiente && state.fase === 'pago') { siguienteTirada(state); return {}; }
  return { error: 'Acción no reconocida.' };
}

function tick(state) {
  if (state.finished) return;
  state.segundos -= 1;
  if (state.segundos > 0) return;
  if (state.fase === 'apuestas') cerrarApuestas(state);
  else if (state.fase === 'giro') pagar(state);
  else siguienteTirada(state);
}

// Si alguien se va, sus apuestas de esta tirada se le devuelven (y deja de jugar).
function onRosterChange(state, rosters) {
  const siguen = new Set(Object.values(rosters).flat().map((p) => p.id));
  state.jugadores.forEach((j) => {
    if (!siguen.has(j.id) && state.fase === 'apuestas' && (state.apuestas[j.id] || []).length) {
      state.saldos[j.id] += totalApostado(state, j.id);
      state.apuestas[j.id] = [];
    }
  });
  actualizarPuntos(state);
}

function scores(state) {
  return Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, e.points]));
}

function carryOver(state) {
  return Object.fromEntries(Object.keys(state.entrants).map((id) => [id, 0]));
}

function publicView(state) {
  // Todo el paño: cuánto hay en cada lugar y de quién (como en la mesa real,
  // las fichas de todos están a la vista).
  const mesa = {};
  state.jugadores.forEach((j) => (state.apuestas[j.id] || []).forEach((x) => {
    const m = mesa[x.clave] = mesa[x.clave] || { clave: x.clave, tipo: x.tipo, nums: x.nums, total: 0, de: {} };
    m.total += x.monto;
    m.de[j.id] = (m.de[j.id] || 0) + x.monto;
  }));
  const mostrarNumero = state.fase === 'giro' || state.fase === 'pago';
  return {
    type,
    label,
    number: Math.min(state.tirada, state.totalTiradas),
    total: state.totalTiradas,
    fase: state.fase,
    segundos: Math.max(state.segundos, 0),
    segundosApuestas: state.segundosApuestas,
    serie: state.serie,
    numero: mostrarNumero ? state.numero : null,
    // Durante el giro el último número todavía no se muestra en el historial.
    historial: state.fase === 'giro' ? state.historial.slice(1) : state.historial,
    fichas: FICHAS,
    pagos: PAGOS,
    mesa: Object.values(mesa),
    jugadores: state.jugadores.map((j) => ({
      ...j,
      saldo: state.saldos[j.id],
      apostado: totalApostado(state, j.id),
      listo: !!state.listos[j.id],
      puedeRepetir: !!(state.ultimas[j.id] || []).length,
      resultado: state.fase === 'pago' ? state.resultados[j.id] || null : null
    })),
    activeEntrant: null,
    entrants: Object.fromEntries(Object.entries(state.entrants).map(([id, e]) => [id, { points: e.points, secondsWon: 0 }])),
    lastFeedback: state.lastFeedback,
    finished: state.finished
  };
}

module.exports = {
  type, label, estimateSecondsPerRound, simultaneous, skipMemberGate, opciones,
  createRound, answer, judge, tick, onRosterChange, scores, carryOver, publicView,
  _test: { armarApuesta, PAGOS, ROJOS }
};
