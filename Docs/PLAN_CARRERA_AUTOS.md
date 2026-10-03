# Plan: "Gran Premio" — carrera de autitos chocadores por equipos

Idea del dueño del proyecto: una carrera donde todos manejan un auto desde su
celu hasta la meta, con obstáculos y dificultad. Se pueden chocar los autos de
**equipos contrarios** (estilo autitos chocadores) pero **no los del mismo
equipo**. Como en la Fórmula 1, **gana el equipo**, no una persona: los puntos
de todos los autos del equipo se suman.

Queda para después de los juegos más simples. Este documento guarda el diseño.

## Reglas

- Una pista cerrada (vista desde arriba o en 3D con cámara detrás del auto),
  con N vueltas o un tramo hasta la meta.
- Cada jugador maneja su auto: acelerar + izquierda/derecha (botones grandes)
  o inclinando el celu.
- Obstáculos: conos (frenan), manchas de aceite (hacen patinar), rampas/turbo.
  Más obstáculos y pistas más cerradas según la dificultad.
- Choques:
  - Mismo equipo: los autos se atraviesan (se ven semitransparentes entre sí).
  - Equipos contrarios: chocan y se empujan. Un buen golpe saca de la pista o
    hace girar al rival. Se puede jugar "de compañero": uno bloquea, el otro pasa.
- Puntaje estilo F1 (25, 18, 15, 12, 10, 8, 6, 4, 2, 1) por posición de
  llegada, sumado por equipo. Bonus a la vuelta más rápida.
- Ajustes de la sala: pista (corta/larga), vueltas, obstáculos (pocos/muchos),
  choques (suaves/fuertes).

## Cómo hacerlo andar con internet de casa

El reto es que los choques necesitan que todos vean lo mismo casi al instante.

1. **Tiempo real de verdad**: hoy el sitio usa conexiones por "long-polling"
   (WebSocket apagado en web.config). Para la carrera hace falta probar si
   MonsterASP soporta WebSocket con iisnode; si no, evaluar otro hosting
   gratuito/barato para este juego o un servidor de tiempo real aparte.
2. **El servidor manda en la física** (servidor autoritativo) a ~15–20
   actualizaciones por segundo: recibe "acelero / giro" de cada celu, mueve
   los autos, resuelve choques y obstáculos, y manda las posiciones.
3. **Predicción en el celu**: cada celu mueve su propio auto al instante (sin
   esperar al servidor) y se corrige suave cuando llega la posición real. Los
   autos de los demás se interpolan para que no salten.
4. Si alguien tiene muy mala señal, su auto sigue derecho y el servidor lo
   frena; nunca traba la carrera de los demás.

## Plan por etapas

1. Prototipo sin choques: pista, autos, vueltas, llegada y puntaje por equipo
   (los demás autos como "fantasmas"). Sirve aunque no haya WebSocket.
2. Probar WebSocket en MonsterASP (o alternativa).
3. Choques entre equipos con física simple (círculos/rectángulos que se empujan).
4. Obstáculos, turbo y ajustes de dificultad.
5. Pulido: cámara, sonidos de motor, semáforo de largada (el mismo de "Aguante").
