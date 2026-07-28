/* ============================================================
   semantic-memory.js
   Búsqueda semántica local (RAG) sobre la memoria del usuario.
   · Embeddings con Transformers.js (WASM/ONNX) usando
     multilingual-e5-small cuantizado (~110 MB, descarga única
     que queda cacheada; luego funciona offline).
   · Vectores guardados en IndexedDB (store 'vectors' del
     MemoryStore). Similitud coseno en memoria: con cientos o
     miles de notas es instantáneo.
   · Convención e5: las consultas llevan prefijo "query: " y los
     documentos "passage: " — sin esto la calidad cae mucho.
   Todo ocurre en el dispositivo; nada sale del teléfono.
   ============================================================ */

/* Misma versión de Transformers.js que usa el adaptador Whisper:
   comparten librería y caché */
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
const EMB_MODEL = 'Xenova/multilingual-e5-small';

/* Tipos de ítem que se indexan */
const INDEXABLE = ['nota', 'tarea', 'evento', 'alarma'];

export class SemanticMemory {
  constructor(memory) {
    this.memory = memory;      // MemoryStore
    this._pipe = null;
    this.ready = false;
    this.loading = false;
    this._queue = [];
    this._busy = false;
    this.onIndexed = null;     // callback opcional por ítem indexado
  }

  /* Texto indexable de un ítem (título + contenido) */
  static itemText(item) {
    if (!item) return '';
    const parts = [];
    if (item.titulo) parts.push(item.titulo);
    if (item.texto) parts.push(item.texto);
    return parts.join('. ').trim();
  }

  /* Descarga (una vez) y prepara el modelo de embeddings */
  async init(onProgress) {
    if (this.ready) return true;
    if (this.loading) return false;
    this.loading = true;
    try {
      const { pipeline, env } = await import(TRANSFORMERS_URL);
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      this._pipe = await pipeline('feature-extraction', EMB_MODEL, {
        quantized: true,
        progress_callback: (p) => { if (onProgress && p.status === 'progress') onProgress(p); }
      });
      this.ready = true;
      this._drain(); // procesa lo que se hubiera encolado mientras cargaba
      return true;
    } finally {
      this.loading = false;
    }
  }

  async _embed(text, kind /* 'query' | 'passage' */) {
    const out = await this._pipe(`${kind}: ${text}`, { pooling: 'mean', normalize: true });
    return Array.from(out.data);
  }

  /* Encola un ítem para indexar (no bloquea; ignora tipos no indexables) */
  enqueue(item) {
    if (!item || !INDEXABLE.includes(item.type)) return;
    this._queue.push(item);
    this._drain();
  }

  async _drain() {
    if (this._busy || !this.ready) return;
    this._busy = true;
    try {
      while (this._queue.length) {
        const it = this._queue.shift();
        const text = SemanticMemory.itemText(it);
        if (!text) continue;
        try {
          const vec = await this._embed(text, 'passage');
          await this.memory.putVector({ id: it.id, type: it.type, text, vec, ts: it.ts || Date.now(), model: EMB_MODEL });
          if (this.onIndexed) { try { this.onIndexed(it); } catch (e) {} }
        } catch (e) {
          console.warn('[RAG] No se pudo indexar', it.id, e);
        }
      }
    } finally {
      this._busy = false;
    }
  }

  remove(id) { return this.memory.deleteVector(id); }

  /* Indexa todo lo que falte (tras activar el motor o importar datos).
     Devuelve cuántos ítems se encolaron; se procesan en segundo plano. */
  async reindexAll() {
    if (!this.ready) return 0;
    const have = new Set((await this.memory.allVectors()).map((v) => v.id));
    let n = 0;
    for (const type of INDEXABLE) {
      for (const it of await this.memory.listItems(type)) {
        if (!have.has(it.id)) { this.enqueue(it); n++; }
      }
    }
    return n;
  }

  async count() { return (await this.memory.allVectors()).length; }

  /* Búsqueda por significado: top-k por similitud coseno.
     Con vectores normalizados, el producto punto ES el coseno.
     Umbral: e5 concentra sus similitudes en una banda alta. */
  async search(query, k = 4, minScore = 0.78) {
    if (!this.ready || !query) return [];
    const q = await this._embed(query, 'query');
    const vecs = await this.memory.allVectors();
    const scored = [];
    for (const v of vecs) {
      if (!v.vec || v.vec.length !== q.length) continue;
      let dot = 0;
      for (let i = 0; i < q.length; i++) dot += q[i] * v.vec[i];
      if (dot >= minScore) scored.push({ id: v.id, type: v.type, text: v.text, ts: v.ts, score: dot });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, k);
  }
}

export default SemanticMemory;
