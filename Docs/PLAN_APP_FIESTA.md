# Plan de Proyecto — App de Fiesta (nombre a definir)

## 1. Concepto
App para cuando se junta un grupo de 5-8 personas en una casa y no tienen con qué
entretenerse: los juegos de cartas quedan cortos de jugadores, a los de mesa les
faltan piezas. La app reemplaza esos juegos usando los celus de todos.

Pensada para que **cualquiera que se junte en una casa la pueda jugar** — no es un
producto atado a un país o cultura en particular. Esto es un requisito de diseño
desde el día 1, no un agregado de último momento:
- **Varios idiomas desde la base**: textos, categorías de contenido y nombres de
  Programas pensados para traducirse, no traducidos después como parche. Ojo con un
  matiz: traducir la **interfaz** (botones, menús) es la parte fácil — el
  **contenido** de varios Programas cambia por idioma/cultura, no es solo texto
  traducido: las letras del abecedario de *El Rosco*, las categorías de Tutifruti,
  y las canciones/letras de *A Toda Voz* son distintas por idioma. Cada Programa
  nuevo tiene que declarar en su carpeta qué idiomas de contenido soporta, no
  asumir que "traducir la UI" alcanza.
- **Contenido inclusivo**: categorías y referencias que no asuman un único país,
  generación o cultura — con lugar para packs de contenido regionales (referencias,
  humor, programas de TV locales de cada lugar) sin romper el resto del catálogo.

No es un único juego: es un catálogo de **Programas** (sección 3) — cada uno con
identidad propia, no una lista plana de mini-juegos sueltos.

### Plan A vs. Plan B (alcance del proyecto)
- **Plan A (foco actual, todo lo que sigue en este documento)**: gente en el mismo
  lugar físico, jugando entre celus propios. Es el que se desarrolla ahora.
- **Plan B (a futuro, explícitamente no ahora)**: gente que no está en el mismo
  lugar — desde familia/amigos conocidos jugando a distancia (técnicamente ya
  soportado por la arquitectura de código de sala por internet, pero necesitaría
  sumar cámara/micro en vivo tipo videollamada para no perder la energía de estar
  juntos, que hoy el diseño no contempla) hasta emparejar equipos de desconocidos
  que quieren entretenerse. Esto último se deja **fuera de alcance por ahora**,
  no como backlog técnico sino como límite de producto: emparejar desconocidos por
  internet (más aún si hay menores de edad involucrados) es un problema de
  seguridad y responsabilidad legal, no solo de ingeniería — requeriría
  moderación, verificación y recursos que este proyecto no tiene en esta etapa.
  Si en algún momento se retoma, como mínimo restringido a mayores de edad, pero
  ni así resuelve todo el riesgo por sí solo.

## 2. Principio de diseño: catálogo modular y liviano
Con la idea de escalar a mucho contenido sin que la app se vuelva pesada de instalar:

- **El código de todos los Programas viaja en la app/sitio** (la lógica de un juego
  de fiesta pesa poco — es texto, UI y reglas).
- **Los assets pesados (modelos 3D, texturas, audio) se descargan on-demand**, solo
  para el candidato que de verdad los necesita (El Cazador, sección 6), vía **Unity
  Addressables** apuntando a un bucket remoto. El resto del catálogo (sección 5) es
  liviano por naturaleza y no necesita este mecanismo.
- Resultado: agregar el Programa #15 al catálogo no hace más pesada la instalación
  inicial — solo pesa para quien realmente lo usa.

### Cómo se agrega un Programa nuevo (convención técnica)
El objetivo: sumar un Programa nuevo es **crear una carpeta y nada más** — sin tocar
código en ningún otro lado del catálogo.

- Cada Programa vive en su propia carpeta autocontenida: `/programs/<slug>/`
  (ej. `/programs/el-rosco/`), con su lógica de rondas, sus textos (por idioma) y
  sus assets propios adentro.
