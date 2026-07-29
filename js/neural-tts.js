/* ============================================================
   neural-tts.js
   Voz neuronal offline con Piper (VITS) vía vits-web:
     · Voces nativas en español (63–77 MB por voz, descarga única).
     · Los pesos se guardan en OPFS (Origin Private File System)
       y la síntesis corre 100 % en el dispositivo (WASM/CPU),
       sin cuentas, sin API keys y sin costo.
     · La voz del sistema (SpeechSynthesis) queda como respaldo:
       voice-engine.js cae a ella automáticamente si esto falla.
   ============================================================ */

/* Versión fijada (verificada) */
const VITS_URL = 'https://esm.run/@diffusionstudio/vits-web@1.0.3';

/* Voces Piper en español seleccionadas (existencia y tamaño verificados) */
export const NEURAL_VOICES = [
  { id: 'es_ES-davefx-medium', label: 'Dave — España, masculina', mb: 63 },
  { id: 'es_ES-sharvard-medium', label: 'Sharvard — España, femenina', mb: 77 },
  { id: 'es_MX-claude-high', label: 'Claude — México, femenina', mb: 63 }
];

export class NeuralTTS {
  constructor() {
    this._lib = null;
    this._audio = null;
  }

  async _vits() {
    if (!this._lib) this._lib = await import(VITS_URL);
    return this._lib;
  }

  /* IDs de voces ya descargadas (OPFS) */
  async stored() {
    try {
      const tts = await this._vits();
      return (await tts.stored()) || [];
    } catch (e) { return []; }
  }

  async isStored(voiceId) { return (await this.stored()).includes(voiceId); }

  /* Descarga una voz a OPFS con progreso 0..1 */
  async download(voiceId, onProgress) {
    const tts = await this._vits();
    await tts.download(voiceId, (p) => {
      if (onProgress && p && p.total) onProgress(p.loaded / p.total);
    });
  }

  async remove(voiceId) {
    try { const tts = await this._vits(); await tts.remove(voiceId); } catch (e) {}
  }

  /* Sintetiza y reproduce; resuelve al terminar el audio */
  async speak(text, voiceId) {
    const tts = await this._vits();
    const wav = await tts.predict({ text, voiceId });
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(wav);
      const audio = new Audio(url);
      this._audio = audio;
      const done = () => { URL.revokeObjectURL(url); if (this._audio === audio) this._audio = null; };
      audio.onended = () => { done(); resolve(); };
      audio.onerror = () => {
        done();
        if (audio._cancelled) resolve(); // detenido a propósito (Silenciar)
        else reject(new Error('No se pudo reproducir el audio'));
      };
      audio.play().catch((e) => { done(); reject(e); });
    });
  }

  /* Detiene la reproducción en curso sin disparar el respaldo */
  stop() {
    const a = this._audio;
    if (!a) return;
    a._cancelled = true;
    try { a.pause(); a.src = ''; } catch (e) {}
    this._audio = null;
  }
}

export default NeuralTTS;
