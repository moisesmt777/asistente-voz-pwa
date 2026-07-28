/* ============================================================
   voice-engine.js
   Motor de voz del asistente:
     · STT  (Speech-to-Text): Web Speech API nativa (capa offline por defecto)
              + adaptador Whisper vía Transformers.js (WASM/ONNX) opcional.
     · TTS  (Text-to-Speech): SpeechSynthesis con voz local en español.
     · VAD  (Voice Activity Detection): energía RMS con Web Audio API.
     · Wake Word: escucha continua de bajo costo buscando la palabra de activación.

   API basada en eventos:
     const ve = new VoiceEngine({ lang:'es-ES' });
     ve.on('partial', t => ...).on('final', t => ...).on('wake', () => ...);
     await ve.init(); ve.startListening(); await ve.speak('Hola');
   ============================================================ */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;

export class VoiceEngine {
  constructor(opts = {}) {
    this.opts = Object.assign({
      lang: 'es-ES',
      sttEngine: 'webspeech',              // 'webspeech' | 'whisper'
      whisperModel: 'Xenova/whisper-tiny', // modelo ligero por defecto
      wakeWord: 'asistente',
      wakeEngine: 'auto',                  // 'auto' | 'porcupine' | 'webspeech'
      pvAccessKey: null,                   // AccessKey de Picovoice (solo vive en el dispositivo)
      rate: 1.03,
      pitch: 1.0,
      vadSilenceMs: 900,                   // silencio para autocorte
      vadThreshold: 0.035,                 // umbral de energía de voz
      maxUtteranceMs: 9000
    }, opts);

    this.handlers = {};
    this.listening = false;
    this.speaking = false;
    this._wakeOn = false;
    this._voice = null;
    this._asr = null;          // pipeline Whisper (perezoso)
    this._recognition = null;  // instancia Web Speech (por sesión)
    this._wake = null;         // instancia Web Speech para wake word
    this._porc = null;         // instancia Porcupine (wake word neuronal)
    this.wakeMode = null;      // 'porcupine' | 'webspeech' | null
  }

  /* -------- Event emitter mínimo -------- */
  on(evt, fn) { this.handlers[evt] = fn; return this; }
  emit(evt, ...args) { try { this.handlers[evt] && this.handlers[evt](...args); } catch (e) { console.error(e); } }

  /* -------- Capacidades del dispositivo -------- */
  static capabilities() {
    return {
      webSpeechSTT: !!SR,
      speechSynthesis: 'speechSynthesis' in window,
      mediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      webAudio: !!(window.AudioContext || window.webkitAudioContext)
    };
  }

  async init() {
    // Precargar voces de TTS (pueden llegar de forma asíncrona)
    if ('speechSynthesis' in window) {
      await this._loadVoices();
    }
    return VoiceEngine.capabilities();
  }

  /* ============================================================
     STT — Reconocimiento de voz
     ============================================================ */
  async startListening() {
    if (this.listening) return;
    if (this._porc) this._porc.pause(); // liberar el micrófono para el STT
    this.listening = true;
    if (this.opts.sttEngine === 'whisper') {
      return this._listenWhisper();
    }
    return this._listenWebSpeech();
  }

  stopListening() {
    this.listening = false;
    if (this._recognition) { try { this._recognition.stop(); } catch (e) {} }
    this._stopVad();
  }

  /* ---- Capa 1: Web Speech API (nativa, offline en Android) ---- */
  _listenWebSpeech() {
    if (!SR) {
      this.listening = false;
      this.emit('error', { type: 'no-stt', message: 'Reconocimiento de voz no disponible (requiere HTTPS y navegador compatible).' });
      return;
    }
    const rec = new SR();
    this._recognition = rec;
    rec.lang = this.opts.lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => this.emit('start');
    rec.onresult = (e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) this.emit('partial', interim.trim());
      if (final) { this.emit('final', final.trim()); }
    };
    rec.onerror = (e) => {
      this.listening = false;
      this.emit('error', { type: e.error, message: this._sttErrorMsg(e.error) });
      this._porcMaybeResume();
    };
    rec.onend = () => { this.listening = false; this.emit('end'); this._porcMaybeResume(); };

