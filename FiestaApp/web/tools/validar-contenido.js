// Revisa el contenido de todos los juegos del Programa.
// Correr con: node tools/validar-contenido.js
//
// Sirve especialmente si se generan mazos nuevos con ayuda de IA: verifica que
// las respuestas correctas realmente cumplan lo que pide la consigna.

const fs = require('fs');
const path = require('path');

const PROGRAMS_DIR = path.join(__dirname, '..', 'programs');

function norm(s) {
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    // Se conservan los dígitos -- preguntas con respuestas numéricas (años,
    // cantidades) son contenido válido, y sacarlos hacía que "1969" y "1965"
    // parecieran la misma opción repetida.
    .replace(/[^a-zñ0-9]/g, '');
}

let problemas = 0;
const aviso = (msg) => { console.log(`   ✗ ${msg}`); problemas++; };

function checkOpciones(item, donde) {
  if (!Array.isArray(item.options) || item.options.length < 2) {
    return aviso(`${donde}: faltan opciones`);
  }
  if (typeof item.correctIndex !== 'number'
    || item.correctIndex < 0
    || item.correctIndex >= item.options.length) {
    return aviso(`${donde}: correctIndex fuera de rango`);
  }
  const set = new Set(item.options.map(norm));
  if (set.size !== item.options.length) aviso(`${donde}: opciones repetidas`);
}

// --- El Rosco: la respuesta debe empezar/contener/terminar con la letra ---
function validarRosco(deck) {
  const vistas = new Set();
  deck.letters.forEach((item) => {
    const donde = `letra ${item.letter}`;
    checkOpciones(item, donde);
    if (vistas.has(item.letter)) aviso(`${donde}: letra repetida`);
    vistas.add(item.letter);

    const L = norm(item.letter);
    const ans = norm(item.options[item.correctIndex]);
    const ok = item.clueType === 'empieza' ? ans.startsWith(L)
      : item.clueType === 'termina' ? ans.endsWith(L)
        : ans.includes(L);
    if (!ok) aviso(`${donde} (${item.clueType}): "${item.options[item.correctIndex]}" no cumple`);
  });
  const tipos = deck.letters.reduce((a, i) => { a[i.clueType] = (a[i.clueType] || 0) + 1; return a; }, {});
  console.log(`   ${deck.letters.length} letras | tipos:`, tipos);
}

// --- Elegí Una / Palabras Cruzadas: preguntas con opciones ---
function validarPreguntas(deck) {
  deck.questions.forEach((q, i) => checkOpciones(q, `pregunta ${i + 1}`));
  console.log(`   ${deck.questions.length} preguntas`);
}

// --- La Silla: todas las respuestas de una tanda empiezan con la misma letra ---
function validarSilla(deck) {
  deck.chains.forEach((chain) => {
    const L = norm(chain.letter);
    chain.questions.forEach((q, i) => {
      const donde = `tanda ${chain.letter}, pregunta ${i + 1}`;
      checkOpciones(q, donde);
      const ans = norm(q.options[q.correctIndex]);
      if (!ans.startsWith(L)) {
        aviso(`${donde}: "${q.options[q.correctIndex]}" no empieza con ${chain.letter}`);
      }
    });
    if (chain.questions.length < 3) aviso(`tanda ${chain.letter}: muy corta`);
  });
  console.log(`   ${deck.chains.length} tandas`);
}

// --- ¿Dónde Estaba?: paneles de exactamente 9 imágenes (emoji + nombre) ---
function validarPaneles9(deck) {
  deck.panels.forEach((p) => {
    if (p.items.length !== 9) aviso(`panel "${p.topic}": tiene ${p.items.length} imágenes, deben ser 9`);
    if (new Set(p.items.map((it) => norm(it.label))).size !== p.items.length) {
      aviso(`panel "${p.topic}": imágenes repetidas`);
    }
    p.items.forEach((it) => {
      if (!it.emoji || !it.label) aviso(`panel "${p.topic}": item sin emoji o sin nombre`);
    });
  });
  console.log(`   ${deck.panels.length} paneles`);
}

// --- Sopa de Letras: palabras cortas, sin espacios, que entren en la grilla ---
function validarSopa(deck) {
  deck.panels.forEach((p) => {
    p.words.forEach((w) => {
      if (w.length > 7) aviso(`panel "${p.topic}": "${w}" no entra en la grilla de 7`);
      if (/[^A-ZÁÉÍÓÚÑ]/i.test(w)) aviso(`panel "${p.topic}": "${w}" tiene caracteres raros`);
    });
    if (p.words.length < 3) aviso(`panel "${p.topic}": muy pocas palabras`);
  });
  console.log(`   ${deck.panels.length} paneles`);
}

