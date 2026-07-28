/* ============================================================
   ai-brain.js
   Cerebro del asistente:
     · MemoryStore  -> memoria persistente en IndexedDB (notas, tareas,
                       eventos, alarmas, historial, preferencias, estadísticas,
                       feedback).
     · AIBrain      -> LLM en el dispositivo con WebLLM (WebGPU). Si no hay
                       WebGPU o el usuario no descarga modelo, usa un cerebro
                       de reglas de respaldo. Incluye prompting adaptativo
                       (few-shot dinámico según frecuencia de uso y feedback).
   ============================================================ */

/* ============================================================
   1) MEMORIA PERSISTENTE (IndexedDB)
   ============================================================ */
const DB_NAME = 'asistente-db';
const DB_VERSION = 1;

export class MemoryStore {
  constructor() { this.db = null; }

  open() {
    if (this._openPromise) return this._openPromise;
    this._openPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('items')) {
          const s = db.createObjectStore('items', { keyPath: 'id' });
          s.createIndex('type', 'type', { unique: false });
          s.createIndex('ts', 'ts', { unique: false });
        }
        if (!db.objectStoreNames.contains('messages')) {
          const m = db.createObjectStore('messages', { keyPath: 'id' });
          m.createIndex('ts', 'ts', { unique: false });
        }
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv', { keyPath: 'k' });
        }
        if (!db.objectStoreNames.contains('stats')) {
          db.createObjectStore('stats', { keyPath: 'cmd' });
        }
      };
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
    return this._openPromise;
  }

  async _tx(store, mode = 'readonly') {
    const db = await this.open();
    return db.transaction(store, mode).objectStore(store);
  }
  _wrap(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /* ---- Ítems (notas/tareas/eventos/alarmas) ---- */
  async putItem(item) {
    if (!item.id) item.id = MemoryStore.uid();
    if (!item.ts) item.ts = Date.now();
    const store = await this._tx('items', 'readwrite');
    await this._wrap(store.put(item));
    return item;
  }
  async getItem(id) { return this._wrap((await this._tx('items')).get(id)); }
  async deleteItem(id) { return this._wrap((await this._tx('items', 'readwrite')).delete(id)); }
  async listItems(type) {
    const store = await this._tx('items');
    const idx = store.index('type');
    const all = await this._wrap(idx.getAll(type));
    return (all || []).sort((a, b) => b.ts - a.ts);
  }

  /* ---- Mensajes (historial de conversación) ---- */
  async addMessage(msg) {
    msg.id = msg.id || MemoryStore.uid();
    msg.ts = msg.ts || Date.now();
    const store = await this._tx('messages', 'readwrite');
    await this._wrap(store.put(msg));
    return msg;
  }
  async updateMessage(msg) {
    const store = await this._tx('messages', 'readwrite');
    return this._wrap(store.put(msg));
  }
  async recentMessages(limit = 12) {
    const store = await this._tx('messages');
    const all = await this._wrap(store.getAll());
    return (all || []).sort((a, b) => a.ts - b.ts).slice(-limit);
  }

  /* ---- Preferencias (key-value) ---- */
  async setPref(k, v) {
    const store = await this._tx('kv', 'readwrite');
    return this._wrap(store.put({ k, v }));
  }
  async getPref(k, def = null) {
    const r = await this._wrap((await this._tx('kv')).get(k));
    return r ? r.v : def;
  }
  async allPrefs() {
    const all = await this._wrap((await this._tx('kv')).getAll());
    const o = {};
    (all || []).forEach((r) => { o[r.k] = r.v; });
    return o;
  }

  /* ---- Estadísticas de comandos (auto-mejora) ---- */
  async bumpCommand(cmd) {
    const store = await this._tx('stats', 'readwrite');
    const cur = await this._wrap(store.get(cmd));
    const rec = cur || { cmd, count: 0, up: 0, down: 0, examples: [] };
    rec.count++;
    await this._wrap(store.put(rec));
    return rec;
  }
  async recordExample(cmd, utterance) {
    const store = await this._tx('stats', 'readwrite');
    const cur = await this._wrap(store.get(cmd));
    const rec = cur || { cmd, count: 0, up: 0, down: 0, examples: [] };
    if (utterance && !rec.examples.includes(utterance)) {
      rec.examples.unshift(utterance);
      rec.examples = rec.examples.slice(0, 3);
      await this._wrap(store.put(rec));
    }
  }
  async feedbackCommand(cmd, dir) {
    const store = await this._tx('stats', 'readwrite');
    const cur = await this._wrap(store.get(cmd));
    const rec = cur || { cmd, count: 0, up: 0, down: 0, examples: [] };
    if (dir > 0) rec.up++; else rec.down++;
    await this._wrap(store.put(rec));
    return rec;
  }
  async topCommands(n = 5) {
    const all = await this._wrap((await this._tx('stats')).getAll());
    return (all || []).sort((a, b) => b.count - a.count).slice(0, n);
  }

  async clearAll() {
    const db = await this.open();
    await Promise.all(['items', 'messages', 'kv', 'stats'].map((s) =>
      this._wrap(db.transaction(s, 'readwrite').objectStore(s).clear())
    ));
  }

  static uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
}

