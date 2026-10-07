# Tu música en datos

Estadísticas de lo que más escuchas: artistas, canciones, álbumes, listas, horas y sugerencias.

Sitio: https://adrianezd.github.io/mi-musica/

- **Spotify conectado** (Web API con PKCE, sin servidor): top de artistas y canciones a 4 semanas, 6 meses y 1 año, últimas 50 escuchas, tus listas y crear una lista privada con tu top. Hace falta el Client ID de una app de Spotify con esta dirección en Redirect URIs; se pone en `CLIENT_ID_DEFECTO` de `script.js` o cada usuario en Ajustes. En modo desarrollo solo entran las cuentas añadidas en User Management.
- **Historial importado** (por día, mes y año): Spotify (`Streaming_History_Audio_*.json` o `StreamingHistory_music_*.json`) y Apple Music (`Apple Music - Play History Daily Tracks.csv` o `Apple Music Play Activity.csv`). Se guarda en IndexedDB.

Apple Music no tiene conexión directa porque su API pide un token de desarrollador de pago.
