// Reels de la portada: una animación corta, en bucle, que muestra cómo se
// juega cada Programa (en vez de un emoji quieto). Está hecha con HTML + CSS
// (ver "Reels" en styles.css): pesa casi nada, se ve nítida en cualquier
// pantalla y no hay que grabar ni regrabar videos cuando cambia el juego.
//
// Solo se animan las tarjetas que están a la vista (IntersectionObserver):
// las que quedan fuera de pantalla se pausan, para no gastar batería.

(function () {
  const LETRAS = 'ABCDEFGHIJLMNOPRSTUV'.split('');

  function reelRosco() {
    const n = 14;
    const discos = LETRAS.slice(0, n).map((l, i) => {
      const ang = (i / n) * 360;
      // Cada letra se "juega" en su turno: algunas aciertan, otras no.
      const estado = [2, 5, 9, 12].includes(i) ? 'mal' : 'bien';
      return `<span class="rr-disc ${estado}" style="--ang:${ang}deg;--i:${i}">${l}</span>`;
    }).join('');
    return `<div class="reel reel-rosco">
      <div class="rr-ring">${discos}</div>
      <div class="rr-center"><span class="rr-time">1:15</span><span class="rr-label">EL ROSCO</span></div>
    </div>`;
  }

  function reelAhoraCaigo() {
    const bloques = (lado, n) => Array.from({ length: n }, (_, i) =>
      `<span class="ac-block" style="--i:${i}"></span>`).join('');
    const escalones = Array.from({ length: 7 }, (_, i) =>
      `<span class="ac-step" style="--i:${i}"></span>`).join('');
    return `<div class="reel reel-caigo">
      <div class="ac-tower a">${bloques('a', 5)}</div>
      <div class="ac-tower b">${bloques('b', 5)}</div>
      <div class="ac-ladder">${escalones}</div>
      <span class="ac-vs">VS</span>
    </div>`;
  }

  function reelImpostor() {
    const cartas = ['🍎', '🕵️', '🍎', '🍎'].map((cara, i) =>
      `<span class="im-card${cara === '🕵️' ? ' impostor' : ''}" style="--i:${i}">
        <span class="im-face im-back">?</span>
        <span class="im-face im-front">${cara}<small>${cara === '🕵️' ? 'IMPOSTOR' : 'MANZANA'}</small></span>
      </span>`).join('');
    return `<div class="reel reel-impostor">
      <div class="im-cards">${cartas}</div>
      <div class="im-vote"><span></span><span></span><span></span></div>
    </div>`;
  }

  // Programas que todavía no existen: el ícono flotando con un brillo que
  // pasa, para que la galería no se vea muerta.
  function reelProximo(icon) {
    return `<div class="reel reel-proximo">
      <span class="rp-orb"></span>
      <span class="rp-icon">${icon}</span>
      <span class="rp-shine"></span>
    </div>`;
  }

  const POR_PROGRAMA = {
    'el-rosco': reelRosco,
    'ahora-caigo': reelAhoraCaigo,
    varios: reelImpostor
  };

  function reelHtml(program) {
    const hacer = POR_PROGRAMA[program.id];
    return hacer ? hacer() : reelProximo(program.icon || '🎮');
  }

  // Pausa las animaciones de lo que no se ve.
  let observer = null;
  function observarReels(root) {
    const reels = (root || document).querySelectorAll('.reel');
    if (!('IntersectionObserver' in window)) {
      reels.forEach((r) => r.classList.add('is-playing'));
      return;
    }
    if (!observer) {
      observer = new IntersectionObserver((entries) => {
        entries.forEach((e) => e.target.classList.toggle('is-playing', e.isIntersecting));
      }, { threshold: 0.35 });
    }
    reels.forEach((r) => observer.observe(r));
  }

  window.Reels = { reelHtml, observarReels };
}());
