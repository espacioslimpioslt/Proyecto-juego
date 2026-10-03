# Soy Participante

Ver [`Docs/PLAN_APP_FIESTA.md`](../../Docs/PLAN_APP_FIESTA.md) para el plan completo.

App web para que un grupo reunido en una casa juegue a un programa de concursos
desde sus propios celulares. Nadie instala nada: el anfitrión crea la sala y el
resto entra con un código.

Hay varios Programas para elegir en la portada:

- **El Rosco**: fiel al programa de TV real — se sortean pruebas del pool y se
  cierra siempre con el rosco final, que gasta el tiempo ganado antes.
- **Ahora Caigo**: también fiel a su programa de TV — duelos 1 contra 1 donde
  el primero que se equivoca cae, y se cierra con la Escalera Final, que
  gasta el tiempo ganado en los duelos.
- **Varios**: juegos de fiesta propios, que no siguen la línea de ningún
  programa. El anfitrión tilda a mano cuáles quiere jugar (uno o varios) y se
  suman los puntos directos de cada uno — no hay prueba final ni tiempo que
  gastar.

## Cómo probarlo

```
npm install
npm start
```

Abrir `http://localhost:3000` — un tab como anfitrión, y otro tab (o el celu, si
está en la misma red) como invitado con el código que aparece.

### Formatos y ajustes de cada juego
En la sala de espera, lo primero es **¿Cómo quieren jugar?**: ⚡ Rápida,
🎬 Clásica, 🏃 Maratón, 👨‍👩‍👧 Familia con chicos o 🔥 Desafío. Un toque llena
la cantidad de pruebas, la dificultad, el tiempo de la final y el **tiempo
para responder** de los juegos por turnos (si se acaba, cuenta como error y
sigue el próximo: la partida nunca queda esperando).

En **⚙️ Ajustes de cada juego** se puede retocar cada uno (letras y segundos
de Tutifruti, vidas de La Silla, tamaño de la sopa, modo y casos del
Impostor, etc.). Lo que no se toca sale de la dificultad. Cada juego declara
sus ajustes en su archivo (`opciones`, ver `server/opciones.js`) y la sala
los muestra sola.

### Jugar con gente que está lejos
En la sala de espera hay un botón **📲 Invitar por WhatsApp** (y otro para
copiar el link). El link lleva el código de la sala: quien lo abre cae directo
en "Unirme" con el código cargado y solo pone su nombre. Así se suman hijos,
parientes o amigos que están en otra ciudad, igual que si estuvieran en el
living. Cuando ya están todos, el anfitrión puede **cerrar la sala** para que
no entre nadie más, y si saca a alguien, ese celu no puede volver a entrar.

### Si se corta la conexión
Cada celu tiene una identidad propia que no depende de la conexión. Si se
bloquea la pantalla, se cambia de app, se va el wifi o se recarga la página,
el jugador **vuelve solo a su lugar**, con su equipo y en la misma prueba.
Mientras no está, aparece con 📵 y su turno lo toma el siguiente de su equipo.
Si no vuelve en 2 minutos (`GRACIA_MS`), sale de la sala; si un equipo se
queda sin nadie, el programa termina con el puntaje que había.

### Modo prueba (probar solo, sin esperar a nadie)
En la sala de espera el anfitrión puede tildar **"Modo prueba"**: arranca con una
sola persona y le permite jugar por todos los equipos. Con el modo apagado el juego
exige al menos 2 participantes (si no, el turno no tendría a quién pasar).

**Nombres inventados por equipo**: con modo prueba activo aparecen dos campos para
cargar nombres (separados por coma) para el Equipo A y el Equipo B. Sin nombres,
modo prueba solo tiene al anfitrión — suficiente para probar juegos por turnos
simples, pero no alcanza para ver cómo rotan de verdad Mímica o La Cadena (que
necesitan varias personas reales por equipo). Cargando nombres se arman equipos
completos "de mentira" que el anfitrión controla todos desde su celu, así se ve
la partida tal cual la jugaría un grupo real, rotación incluida.

## El programa "El Rosco"

100% fiel al programa de televisión real: seis pruebas encadenadas que
**reparten segundos**, y el rosco final que **los gasta** — se llega a la
ronda final con el tiempo ganado antes.

