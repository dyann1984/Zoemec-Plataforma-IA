ZOEMEC COTIZADOR - React + Firebase

IMPORTANTE:
Este proyecto NO se abre con Live Server.
No abras 127.0.0.1:5500/index.html.

PASOS:
1. Abre esta carpeta en VS Code.
2. Abre Terminal > New Terminal.
3. Ejecuta:
   npm install
   npm run dev
4. Abre la liga que salga, normalmente:
   http://127.0.0.1:5173

ARCHIVOS IMPORTANTES:
- index.html: solo carga React, por eso tiene poco cÃ³digo.
- src/main.jsx: aquÃ­ estÃ¡ toda la aplicaciÃ³n.
- src/firebase.js: aquÃ­ pegas tu configuraciÃ³n de Firebase.
- src/style.css: diseÃ±o visual.
- .gitignore: evita subir node_modules, dist y archivos .env.

NOTAS DE ESTA VERSIÃ“N CORREGIDA:
- El ZIP no debe incluir node_modules ni dist; se regeneran con npm install / npm run build.
- Se reemplazÃ³ la librerÃ­a xlsx por read-excel-file y write-excel-file para evitar avisos de seguridad conocidos.
- El login actual sigue siendo modo demo/local hasta conectar Firebase Authentication.
- No uses datos reales de clientes hasta activar Firebase Auth, Firestore y reglas de seguridad.

PARA ACTIVAR IA REAL CON OPENAI:
1. Copia .env.example como .env.
2. En .env pega tu llave:
   OPENAI_API_KEY=tu_llave
3. Abre una terminal y ejecuta:
   npm run ai
4. Abre otra terminal y ejecuta:
   npm run dev
5. En APU Inteligente usa el botÃ³n "IA real" o "Generar APU con IA real".

IMPORTANTE:
La llave OPENAI_API_KEY se queda en el servidor local (server/openai-apu-server.mjs).
No la pegues dentro de src/main.jsx ni en archivos pÃºblicos.

PARA GOOGLE LOGIN:
1. En Firebase Authentication activa Google.
2. En Firebase Authentication activa Email/Password.
3. Pega la configuraciÃ³n web en src/firebase.js.
