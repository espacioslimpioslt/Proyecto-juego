# Evaluación — Seguridad, modelo de negocio y estado técnico (oct 2026)

Documento de decisión antes de llevar **Soy Participante** a la Play Store.
Complementa a [`PLAN_APP_FIESTA.md`](PLAN_APP_FIESTA.md) (Plan A / Plan B) y
lo baja a decisiones concretas: qué producto se publica, cómo se evita que
"los malos dicten cómo se divierte el resto", y qué hay que arreglar en el
código antes de que lo use gente que no conocemos.

---

## 1. Resumen ejecutivo

1. **El dominio es la casa, no internet.** El producto es "cada casa es el
   estudio de un programa de TV": el grupo está junto, se ve, se escucha, y la
   app hace de conductor/árbitro. Eso es lo que lo diferencia de cualquier
   trivia online, y además es lo que lo hace seguro casi gratis.
2. **Competir contra otra casa sí, pero solo por invitación.** "Duelo de
   Casas": una casa desafía a otra con un link que se comparte por WhatsApp.
   Sin emparejamiento con desconocidos, sin chat libre, sin video entre casas.
   Es la forma de tener la emoción de competir contra otros sin heredar el
   problema de moderación de las plataformas abiertas.
3. **El servidor es el árbitro, nunca una de las partes.** En un duelo entre
   casas no puede haber juegos donde el anfitrión de un equipo decide si la
   respuesta del rival vale. Hoy hay cuatro juegos así (sección 5).
4. **Copiar lo que ya funciona** en Kahoot, Jackbox, Nintendo, Clash Royale y
   Rocket League: apodos de lista, reacciones predefinidas en vez de chat,
   salas que se cierran, bloqueo persistente, reputación de "juego limpio".
5. **Antes de publicar hay que arreglar el código.** Hay 6 errores que son
   bloqueantes para una app pública (sección 6). El más grave: si a alguien se
   le bloquea el celular, se cae de la partida y no puede volver, y algunos
   juegos quedan trabados para siempre.