/* ============================================================
   2) CEREBRO DE IA (WebLLM + fallback de reglas)
   ============================================================ */
/* Versión fijada: los IDs de RECOMMENDED_MODELS están verificados contra el
   prebuiltAppConfig de esta versión (evita que 'latest' los rompa un día). */
const WEBLLM_URL = 'https://esm.run/@mlc-ai/web-llm@0.2.84';

/* Modelos pequeños recomendados para móviles (orden por VRAM requerida,
   según el prebuiltAppConfig de WebLLM 0.2.84) */
export const RECOMMENDED_MODELS = [
  { id: 'gemma3-1b-it-q4f16_1-MLC', label: 'Gemma 3 1B (equipos modestos)', mb: 711 },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B (equilibrado)', mb: 879 },
  { id: 'Qwen3-0.6B-q4f16_1-MLC', label: 'Qwen3 0.6B (compacto)', mb: 1403 },
  { id: 'Qwen3-1.7B-q4f16_1-MLC', label: 'Qwen3 1.7B (recomendado ★)', mb: 2037 },
  { id: 'Qwen3.5-2B-q4f16_1-MLC', label: 'Qwen3.5 2B (última generación)', mb: 2245 },
  { id: 'Phi-4-mini-instruct-q4f16_1-MLC', label: 'Phi-4 mini 3.8B (gama alta)', mb: 3438 }
];

export class AIBrain {
  constructor(memory, opts = {}) {
    this.memory = memory;
    this.opts = Object.assign({
      defaultModel: 'Qwen3-1.7B-q4f16_1-MLC',  // mejor equilibrio español/tamaño (Fase 1)
      temperature: 0.6,
      maxTokens: 256                            // respuestas breves, aptas para voz
    }, opts);
    this.engine = null;
    this.modelId = null;
    this.mode = 'rules';          // 'llm' | 'rules'
    this.loading = false;
  }

  /* Detección de WebGPU */
  static async hasWebGPU() {
    if (!('gpu' in navigator)) return false;
    try { const a = await navigator.gpu.requestAdapter(); return !!a; }
    catch (e) { return false; }
  }

  async init() {
    this.webgpu = await AIBrain.hasWebGPU();
    return { webgpu: this.webgpu, mode: this.mode };
  }

  /* Lista de modelos disponibles (desde WebLLM) filtrada a los recomendados */
  async availableModels() {
    try {
      const { prebuiltAppConfig } = await import(WEBLLM_URL);
      const ids = new Set(prebuiltAppConfig.model_list.map((m) => m.model_id));
      return RECOMMENDED_MODELS.filter((m) => ids.has(m.id));
    } catch (e) {
      return RECOMMENDED_MODELS; // fallback offline: mostramos los recomendados
    }
  }

  /* Carga (descarga + compila) el modelo en el dispositivo */
  async loadModel(modelId, onProgress) {
    if (this.loading) throw new Error('Ya hay una carga de modelo en curso.');
    if (!(await AIBrain.hasWebGPU())) {
      throw new Error('WebGPU no está disponible en este dispositivo/navegador.');
    }
    this.loading = true;
    try {
      const { CreateMLCEngine, prebuiltAppConfig } = await import(WEBLLM_URL);
      const id = modelId || this.opts.defaultModel;
      this.engine = await CreateMLCEngine(id, {
        appConfig: prebuiltAppConfig,
        initProgressCallback: (r) => { if (onProgress) onProgress(r); }
      });
      this.modelId = id;
      this.mode = 'llm';
      await this.memory.setPref('model', id);
      return id;
    } finally {
      this.loading = false;
    }
  }

  async unload() {
    if (this.engine && this.engine.unload) { try { await this.engine.unload(); } catch (e) {} }
    this.engine = null; this.modelId = null; this.mode = 'rules';
  }