// --- Palabras Cruzadas: la cruzada debe compartir letra con la base ---
function validarCruzadas(deck) {
  deck.boards.forEach((b) => {
    const base = b.base.word.toUpperCase();
    b.crosses.forEach((c) => {
      const donde = `tablero "${b.topic}", cruzada ${c.word}`;
      checkOpciones(c, donde);
      const word = c.word.toUpperCase();
      if (c.baseIndex >= base.length) return aviso(`${donde}: baseIndex fuera de la palabra base`);
      if (c.wordIndex >= word.length) return aviso(`${donde}: wordIndex fuera de la palabra`);
      if (base[c.baseIndex] !== word[c.wordIndex]) {
        aviso(`${donde}: no cruza — base tiene "${base[c.baseIndex]}" y la palabra "${word[c.wordIndex]}"`);
      }
      if (c.options[c.correctIndex].toUpperCase() !== word) {
        aviso(`${donde}: la opción correcta no coincide con la palabra`);
      }
    });
  });
  console.log(`   ${deck.boards.length} tableros`);
}

// --- Tutifruti: banco de palabras por categoria, sin repetidas ---
function validarTutifruti(deck) {
  Object.entries(deck.categorias).forEach(([cat, lista]) => {
    if (lista.length < 10) aviso(`categoría "${cat}": muy pocas palabras (${lista.length})`);
    if (new Set(lista.map(norm)).size !== lista.length) aviso(`categoría "${cat}": palabras repetidas`);
    lista.forEach((w) => {
      if (!/^[a-záéíóúñ ]+$/i.test(w)) aviso(`categoría "${cat}": "${w}" tiene caracteres raros`);
    });
  });
  console.log(`   ${Object.keys(deck.categorias).length} categorías`);
}

// --- Mímica: lista plana de palabras/frases cortas, sin repetidas ---
function validarMimica(deck) {
  if (!Array.isArray(deck.words) || deck.words.length < 15) {
    aviso(`muy pocas palabras (${(deck.words || []).length}), hacen falta al menos 15`);
  }
  if (new Set((deck.words || []).map(norm)).size !== (deck.words || []).length) {
    aviso('hay palabras repetidas');
  }
  (deck.words || []).forEach((w) => {
    if (!/^[a-záéíóúñ ]+$/i.test(w)) aviso(`"${w}" tiene caracteres raros`);
  });
  console.log(`   ${(deck.words || []).length} palabras`);
}

// --- Palabra Prohibida: cada tarjeta tiene palabra + 3-4 prohibidas, sin repetidas ---
function validarPalabraProhibida(deck) {
  (deck.cards || []).forEach((c, i) => {
    const donde = `tarjeta ${i + 1} ("${c.word}")`;
    if (!c.word) return aviso(`${donde}: sin palabra`);
    if (!Array.isArray(c.forbidden) || c.forbidden.length < 3) {
      aviso(`${donde}: hacen falta al menos 3 palabras prohibidas, tiene ${(c.forbidden || []).length}`);
    }
    const todas = [c.word, ...(c.forbidden || [])];
    if (new Set(todas.map(norm)).size !== todas.length) {
      aviso(`${donde}: la palabra se repite entre las prohibidas, o hay prohibidas repetidas`);
    }
  });
  const palabras = (deck.cards || []).map((c) => c.word);
  if (new Set(palabras.map(norm)).size !== palabras.length) aviso('hay tarjetas con la misma palabra');
  console.log(`   ${(deck.cards || []).length} tarjetas`);
}

const VALIDADORES = {
  rosco: validarRosco,
  'eligi-una': validarPreguntas,
  'la-silla': validarSilla,
  'donde-estaba': validarPaneles9,
  'sopa-de-letras': validarSopa,
  'palabras-cruzadas': validarCruzadas,
  tutifruti: validarTutifruti,
  'la-cadena': validarPreguntas,
  mimica: validarMimica,
  'palabra-prohibida': validarPalabraProhibida,
  'duelo-torres': validarPreguntas,
  'escalera-final': validarPreguntas
};

// Recorre TODOS los Programas (El Rosco, Varios, los que se sumen despues),
// no solo uno -- cada uno tiene su propia carpeta programs/<id>/content/.
for (const programa of fs.readdirSync(PROGRAMS_DIR)) {
  const CONTENT = path.join(PROGRAMS_DIR, programa, 'content');
  if (!fs.existsSync(CONTENT) || !fs.statSync(CONTENT).isDirectory()) continue;

  for (const juego of fs.readdirSync(CONTENT)) {
  const dir = path.join(CONTENT, juego);
  if (!fs.statSync(dir).isDirectory()) continue;
  const validar = VALIDADORES[juego];

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const deck = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    console.log(`\n== ${programa}/${juego}/${file} — ${deck.theme} | ${(deck.regions || ['global']).join(',')} | +${deck.minAge || 0}`);
    if (!validar) { console.log('   (sin validador específico)'); continue; }
    try {
      validar(deck);
    } catch (e) {
      aviso(`el archivo no tiene la forma esperada: ${e.message}`);
    }
  }
  }
}

console.log(problemas === 0 ? '\n✅ TODO OK' : `\n❌ ${problemas} PROBLEMAS`);
process.exit(problemas === 0 ? 0 : 1);