| Prueba | Qué se hace | Segundos por acierto |
|---|---|---|
| **Elegí Una** | Cada equipo responde sus PROPIAS diez preguntas (no las mismas que el otro), rotando quién contesta. Gana el que más acertó de las suyas | +5 s |
| **La Silla** | Tanda de cinco preguntas que empiezan todas con la misma letra. Dos errores y se corta | +6 s |
| **¿Dónde Estaba?** | Panel de 9 casillas: se memorizan las palabras, se tapan, y hay que decir dónde estaba cada una | +6 s |
| **Sopa de Letras** | Cada equipo tiene su PROPIA copia del mismo panel (7×7) y la resuelve a su ritmo, al mismo tiempo que el otro — no comparten palabras encontradas. Errar resta 5 s al propio reloj. Gana el que encuentra todas sus palabras más rápido. En difícil (9×9) hay palabras que se leen al revés | +8 s + bono al más rápido |
| **Palabras Cruzadas** | Cada equipo tiene su PROPIO tablero (misma base, mismas cruzadas) y lo resuelve a su ritmo, al mismo tiempo que el otro. Gana el que completa todo su tablero más rápido | +7 s + bono al más rápido |
| **Tutifruti** | Varias letras seguidas (5/7/9 según dificultad), sin repetir. En cada una, todos los equipos escriben a la vez, por teclado, las 6 categorías. El primero en mandar corta a los demás (como el "¡Basta!" del juego real). Se compara contra un banco de palabras; lo que no está en el banco pero cumple la letra queda "dudoso" y el anfitrión lo resuelve con el grupo, en voz alta. Los puntos se acumulan entre todas las letras | +4 s por punto (2 pts palabra única, 1 pt repetida) |
| **El Rosco** | La final: una palabra por letra, con pasapalabra y el reloj corriendo solo para el equipo activo | — gasta el tiempo |

### Sobre las letras en Tutifruti
La prueba entera son **varias letras seguidas** (5 en fácil, 7 en normal, 9 en
difícil — nunca se repite una dentro de la misma prueba), no una sola: se
escribe, se revisa y se puntúa igual que siempre, y al cerrar una letra
arranca la siguiente sola, sumando los puntos de todas. Antes era una letra
nomás y quedaba demasiado corta.

### Sobre la validación de palabras en Tutifruti
No hay un diccionario completo del español integrado (sería enorme y quedaría
desactualizado). En cambio: cada categoría tiene un banco curado de palabras que se
valida solas; lo que no está en el banco pero **empieza con la letra correcta** queda
como "dudosa" y el anfitrión —representando lo que el grupo discutió en voz alta,
como se juega en la vida real— la acepta o la rechaza antes de que se calcule el
puntaje.

**Por qué es solo por teclado, sin dictado por voz**: Tutifruti es el único
juego donde todos los equipos escriben **al mismo tiempo, en la misma sala**. Si
alguien dictara su respuesta en voz alta, el resto la escucharía y perdería toda la
gracia del juego — a diferencia de los juegos por turnos, acá el silencio es parte
de la mecánica.

**El primero en mandar frena a los demás**: como en el juego real (el clásico
grito de "¡Basta!"), todos escriben a la vez y en cuanto **un equipo manda**, a
los demás se les mandan automáticamente las respuestas que tenían escritas hasta
ese instante — no llegan a seguir completando. Es una carrera real: escribir
rápido importa. El reloj compartido sigue existiendo como límite máximo, por si
ningún equipo termina antes.

**Pero solo cuenta si completó las 6 categorías**: el envío que dispara el
corte (el primero) tiene que tener las 6 categorías escritas — si no, el botón
de mandar queda deshabilitado y el servidor lo rechaza igual. Si no fuera así,
cualquiera podría cortarle la escritura a los demás mandando con una o dos
casillas nomás. Una vez que el corte ya está en marcha, los equipos que quedan
atrapados sí pueden mandar incompleto — es lo que tenían escrito en ese
momento, no una trampa.

**Tutifruti son varias letras** (5/7/9 según dificultad, sin repetir), no una
sola — se explica más abajo, en "Sobre las letras en Tutifruti".

