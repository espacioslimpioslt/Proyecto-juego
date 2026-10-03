# Publicar Soy Participante en MonsterASP.NET

MonsterASP corre aplicaciones Node.js dentro de IIS (el servidor web de
Windows) con el módulo **iisnode**. No ejecuta `npm install` en el servidor:
hay que subir la app con la carpeta `node_modules` ya armada.

## Publicación automática (recomendada)

`.github/workflows/publicar-monsterasp.yml` publica solo cada vez que se
actualiza `main`: prueba el contenido y el motor (si algo falla, no sube
nada), arma el paquete con `node_modules` y lo sube por FTP a `wwwroot`.
También se puede correr a mano desde la pestaña **Actions** del repo →
**Publicar en MonsterASP** → **Run workflow**.

Configuración, una sola vez: en GitHub, **Settings → Secrets and variables →
Actions → New repository secret**, crear estos tres con los datos de
"Acceso FTP/SFTP" del panel de MonsterASP:

| Secret | Valor |
|---|---|
| `FTP_SERVER` | el servidor, ej. `sitio95765.siteasp.net` |
| `FTP_USERNAME` | el usuario, ej. `sitio95765` |
| `FTP_PASSWORD` | la contraseña FTP |

La contraseña queda guardada cifrada en GitHub: no aparece en el código ni
en los registros.

## Publicación a mano (si hace falta)

### Qué se sube

Todo lo que está dentro de `FiestaApp/web/` **menos** `tools/`, y con
`node_modules` instalado solo con las dependencias de producción:

```
app.js            ← punto de entrada para iisnode (carga server/server.js)
web.config        ← configuración de IIS + iisnode
package.json
package-lock.json
server/
public/
programs/
node_modules/     ← generado con: npm ci --omit=dev
```

Para armar el paquete en la compu (desde `FiestaApp/web/`):

```
npm ci --omit=dev
```

y comprimir esas carpetas y archivos en un `.zip`. Las dependencias
(Express y Socket.io) son JavaScript puro, así que un `node_modules` armado
en Linux o Mac sirve igual en el Windows del hosting.

## Pasos en el panel de MonsterASP

1. Crear un sitio web (queda en un subdominio gratis `*.runasp.net`).
2. Si el panel tiene una opción para elegir la tecnología del sitio o
   activar Node.js, activarla.
3. Subir el contenido del `.zip` a la **raíz del sitio** (la carpeta
   `wwwroot`), con el administrador de archivos del panel o por FTP. Tiene
   que quedar `web.config` y `app.js` directamente en la raíz, no dentro de
   otra carpeta.
4. Abrir `https://<tu-sitio>.runasp.net/api/salud`. Si responde `"ok": true`,
   el servidor está andando.
5. Abrir `https://<tu-sitio>.runasp.net` en dos celulares y jugar una
   partida.

## Las tres cosas a verificar del plan gratuito

| Qué | Cómo se ve | Si sale mal |
|---|---|---|
| **¿Pasan los WebSockets?** | Con una partida abierta, en `/api/salud` mirar `transportes`: `websocket` es lo ideal; `polling` significa que el hosting no los deja pasar | Funciona igual (Socket.io usa "long polling" solo), un poco más lento. Para juegos por turnos alcanza |
| **¿El servidor se reinicia o se duerme?** | Mirar `arrancado` en `/api/salud` en distintos momentos del día. Si cambia sin que hayamos subido nada, se reinició | Las salas viven en memoria: un reinicio corta las partidas en curso. Ahí conviene guardar las salas en la base de datos gratuita |
| **¿Un solo proceso de Node?** | `web.config` ya pide uno solo (`nodeProcessCountPerApplication="1"`) | Si el hosting lo ignorara y abriera varios, cada proceso tendría salas distintas y la gente "no encontraría" la sala. Se nota porque el código de sala a veces dice que no existe |

## Lo que pasó en la primera publicación (oct 2026)

Con el primer `web.config` (que tenía `watchedFiles` con subcarpetas,
`loggingEnabled`, `hiddenSegments`, etc.) el proceso de IIS se caía apenas
arrancaba: en **Registros → Registros de eventos** aparecía tres veces "el
grupo de aplicaciones finalizó inesperadamente". Con el `web.config` simple
que está ahora en el repo (solo el handler, la regla de reescritura, WebSocket
de IIS apagado y un único proceso) anduvo sin tocar nada más. **No sumarle
opciones a `<iisnode>` sin probarlas de a una.**

`devErrorsEnabled="true"` muestra en el navegador el error de Node si algo
falla. Sirve mientras se prueba; antes de abrirlo a más gente, pasarlo a
`false`.

## Si algo falla

- **"This page isn't working" / el sitio no abre**: mirar **Registros →
  Registros de eventos** del panel. Si dice que el grupo de aplicaciones
  finalizó inesperadamente, el problema es la configuración de IIS
  (`web.config`), no el juego.
- **Página de error con texto**: es Node avisando qué falló
  (`devErrorsEnabled="true"`). Ese texto dice qué corregir.
- **La página carga pero no se puede crear sala**: revisar `/api/salud`; si
  no responde, Node no arrancó (ver el registro de arriba).
- **Cambios que no se ven**: iisnode reinicia Node cuando cambia
  `web.config` o un `.js` de la raíz. Si se cambiaron archivos de `server/`,
  pulsar **Reanudar** en "Acciones rápidas" para que tome los cambios. Si se
  cambió solo algo de `public/` (pantallas), alcanza con recargar el
  navegador.
