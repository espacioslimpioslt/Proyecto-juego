// Punto de entrada para hostings con IIS + iisnode (ej. MonsterASP): el
// web.config apunta a este archivo en la raiz. El servidor real esta en
// server/server.js; en la compu se sigue arrancando con `npm start`.
require('./server/server.js');