6. **Cambiar los nombres de los Programas.** "El Rosco" y "Ahora Caigo" son
   formatos de TV con dueño. Para una app gratuita en casa puede pasar; para
   una app publicada y monetizada en la Play Store es un riesgo legal real
   (el propio `PLAN_APP_FIESTA.md` ya lo advierte en "Cuidado con nombres y
   marcas").

---

## 2. El dominio: qué es y qué no es Soy Participante

| Es | No es |
|---|---|
| Un programa de TV que se arma en el living de cada casa | Una red social ni un lugar para conocer gente |
| Un grupo que se ve y se escucha en persona | Una videollamada entre desconocidos |
| La app como conductor y árbitro neutral | Un chat |
| Competencia entre grupos que **se eligen** | Un ranking mundial abierto contra cualquiera |

La regla de diseño que sale de esto: **toda interacción que cruza de una casa
a otra pasa por el juego, en formato estructurado** (respuestas, puntos,
reacciones de una lista), nunca como texto, audio o video libre. Dentro de
una casa, todo vale: es la misma gente sentada en el mismo sillón.

### Tres modos de juego

| Modo | Quién juega | Riesgo | Cuándo |
|---|---|---|---|
| **Modo Casa** (lo que existe hoy) | Un grupo en el mismo lugar, equipo contra equipo | Mínimo: se conocen y se están viendo | Lanzamiento |
| **Duelo de Casas** | Una casa contra otra, por link de invitación | Bajo, si no hay chat/video libre y el servidor arbitra | Versión 2 |
| **Liga / Torneo de conocidos** | Varias casas que ya se enfrentaron y se agregaron como rivales | Bajo-medio | Versión 3 |
| ~~Emparejamiento con desconocidos~~ | Cualquier casa contra cualquiera | Alto: abuso, menores, moderación 24/7 | **No**, salvo que algún día exista un equipo de moderación y sea solo +18 |

---

## 3. "Filtrar por amigos de WhatsApp": qué se puede y qué no

**No se puede leer la lista de amigos ni de grupos de WhatsApp.** WhatsApp no
le da esa información a apps de terceros. La API de WhatsApp Business sirve
para que una empresa le mande mensajes a sus clientes, no para ver los
contactos de nadie.

Lo que sí funciona, y es lo que usan casi todos los juegos de fiesta:

1. **Invitar con un link compartido por WhatsApp.** El anfitrión toca
   "Desafiar a otra casa" y la app abre el menú de compartir de Android con un
   link (`soyparticipante.app/d/XK7P2Q`). Lo manda al grupo de WhatsApp de la
   familia o de los amigos. Solo quien recibió el link puede entrar. **El filtro
   es el grupo de WhatsApp donde se compartió**, sin que la app vea nada de
   WhatsApp.
2. **Rivales guardados.** Después de jugar, cada casa puede guardar a la otra
   como rival ("Los Pérez"). La próxima vez la desafía directo desde la app,
   sin link. Es lo que hace Nintendo con los códigos de amigo: el círculo crece
   solo por gente con la que ya jugaste.
3. **Contactos del teléfono (no recomendado al principio).** Cruzar la agenda
   del celular para encontrar conocidos que tienen la app. Funciona bien, pero
   obliga a pedir el permiso de Contactos, declarar ese uso de datos en la Play
   Store y tratar números de teléfono de terceros. Es mucha responsabilidad
   legal para el valor que agrega. Para más adelante, como mucho.

---

## 4. Modelo de seguridad: lo que copiamos de otros juegos

### 4.1 Quién puede entrar a una sala

| Medida | Inspirado en | Estado hoy |
|---|---|---|
| Códigos de sala más largos (6 caracteres) y límite de intentos por IP | Kahoot, Jackbox | ❌ 4 caracteres (~1 millón de combinaciones), sin límite |
| El anfitrión **aprueba** a cada persona que entra (sala de espera) | Zoom | ❌ entra cualquiera con el código |
| **Cerrar la sala** cuando ya están todos | Kahoot ("Lock") | ❌ |
| Expulsar **y que no pueda volver** en esa partida | Jackbox, Kahoot | ❌ hoy el expulsado vuelve a entrar al instante |
| En Duelo de Casas: solo entra la casa invitada, con link de un solo uso | Clash Royale (amistosos), Nintendo | — no existe todavía |

### 4.2 Qué se puede "decir" entre casas

| Medida | Inspirado en | Comentario |
|---|---|---|
| **Sin chat libre entre casas** | Clash Royale, Rocket League (quick chat) | Solo reacciones de una lista: "¡Bien jugado!", "¡Uff!", "😂", "👏". Se pueden silenciar con un toque |
| **Sin audio ni video entre casas** | Juegos para chicos de Nintendo y Roblox (por edad) | El "se están viendo" es **dentro** de cada casa. Ver a la otra casa por cámara es justo lo que trae los problemas graves (desnudez, menores, grabaciones) |
| **Apodos de casa elegidos de una lista** ("Los Halcones", "Team Milanesa") o generados | Kahoot (Friendly Nickname Generator), Among Us | Los nombres reales de cada integrante solo se ven dentro de su propia casa |
| Filtro de malas palabras en todo texto que vea la otra casa | Jackbox ("family friendly"), Roblox | Tutifruti es el caso clave: las palabras escritas las ve el rival |
| Límite de respuestas y de intentos | Kahoot | Ya existe en parte (un envío por equipo en Tutifruti). Falta en Mímica y Palabra Prohibida (sección 6) |

### 4.3 Qué pasa después de jugar

| Medida | Inspirado en | Detalle |
|---|---|---|
| **Bloquear una casa** para siempre | Todas las plataformas | No te puede volver a desafiar ni ver tu casa |
| **Reportar** con el registro de la partida adjunto | Overwatch, Fortnite | Como no hay chat libre, el reporte trae solo lo que pasó en el juego (reacciones enviadas, abandonos, demoras) y es fácil de revisar |
| **"¿Volverías a jugar con esta casa?"** 👍/👎 al terminar | Uber (calificación de las dos partes), recomendaciones de Overwatch | El puntaje no se muestra; se usa por detrás |
| **Reputación de juego limpio** | Overwatch, Rocket League | Si una casa junta muchos 👎, bloqueos o abandonos, pierde Duelo de Casas por un tiempo. El Modo Casa nunca se pierde |
| Penalizar el abandono a mitad de partida | Clash Royale, Rocket League | Una casa que se va perdiendo cuenta como derrota |

### 4.4 Quién es responsable de la cuenta

- **El que tiene cuenta es el anfitrión, y es un adulto.** Los invitados de la
  casa entran con el código, sin cuenta ni datos personales (como Kahoot y
  Jackbox). Esto evita guardar datos de menores y deja claro quién responde
  por la casa.
- **El Duelo de Casas pide una cuenta de anfitrión verificada** (Google +
  teléfono). Crear cuentas falsas para molestar se vuelve caro, y un bloqueo
  realmente bloquea.

### 4.5 Menores de edad

- Publicar en la Play Store como app **para mayores de 13 o de 18**. Que los
  chicos jueguen **como invitados del anfitrión adulto**, no con cuenta propia.
  Si la app se declara "para niños", entra en el programa *Designed for
  Families* de Google, con reglas mucho más estrictas: anuncios certificados,
  nada de datos personales, revisión adicional.
- Los mazos +18 que ya existen (`minAge: 18`) solo se muestran con "solo
  mayores" activado. **Hoy ese filtro tiene un agujero** (sección 6, error 4).
- El Duelo de Casas hereda el filtro de edad de la casa más restrictiva: si
  una casa no marcó "solo mayores", nadie recibe contenido +18.
- **Consultar con un abogado antes de publicar**, por las leyes de datos
  personales de cada país donde se lance (Ley 25.326 en Argentina, LGPD en
  Brasil, RGPD en Europa, COPPA en EE. UU. si se apunta a menores de 13).
  Google también exige una política de privacidad y una forma de borrar la
  cuenta desde la app.

---

## 5. El problema del árbitro: qué juegos sirven para competir entre casas

Hoy varios juegos dependen de que **el anfitrión confirme a mano** si una
respuesta vale. En Modo Casa está perfecto: el grupo lo discute en voz alta,
como en la vida real. En un Duelo de Casas, el anfitrión es **parte
interesada**, y ahí nacen las peleas ("¡nos robaron!").

| Juego | Cómo se valida | ¿Sirve para Duelo de Casas? |
|---|---|---|
| El Rosco, Elegí Una, La Silla, ¿Dónde Estaba?, Sopa de Letras, Palabras Cruzadas | Automática, el servidor sabe la respuesta | ✅ Sí, tal cual |
| Duelo de Torres, Escalera Final | Automática | ✅ Sí, y el Duelo de Torres es ideal (uno de cada casa, cara a cara) |
| Tutifruti | Banco de palabras + **dudosas que juzga el anfitrión** | ⚠ Con ajuste: las dudosas las votan **las dos casas**, y si no hay acuerdo la palabra no suma para nadie. O solo cuenta el banco |
| La Cadena | Voz + **confirmación manual del anfitrión** | ⚠ Con ajuste: sin confirmación manual entre casas, solo la validación automática |
| Mímica, Palabra Prohibida | Voz + confirmación manual + "dijo una prohibida" | ❌ Solo Modo Casa: necesitan ver y oír al que actúa, o sea video entre casas |
| Adiviná la Canción | 100 % juzgada por el anfitrión | ❌ Solo Modo Casa |

**Propuesta:** cada juego declara en su archivo `mode: ['casa', 'duelo']`, y
el Duelo de Casas solo ofrece los que son 100 % automáticos. Así el catálogo
se filtra solo, igual que ya se hace con los mazos por región y edad.

---

## 6. Prueba de punta a punta: errores encontrados

### Cómo se probó

- **Instalación y arranque**: `npm ci`, `npm start` y chequeo de sintaxis de
  todos los archivos `.js`. Todo OK.
- **Validador de contenido** (`tools/validar-contenido.js`): ✅ TODO OK.
- **Simulador de partidas** (nuevo: `tools/simular-partidas.js`): juega
  partidas completas contra el motor real, con 2 a 7 jugadores "bots" que
  mandan respuestas correctas, incorrectas e inválidas al azar, en los 3
  Programas y las 3 dificultades, y desconecta a alguien a mitad de partida
  en el 30 % de los casos. **135 partidas**:
  - **Sin desconexiones, todas terminaron bien**, sin excepciones ni puntajes
    raros.
  - **Con desconexiones, 8 de 135 quedaron trabadas para siempre.**
- **Navegador real** (Chromium, tamaño de celular): portada, sala, unirse con
  código, partidas en modo prueba de los 3 Programas. Sin errores de
  JavaScript y sin desborde horizontal. Ahora Caigo se jugó completo hasta la
  pantalla de resultados.
- **Pruebas puntuales** de cada sospecha que surgió al leer el código. Todos
  los errores de abajo están **reproducidos**, no son teóricos.

### 🔴 Bloqueantes para publicar

| # | Error | Dónde | Qué pasa |
|---|---|---|---|
| 1 | **No hay reconexión** | `server/rooms.js:592` (`removeSocket`) y `:162` (`joinRoom`) | Al bloquear el celular, cambiar de app o perder el wifi un segundo, el jugador **sale de la partida**. Al volver, "Esa sala ya empezó a jugar". En un celular esto pasa todo el tiempo |
| 2 | **Partidas trabadas para siempre** cuando alguien se va | `dueloTorres.js:122`, `rooms.js:355` (`beginRound`) | (a) En el Duelo de Torres solo puede responder ese duelista, y no hay reloj: si se va, nadie puede seguir. (b) Si un equipo se queda sin gente, los juegos por turnos esperan una respuesta que nunca llega. (c) Si un juego nace ya "terminado" (ej. Adiviná la Canción con un solo equipo), el motor no lo cierra. Reproducido en 8 de 135 partidas |
| 3 | **Se puede inyectar HTML con el nombre del jugador** | `public/app.js:1806` (Duelo de Torres), `:1529`, `:1693` y otros `innerHTML` | Un jugador que se llama `<b id=x>HOLA</b>` mete ese HTML en la pantalla de todos (confirmado en el navegador). Hoy el límite de 20 caracteres frena que se ejecute código, pero en una app pública es una puerta abierta. Hay que escapar todo texto que venga de usuarios |
| 4 | **Un mazo +18 puede salir con "solo mayores" apagado** | `server/contentLoader.js:50` (`pickDeck`) | Si no hay ningún mazo que cumpla dificultad + región + edad, el código usa **todos** los mazos, incluidos los +18. Hoy no ocurre de casualidad (el único mazo +18 es del Rosco, que tiene mazos de todas las dificultades), pero alcanza con sumar un mazo +18 a Mímica para que salga jugando en "Normal". El filtro de edad no se puede relajar nunca |
| 5 | **Las respuestas secretas viajan a todos los celulares** | `mimica.js:231`, `palabraProhibida.js:244` | La palabra a actuar y la tarjeta con las prohibidas se mandan a **todos**, y el celular de cada uno decide si mostrarlas. Cualquiera que mire lo que llega a su teléfono las ve. En Modo Casa da igual; en Duelo de Casas es trampa servida. El servidor tiene que mandar a cada jugador solo lo que puede ver |
| 6 | **Trampas fáciles en los juegos de voz** | `laCadena.js:53`, `mimica.js:187`, `palabraProhibida.js:200` | En La Cadena, decir **las 4 opciones seguidas** cuenta como acierto (confirmado). En Mímica y Palabra Prohibida se puede escribir una lista larga de palabras y alguna pega, sin límite de intentos |

### 🟠 Importantes

| # | Error | Dónde | Qué pasa |
|---|---|---|---|
| 7 | El expulsado vuelve a entrar | `rooms.js:181` | `kickPlayer` lo saca, pero puede volver con el mismo código al instante |
| 8 | Si se va el anfitrión en modo prueba, el nuevo anfitrión es un jugador inventado | `rooms.js:592` | La sala queda sin nadie que la maneje y **nunca se borra** (los jugadores inventados no se desconectan): pierde memoria el servidor |
| 9 | En modo prueba con nombres, un invitado real que entra desaparece | `rooms.js:221` (`buildTestRoster`) | Se lo saca de la lista sin avisarle |
| 10 | Tutifruti con la letra **Ñ** acepta palabras con **N** | `tutifruti.js:117`, `:135` | Al sacar los acentos, la Ñ se convierte en N. "Naranja" pasa como palabra con Ñ |
| 11 | Si el anfitrión juzga, juzga a su propio equipo | `rooms.js:511` (`judgeWord`) | En Modo Casa está bien (el grupo discute). En Duelo de Casas es conflicto de interés (ver sección 5) |
| 12 | Las salas viven solo en la memoria del servidor | `rooms.js` (`const rooms = new Map()`) | Si se reinicia o actualiza el servidor, se cortan todas las partidas. Para la Play Store hace falta guardar el estado (por ejemplo, en Redis) |
| 13 | Sin límite de velocidad en los mensajes | `server/server.js` | Un cliente puede mandar miles de acciones por segundo (adivinanzas, uniones a salas, configuraciones) |

### 🟡 Para mejorar

- **Poco contenido para repetir partidas.** La Silla tiene 2 tandas en fácil y
  2 en difícil; Palabras Cruzadas, 3 tableros. En partidas de 9 pruebas o con
  el mismo grupo se repiten enseguida. Para una app publicada hace falta
  bastante más contenido por juego y por país.
- **Mezcla sesgada.** `shuffle` usa `sort(() => Math.random() - 0.5)`, que no
  mezcla parejo (hay órdenes que salen más que otros). Conviene Fisher-Yates.
- **El reconocimiento de voz depende del navegador.** Si la app se publica con
  Capacitor o un WebView común, la Web Speech API **no existe** ahí y hace
  falta un plugin nativo. Con una TWA (Chrome adentro) sí funciona.
- **No hay pruebas automáticas** del motor. El simulador nuevo es un primer
  paso; conviene correrlo en cada cambio (GitHub Actions).
- **El `.gitignore` de la raíz es de Unity**, del proyecto 3D anterior. No
  rompe nada porque `FiestaApp/web/` tiene el suyo.

---

## 7. Modelo de negocio

**Principio:** se cobra por **más diversión**, nunca por **ganar**, y nunca se
corta el clima de la fiesta con publicidad en medio de una ronda (ya está
decidido en `PLAN_APP_FIESTA.md`).

| Qué | Para quién | Precio orientativo |
|---|---|---|
| **Gratis**: Modo Casa con 2-3 Programas y mazos básicos | Todos | — |
| **Packs de contenido** por país y por tema (Rioplatense, Fútbol, Novelas, Años 90, +18) | La casa que quiere variedad | Pago único chico |
| **Pase Familiar** (suscripción): todo el catálogo + **Duelo de Casas** + torneos de conocidos | La casa que juega seguido | Mensual o anual bajo |
| Publicidad solo en menús (opcional) | Usuarios gratis | — |

**Por qué el Duelo de Casas va en el pase pago:**
1. Es lo que más cuesta mantener (servidores, moderación, soporte).
2. **Pagar es una verificación natural**: una cuenta paga es de un adulto con
   medio de pago, y crear cuentas falsas para molestar sale plata. Es la
   misma lógica de por qué hay tan pocos abusos en salas de pago.

**Crecimiento:** cada Duelo de Casas es publicidad gratis. El link que se
comparte por WhatsApp lleva a otra familia a instalar la app para aceptar el
desafío. Los desafíos son el motor de crecimiento, no los anuncios.

**Nombres y formatos:** antes de cobrar, renombrar los Programas inspirados
en formatos reales ("El Rosco" → nombre propio, "Ahora Caigo" → nombre
propio) y revisar que las mecánicas no copien elementos protegidos. Hubo
juicios conocidos sobre el formato de Pasapalabra. Consultar con un abogado
de propiedad intelectual.

---

## 8. Cómo llevarlo a la Play Store

La app es web (Node + Socket.io + HTML). Lo más rápido y barato es **no
reescribirla**:

1. **Convertirla en PWA** (manifest, ícono, service worker para la portada).
2. **Empaquetarla como TWA** (Trusted Web Activity, con la herramienta
   Bubblewrap de Google). Es Chrome adentro de la app, así que el
   reconocimiento de voz sigue funcionando.
3. **Servidor en la nube** con HTTPS, dominio propio, salas guardadas en
   Redis (error 12) y monitoreo.
4. **Clasificación de contenido (IARC)** en la Play Console: declarar
   "interacción entre usuarios" cuando exista el Duelo de Casas.
5. **Política de privacidad y borrado de cuenta**, que son obligatorios.

Unity (mencionado en el plan para "El Cazador") no hace falta para nada de
esto.

---

## 9. Plan de ajustes, en orden

### Fase 1: dejar sólido el juego, en casa y a distancia con conocidos — ✅ hecha (oct 2026)

Decisión tomada: el juego se abre a internet **para familia y amigos que
están lejos**, entrando por link de invitación (WhatsApp). Las salas para
desconocidos quedan para más adelante, con las medidas de las secciones 4 y 5.

Hecho en esta fase: reconexión (identidad por celu, 2 min de gracia, turno al
siguiente del equipo mientras alguien está cortado), juegos que ya no se
traban (duelista y actor se reemplazan, juego que nace terminado se cierra,
equipo vacío termina el programa), nombres y palabras escapados, filtro +18
que nunca se afloja, trampas de voz cerradas (La Cadena, Mímica, Palabra
Prohibida), expulsión con bloqueo, sala cerrable, códigos de 6 caracteres,
límite de mensajes por segundo y de intentos de unirse, modo prueba sin
perder invitados ni dejar salas huérfanas, la Ñ en Tutifruti, mezcla
Fisher-Yates, invitación por link de WhatsApp, una regla `.hidden` que
faltaba (los invitados veían los controles del anfitrión), y la Escalera
Final ya no deja a un equipo sin pregunta esperando que se le acabe el reloj. Errores 1, 2, 3,
4, 6, 7, 8, 9, 10 y 13 de la sección 6. Quedan el 5 (vista por jugador, para
Duelo de Casas), el 11 (árbitro) y el 12 (Redis), que son de las fases 2 y 3.

Plan original de la fase:
1. Reconexión: cada jugador recibe un token al entrar; si se cae, vuelve a su
   lugar con el mismo equipo y turno (errores 1 y 2b).
2. Reloj de turno con salto automático, y el anfitrión puede saltear a quien
   no responde. Si un equipo se queda sin gente, el juego sigue o termina
   solo (errores 2a, 2b y 2c).
3. Escapar todo texto de usuarios en `app.js` (error 3).
4. El filtro de edad nunca se relaja en `pickDeck` (error 4).
5. Arreglar las trampas de voz: la respuesta nueva tiene que ser lo último
   dicho, y no se aceptan varias opciones juntas. Límite de intentos por
   segundo (error 6).
6. Expulsión con bloqueo para esa sala, sala cerrable, códigos de 6
   caracteres y límite de intentos (errores 7 y 13).
7. Arreglar el modo prueba (errores 8 y 9) y la Ñ (error 10).
8. Simulador en GitHub Actions y más contenido por juego.

### Fase 2: publicar
9. Renombrar los Programas, PWA + TWA, servidor con Redis, política de
   privacidad, cuenta de anfitrión (Google).

### Fase 3: Duelo de Casas
10. Vista por jugador en el servidor (error 5): cada uno recibe solo lo suyo.
11. Link de desafío compartible por WhatsApp, apodos de casa de una lista,
    reacciones predefinidas sin chat.
12. Solo juegos con validación automática; Tutifruti con dudosas votadas por
    las dos casas.
13. Bloqueo, reporte, 👍/👎 después de jugar, reputación y penalización por
    abandono.

### Fase 4: comunidad de conocidos
14. Rivales guardados, revanchas, torneos entre casas amigas, ranking **solo
    entre tus rivales**, nunca uno mundial abierto.

---

## 10. Decisiones que quedan abiertas

- **Edad mínima de la cuenta de anfitrión**: 18 (más simple y seguro) o 13.
- **Video entre casas**: la recomendación es **no**. Si algún día se suma,
  solo entre rivales guardados, solo +18 y apagado por defecto.
- **Países de lanzamiento**: define qué contenido regional hace falta primero
  y qué leyes de datos aplican.
- **Nombres propios para los Programas.**