### Sobre Sopa de Letras y Palabras Cruzadas: carrera por tiempo, no por turnos
Cada equipo tiene su **propia copia independiente** del mismo panel/tablero
(mismas letras, mismas palabras o cruzadas) y lo resuelve a su propio ritmo,
al mismo tiempo que el otro equipo — no comparten el progreso: que un equipo
encuentre una palabra o resuelva una cruzada no le afecta nada al otro, cada
uno tiene que encontrar/resolver las suyas igual. Gana el equipo que termina
**todo** su panel/tablero en menos tiempo. Cada acierto suma segundos como
siempre, y el equipo más rápido en terminar se lleva un bono extra. Si nadie
llega a terminar antes del tiempo máximo, se cierra igual con lo que hayan
logrado hasta ahí.

De cada partida se sortean las pruebas del pool sin repetir, y **siempre se cierra
con el rosco**. La cantidad de pruebas (3, 6 o 9) la elige el anfitrión.

## El programa "Ahora Caigo"

Fiel al programa real: duelos 1 contra 1 donde el primero que se equivoca
"cae", y una Escalera Final donde hay que subir escalón a escalón sin
equivocarse... o plantarse a tiempo para no arriesgar lo ganado. Igual que
El Rosco, los duelos **reparten segundos** y la Escalera Final **los gasta**.

| Prueba | Qué se hace | Segundos por torre |
|---|---|---|
| **Duelo de Torres** | Un integrante de cada equipo se enfrenta 1 contra 1: preguntas de opción múltiple que se alternan entre los dos (primero responde quien defiende la torre, después el retador, y así). El primero que se equivoca cae — el otro gana la torre y sigue defendiendo. El equipo que cayó manda a su SIGUIENTE integrante a retar la próxima vez, así todos van pasando por el rol de retador | +8 s |
| **Escalera Final** | Cada equipo tiene su propia escalera de 10 escalones y su propio reloj (el tiempo ganado en los duelos), pero se juega por turnos como El Rosco: mientras es tu turno, cada acierto sube un escalón y sigue el mismo equipo; si te equivocás, "caés" y volvés al último escalón que hayas plantado (0 si nunca plantaste) — se pierde todo lo arriesgado desde ahí, y el turno pasa al otro equipo. En cualquier momento podés plantarte: el escalón alcanzado queda a salvo para siempre, pero dejás de subir | — gasta el tiempo |

