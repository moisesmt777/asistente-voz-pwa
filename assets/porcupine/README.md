# Palabra de activación neuronal (Porcupine)

En esta carpeta va la palabra clave en español entrenada en
[Picovoice Console](https://console.picovoice.ai) (gratis):

1. Crea tu cuenta y copia tu **AccessKey**. Se pega en la app
   (Ajustes → 👂 Palabra de activación) y **solo se guarda en tu
   dispositivo** — nunca la subas a este repositorio.
2. En Console: **Porcupine** → idioma **Español** → escribe la frase
   (p. ej. `asistente`) → plataforma **Web (WASM)** → *Train/Download*.
3. Del zip descargado, copia el archivo `.ppn` a esta carpeta con el
   nombre exacto:

   `assets/porcupine/asistente_es_wasm.ppn`

El modelo base en español (`porcupine_params_es.pv`, ~1 MB) no hace falta
descargarlo: la app lo obtiene del repositorio oficial de Porcupine
(release v3.0, URL fijada) y el Service Worker lo cachea para uso offline.

Mientras falte la AccessKey o el `.ppn`, la app usa automáticamente la
escucha continua con Web Speech (el wake word de siempre).