  /* ============================================================
     PROMPTING ADAPTATIVO
     Construye el system prompt combinando:
       · preferencias del usuario (nombre, tono),
       · resumen de su contexto (tareas/eventos),
       · few-shot dinámico con sus comandos más usados,
       · señales de feedback (si hubo respuestas mal valoradas, pide precisión).
     ============================================================ */
  async buildSystemPrompt() {
    const prefs = await this.memory.allPrefs();
    const name = prefs.name || 'Moises';
    const tono = prefs.tono || 'amable y directo';
    const pend = (await this.memory.listItems('tarea')).filter((t) => !t.done);
    const eventos = (await this.memory.listItems('evento')).filter((e) => e.fecha >= ymd(new Date()));
    const top = await this.memory.topCommands(5);
    const now = new Date();

    let ctx = '';
    if (pend.length) ctx += `\n- Tareas pendientes (${pend.length}): ${pend.slice(0, 4).map((t) => t.texto).join('; ')}.`;
    if (eventos.length) ctx += `\n- Próximos eventos: ${eventos.slice(0, 3).map((e) => `${e.titulo} (${e.fecha}${e.hora ? ' ' + e.hora : ''})`).join('; ')}.`;

    // Few-shot dinámico: refuerza los tipos de comando que el usuario más usa
    let fewshot = '';
    const withEx = top.filter((c) => c.examples && c.examples.length);
    if (withEx.length) {
      fewshot = '\nEjemplos del estilo de peticiones frecuentes de este usuario: ' +
        withEx.map((c) => `"${c.examples[0]}"`).join(', ') + '.';
    }
    // Señal de feedback negativo -> ajusta comportamiento
    const totalDown = top.reduce((a, c) => a + (c.down || 0), 0);
    const precision = totalDown >= 3 ? '\nEl usuario ha marcado respuestas anteriores como poco útiles: sé más preciso, breve y evita rodeos.' : '';

    return (
      `Eres "Asistente", el asistente personal de ${name}. Hablas español neutro, ${tono}. ` +
      `Respondes de forma breve (1-3 frases), útil y conversacional, apta para leerse en voz alta. ` +
      `No inventes datos personales. Si te piden crear notas, tareas, eventos o alarmas, confírmalo con naturalidad.` +
      `\nFecha y hora actual: ${now.toLocaleString('es')}.` +
      (ctx ? `\nContexto del usuario:${ctx}` : '') +
      fewshot + precision
    );
  }

  /* Respuesta conversacional (usa LLM si está listo; si no, respuesta simple) */
  async chat(userText) {
    if (this.mode === 'llm' && this.engine) {
      try {
        let system = await this.buildSystemPrompt();
        // Qwen3/3.5 "razonan" con bloques <think>: los desactivamos para voz (soft switch)
        if (/^Qwen3/i.test(this.modelId || '')) system += '\n/no_think';
        const history = await this.memory.recentMessages(8);
        const messages = [{ role: 'system', content: system }];
        for (const m of history) {
          messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text });
        }
        messages.push({ role: 'user', content: userText });

        const res = await this.engine.chat.completions.create({
          messages,
          temperature: this.opts.temperature,
          max_tokens: this.opts.maxTokens
        });
        const text = stripThink(res.choices[0].message.content);
        if (text) return { text, mode: 'llm' };
        return { text: this._rulesReply(userText), mode: 'rules' };
      } catch (e) {
        console.warn('[AIBrain] LLM falló, uso reglas:', e);
        return { text: this._rulesReply(userText), mode: 'rules' };
      }
    }
    return { text: this._rulesReply(userText), mode: 'rules' };
  }

  /* Cerebro de reglas de respaldo: respuestas conversacionales básicas
     sin modelo (small talk + orientación). Los comandos concretos los
     resuelve commands.js antes de llegar aquí. */
  _rulesReply(text) {
    const t = text.toLowerCase();
    if (/\b(hola|buenas|buenos días|buenas tardes|buenas noches|qué tal|hey)\b/.test(t))
      return '¡Hola! ¿En qué te ayudo? Puedo crear notas, tareas, eventos o recordatorios.';
    if (/\b(gracias|genial|perfecto)\b/.test(t)) return '¡Con gusto! ¿Algo más?';
    if (/\b(qué puedes hacer|ayuda|comandos|funciones)\b/.test(t))
      return 'Puedo tomar notas, gestionar tus tareas, agendar eventos y ponerte alarmas. Dilo natural, por ejemplo: "recuérdame llamar al banco a las 5".';
    if (/\b(qué hora|hora es)\b/.test(t)) return 'Son las ' + new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) + '.';
    if (/\b(qué día|fecha)\b/.test(t)) return 'Hoy es ' + new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }) + '.';
    return 'Entendido. Para activar respuestas más inteligentes puedes descargar un modelo de IA en Ajustes. Mientras tanto, puedo gestionar tus notas, tareas, eventos y alarmas.';
  }
}

/* Quita bloques de razonamiento <think>…</think> (Qwen3) del texto final */
function stripThink(s) {
  let t = (s || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const i = t.indexOf('<think>');
  if (i !== -1) t = t.slice(0, i); // bloque sin cerrar (cortado por max_tokens)
  return t.trim();
}

/* Utilidad compartida */
function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default AIBrain;
