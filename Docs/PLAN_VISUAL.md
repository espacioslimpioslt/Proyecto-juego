# Plan visual — animaciones, reels y 3D

Objetivo: que Soy Participante se sienta como un programa de TV de verdad
(luces, movimiento, sonido, identidad), no como un formulario. Dirección
elegida: **show nocturno moderno** — fondo profundo, neón, reflectores,
vidrio esmerilado, tipografía grande (Unbounded + Inter) y 3D brillante en los
momentos que lucen.

Regla técnica: **3D donde luce, 2D animado donde hay que leer**. Todo corre en
el navegador (sin Unity, sin instalar nada) y tiene respaldo: si el celu no
tiene WebGL o pidió "reducir movimiento", se ve una versión quieta.

## Fase 1 — Identidad ✅
- Logo con brillo animado y "ON AIR" titilando.
- Paleta nueva (tokens en `:root` de `styles.css`) y tipografías de Google Fonts.
- Cortina de luz + "whoosh" al cambiar de pantalla.
- Sonidos sintetizados con Web Audio (`public/fx/sfx.js`): acierto, error,
  turno, redoble, fanfarria. Sin archivos ni derechos. Botón 🔊 para silenciar.

## Fase 2 — Portada ✅
- **Escenario 3D** (`public/fx/stage3d.js`, Three.js en `public/vendor/`):
  estudio con reflectores que barren, paneles de luces, piso brillante,
  partículas y el objeto de cada Programa (rosco que gira y se ilumina,
  torres que crecen y se caen + escalera, cartas del impostor que se dan
  vuelta). Solo se dibuja mientras se ve; resolución limitada para cuidar
  la batería.
- **Destacado que rota** cada 8 s (puntitos con progreso, deslizar con el dedo).
- **Reels en cada tarjeta** (`public/fx/reels.js` + CSS): animaciones cortas
  que muestran cómo se juega; se pausan fuera de pantalla.
- **Reel grande en "Crear sala"**.

## Fase 3 — Dentro del juego ✅ (primera pasada)
Hecho:
- Encabezado de cada prueba con ícono, nombre y "1/3" en el color del juego
  (`GAME_THEME` en `app.js`).
- Presentación al arrancar cada prueba: ícono, nombre, cómo se juega en una
  línea y cuenta 3-2-1 con redoble (se saltea tocando).
- Marcador estilo TV: el equipo de turno brilla y los números "saltan" al
  cambiar. Tiempo para la final en fichas.
- Respuestas como fichas A/B/C/D que entran escalonadas.
- Puntos que vuelan del tablero al marcador; confeti en el resultado de cada
  prueba y en el final.
- Momentos propios: escaleras verticales por equipo (Escalera Final), cara a
  cara con corona (Duelo), cartas que se dan vuelta al taparse (¿Dónde
  Estaba?), letra tragamonedas (Tutifruti), eslabones (La Cadena),
  ecualizador y botón que late (Adiviná la Canción), letra activa que late
  (Rosco), palabra secreta con brillo (Mímica / Palabra Prohibida).

Pendiente de esta fase:
- Presentación de cada prueba: cortina, nombre, cuenta regresiva 3-2-1.
- Puntos que "vuelan" al marcador, temblor en los errores.
- Podio final con confeti y reflector.
- Momentos firma: rosco 3D girando hasta la letra activa, revelación del
  impostor con reflector, escalón que se ilumina al plantarse.

## Fase 4 — Pulido y medición (pendiente)
- Medir en un celu de gama media (fluidez y peso con datos móviles).
- Video de 30 s para mostrar y ver si "tiene futuro".

## Para actualizar Three.js
`npm install three@<versión> --save-dev` y `npm run vendor` (copia el archivo a
`public/vendor/`). En producción no se instala: el archivo ya va en `public/`.