- Cada carpeta tiene un **manifest** (`manifest.json`) con los datos que el catálogo
  necesita para mostrarlo: nombre, descripción corta, jugadores mín/máx, ícono, si
  soporta equipos, si pide algún permiso especial (ej. Contactos). Ejemplo:
  ```json
  {
    "id": "el-rosco",
    "name": "El Rosco",
    "description": "Una palabra por cada letra, contrarreloj.",
    "minPlayers": 3,
    "maxPlayers": 10,
    "supportsTeams": false,
    "requiresPermissions": []
  }
  ```
- El servidor/catálogo, al arrancar, **escanea la carpeta `/programs/`** y arma la
  lista de Programas disponibles leyendo cada `manifest.json` que encuentra — no
  hay una lista fija escrita a mano en otro archivo que haya que actualizar.
- La pantalla principal recorre esa lista y genera **una tarjeta/div por Programa**
  automáticamente a partir de esos datos — agregar una carpeta nueva bien formada
  hace aparecer la tarjeta sola, sacar la carpeta la hace desaparecer sola.

Esta es la misma idea de "galería modular" que ya veníamos manejando, bajada a una
convención concreta y simple de seguir.

### Dos capas: motor común + tipos de ronda reutilizables
Para que sumar Programas nuevos no implique programar una interfaz de puntaje/turnos
distinta cada vez, el sistema se separa en dos capas:

1. **Motor común** (se construye una sola vez): entrada de jugadores por **código
   de sala nuevo en cada partida** (privado por diseño — no hay modo "entra quien
   quiera", es una casa con gente conocida, no un evento público), con una **sala
   de espera** donde el anfitrión ve en vivo quién se va uniendo y puede sacar a
   alguien con un toque antes de arrancar. Después sigue la **configuración
   previa** (nombres de los participantes, armado de equipos si el Programa los
   usa, cantidad de rondas con su estimación de tiempo — sección de abajo),
   marcador/puntaje, pantalla de transición entre rondas, pantalla de resultados.
   Todo Programa usa esta misma secuencia y estas mismas pantallas, sin
   reimplementarlas — lo único que cambia entre Programas es de qué pool se
   sortean los juegos de cada ronda (ver "Dos capas" y "Modo Azar").
2. **Tipos de ronda** (biblioteca reutilizable, se arma con el tiempo): cada tipo de
   ronda es un bloque genérico — trivia de opción múltiple, buzzer (quién aprieta
   primero), escribir y votar, puntaje por jurado (slider 1-10), desafío de
   micrófono (volumen o tono), desafío de reacción (tap), encuesta/ranking, etc. Un
   Programa nuevo casi siempre puede armarse **combinando tipos de ronda que ya
   existen**, con contenido propio — no hace falta código nuevo salvo que el tipo
   de ronda en sí sea nuevo.

Un Programa, entonces, es su manifest + una **secuencia de rondas** que referencia
tipos ya construidos:
```json
{
  "id": "el-rosco",
  "name": "El Rosco",
  "rounds": [
    { "type": "trivia-opcion-multiple", "content": "el-rosco/preguntas-es.json", "count": 27 }
  ]
}
```
```json
{
  "id": "contrarreloj",
  "name": "Contrarreloj",
  "rounds": [
    { "type": "desafio-microfono-volumen", "content": "contrarreloj/prueba-01.json" },
    { "type": "desafio-tap-reaccion", "content": "contrarreloj/prueba-02.json" }
  ]
}
```
La Escalera (trivia) y El Rosco pueden compartir el mismo tipo de ronda
`trivia-opcion-multiple` — lo único que cambia es el contenido y cómo se presenta.

### Modo Azar
Con la biblioteca de tipos de ronda ya armada, un "Programa" especial (`azar`) arma
su secuencia **al azar**, tomando rondas sueltas de distintos Programas en vez de
seguir la secuencia fija de uno solo — es casi gratis de construir una vez que
existen los tipos de ronda, porque solo cambia el algoritmo de selección, no la
ejecución de cada ronda.

### Cantidad de rondas configurable
Al elegir un Programa, el motor común le pregunta al anfitrión **cuántas rondas**
quiere jugar (opciones simples: 3 / 6 / 9) y le muestra una **estimación de
duración** calculada a partir del tiempo promedio de cada juego (ej. "9 rondas ≈ 50
min") — se pregunta por cantidad, no por tiempo, y el tiempo se muestra como dato
informativo, no como input. Es una opción del motor común, no algo que cada
Programa deba resolver por su cuenta.

### Pantalla principal: todo al mismo nivel
La grilla de tarjetas que ve el anfitrión al entrar muestra, todas como tarjetas
hermanas (mismo nivel, misma pantalla, sin anidar nada adentro de otra cosa):
- Una tarjeta por cada Programa (El Rosco, Contrarreloj, etc.).
- Una tarjeta **Modo Azar**, que arma la sesión mezclando juegos de todos los
  Programas.
- Una tarjeta **Juegos Varios**, con los juegos propios que no imitan ningún
  formato de TV puntual (la bolsa que antes llamábamos "Noche Clásica").

Azar y Juegos Varios no son casos especiales a nivel técnico — son dos carpetas
más dentro de `/programs/` con su propio manifest, así que la misma convención de
"agregar una carpeta = aparece una tarjeta" ya los cubre sin lógica aparte.

### Plan de contenido: ~20 Programas simples primero
La estrategia para poblar el catálogo: una vez que el motor común y unos pocos
tipos de ronda estén listos, se arma Programa por Programa, reusando los mismos
tipos de ronda todo lo posible. Recién cuando la biblioteca de tipos de ronda no
alcance para una idea nueva, se justifica construir un tipo de ronda adicional.

**Orden de trabajo dentro de cada Programa**: un juego primero, jugable de punta a
punta, antes de tocar nada más — recién con eso andando se completa el pool del
Programa hasta llegar a un tamaño objetivo (**~6 juegos por Programa**). El
puntaje de una partida se suma entre todos los juegos del pool que se hayan
jugado en esa sesión, no por juego individual. Completado un Programa, se pasa al
siguiente y se repite el mismo orden: uno primero, después completar el pool.

## 3. Estructura de contenido: Programas, no mini-juegos sueltos
El contenido se organiza en **Programas**: cada uno recrea la experiencia de un
formato de concurso/TV, con identidad propia (nombre, presentador, estética) y
varias **rondas** internas — no una sola mecánica suelta. Los jugadores entran
"como participantes nuevos" de ese Programa, no simplemente "abren un mini-juego".
Es más fácil de convocar ("juguemos el de la rueda de letras") que elegir de un menú
de mecánicas sin nombre propio.

### Cuidado con nombres y marcas
Los programas de TV reales (Pasapalabra, Minuto para Ganar, 100 Argentinos Dicen...)
tienen nombres y marcas registradas — existe toda una industria de licencias de
formatos de TV para esto. Lo que generalmente **no** está protegido es la mecánica
del juego en sí (las reglas), solo el nombre y la identidad visual.

**Regla de diseño**: nos inspiramos en la mecánica, pero cada Programa tiene nombre
e identidad propia — nunca el nombre real del programa de TV:

| Inspirado en (referencia real) | Nuestro nombre propio |
|---|---|
| Pasapalabra (rueda de letras) | *El Rosco* — término genérico del formato, no exclusivo de una marca |
| Minuto para Ganar / Marley (pruebas de 60 segundos) | *Contrarreloj* |
| 100 Argentinos Dicen / Family Feud (encuesta) | *La Encuesta* |
| Los 8 Escalones (trivia, subir/bajar escalones) | *La Escalera* |
| Susana Giménez (llamado al azar en vivo, grilla de premios) | *Llamada Sorpresa* |

Jugar entre amigos en casa no tiene riesgo real de esto — importa recién si la app
se publica o se monetiza en serio. Mejor tomar el hábito de nombres propios desde ya.

### Modo Noche y equipos
- **Modo Noche** (opcional, no obligatorio): el anfitrión encadena varios Programas
  a lo largo de la noche con **un marcador acumulado único** — al final se corona un
  ganador de la noche. La alternativa siempre disponible es **jugar un solo
  Programa suelto**, sin compromiso.
- **Equipos**: el catálogo tiene que soportar dividir a los jugadores en 2+ equipos
  que compiten entre sí, no solo puntaje individual — varios Programas (La
  Encuesta, Contrarreloj, Aguante) se juegan naturalmente por equipos.

## 4. Arquitectura técnica
Investigando referencias (Jackbox Party Pack y similares) encontramos algo
importante: **ni los productos más exitosos del rubro usan descubrimiento de red
local real**. Jackbox conecta cada celu por navegador a un código de sala vía
internet (funciona con WiFi, datos móviles, lo que sea), evitando la fragilidad de
depender de la red WiFi de la casa (redes de invitados con aislamiento de clientes,
routers que bloquean broadcast, etc.). Esto actualiza el enfoque original ("todo en
LAN, sin internet"):

| Pieza | Enfoque |
|---|---|
| **Cliente de los Programas** | Web — navegador del celu, sin instalar nada. Liviano, y hace mucho más simple soportar varios idiomas (sección 1) que si fuera nativo |
| **Cliente de El Cazador** | App nativa (Unity) — es el único candidato que necesita control de personaje en tiempo real, no encaja en un navegador |
| **Conexión** | Servidor propio liviano con **código de sala** (modelo Jackbox) — funciona con o sin WiFi de la casa |
| **Motor de El Cazador** | Unity (mismo stack que `ProyectoJuego3D`), con Netcode for GameObjects o Mirror para el tiempo real, en un proyecto separado `FiestaApp/` dentro de este repo |
| **Descarga de contenido pesado** | Solo aplica a El Cazador (assets 3D) vía Unity Addressables |

## 5. Catálogo de Programas

### Inspirados en formatos de TV (mecánica sí, nombre/marca propio no)
- **El Rosco** — una palabra por cada letra del abecedario, tiempo límite.
- **Contrarreloj** — varias pruebas cortas de 60 segundos, adaptadas a lo que un
  celu puede medir (ver tabla de sensores más abajo). Vidas limitadas antes de
  quedar afuera.
- **La Encuesta** — se hace una pregunta, los equipos adivinan las respuestas más
  populares, puntos según qué tan arriba está cada respuesta en el ranking.
- **La Escalera** — trivia de opción múltiple: cada acierto sube un escalón, cada
  error baja uno.
- **Llamada Sorpresa** — en cualquier momento el juego "llama" al azar a un
  **jugador que ya está en la juntada** (aparece resaltado en todas las pantallas,
  no es una llamada telefónica real); tiene que responder algo o encontrar un ítem
  en una grilla para puntos extra. Mantiene enganchados a los que no están jugando
  en ese instante. Sin acceso a contactos, sin nada fuera de la sala — cero
  problema de permisos.
- **Aguante** — juego de eliminación por comando (espíritu "Simon Says", parecido a
  pruebas de eliminación física de reality shows): pide presionar botones
  específicos cada vez más rápido; quien se equivoca o llega tarde queda afuera.
  Por equipos, gana el que tenga más sobrevivientes. No encontramos una referencia
  exacta de TV para la versión "barco que se inclina" que se te ocurrió, pero la
  mecánica (reacción + velocidad creciente + eliminación por equipos) es sólida y
  se puede construir igual.
- **Memoria Fotográfica** — se muestra una secuencia de imágenes (pueden ser fotos
  del propio grupo) y después preguntas de detalle ("¿cómo iba vestido tal persona
  en una de las fotos?"). Sirve de base para packs de contenido personalizados por
  grupo, no solo genéricos.
- **A Toda Voz** — inspirado en *Dar la Nota* (Guido Kaczka, Canal 13): karaoke con
  puntaje automático de afinación. Se lee la letra en pantalla (el celu hace de
  monitor) y el micrófono mide qué tan cerca del tono correcto está cantando cada
  uno — misma familia de tecnología que SingStar/UltraStar (detección de tono por
  micrófono, no solo volumen). Ya existe una app de karaoke inspirada en el mismo
  programa, lo que confirma que es viable con celus comunes. Tiene dos modos, sin
  necesidad de ser dos Programas separados:
  - **Modo solo**: puntaje automático por afinación (arriba).
  - **Modo Jurado** (inspirado en *Cantando por un Sueño*, donde un jurado puntúa
    de 1 a 10 y los peores puntajes van a un "duelo"): 2-3 personas rotan como
    jurado en cada ronda y puntúan desde su celu mientras el resto canta; los
    roles rotan para que todos pasen por ambos lados. El "duelo" para el
    puntaje más bajo queda anotado como mejora futura, no bloquea el modo base.

### Tabla de sensores (para adaptar cualquier prueba física a lo digital)
Cualquier desafío físico de TV se puede probar contra esta tabla — si entra, es
viable ya mismo; si depende de espacio/objetos físicos reales, se deja afuera sin
descartar la idea completa:

| Desafío físico original | Sensor del celu que lo reemplaza |
|---|---|
| Inflar un globo, gritar más fuerte, aguantar la respiración | **Micrófono** (volumen/soplido en tiempo real) |
| Cantar afinado (karaoke) | **Micrófono** — pero midiendo tono/frecuencia, no volumen (técnica distinta, ver *A Toda Voz*) |
| Medir fuerza, agitar algo | **Acelerómetro** |
| Balance, inclinar un objeto | **Giroscopio** |
| Reflejos, quién reacciona primero | **Timestamp del toque**, resuelto por el servidor |
| Resistencia, aguantar sin soltar | **Touch mantenido** |
| Movimiento corporal, gestos | **Cámara** — más avanzado y menos confiable en celus de gama media, se deja para más adelante |

### Programa "clásico" (juegos propios, no atados a un formato de TV puntual)
Para no descartar las ideas originales — se agrupan en un Programa propio (ej.
*Noche Clásica*), sin pretender imitar nada externo:
- **Impostor**: todos reciben una palabra menos uno; se discute en persona y se
  vota quién es el impostor.
- **Tutifruti**: categorías + letra al azar + timer, se comparte y puntúa al cortar
  el tiempo.
- **La Botella/Prendas**: ruleta digital que elige jugador + tipo de reto (verdad,
  prenda, karaoke).
- **Mímica por equipos** (ej. adivinar películas): equipos al azar, uno actúa en
  secreto, el resto adivina a los gritos.

### Backlog / referencias regionales para investigar más adelante
- **Chile**: *Dudo* (Canal 13, trivia/conversación) y *Morandé con Compañía* como
  referencia histórica de variedad + juegos — para cuando se arme el primer pack de
  contenido regional fuera de Argentina.
- **Cámara con efectos**: versión simple (filtros locales) viable pronto; versión
  con IA generativa real depende de internet, tiene costo por uso y hay que pensar
  privacidad — se deja para después de validar el resto de la app.
- **Llamada Sorpresa (versión con contactos reales, fuera de la juntada)**: la
  versión más fiel al programa de Susana Giménez, llamando a alguien que no está
  presente. Requiere permiso de Contactos del sistema operativo y **tiene que ser
  una función que el anfitrión activa a propósito antes de arrancar, nunca
  automática ni por defecto** — quien recibe la llamada no dio consentimiento de
  estar en el juego, y el grupo tiene que poder jugar todo igual sin activarla.
- **Estanciero/Monopoly digital**: descartado como prioridad — pierde la gracia
  táctil de un juego de mesa real, que es justo lo que la gente ama de ese formato.
- **El Palo** (candidato ambicioso, mismo criterio que El Cazador — sección 6): un
  obstáculo (palo/barra) pasa y todos tienen que "saltarlo" a tiempo, viéndose
  entre sí en la misma pantalla compartida; quien no reacciona a tiempo va
  cayendo/quedando afuera. La dificultad no es la idea sino la infraestructura:
  necesita sincronización en tiempo real entre muchos celus a la vez (no por
  turnos, como la mayoría del catálogo), del mismo nivel de esfuerzo que El
  Cazador. Se construye después de tener el motor común y los Programas simples
  andando, no como parte del MVP.

## 6. El Rosco — primer Programa (MVP), diseño detallado
Elegido como el primero a construir: mecánica simple, muy reconocible, y reutiliza
el tipo de ronda de trivia que hace falta para varios Programas más.

**Formato**: por equipos (2+), un rosco **compartido** por equipo — todos los
integrantes ven el mismo rosco sincronizado en sus celus, discuten la respuesta en
voz alta entre todos, cualquiera del equipo la toca en su celu. Mantiene a todo el
equipo enganchado a la vez en vez de que uno juegue mientras el resto mira.

**Reglas:**
- Rosco de letras del abecedario en español (set inicial más corto, dejando afuera
  las más difíciles tipo Ñ/X/W — ampliable a dificultad "completa" más adelante).
- Cada letra tiene una pista ("empieza con..." o "contiene la letra...") y
  **4 opciones de respuesta** (opción múltiple — reutiliza el tipo de ronda
  `trivia-opcion-multiple` ya planeado, sin necesidad de construir nada nuevo).
- Tiempo compartido por equipo corriendo mientras contestan (configurable, default
  orientativo ~3 min por rosco).
- **Pasapalabra**: se puede pasar una letra y volver a ella después, antes de que
  se acabe el tiempo.
- Correcta = suma punto, letra en verde. Incorrecta = no suma, letra en rojo, el
  equipo sigue jugando (no penaliza ni corta el juego). Termina cuando se
  completan las letras o se acaba el tiempo.
- Con 2+ equipos, gana el de más aciertos.

**Cómo encaja con el pool de la sección 2**: como El Rosco es una sola mecánica
(no varios tipos de desafío como Contrarreloj), su "pool" son **mazos temáticos de
preguntas** (Cine, Historia, Deportes, Cultura General, Música...) — un rosco
completo de un mazo = una ronda. Al elegir cantidad de rondas (3/6/9), el sistema
sortea esa cantidad de mazos temáticos del pool, sin repetir salvo que se agoten.

**Lo que falta antes de tenerlo jugable**: es más contenido que código — hace
falta escribir ~20-25 preguntas (con sus 4 opciones) por cada mazo temático. El
tipo de ronda (`trivia-opcion-multiple`) y el motor común (sala, equipos, rondas,
puntaje) son el único desarrollo real; el resto es autoría de contenido.

**Este juego es el primero de seis**: el Programa "El Rosco" apunta a un pool de
~6 juegos en total (ver "Plan de contenido" en la sección 2). El objetivo
inmediato es dejar este primer juego jugable de punta a punta; los otros 5 se
diseñan después, uno por uno, sin bloquear el desarrollo de los demás Programas.

## 7. El Cazador (versión virtual — candidato, no comprometido)
**Idea**: no es en la casa real — es una casa/nivel **virtual en 3D** dentro del
juego. Cada jugador controla un avatar en su celu (tercera persona). Uno es el
cazador y persigue a los demás dentro del mapa virtual; los otros deben evitarlo
hasta que se acabe el tiempo.

Se descartó trackear posiciones reales por Bluetooth/GPS (poco preciso, indoor no
es viable) — al ser todo virtual, el juego tiene control total y confiable sobre
posiciones, colisiones y visibilidad.

**Piezas de diseño a resolver:**
- **Cómo se atrapa**: colisión/cercanía directa del avatar del cazador (perseguir
  de verdad), no un botón de "tag". Variantes futuras: visión tipo linterna/cono,
  stamina para correr.
- **Ocultamiento**: hace falta lógica de línea de visión (raycast) — el cazador
  solo ve a un escondido si está cerca o sin obstáculos entre medio.
- **Controles táctiles**: joystick virtual para moverse + arrastre de dedo para la
  cámara. Necesita prueba temprana en celu real.
- **El mapa**: para probar la idea alcanza un **nivel gris** (cajas/planos, sin
  arte final) — mismo criterio de "prototipo gris" que `ProyectoJuego3D`.

**Orden sugerido si se decide avanzar:**
1. Prototipo mínimo: 2-3 celus conectados, cada uno mueve su avatar en un nivel
   gris y se ven entre sí en tiempo real — valida networking + controles táctiles
   antes de sumar reglas de juego.
2. Recién ahí sumar roles (cazador/escondidos), timer, línea de visión y condición
   de victoria.

**Ideas a futuro**: modo "frío/caliente" con audio/vibración según cercanía; zonas o
power-ups (ej. "congelar" al cazador unos segundos).

## 8. Monetización
Sin usuarios reales todavía — se deja anotada la dirección para no partir de cero
más adelante, no para implementar ya.

- **No monetizar todavía**: primero validar que el catálogo engancha con gente real
  (ver Milestones). Un plan de monetización sin datos de uso real es especulación.
- **Mejor encaje con esta arquitectura** (catálogo que crece con el tiempo), cuando
  llegue el momento:
  - **Freemium por contenido**: la app y unos pocos Programas gratis, el resto se
    desbloquea (compra única o suscripción tipo "Pase Fiesta"). Encaja natural con
    un catálogo pensado para crecer.
  - **Personalización paga** (no gameplay): nombres/logos de equipo, voces del
    narrador, packs de fotos para Memoria Fotográfica.
- **Evitar publicidad interruptiva durante el juego**: el objetivo es mantener el
  ritmo de una fiesta, un video-ad a mitad de una ronda mata el clima. Si hay
  publicidad, limitarla a pantallas de menú/lobby.
- **Patrocinios** (al estilo "propaganda" de TV: una marca auspicia un Programa o
  una ronda): plausible, pero requiere escala/audiencia real primero — no es tema
  de MVP.

## 9. Milestones
**MVP elegido: El Rosco** (sección 6). El soporte de varios idiomas (sección 1) se
diseña en la arquitectura de contenido desde el principio, aunque el primer
playtest sea en un solo idioma.

1. **Lobby + servidor con código de sala (semana 1-2)**: conexión web, sala de
   espera con lista de jugadores en vivo, configuración previa (nombres/equipos).
   Sin Programas todavía.
2. **El Rosco jugable (semana 3-4)**: tipo de ronda `trivia-opcion-multiple` +
   motor de rosco/pasapalabra + 2-3 mazos de contenido. Jugable de punta a punta,
   playtest real con gente.
3. **Catálogo + segundo/tercer Programa (semana 5-6)**: agregar 1-2 Programas más
   que reusen el mismo tipo de ronda (ej. La Escalera, Comodines), validar que el
   sistema modular (carpeta + manifest + pool) funciona sin romper lo anterior.
4. **Pulido y Modo Noche (semana 7)**: marcador acumulado entre Programas, Modo
   Azar, Juegos Varios, testing de instalación liviana.
5. **Playtest grupal grande (semana 8)**: probar con 6-8 personas reales, ajustar
   según fricciones encontradas.
6. **(Si se decide avanzar) El Cazador virtual / El Palo**: arrancan con su propio
   prototipo gris de movimiento/networking (sección 7) antes de sumarse al
   catálogo — se tratan como sus propios mini-hitos, de mayor esfuerzo que los
   Programas simples.

Tiempos orientativos — la prioridad es tener siempre algo jugable, no cumplir el
cronograma al pie de la letra.

## 10. Próximos pasos manuales (requieren tu intervención)
1. Escribir el contenido de los primeros 2-3 mazos temáticos de El Rosco (~20-25
   preguntas con 4 opciones cada una, por mazo) — es autoría de contenido, no
   requiere herramientas técnicas.
2. En Unity Hub, crear un **proyecto nuevo** (template 3D o Mobile) ubicado en
   `FiestaApp/` dentro de este repo, para cuando se decida avanzar con El Cazador —
   no bloquea el arranque de El Rosco, que es web.
3. Avisame cuándo querés bajar a detalle técnico del motor común (sala con
   código, equipos, puntaje) para arrancar el desarrollo de El Rosco.
