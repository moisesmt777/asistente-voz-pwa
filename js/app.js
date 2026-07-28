/* ============================================================
   app.js — Orquestador principal
   Conecta: VoiceEngine (STT/TTS/VAD/wake) · AIBrain (LLM+memoria)
            · CommandRouter (skills) · UI (presentación).

   Flujo de una interacción:
     voz/texto → transcripción → router de skills (determinista)
       ├─ si es un comando → ejecuta, persiste en IndexedDB y responde
       └─ si no → cerebro conversacional (LLM local o reglas)
     → respuesta en pantalla + voz (TTS) → memoria + estadísticas (auto-mejora)
   ============================================================ */
import { VoiceEngine } from './voice-engine.js';
import { AIBrain, MemoryStore } from './ai-brain.js';
import { CommandRouter, cuando } from './commands.js';
import { UI } from './ui.js';

const $ = (s) => document.querySelector(s);

class App {
  constructor() {
    this.memory = new MemoryStore();
    this.ui = new UI(this.memory);
    this.voice = new VoiceEngine({ lang: 'es-ES' });
    this.brain = new AIBrain(this.memory);
    this.router = new CommandRouter(this.memory);
    this.msgCmd = {};   // id de mensaje -> comando (para feedback)
    this.busy = false;
  }

  async start() {
    // Preferencias iniciales
    await this.memory.open();
    if (!(await this.memory.getPref('name'))) await this.memory.setPref('name', 'Moises');

    // Aplicar ajustes guardados
    const savedStt = await this.memory.getPref('sttEngine', 'webspeech');
    const savedWake = await this.memory.getPref('wakeWord', 'asistente');
    const savedVoice = await this.memory.getPref('ttsVoice', null);
    this.voice.setSttEngine(savedStt);
    this.voice.setWakeWord(savedWake);
    this.voice.setWakeEngine(await this.memory.getPref('wakeEngine', 'auto'));
    this.voice.setPvAccessKey(await this.memory.getPref('pvAccessKey', null));

    const caps = await this.voice.init();
    if (savedVoice) this.voice.setVoice(savedVoice);
    const brainState = await this.brain.init();

    this.ui.setOnline(navigator.onLine);
    this.ui.setState('idle');
    this.ui.setBrandSub(brainState.webgpu ? 'IA local disponible' : 'Modo reglas (sin WebGPU)');

    // Reactivar el último modelo usado (ya descargado → carga rápida desde caché)
    const savedModel = await this.memory.getPref('model', null);
    if (brainState.webgpu && savedModel) {
      this.brain.loadModel(savedModel, (r) => {
        const pct = Math.round((r.progress || 0) * 100);
        this.ui.setBrandSub(`Cargando IA… ${pct}%`);
      }).then(() => this.ui.setBrandSub('IA local activa 🧠'))
        .catch(() => this.ui.setBrandSub('IA local disponible'));
    }

    this._wireVoice();
    this._wireUI();
    this._startAlarmLoop();
    this._handleLaunchAction();
    await this.ui.renderPanel('tareas');

    // Saludo inicial
    this.ui.sys('Asistente listo · offline-first. Toca 🎙️ o escribe.');
    if (!caps.webSpeechSTT && savedStt === 'webspeech') {
      this.ui.toast('🎙️', 'La voz nativa requiere HTTPS. En Ajustes puedes activar Whisper.', 5000);
    }
  }

  /* ============================================================
     Eventos del motor de voz
     ============================================================ */
  _wireVoice() {
    this.voice
      .on('start', () => this.ui.setState('listening'))
      .on('partial', (t) => this.ui.setLive(t))
      .on('final', (t) => this._onUserInput(t))
      .on('end', () => { if (document.body.dataset.state === 'listening') this.ui.setState('idle'); })
      .on('error', (e) => {
        this.ui.setState('error', e.message);
        this.ui.toast('🎙️', e.message);
        setTimeout(() => this.ui.setState('idle'), 1500);
      })
      .on('ttsstart', () => this.ui.setState('speaking'))
      .on('ttsend', () => this.ui.setState('idle'))
      .on('modelprogress', (p) => this.ui.setBrandSub(`Cargando Whisper… ${Math.round((p.progress || 0))}%`))
      .on('wake', () => { this.ui.toast('👂', '¡Te escucho!'); this.startListening(); })
      .on('wakeinfo', (m) => this.ui.toast('👂', m, 4500))
      .on('wakestate', (on) => { const b = $('#btnWake'); b && b.classList.toggle('on', on); });
  }

