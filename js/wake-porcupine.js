/* ============================================================
   wake-porcupine.js
   Wake word neuronal con Porcupine (Picovoice) vía WebAssembly.
   Mucho más eficiente en batería que la escucha continua de
   Web Speech: procesa el audio localmente en un Web Worker.

   Requisitos (ver assets/porcupine/README.md):
     · AccessKey de Picovoice (gratis) — se guarda SOLO en el
       dispositivo (preferencias en IndexedDB), nunca en el repo.
     · Palabra clave en español entrenada para Web (WASM):
       assets/porcupine/asistente_es_wasm.ppn
   El SDK guarda el modelo y la keyword en IndexedDB, así que
   tras la primera carga funciona offline.
   ============================================================ */

/* Versiones fijadas (verificadas): el SDK 4.x usa los params v3.0 */
const PORCUPINE_URL = 'https://esm.run/@picovoice/porcupine-web@4.0.1';
const WVP_URL = 'https://esm.run/@picovoice/web-voice-processor@4.0.10';

/* Modelo base en español, fijado a la release v3.0 del repo oficial (~1 MB).
   raw.githubusercontent.com está en la lista de CDN del Service Worker,
   por lo que queda cacheado para uso offline. */
const MODEL_ES_URL = 'https://raw.githubusercontent.com/Picovoice/porcupine/v3.0/lib/common/porcupine_params_es.pv';

/* Keyword entrenada por el usuario en Picovoice Console (Español, Web/WASM) */
const KEYWORD_PATH = 'assets/porcupine/asistente_es_wasm.ppn';

export class PorcupineWake {
  constructor({ accessKey, keywordPath = KEYWORD_PATH, label = 'asistente', sensitivity = 0.6, onWake, onError } = {}) {
    this.accessKey = accessKey;
    this.keywordPath = keywordPath;
    this.label = label;
    this.sensitivity = sensitivity;
    this.onWake = onWake;
    this.onError = onError;
    this._worker = null;
    this._wvp = null;
    this.running = false;
    this.paused = false;
  }

  /* ¿Existe la keyword (.ppn) en el sitio desplegado? */
  static async keywordAvailable(path = KEYWORD_PATH) {
    try { const r = await fetch(path, { method: 'HEAD' }); return r.ok; }
    catch (e) { return false; }
  }

  /* Carga las librerías (CDN fijado), crea el worker y conecta el micrófono */
  async start() {
    const [{ PorcupineWorker }, { WebVoiceProcessor }] = await Promise.all([
      import(PORCUPINE_URL),
      import(WVP_URL)
    ]);
    this._worker = await PorcupineWorker.create(
      this.accessKey,
      [{ publicPath: this.keywordPath, label: this.label, sensitivity: this.sensitivity }],
      (detection) => { if (this.running && !this.paused && this.onWake) this.onWake(detection); },
      { publicPath: MODEL_ES_URL },
      { processErrorCallback: (e) => { if (this.onError) this.onError(e); } }
    );
    this._wvp = WebVoiceProcessor;
    await WebVoiceProcessor.subscribe(this._worker);
    this.running = true;
    this.paused = false;
  }

  /* Pausa/reanuda la escucha (p. ej. mientras el STT usa el micrófono) */
  async pause() {
    if (!this.running || this.paused || !this._wvp) return;
    this.paused = true;
    try { await this._wvp.unsubscribe(this._worker); } catch (e) {}
  }

  async resume() {
    if (!this.running || !this.paused || !this._wvp) return;
    this.paused = false;
    try { await this._wvp.subscribe(this._worker); } catch (e) {}
  }

  /* Libera micrófono, worker y WASM */
  async stop() {
    this.running = false;
    if (this._wvp && this._worker) { try { await this._wvp.unsubscribe(this._worker); } catch (e) {} }
    if (this._worker) {
      try { if (this._worker.release) await this._worker.release(); } catch (e) {}
      try { if (this._worker.terminate) this._worker.terminate(); } catch (e) {}
    }
    this._worker = null;
  }
}

export default PorcupineWake;
