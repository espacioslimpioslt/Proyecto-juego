// Carga y filtrado de contenido, compartido por todos los juegos.
// El contenido vive en programs/<programa>/content/<juego>/<mazo>.json
// Cada mazo declara para quien sirve (regiones, edad minima), asi un grupo en
// Brasil no recibe preguntas sobre proceres argentinos.

const fs = require('fs');
const path = require('path');

const PROGRAMS_DIR = path.join(__dirname, '..', 'programs');

function contentDir(programId, gameId) {
  return path.join(PROGRAMS_DIR, programId, 'content', gameId);
}

function loadDecks(programId, gameId) {
  const dir = contentDir(programId, gameId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const deck = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      return {
        id: `${gameId}/${f.replace(/\.json$/, '')}`,
        theme: deck.theme,
        regions: deck.regions || ['global'],
        minAge: deck.minAge || 0,
        // Los mazos viejos no tienen dificultad declarada -- se tratan como
        // "normal" para no romper nada de lo que ya existia.
        difficulty: deck.difficulty || 'normal',
        data: deck
      };
    });
}

// Un mazo sirve si su region es 'global' o incluye el pais elegido, si su
// edad minima esta permitida para el publico de esta partida, y si coincide
// con la dificultad elegida por el anfitrion.
function decksFor(decks, { region = 'global', adultsOnly = false, difficulty = 'normal' } = {}) {
  return decks.filter((d) => {
    const okRegion = d.regions.includes('global') || d.regions.includes(region);
    const okAge = adultsOnly || d.minAge < 18;
    const okDifficulty = d.difficulty === difficulty;
    return okRegion && okAge && okDifficulty;
  });
}

// Elige un mazo al azar entre los que corresponden, evitando repetir.
// Si ningun mazo cumple todos los filtros, se aflojan de a uno -- primero la
// dificultad, despues el pais -- pero la EDAD nunca: antes se caia a "todos
// los mazos" y podia salir uno +18 con "solo mayores" apagado.
function pickDeck(decks, usedDeckIds = [], filters = {}) {
  const permitidos = decks.filter((d) => filters.adultsOnly || d.minAge < 18);
  const intentos = [
    decksFor(permitidos, filters),
    permitidos.filter((d) => d.regions.includes('global') || d.regions.includes(filters.region || 'global')),
    permitidos
  ];
  const safe = intentos.find((lista) => lista.length) || [];
  if (!safe.length) return null;
  const unused = safe.filter((d) => !usedDeckIds.includes(d.id));
  const pool = unused.length ? unused : safe;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Fisher-Yates: mezcla pareja. El viejo sort(() => Math.random() - 0.5) hacia
// que algunos ordenes salieran bastante mas que otros.
function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Mezcla las opciones y devuelve donde quedo la correcta. Sin esto, quien
// escribe el contenido tiende a dejar la correcta siempre en el mismo lugar.
function shuffleOptions(item) {
  const correct = item.options[item.correctIndex];
  const options = shuffle(item.options);
  return { options, correctIndex: options.indexOf(correct) };
}

module.exports = { loadDecks, decksFor, pickDeck, shuffle, shuffleOptions };