### Sobre el Duelo de Torres: campeón fijo, retador rotativo
A diferencia de los demás juegos por turnos (donde "el que sigue en la
lista" del equipo contesta cada pregunta), acá hay dos personas puntuales
jugando el duelo: quien defiende la torre y quien la reta. Mientras el
campeón siga ganando, sigue siendo la MISMA persona la que defiende (no
rota) — recién cuando cae le toca a alguien de su equipo, y ahí sí pasa al
siguiente integrante. El mazo de preguntas se reparte de nuevo si se agota
en medio de una racha de aciertos (mismo mecanismo que ya usan Mímica y
Palabra Prohibida): un duelo termina únicamente cuando alguien se equivoca,
nunca porque se acabaron las preguntas.

Se juegan varios duelos seguidos (3 en fácil, 4 en normal, 5 en difícil), y
cada torre ganada suma segundos para la Escalera Final.

### Sobre la Escalera Final: todo o nada, salvo que te plantes
Es la misma tensión del programa real: podés seguir subiendo mientras te
alcance el tiempo y no te equivoques, pero si caés sin haberte plantado
antes, perdés todo lo que llevabas arriesgado — no hay red de seguridad
automática. Plantarse es una decisión consciente: en cualquier momento en
que te toque jugar, en vez de responder podés guardar el escalón alcanzado
como definitivo y dejar de arriesgar (aunque eso también significa que ya no
podés seguir sumando). Si un equipo completa los 10 escalones sin caer,
queda a salvo automáticamente en el último. El equipo con el escalón más
alto guardado gana esta prueba — y como es la última, también puede definir
el Programa entero.

## El programa "Varios"

Juegos de fiesta propios, que no siguen la línea de ningún programa de TV en
particular. A diferencia de El Rosco, acá **no se sortea nada**: en la sala de
espera el anfitrión tilda a mano cuáles de estos juegos quiere jugar (uno o
varios seguidos), y se juegan justo esos, en ese orden. No hay rosco final ni
tiempo que gastar — cada juego suma **puntos directos** a `room.scores`, y al
terminar el último tildado se pasa directo a la pantalla de resultados.

| Juego | Qué se hace |
|---|---|
| **El Impostor** | Todos reciben la misma palabra secreta menos uno, el impostor. Por turnos, cada uno escribe una pista corta (sin decir la palabra) que aparece en la pantalla de todos; después se vota tocando a quien se sospecha. Si atrapan al impostor, tiene un **robo final**: adivinar la palabra entre 6 opciones para robarse el caso. Necesita al menos 3 personas |
| **La Encuesta** | Como en los programas de "le preguntamos a 100 personas": una pregunta con las respuestas más populares ocultas en un tablero. El equipo con el control escribe respuestas (rotando quién contesta); cada acierto destapa una ficha y suma al pozo. Con 3 cruces, el otro equipo tiene una sola chance de **robar** el pozo. El servidor reconoce la respuesta aunque esté escrita distinto (sin tildes, plurales, diminutivos, alias y un error de tipeo); si igual no la toma, el anfitrión puede ver las respuestas ocultas a propósito y darla por buena. La última pregunta puede valer doble |
| **Caja Fuerte** | ¿Trato o no trato? Cada equipo elige su caja sin abrirla y va abriendo las demás de a tandas; la Banca le ofrece puntos por su caja. Trato: se lleva la oferta. No trato: sigue abriendo. Sin preguntas: juegan igual chicos y grandes. Ajustes: cantidad de cajas y si la Banca es generosa, justa o tacaña |
| **Verdadero o Falso** | Relámpago: aparece una afirmación y todos los equipos contestan a la vez, contra reloj (vale el primer toque de cada equipo). Acertar suma 2 y el primero en acertar suma 1 más; después se revela con un dato curioso. Mazos fácil (para chicos), general y difícil. Ajustes: cantidad de afirmaciones y segundos para contestar |
| **La Torre** | Juego de habilidad en 3D (Three.js): un bloque va y viene sobre la torre y hay que tocar para soltarlo; lo que sobra se corta y cae. Si cae justo encima ("¡perfecto!") no se achica y suma un punto extra. Cada equipo arma su torre y en cada bloque suelta un integrante distinto. El celu que suelta manda dónde estaba el bloque y el servidor hace el resto. Sin WebGL, se juega en una versión plana. Ajustes: velocidad y torres por equipo |
| **Aguante** | Reflejos con el semáforo de largada de la F1: se prenden cinco luces rojas y en un momento al azar se apagan; hay que tocar apenas se apagan (antes es "largada en falso"). Juegan todos a la vez y cada uno suma puntos estilo F1 (25, 18, 15...) para su equipo. El tiempo lo mide cada celu contra su propia pantalla, así la demora de internet no favorece a nadie. Ajustes: cantidad de largadas y luces trampa (un destello amarillo que engaña) |
| **Mímica** | Roles cruzados: uno de un equipo actúa en silencio, cualquiera del OTRO equipo dice la respuesta apretando el micrófono — el celu la reconoce y valida sola. Se juega por bloques de tiempo fijo que se turnan hasta que todos actuaron |
| **Adiviná la Canción** | Roles cruzados: un equipo pone música (cualquiera, desde su propio celu), cualquiera del otro equipo responde en voz alta apenas la sepa y el anfitrión confirma. Se invierten los roles en cada canción |
| **La Cadena** | Memoria en equipo, al estilo "iba al mercado y compré...": pregunta 1 → "sol". Pregunta 2 → hay que decir "sol" y recién ahí la respuesta nueva. Pregunta 3 → "sol, nube" y la nueva. Todo en un solo audio, el celu lo valida. Si alguien falla, la cadena NO se pierde: le toca a la siguiente persona del equipo, con la misma cadena y la misma pregunta |
| **Palabra Prohibida** | Al estilo Taboo: uno de un equipo describe una palabra sin decir ninguna de las 4 palabras prohibidas que la acompañan; cualquiera del OTRO equipo adivina por micrófono. Si el anfitrión escucha que dijo una prohibida, corta la tarjeta sin puntaje con "🚫 Dijo una prohibida" |

Como no hay rosco final, ninguno de estos juegos reparte "segundos" — el
puntaje de cada uno (aciertos, largo de la cadena lograda, etc.) se suma tal
cual al marcador general del Programa.

### Sobre El Impostor
- **Cada celu recibe solo lo suyo**: la palabra secreta nunca viaja al celu
  del impostor, ni siquiera escondida (el servidor arma una vista por persona,
  `privateView`). La palabra se ve manteniendo apretada una carta, para que el
  de al lado no espíe.
- **Pistas escritas**: se juega igual en el living que a distancia, sin
  videollamada. El servidor rechaza una pista que diga la palabra (o un pedazo
  largo de ella). Si el impostor la "adivina" como pista se acepta:
  rechazarla le confirmaría cuál es.
- **Dificultad**: en fácil todos ven la categoría; en normal nadie; en difícil
  ("a ciegas") el impostor recibe otra palabra de la misma categoría y no
  sabe que es el impostor.
- **Puntos**: cada voto acertado suma 1 al equipo de quien votó; el impostor
  suma 3 a su equipo si escapa (o si hay empate) o si roba el caso.
- Se juegan 3 casos, con relojes para pistas, votación y robo: si alguien no
  contesta, el juego sigue solo. El anfitrión puede saltear un turno o cerrar
  la votación antes.

### Sobre Mímica: reconocimiento de voz real
A diferencia de Tutifruti/La Cadena/Adiviná la Canción (donde el anfitrión
arbitra a mano lo que se dijo en voz alta), acá el celu de quien adivina
**escucha de verdad** con la Web Speech API del navegador y valida el texto
reconocido contra la palabra objetivo. Es menos confiable que un botón manual
(depende de que el navegador soporte reconocimiento, del ruido de la previa,
del acento) pero es fiel al juego real — nadie tiene que estar mirando un
celu para confirmar si acertaron. Dos redes de seguridad por si falla:

- Si el navegador no soporta reconocimiento de voz (ej. Firefox), aparece un
  campo de texto de respaldo que manda exactamente lo mismo al servidor.
- El anfitrión siempre tiene un botón para dar la palabra por válida a mano,
  por si el reconocimiento se equivocó con algo que sí se dijo bien.

**Quién actúa se elige en el momento**: al empezar cada bloque, el anfitrión
elige 🎲 al azar (como tirar un dado entre los del equipo) o 🔄 rotativo
(el que sigue en la lista) — no es una configuración fija de la sala, es una
decisión que se toma cada vez. Los bloques son de **tiempo fijo, no por
cuántas palabras adivinan**: se turnan ambos equipos hasta que a todos les
tocó actuar al menos una vez (el equipo con menos gente repite integrantes).
El único motivo por el que cambia el actor es que se acabe el tiempo del
bloque — si el mazo de palabras se agota antes (pasando muchas), se reparte
de nuevo mezclado en vez de cortarle el turno a quien está actuando.

### Sobre el recitado en voz alta en La Cadena
Se valida con reconocimiento de voz real (Web Speech API, igual que Mímica),
y en **un solo audio**: pregunta 1 → responde "sol". Pregunta 2 → antes de
decir "nube" (la respuesta nueva) hay que decir "sol" (lo anterior). Pregunta
3 → "sol, nube" y recién ahí la respuesta nueva. Así con cada pregunta: la
cadena crece de a uno, y siempre se recita completa + la respuesta nueva en
la misma grabación — el celu valida las dos cosas juntas (tolera muletillas
de por medio, pero no palabras salteadas ni cambiadas de lugar). Hay un botón
manual para escribir la respuesta (siempre visible, no solo si falla el
micrófono) y otro para que el anfitrión la dé por buena a mano si el
reconocimiento se equivoca con algo que en realidad se dijo bien.

**Un error no borra la cadena — pasa a la siguiente persona del equipo**: la
rotación de quién contesta es automática (mismo motor común de turnos que
usan los demás juegos), así que si alguien falla, le toca intentar la MISMA
pregunta, con la MISMA cadena ya armada, al que sigue en el equipo. Recién si
**todo el equipo** falló esa pregunta (le tocó a cada integrante y nadie
pudo) se termina el turno del equipo, con la cadena que hayan logrado hasta
ahí. El puntaje final es el largo de esa cadena.

**Cada equipo tiene su propia tanda de preguntas**, no la misma: como
recitan en voz alta delante de todos, si compartieran la tanda, el equipo que
juega segundo ya habría escuchado las respuestas del primero. La cadena del
equipo que está jugando se ve en la pantalla de todos (incluido el rival) —
la gracia es que quien recita lo haga de memoria sin mirar, no que sea
secreto para el resto del grupo. Las opciones de la pregunta actual se
muestran en un recuadro bien visible, para que se sepa siempre entre qué
elegir.

**Ayuda según dificultad**: en fácil se ve la cadena en el orden correcto
(solo hay que decirla bien); en normal se ve pero desordenada (hay que saber
el orden, no las palabras); en difícil no se ve nada — hay que recordar todo.

### Palabra Prohibida
Mismo patrón que Mímica (roles cruzados, bloques de tiempo fijo, elegir el
actor 🎲 al azar o 🔄 rotativo, mazo que se reparte de nuevo si se agota sin
cortarle el bloque a quien está describiendo) pero al estilo Taboo: cada
tarjeta tiene una palabra objetivo y 4 palabras prohibidas. Quien describe ve
las dos cosas; el resto del equipo no.

- **Adivinar**: cualquiera del equipo contrario, por micrófono (igual que
  Mímica) o por el campo de texto de respaldo.
- **✔ Dar por válida igual**: red de seguridad de siempre, por si el
  reconocimiento de voz no entendió algo que sí se dijo bien.
- **🚫 Dijo una prohibida**: acción nueva del anfitrión — si escucha (en la
  previa, en voz alta) que quien describe dijo una de las palabras prohibidas,
  corta la tarjeta ahí mismo, sin puntaje para nadie, y pasa a la siguiente.
  Mismo mecanismo interno que "pasar", pero registrado aparte para que quede
  claro que fue una falta y no una tarjeta salteada porque no se le ocurría.

### Adiviná la Canción — por qué la app no reproduce música
Es un juego propio de Varios (no una prueba del programa real), y por eso
**la app nunca aloja ni reproduce audio con copyright**: reproducir música con
derechos en una app que se publica es un problema legal real (a diferencia de
jugar en casa), y no hay presupuesto para licencias de ejecución pública (lo
que sí pagan los programas de TV que usan canciones reales).

En cambio, la app solo corre la mecánica, con **roles cruzados que se
invierten en cada canción** (mismo espíritu que Mímica): un equipo hace de
DJ — **cualquiera de sus integrantes** reproduce una canción cualquiera desde
su propio celu o parlante, la app no toca el audio en ningún momento — y el
otro equipo compite por saber qué es: **cualquiera de sus integrantes**
(no un representante fijo) puede presionar para responder en voz alta apenas
la sepa. El anfitrión confirma si acertó (mismo patrón de arbitraje que las
palabras dudosas de Tutifruti y el recitado de La Cadena), o la salta si
nadie la sabe. **Acierto, error o salteo: en los tres casos la canción se da
por resuelta y se pasa a la siguiente** — cada canción gasta un cupo de la
tanda pase lo que pase, así el juego siempre llega a la cantidad total (5/7/9
según la dificultad) sin importar cuántas acierten. Al resolverse cada
canción, los roles se invierten: el que adivinaba pasa a poner la música
siguiente, así todos ponen música y todos adivinan en algún momento.

## Turnos

El turno es del **equipo**, y dentro del equipo va **rotando quién contesta**: solo
esa persona puede tocar los botones, el resto la ayuda en voz alta. Así participan
todos y no contesta siempre el más rápido.

Esta rotación vive en el motor común (`server/rooms.js`), no en cada juego — así que
cualquier prueba que se agregue la hereda sin reimplementarla.

## Contenido

El contenido vive en `programs/<programa>/content/<juego>/*.json` (por ejemplo
`programs/el-rosco/content/tutifruti/` o `programs/varios/content/mimica/`),
separado por juego y por tema. Agregar un tema es crear otro archivo con la
misma forma; el servidor los carga solos al arrancar (escanea todos los
Programas, no hace falta registrar nada a mano) y sortea sin repetir dentro de
una misma partida.

### Filtrado por país y por edad
Cada mazo declara para quién sirve:

```json
{ "theme": "Argentina y el Cono Sur", "regions": ["ar","uy","cl","pe"], "minAge": 0 }
```

- `regions`: `["global"]` sirve en cualquier lado. Un mazo con `["ar","cl","pe"]`
  solo se sortea si el grupo dijo que juega desde ahí — así un grupo en Brasil no
  recibe preguntas sobre próceres argentinos.
- `minAge`: los mazos de 18 o más solo aparecen si el anfitrión marcó "solo mayores".

El anfitrión elige país y público en la sala de espera, antes de arrancar.

### Escribir mazos nuevos (y el rol de la IA)
Se puede usar IA para **redactar** mazos por país o franja etaria, pero **offline,
como herramienta de autoría** — nunca generando preguntas en vivo durante la
partida: haría falta internet, tendría costo por partida, y si el modelo se equivoca
en una respuesta el juego da por incorrecta una respuesta correcta.

El flujo sano es generar, revisar y validar:

```
node tools/validar-contenido.js
```

La herramienta chequea, según el juego: que la respuesta correcta cumpla la consigna
(empieza/contiene/termina con la letra), que las tandas de La Silla tengan todas la
misma inicial, que los paneles de memoria tengan 9 palabras, que las palabras de la
sopa entren en la grilla, y que las cruzadas del crucigrama **realmente crucen** en
la letra correcta. Encontró 35 errores reales mientras se escribía el contenido
inicial, así que conviene correrla siempre antes de dar un mazo por bueno.

Para el motor de juego hay un simulador que juega cientos de partidas
completas con bots (respuestas al azar, gente que se corta y vuelve, gente que
se va) y avisa si alguna se traba o explota:

```
node tools/simular-partidas.js 20
```

## Cómo se agrega una prueba nueva

1. Crear `server/roundTypes/<nombre>.js` que exponga `type`, `label`,
   `estimateSecondsPerRound`, `createRound()`, `answer()`, `scores()`,
   `carryOver()` y `publicView()` (más `tick()` si necesita reloj).
2. Registrarlo en `roundTypes` (y su ícono en `ICONS`) dentro de `server/rooms.js`.
3. Sumarlo a `games` en el manifest del Programa que corresponda (¿es fiel a
   un programa de TV con prueba final propia, como El Rosco o Ahora Caigo?
   va en ese Programa. ¿Es un juego propio, sin línea de programa? va en
   `varios`, o en uno nuevo — ver más abajo).
4. Dibujar su tablero en `BOARDS`/el `renderPlaying` de `public/app.js`.
5. Poner su contenido en `programs/<programa>/content/<nombre>/`.

El motor común (sala, código, equipos, turnos, puntaje, tiempo acumulado) no se
toca.

### Cómo se agrega un Programa nuevo
Un "Programa" es solo un `programs/<id>/manifest.json` + su carpeta de
contenido — el servidor los descubre solos al arrancar, no hace falta
registrar nada más en el motor común. Dos modos posibles, vía `sequenceMode`
en el manifest:

- `"random"` (default, como El Rosco): sortea `roundCount - 1` juegos del
  `games` del pool y cierra siempre con `finalGame`.
- `"pick"` (como Varios): sin `finalGame`; el anfitrión tilda a mano
  cuáles de los `games` quiere jugar (`selectedGames`), se juegan tal cual se
  tildaron, sin sorteo, y no hay prueba final que gaste tiempo — el puntaje ya
  quedó sumado directo por cada juego jugado.

### Ganador de cada juego

Además del ganador del programa (la suma de todos los juegos), al terminar cada juego se muestra quién lo ganó, y en la pantalla final hay una tabla de "Ganadores por juego". Así un programa de Varios sirve igual para jugar un solo juego suelto o una noche de varios.