    try { rec.start(); }
    catch (e) { this.listening = false; this.emit('error', { type: 'start-failed', message: String(e) }); }
  }

  _sttErrorMsg(code) {
    switch (code) {
      case 'not-allowed':
      case 'service-not-allowed': return 'Permiso de micrófono denegado.';
      case 'no-speech': return 'No se detectó voz.';
      case 'audio-capture': return 'No se encontró micrófono.';
      case 'network': return 'Error de red en el reconocimiento.';
      default: return 'Error de reconocimiento: ' + code;
    }
  }

  /* ---- Capa 2: Whisper vía Transformers.js (WASM/ONNX) ---- */
  async _ensureWhisper(onProgress) {
    if (this._asr) return this._asr;
    const mod = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
    const { pipeline, env } = mod;
    // Usar caché del navegador para los pesos del modelo (offline tras 1ª descarga)
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    this._asr = await pipeline('automatic-speech-recognition', this.opts.whisperModel, {
      quantized: true,
      progress_callback: (p) => { if (onProgress && p.status === 'progress') onProgress(p); }
    });
    return this._asr;
  }

  async _listenWhisper() {
    const caps = VoiceEngine.capabilities();
    if (!caps.mediaDevices) {
      this.listening = false;
      this.emit('error', { type: 'no-mic', message: 'Micrófono no disponible.' });
      return;
    }
    this.emit('start');
    let blob;
    try {
      blob = await this._recordUtterance();
    } catch (e) {
      this.listening = false;
      this.emit('error', { type: 'record', message: 'No se pudo grabar audio: ' + e.message });
      this._porcMaybeResume();
      return;
    }
    this.emit('end');
    this.emit('partial', '…transcribiendo…');
    try {
      const asr = await this._ensureWhisper((p) => this.emit('modelprogress', p));
      const pcm = await this._blobToPCM16k(blob);
      const out = await asr(pcm, { language: 'spanish', task: 'transcribe', chunk_length_s: 15 });
      const text = (out && out.text ? out.text : '').trim();
      this.listening = false;
      if (text) this.emit('final', text);
      else this.emit('error', { type: 'empty', message: 'No se entendió el audio.' });
      this._porcMaybeResume();
    } catch (e) {
      this.listening = false;
      this.emit('error', { type: 'whisper', message: 'Fallo en Whisper: ' + e.message });
      this._porcMaybeResume();
    }
  }

  /* Graba una locución y la corta automáticamente por silencio (VAD) */
  async _recordUtterance() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { rec.onstop = res; });
    rec.start();
    // Autocorte por VAD o por tiempo máximo
    this._startVad(stream, () => { if (rec.state !== 'inactive') rec.stop(); }, this.opts.maxUtteranceMs);
    await stopped;
    this._stopVad();
    stream.getTracks().forEach((t) => t.stop());
    return new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
  }

  /* Decodifica el audio a PCM mono 16 kHz (Float32) para Whisper */
  async _blobToPCM16k(blob) {
    const arrBuf = await blob.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    // El contexto a 16 kHz fuerza el remuestreo al decodificar
    const ctx = new AC({ sampleRate: 16000 });
    const audio = await ctx.decodeAudioData(arrBuf);
    let data = audio.getChannelData(0);
    if (audio.numberOfChannels > 1) {
      // Mezcla a mono promediando canales
      const ch2 = audio.getChannelData(1);
      const mono = new Float32Array(data.length);
      for (let i = 0; i < data.length; i++) mono[i] = (data[i] + ch2[i]) / 2;
      data = mono;
    }
    ctx.close();
    return data;
  }

  /* ============================================================
     VAD — Detección de actividad de voz (energía RMS)
     ============================================================ */
  _startVad(stream, onSilence, maxMs) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this._vadCtx = new AC();
    const src = this._vadCtx.createMediaStreamSource(stream);
    const analyser = this._vadCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const t0 = performance.now();
    let sawSpeech = false, silenceStart = null;

    const loop = () => {
      if (!this._vadCtx) return;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; sum += x * x; }
      const rms = Math.sqrt(sum / buf.length);
      this.emit('vad', rms);
      const now = performance.now();
      if (rms > this.opts.vadThreshold) { sawSpeech = true; silenceStart = null; }
      else if (sawSpeech) {
        if (!silenceStart) silenceStart = now;
        else if (now - silenceStart > this.opts.vadSilenceMs) { onSilence(); return; }
      }
      if (now - t0 > maxMs) { onSilence(); return; }
      this._vadRaf = requestAnimationFrame(loop);
    };
    this._vadRaf = requestAnimationFrame(loop);
  }

  _stopVad() {
    if (this._vadRaf) cancelAnimationFrame(this._vadRaf);
    this._vadRaf = null;
    if (this._vadCtx) { try { this._vadCtx.close(); } catch (e) {} this._vadCtx = null; }
  }

  /* ============================================================
     Wake Word — palabra de activación
       · Porcupine (neuronal, WASM): eficiente en batería. Requiere
         AccessKey de Picovoice y assets/porcupine/asistente_es_wasm.ppn.
       · Web Speech continuo (respaldo): consume batería moderada;
         mejor con la pantalla encendida.
     ============================================================ */
  enableWakeWord() {
    if (this._wakeOn) return true;
    this._wakeOn = true;
    const eng = this.opts.wakeEngine || 'auto';
    if ((eng === 'porcupine' || eng === 'auto') && this.opts.pvAccessKey) {
      this._startPorcupine(); // asíncrono: emite 'wakestate' cuando está listo
      return true;
    }
    return this._enableWakeWebSpeech();
  }

  /* Porcupine con retroceso automático a Web Speech si algo falta o falla */
  async _startPorcupine() {
    try {
      const { PorcupineWake } = await import('./wake-porcupine.js');
      if (!(await PorcupineWake.keywordAvailable()))
        throw new Error('falta assets/porcupine/asistente_es_wasm.ppn');
      const porc = new PorcupineWake({
        accessKey: this.opts.pvAccessKey,
        label: this.opts.wakeWord,
        onWake: () => { if (this._wakeOn) { porc.pause(); this.emit('wake'); } },
        onError: (e) => { if (this._wakeOn && this.wakeMode === 'porcupine') this._porcFallback(e); }
      });
      await porc.start();
      if (!this._wakeOn) { porc.stop(); return; } // lo desactivaron durante la carga
      this._porc = porc;
      this.wakeMode = 'porcupine';
      this.emit('wakestate', true);
    } catch (e) {
      this._porcFallback(e);
    }
  }

  _porcFallback(e) {
    if (this._porc) { const p = this._porc; this._porc = null; p.stop(); }
    if (!this._wakeOn) return;
    if ((this.opts.wakeEngine || 'auto') === 'auto' && SR) {
      this.emit('wakeinfo', 'Porcupine no disponible (' + (e && e.message ? e.message : e) + '). Uso escucha continua.');
      this._enableWakeWebSpeech();
    } else {
      this._wakeOn = false;
      this.wakeMode = null;
      this.emit('wakestate', false);
      this.emit('error', { type: 'porcupine', message: 'Wake word Porcupine falló: ' + (e && e.message ? e.message : e) });
    }
  }

  /* Respaldo: escucha continua con Web Speech */
  _enableWakeWebSpeech() {
    if (!SR) {
      this._wakeOn = false;
      this.emit('error', { type: 'no-stt', message: 'Wake word requiere Web Speech API.' });
      return false;
    }
    const w = new SR();
    this._wake = w;
    w.lang = this.opts.lang;
    w.continuous = true;
    w.interimResults = true;
    w.onresult = (e) => {
      const txt = Array.from(e.results).map((r) => r[0].transcript).join(' ').toLowerCase();
      if (txt.includes(this.opts.wakeWord.toLowerCase())) {
        try { w.stop(); } catch (err) {}
        this.emit('wake');
      }
    };
    w.onerror = (e) => {
      // 'no-speech'/'aborted' son normales en escucha continua: se reinicia solo
      if (this._wakeOn && e.error !== 'not-allowed') this._restartWake();
    };
    w.onend = () => { if (this._wakeOn) this._restartWake(); };
    this.wakeMode = 'webspeech';
    try { w.start(); this.emit('wakestate', true); } catch (e) {}
    return true;
  }

  _restartWake() {
    if (!this._wakeOn || !this._wake) return;
    // Pequeño retardo evita bucles de reinicio inmediato
    clearTimeout(this._wakeTimer);
    this._wakeTimer = setTimeout(() => { try { this._wake.start(); } catch (e) {} }, 350);
  }

  disableWakeWord() {
    this._wakeOn = false;
    clearTimeout(this._wakeTimer);
    if (this._wake) { try { this._wake.stop(); } catch (e) {} }
    if (this._porc) { const p = this._porc; this._porc = null; p.stop(); }
    this.wakeMode = null;
    this.emit('wakestate', false);
  }

  isWakeWordOn() { return this._wakeOn; }

  /* ============================================================
     TTS — Síntesis de voz
     ============================================================ */
  _loadVoices() {
    return new Promise((resolve) => {
      const pick = () => {
        const voices = speechSynthesis.getVoices();
        if (voices && voices.length) {
          this._voices = voices;
          this._voice = this._chooseSpanishVoice(voices);
          resolve(voices);
          return true;
        }
        return false;
      };
      if (pick()) return;
      speechSynthesis.onvoiceschanged = () => { pick(); };
      // Respaldo por si el evento no dispara
      setTimeout(() => { pick(); resolve(this._voices || []); }, 1200);
    });
  }

  _chooseSpanishVoice(voices) {
    // Prioriza voces locales en español
    const es = voices.filter((v) => /es(-|_)?/i.test(v.lang));
    const local = es.filter((v) => v.localService);
    return local[0] || es[0] || voices[0] || null;
  }

  getVoices() { return this._voices || (('speechSynthesis' in window) ? speechSynthesis.getVoices() : []); }
  setVoice(uri) {
    const v = this.getVoices().find((x) => x.voiceURI === uri);
    if (v) this._voice = v;
  }

  speak(text) {
    if (!('speechSynthesis' in window) || !text) return Promise.resolve();
    this.stopSpeaking();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = this.opts.lang;
      u.rate = this.opts.rate;
      u.pitch = this.opts.pitch;
      if (this._voice) u.voice = this._voice;
      u.onstart = () => { this.speaking = true; if (this._porc) this._porc.pause(); this.emit('ttsstart'); };
      u.onend = () => { this.speaking = false; this.emit('ttsend'); this._porcMaybeResume(); resolve(); };
      u.onerror = () => { this.speaking = false; this.emit('ttsend'); this._porcMaybeResume(); resolve(); };
      speechSynthesis.speak(u);
    });
  }

  stopSpeaking() {
    if ('speechSynthesis' in window && (speechSynthesis.speaking || speechSynthesis.pending)) {
      speechSynthesis.cancel();
    }
    this.speaking = false;
  }

  /* Reanuda Porcupine solo cuando el asistente vuelve a estar ocioso */
  _porcMaybeResume() {
    if (this._porc && this._wakeOn && !this.listening && !this.speaking) this._porc.resume();
  }

  /* -------- Configuración en caliente -------- */
  setSttEngine(name) { this.opts.sttEngine = name; }
  setWakeWord(word) { this.opts.wakeWord = (word || 'asistente').toLowerCase(); }
  setWakeEngine(name) { this.opts.wakeEngine = name || 'auto'; }
  setPvAccessKey(key) { this.opts.pvAccessKey = (key || '').trim() || null; }
  setLang(lang) { this.opts.lang = lang; }
}

export default VoiceEngine;