  /* ============================================================
     Entrada del usuario (voz o texto) → respuesta
     ============================================================ */
  async _onUserInput(text) {
    text = (text || '').trim();
    if (!text || this.busy) return;
    this.busy = true;
    this.voice.stopListening();
    this.ui.setLive('');
    this.ui.addUser(text);
    await this.memory.addMessage({ role: 'user', text });
    this.ui.setState('thinking');

    try {
      // 1) Skills deterministas
      const cmd = await this.router.handle(text);
      if (cmd.handled) {
        await this.memory.bumpCommand(cmd.cmd);
        if (cmd.utterance) await this.memory.recordExample(cmd.cmd, cmd.utterance);
        const msg = await this.memory.addMessage({ role: 'assistant', text: cmd.reply, cmd: cmd.cmd });
        this.msgCmd[msg.id] = cmd.cmd;
        this.ui.addBot(cmd.reply, { mode: 'skill', id: msg.id });

        if (cmd.action === 'open') { this.ui.openSheet('panel'); this.ui.renderPanel(cmd.tab); }
        else if (cmd.action === 'refresh') this.ui.renderPanel(cmd.tab);

        await this.voice.speak(cmd.reply);
      } else {
        // 2) Cerebro conversacional
        const res = await this.brain.chat(text);
        const msg = await this.memory.addMessage({ role: 'assistant', text: res.text, cmd: 'chat' });
        this.msgCmd[msg.id] = 'chat';
        this.ui.addBot(res.text, { mode: res.mode, id: msg.id });
        await this.voice.speak(res.text);
      }
    } catch (e) {
      console.error(e);
      this.ui.addBot('Tuve un problema procesando eso. ¿Lo intentas de nuevo?', { mode: 'rules' });
    } finally {
      this.ui.setState('idle');
      this.busy = false;
    }
  }

  startListening() {
    if (this.busy) return;
    this.voice.stopSpeaking();
    this.voice.startListening();
  }

