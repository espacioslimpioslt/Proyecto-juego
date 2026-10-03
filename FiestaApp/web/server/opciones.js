// Ajustes propios de cada juego, elegidos por el anfitrión en la sala de
// espera ("Personalizada"). Cada tipo de ronda declara su lista:
//
//   const opciones = [
//     { id: 'segundos', label: 'Segundos por letra',
//       valores: [[30, '30 s'], [60, '1 min']],
//       porDificultad: { facil: 60, normal: 60, dificil: 30 } }
//   ];
//
// Lo que no eligió el anfitrión sale de la dificultad. Un valor que no está
// en la lista se ignora (nunca llega un número inventado al juego).

function porDefecto(o, difficulty) {
  if (o.porDificultad) {
    return o.porDificultad[difficulty] !== undefined ? o.porDificultad[difficulty] : o.porDificultad.normal;
  }
  return o.porDefecto !== undefined ? o.porDefecto : o.valores[0][0];
}

function resolver(schema = [], elegidas = {}, difficulty = 'normal') {
  const out = {};
  schema.forEach((o) => {
    const elegido = elegidas ? elegidas[o.id] : undefined;
    const match = o.valores.find(([v]) => String(v) === String(elegido));
    out[o.id] = match ? match[0] : porDefecto(o, difficulty);
  });
  return out;
}

// Deja solo ids y valores que existen (para guardar en la sala).
function limpiar(schema = [], elegidas = {}) {
  const out = {};
  schema.forEach((o) => {
    const elegido = elegidas ? elegidas[o.id] : undefined;
    const match = o.valores.find(([v]) => String(v) === String(elegido));
    if (match) out[o.id] = match[0];
  });
  return out;
}

// Versión para mandar al celu (para dibujar los selectores).
function publico(schema = [], difficulty = 'normal') {
  return schema.map((o) => ({
    id: o.id,
    label: o.label,
    valores: o.valores.map(([v, label]) => ({ v, label })),
    porDefecto: porDefecto(o, difficulty)
  }));
}

module.exports = { resolver, limpiar, publico };
