# every.mp3

Descargador multimedia con estética **Apple Glassmorphism** monocromática y acento `#FF3D6E`, micro-animaciones, efectos de sonido (SFX) sintetizados y sincronización en la nube con **Firebase Auth (Google) + Cloud Firestore**.

Soporta **YouTube, Spotify (canciones, álbumes y playlists), SoundCloud, TikTok, Instagram** y más de 1.000 sitios compatibles con `yt-dlp`.

## Estructura del proyecto

- `client/` — Frontend React + Vite + Tailwind CSS + Firebase Auth/Firestore (listo para **Netlify**).
- `server/` — Motor de descargas Node.js + Express + `yt-dlp` + `FFmpeg` + resolución de Spotify (incluye `Dockerfile` para **Hugging Face Spaces / Render / Railway**).
- `firestore.rules` — Reglas de seguridad de Cloud Firestore (acceso privado por usuario).

## Probar en local

1. Arranca el motor de descargas:
   ```bash
   npm run dev:server
   ```
2. En otra terminal, arranca la web:
   ```bash
   npm run dev:client
   ```
3. Abre `http://localhost:5173`.

## Configurar Firebase (Google Sign-In + Firestore)

1. Crea un proyecto gratis en [Firebase Console](https://console.firebase.google.com).
2. Activa **Authentication → Sign-in method → Google**.
3. Activa **Firestore Database** y pega las reglas de `firestore.rules`.
4. Copia `client/.env.example` a `client/.env` y rellena las variables `VITE_FIREBASE_*`.
5. Cuando publiques en Netlify, añade tu dominio `*.netlify.app` en **Authentication → Settings → Authorized domains**.

## Desplegar gratis en la nube

### 1. Backend (`server/`) en Hugging Face Spaces o Render
- **Hugging Face Spaces (Recomendado, gratis y rápido):** Crea un Space de tipo **Docker**, sube el contenido de `server/` y copia la URL pública del Space (`https://tu-usuario-every-mp3.hf.space`).
- **Render:** Crea un *Web Service* apuntando a la carpeta `server/` con entorno **Docker**.

### 2. Frontend (`client/`) en Netlify
- Conecta el repo en Netlify (detectará automáticamente `netlify.toml`).
- Añade en **Environment variables** de Netlify:
  - `VITE_API_URL` = URL de tu backend en la nube (sin barra final)
  - `VITE_FIREBASE_*` = tus claves de Firebase