  /* ============================================================
     Eventos de la interfaz
     ============================================================ */
  _wireUI() {
    $('#btnMic').addEventListener('click', () => this.startListening());
    $('#btnStop').addEventListener('click', () => { this.voice.stopSpeaking(); this.voice.stopListening(); this.ui.setState('idle'); });
    $('#btnSend').addEventListener('click', () => this._sendText());
    $('#textInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') this._sendText(); });

    $('#btnWake').addEventListener('click', () => {
      if (this.voice.isWakeWordOn()) this.voice.disableWakeWord();
      else { this.voice.enableWakeWord(); this.ui.toast('👂', 'Di "' + this.voice.opts.wakeWord + '" para activarme.'); }
    });

    $('#btnPanel').addEventListener('click', () => { this.ui.openSheet('panel'); this.ui.renderPanel(); });
    $('#btnSettings').addEventListener('click', () => { this._renderSettings(); this.ui.openSheet('settings'); });

    document.querySelectorAll('[data-close]').forEach((b) =>
      b.addEventListener('click', () => this.ui.closeSheet(b.dataset.close)));
    $('#panelOverlay').addEventListener('click', () => this.ui.closeSheet('panel'));
    $('#settingsOverlay').addEventListener('click', () => this.ui.closeSheet('settings'));

    document.querySelectorAll('#panelTabs .tab').forEach((b) =>
      b.addEventListener('click', () => this.ui.renderPanel(b.dataset.tab)));

    // Feedback de respuestas → auto-mejora
    this.ui.onFeedback = async (msgId, dir) => {
      const cmd = this.msgCmd[msgId] || 'chat';
      await this.memory.feedbackCommand(cmd, dir);
      this.ui.toast(dir > 0 ? '👍' : '👎', 'Feedback registrado. Me adapto a ti.');
    };

    window.addEventListener('online', () => this.ui.setOnline(true));
    window.addEventListener('offline', () => this.ui.setOnline(false));
  }

  _sendText() {
    const inp = $('#textInput');
    const v = inp.value.trim();
    if (!v) return;
    inp.value = '';
    this._onUserInput(v);
  }

  /* ============================================================
     Ajustes (render dinámico)
     ============================================================ */
  async _renderSettings() {
    const caps = VoiceEngine.capabilities();
    const webgpu = this.brain.webgpu;
    const models = await this.brain.availableModels();
    const prefs = await this.memory.allPrefs();
    const voices = this.voice.getVoices().filter((v) => /es/i.test(v.lang));
    const curModel = prefs.model || this.brain.opts.defaultModel;

    this.ui.el.settingsBody.innerHTML = `
      <label class="lbl">Tu nombre</label>
      <div class="inrow">
        <input class="field" id="setName" value="${(prefs.name || 'Moises')}">
        <button class="btn" id="saveName">Guardar</button>
      </div>

      <div class="card" style="margin-top:14px">
        <h3>🧠 Motor de IA (en el dispositivo)</h3>
        <div class="muted">WebGPU: <b style="color:${webgpu ? 'var(--ok)' : 'var(--danger)'}">${webgpu ? 'disponible' : 'no disponible'}</b>.
        ${webgpu ? 'Puedes descargar un modelo para respuestas más inteligentes (se guarda para uso offline).' : 'Sin WebGPU se usa el cerebro de reglas, igualmente funcional para tus comandos.'}</div>
        ${webgpu ? `
        <label class="lbl">Modelo</label>
        <select class="field" id="setModel">
          ${models.map((m) => `<option value="${m.id}" ${m.id === curModel ? 'selected' : ''}>${m.label} · ~${(m.mb / 1024).toFixed(1)} GB</option>`).join('')}
        </select>
        <button class="btn block" id="loadModel" style="margin-top:10px">⬇️ Descargar y activar modelo</button>
        <div class="progress" id="modelProg" style="display:none"><i></i></div>
        <div class="muted" id="modelMsg" style="margin-top:6px"></div>` : ''}
      </div>

      <div class="card">
        <h3>🎙️ Reconocimiento de voz (STT)</h3>
        <label class="lbl">Motor</label>
        <select class="field" id="setStt">
          <option value="webspeech" ${prefs.sttEngine !== 'whisper' ? 'selected' : ''}>Web Speech API (nativo, rápido)</option>
          <option value="whisper" ${prefs.sttEngine === 'whisper' ? 'selected' : ''}>Whisper (Transformers.js, más preciso)</option>
        </select>
        <div class="muted" style="margin-top:6px">Nativo disponible: <b style="color:${caps.webSpeechSTT ? 'var(--ok)' : 'var(--warn)'}">${caps.webSpeechSTT ? 'sí' : 'no'}</b></div>
      </div>

      <div class="card">
        <h3>🔊 Voz del asistente (TTS)</h3>
        <label class="lbl">Voz</label>
        <select class="field" id="setVoice">
          ${voices.length ? voices.map((v) => `<option value="${v.voiceURI}" ${prefs.ttsVoice === v.voiceURI ? 'selected' : ''}>${v.name} (${v.lang})</option>`).join('') : '<option>Voces del sistema</option>'}
        </select>
        <button class="btn ghost block" id="testVoice" style="margin-top:10px">▶ Probar voz</button>
      </div>

      <div class="card">
        <h3>👂 Palabra de activación</h3>
        <div class="inrow">
          <input class="field" id="setWake" value="${(prefs.wakeWord || 'asistente')}">
          <button class="btn" id="saveWake">Guardar</button>
        </div>
        <label class="lbl">Motor</label>
        <select class="field" id="setWakeEngine">
          <option value="auto" ${(prefs.wakeEngine || 'auto') === 'auto' ? 'selected' : ''}>Auto — Porcupine si está configurado</option>
          <option value="porcupine" ${prefs.wakeEngine === 'porcupine' ? 'selected' : ''}>Porcupine (neuronal, ahorra batería)</option>
          <option value="webspeech" ${prefs.wakeEngine === 'webspeech' ? 'selected' : ''}>Escucha continua (Web Speech)</option>
        </select>
        <label class="lbl">AccessKey de Picovoice</label>
        <div class="inrow">
          <input class="field" id="setPvKey" type="password" autocomplete="off" placeholder="${prefs.pvAccessKey ? '••••••••  (guardada)' : 'Pega aquí tu AccessKey (gratis)'}">
          <button class="btn" id="savePvKey">Guardar</button>
        </div>
        <div class="muted" id="pvStatus" style="margin-top:6px">Comprobando Porcupine…</div>
      </div>

      <div class="card">
        <h3>🔔 Notificaciones</h3>
        <div class="muted">Estado: <b>${('Notification' in window) ? Notification.permission : 'no soportado'}</b></div>
        <button class="btn ghost block" id="askNotif" style="margin-top:10px">Permitir notificaciones</button>
      </div>

      <div class="card">
        <h3>💾 Datos</h3>
        <div class="muted">Todo se guarda en tu dispositivo (IndexedDB). Nada sale de tu teléfono.</div>
        <button class="btn ghost block" id="clearData" style="margin-top:10px;color:var(--danger)">🗑️ Borrar todos los datos</button>
      </div>
      <div class="muted" style="text-align:center;padding:6px">Asistente de Voz · PWA offline-first · v1.2.0</div>
    `;
    this._wireSettings();
  }

  _wireSettings() {
    const body = this.ui.el.settingsBody;
    const g = (id) => body.querySelector('#' + id);

    g('saveName').addEventListener('click', async () => {
      await this.memory.setPref('name', g('setName').value.trim() || 'Moises');
      this.ui.toast('✅', 'Nombre guardado');
    });

    const stt = g('setStt');
    stt && stt.addEventListener('change', async () => {
      await this.memory.setPref('sttEngine', stt.value);
      this.voice.setSttEngine(stt.value);
      this.ui.toast('🎙️', 'Motor STT: ' + stt.value);
    });

    const vsel = g('setVoice');
    vsel && vsel.addEventListener('change', async () => {
      this.voice.setVoice(vsel.value);
      await this.memory.setPref('ttsVoice', vsel.value);
    });
    const test = g('testVoice');
    test && test.addEventListener('click', () => this.voice.speak('Hola, soy tu asistente. Te escucho.'));

    g('saveWake').addEventListener('click', async () => {
      const w = g('setWake').value.trim() || 'asistente';
      await this.memory.setPref('wakeWord', w);
      this.voice.setWakeWord(w);
      this.ui.toast('👂', 'Palabra de activación: ' + w);
    });

    const eng = g('setWakeEngine');
    eng && eng.addEventListener('change', async () => {
      await this.memory.setPref('wakeEngine', eng.value);
      this.voice.setWakeEngine(eng.value);
      if (this.voice.isWakeWordOn()) { this.voice.disableWakeWord(); this.voice.enableWakeWord(); }
      this.ui.toast('👂', 'Motor de wake word: ' + eng.options[eng.selectedIndex].text);
    });

    const pvBtn = g('savePvKey');
    pvBtn && pvBtn.addEventListener('click', async () => {
      const k = g('setPvKey').value.trim();
      if (!k) { this.ui.toast('👂', 'Pega tu AccessKey de Picovoice primero'); return; }
      await this.memory.setPref('pvAccessKey', k);
      this.voice.setPvAccessKey(k);
      g('setPvKey').value = '';
      g('setPvKey').placeholder = '••••••••  (guardada)';
      this._updatePvStatus();
      this.ui.toast('✅', 'AccessKey guardada (solo en este dispositivo)');
    });
    this._updatePvStatus();

    g('askNotif').addEventListener('click', () => {
      if ('Notification' in window) Notification.requestPermission().then((p) => this.ui.toast('🔔', 'Notificaciones: ' + p));
    });

    g('clearData').addEventListener('click', async () => {
      if (confirm('¿Borrar TODO (notas, tareas, eventos, alarmas, historial)? No se puede deshacer.')) {
        await this.memory.clearAll();
        await this.memory.setPref('name', g('setName').value.trim() || 'Moises');
        this.ui.renderPanel();
        this.ui.toast('🗑️', 'Datos borrados');
      }
    });

    const load = g('loadModel');
    load && load.addEventListener('click', async () => {
      const id = g('setModel').value;
      const prog = g('modelProg'); const bar = prog.querySelector('i'); const msg = g('modelMsg');
      prog.style.display = 'block'; load.disabled = true; load.textContent = 'Descargando…';
      try {
        await this.brain.loadModel(id, (r) => {
          const pct = Math.round((r.progress || 0) * 100);
          bar.style.width = pct + '%';
          msg.textContent = r.text || `Cargando… ${pct}%`;
        });
        msg.textContent = '✅ Modelo activo: ' + id;
        this.ui.setBrandSub('IA local activa 🧠');
        this.ui.toast('🧠', 'Modelo de IA activado');
      } catch (e) {
        msg.textContent = '⚠️ ' + e.message;
        this.ui.toast('⚠️', 'No se pudo cargar el modelo');
      } finally {
        load.disabled = false; load.textContent = '⬇️ Descargar y activar modelo';
      }
    });
  }

  /* Estado de Porcupine en Ajustes: indica qué falta para el modo neuronal */
  async _updatePvStatus() {
    const el = this.ui.el.settingsBody.querySelector('#pvStatus');
    if (!el) return;
    const key = await this.memory.getPref('pvAccessKey', null);
    let ppn = false;
    try {
      const { PorcupineWake } = await import('./wake-porcupine.js');
      ppn = await PorcupineWake.keywordAvailable();
    } catch (e) {}
    if (key && ppn) el.innerHTML = '✅ Porcupine listo: activa el wake word y di <b>«asistente»</b>.';
    else if (!key && !ppn) el.textContent = 'Sin configurar: se usa la escucha continua (mejor con pantalla encendida). Para el modo eficiente faltan la AccessKey y el archivo .ppn (ver assets/porcupine/README.md).';
    else if (!key) el.textContent = 'El archivo .ppn ya está ✓. Falta pegar tu AccessKey de Picovoice (console.picovoice.ai, gratis).';
    else el.textContent = 'AccessKey guardada ✓. Falta el archivo assets/porcupine/asistente_es_wasm.ppn (se entrena gratis en Picovoice Console; ver README de esa carpeta).';
  }

  /* ============================================================
     Alarmas: chequeo + notificación (mientras la app está abierta)
     ============================================================ */
  _startAlarmLoop() {
    const check = async () => {
      const now = Date.now();
      const alarmas = await this.memory.listItems('alarma');
      for (const a of alarmas) {
        if (a.activa && !a.sonada && a.ts <= now) {
          a.sonada = true; a.activa = false;
          await this.memory.putItem(a);
          this._fireAlarm(a);
        }
      }
    };
    check();
    setInterval(check, 15000);
  }

  _fireAlarm(a) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('⏰ ' + a.texto, { body: cuando(a.ts), icon: 'assets/icons/icon-192.png' }); } catch (e) {}
    }
    this.ui.toast('⏰', `<b>${a.texto}</b>`, 6000);
    this.ui.addBot(`⏰ Recordatorio: ${a.texto}`, { mode: 'skill' });
    this.voice.speak('Recordatorio: ' + a.texto);
    this._beep();
  }

  _beep() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const ac = new AC();
      [0, 0.25, 0.5].forEach((t) => {
        const o = ac.createOscillator(), gn = ac.createGain();
        o.type = 'sine'; o.frequency.value = 880; o.connect(gn); gn.connect(ac.destination);
        gn.gain.setValueAtTime(0.001, ac.currentTime + t);
        gn.gain.exponentialRampToValueAtTime(0.35, ac.currentTime + t + 0.02);
        gn.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.18);
        o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.2);
      });
    } catch (e) {}
  }

  /* Accesos directos del manifest (?action=) */
  _handleLaunchAction() {
    const action = new URLSearchParams(location.search).get('action');
    if (action === 'listen') setTimeout(() => this.startListening(), 400);
    else if (action === 'nota') { this.ui.openSheet('panel'); this.ui.renderPanel('notas'); }
    else if (action === 'tarea') { this.ui.openSheet('panel'); this.ui.renderPanel('tareas'); }
  }
}

/* Arranque */
const app = new App();
window.__app = app; // útil para depurar
app.start().catch((e) => console.error('[App] Error al iniciar:', e));
