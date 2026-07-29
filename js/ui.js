/* ============================================================
   ui.js
   Capa de presentación reactiva: máquina de estados visual del
   asistente (idle / listening / thinking / speaking / offline),
   conversación con burbujas, hojas (panel de skills y ajustes),
   toasts y render de notas/tareas/eventos/alarmas.
   ============================================================ */
import { fechaCorta, cuando } from './commands.js';

/* ============================================================
   Iconos SVG inline (trazo consistente, sin dependencias)
   ============================================================ */
const svg = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const ICON = {
  mic: svg('<path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="21"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/>'),
  check: svg('<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
  note: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
  calendar: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  bell: svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
  chat: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  trash: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  ok: svg('<circle cx="12" cy="12" r="10"/><polyline points="8 12.5 11 15.5 16 9.5"/>'),
  no: svg('<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'),
  warn: svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  info: svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
  clock: svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  search: svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  save: svg('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>'),
  wave: svg('<line x1="3" y1="10" x2="3" y2="14"/><line x1="7" y1="7" x2="7" y2="17"/><line x1="11" y1="4" x2="11" y2="20"/><line x1="15" y1="7" x2="15" y2="17"/><line x1="19" y1="10" x2="19" y2="14"/>'),
  external: svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'),
  contact: svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  camera: svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  video: svg('<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>')
};

/* Iconos heredados (emoji) -> icono SVG, para no tocar cada llamada a toast() */
const TOAST_ICON = {
  '✅': 'ok', '👍': 'ok', '⚠️': 'warn', '👎': 'no', '🎙️': 'mic', '👂': 'wave',
  '🧠': 'info', '💾': 'save', '🗑️': 'trash', '🔔': 'bell', '🔎': 'search',
  '⏰': 'clock', '♻️': 'info', '⬇️': 'save', '🔊': 'wave'
};

/* Tiles del home (estilo launcher de smartphone) */
const TILES = [
  { id: 'tareas', label: 'Tareas', icon: 'check', grad: 'g-green' },
  { id: 'notas', label: 'Notas', icon: 'note', grad: 'g-orange' },
  { id: 'eventos', label: 'Agenda', icon: 'calendar', grad: 'g-blue' },
  { id: 'alarmas', label: 'Recordatorios', icon: 'bell', grad: 'g-pink' },
  { id: 'media', label: 'Fotos', icon: 'camera', grad: 'g-teal' },
  { id: 'chat', label: 'Conversación', icon: 'chat', grad: 'g-purple' },
  { id: 'ajustes', label: 'Ajustes', icon: 'gear', grad: 'g-slate' }
];

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = (n) => String(n).padStart(2, '0');

export class UI {
  constructor(memory) {
    this.memory = memory;
    this.el = {
      body: document.body,
      orb: $('#orb'),
      stateLabel: $('#stateLabel'),
      live: $('#liveTranscript'),
      conv: $('#conversation'),
      brandSub: $('#brandSub'),
      netChip: $('#netChip'),
      panel: $('#panel'), panelBody: $('#panelBody'),
      settings: $('#settings'), settingsBody: $('#settingsBody'),
      chat: $('#chat'),
      tiles: $('#tiles'), replyCard: $('#replyCard'),
      toasts: $('#toasts')
    };
    this.onFeedback = null; // (msgId, dir) => {}
    this.onOpenSettings = null; // abre Ajustes (lo conecta app.js)
    this.onAction = null; // acción con datos (p. ej. abrir Contact Picker)
    this.activeTab = 'tareas';
    this._view = null;    // vista abierta: 'panel' | 'chat' | 'settings' | null
    this.media = null;         // MediaStore (OPFS), lo conecta app.js
    this.mediaFilter = null;   // ids filtrados por una búsqueda por voz
    this._mediaOpen = null;    // id abierto en el visor
    this._mediaQuery = '';     // filtro del buscador de la galería
    this._mediaPending = null; // captura recién hecha esperando descripción
    this._urls = [];           // object URLs a liberar en cada render

    // El botón/gesto "atrás" del sistema navega entre vistas (Android/PWA)
    window.addEventListener('popstate', (e) => {
      if (e.state && e.state.view && this.el[e.state.view]) {
        this._view = e.state.view;
        this.el[e.state.view].classList.add('open');
      } else {
        this._closeViewVisual();
      }
    });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeSheet(); });
  }

  /* -------- Estado visual del asistente -------- */
  setState(state, label) {
    this.el.body.dataset.state = state;
    this.el.orb.dataset.state = state;
    const labels = {
      idle: 'Toca el micrófono para hablar',
      listening: 'Escuchando…',
      thinking: 'Pensando…',
      speaking: 'Hablando…',
      error: 'Ups, algo pasó',
      offline: 'Modo offline'
    };
    this.el.stateLabel.textContent = label || labels[state] || '';
    if (state !== 'listening') this.setLive('');
  }
  setLive(text) { this.el.live.textContent = text || ''; }
  setBrandSub(text) { this.el.brandSub.textContent = text; }

  setOnline(isOnline) {
    this.el.netChip.textContent = isOnline ? '● Online' : '◍ Offline';
    this.el.netChip.classList.toggle('online', isOnline);
  }

  /* -------- Conversación -------- */
  addUser(text) { return this._bubble('user', esc(text)); }
  sys(text) { this.showReply(text); return this._bubble('sys', esc(text)); }

  addBot(text, { mode = 'rules', id = null, action = null } = {}) {
    const b = document.createElement('div');
    b.className = 'bubble bot';
    b.innerHTML = `<div class="b-text">${esc(text)}</div>` +
      `<div class="meta">${mode === 'llm' ? 'IA local' : mode === 'skill' ? 'skill' : 'reglas'}</div>`;
    if (id) {
      const fb = document.createElement('div');
      fb.className = 'fb';
      fb.innerHTML = `<button data-d="1" title="Útil">${ICON.ok}</button><button data-d="-1" title="Mejorable">${ICON.no}</button>`;
      fb.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
        this.onFeedback && this.onFeedback(id, parseInt(btn.dataset.d, 10));
        fb.innerHTML = `<span style="font-size:12px;color:var(--txt-faint)">¡Gracias por tu feedback!</span>`;
      }));
      b.appendChild(fb);
    }
    const act = this._actionEl(action);
    if (act) b.appendChild(act);
    this.el.conv.appendChild(b);
    this._scroll();
    this.showReply(text, action);
    return b;
  }

  _bubble(cls, html) {
    const b = document.createElement('div');
    b.className = 'bubble ' + cls;
    b.innerHTML = html;
    this.el.conv.appendChild(b);
    this._scroll();
    return b;
  }
  _scroll() { this.el.conv.scrollTop = this.el.conv.scrollHeight; }

  /* -------- Toasts -------- */
  toast(icon, msg, ms = 3200) {
    const t = document.createElement('div');
    t.className = 'toast';
    const key = ICON[icon] ? icon : (TOAST_ICON[icon] || 'info');
    t.innerHTML = `<span class="ti">${ICON[key]}</span><span>${msg}</span>`;
    this.el.toasts.appendChild(t);
    setTimeout(() => {
      t.style.transition = '.3s'; t.style.opacity = '0'; t.style.transform = 'translateY(-10px)';
      setTimeout(() => t.remove(), 300);
    }, ms);
  }

  /* -------- Vistas a pantalla completa (navegación tipo app) -------- */
  openSheet(which) {
    if (!this.el[which] || this._view === which) return;
    if (this._view) {
      // Cambio directo de vista: sustituye la entrada del historial
      this.el[this._view] && this.el[this._view].classList.remove('open');
      history.replaceState({ view: which }, '');
    } else {
      history.pushState({ view: which }, '');
    }
    this._view = which;
    this.el[which].classList.add('open');
  }

  /* La flecha ← va por el historial: así el "atrás" del sistema hace lo mismo */
  closeSheet() {
    if (this._view) history.back();
  }

  _closeViewVisual() {
    ['panel', 'chat', 'settings'].forEach((k) => {
      const v = this.el[k];
      v && v.classList.remove('open');
    });
    this._view = null;
  }

  /* -------- Home: cuadrícula de iconos (estilo launcher) -------- */
  async renderTiles() {
    const counts = await this._tileCounts();
    this.el.tiles.innerHTML = TILES.map((t) => `
      <button class="tile" data-tile="${t.id}" aria-label="${t.label}">
        <span class="ic ${t.grad}">${ICON[t.icon]}${counts[t.id] ? `<span class="badge">${counts[t.id]}</span>` : ''}</span>
        <span class="lb">${t.label}</span>
      </button>`).join('');
    this.el.tiles.querySelectorAll('[data-tile]').forEach((b) =>
      b.addEventListener('click', () => this._openTile(b.dataset.tile)));
  }

  async refreshTiles() {
    if (!this.el.tiles || !this.el.tiles.childElementCount) return;
    const counts = await this._tileCounts();
    this.el.tiles.querySelectorAll('[data-tile]').forEach((b) => {
      const ic = b.querySelector('.ic');
      let badge = ic.querySelector('.badge');
      const n = counts[b.dataset.tile] || 0;
      if (n) {
        if (!badge) { badge = document.createElement('span'); badge.className = 'badge'; ic.appendChild(badge); }
        badge.textContent = n;
      } else if (badge) badge.remove();
    });
  }

  async _tileCounts() {
    const [tareas, notas, eventos, alarmas, media] = await Promise.all(
      ['tarea', 'nota', 'evento', 'alarma', 'media'].map((t) => this.memory.listItems(t)));
    const hoy = new Date().toISOString().slice(0, 10);
    return {
      tareas: tareas.filter((t) => !t.done).length,
      notas: notas.length,
      eventos: eventos.filter((e) => e.fecha >= hoy).length,
      alarmas: alarmas.filter((a) => a.activa).length,
      media: media.length
    };
  }

  _openTile(id) {
    if (id === 'chat') { this.openSheet('chat'); return; }
    if (id === 'ajustes') { this.onOpenSettings && this.onOpenSettings(); return; }
    if (id === 'media') { this.mediaFilter = null; this._mediaOpen = null; this._mediaQuery = ''; }
    this.openSheet('panel');
    this.renderPanel(id);
  }

  /* El orbe viaja hasta el icono relacionado con la acción en curso */
  focusTile(tab) {
    const tile = this.el.tiles && this.el.tiles.querySelector(`[data-tile="${tab}"]`);
    const orb = this.el.orb;
    if (!tile || !orb) return;
    // Posición "en reposo" del orbe (evita medirlo ya desplazado)
    if (!orb.classList.contains('focusing') || !this._orbHome) {
      this._orbHome = orb.getBoundingClientRect();
    }
    const t = tile.getBoundingClientRect();
    const o = this._orbHome;
    orb.style.setProperty('--fx', ((t.left + t.width / 2) - (o.left + o.width / 2)) + 'px');
    orb.style.setProperty('--fy', ((t.top + t.height / 2) - (o.top + o.height / 2)) + 'px');
    orb.classList.add('focusing');
    this.el.tiles.querySelectorAll('.tile.focus').forEach((x) => x.classList.remove('focus'));
    tile.classList.add('focus');
    clearTimeout(this._focusTimer);
    this._focusTimer = setTimeout(() => {
      orb.classList.remove('focusing');
      this.el.tiles.querySelectorAll('.tile.focus').forEach((x) => x.classList.remove('focus'));
    }, 2600);
  }

  /* Botón de acción (deep link o Contact Picker) para una respuesta */
  _actionEl(action) {
    if (!action || !(action.href || action.data)) return null;
    const act = document.createElement('div');
    act.className = 'act';
    if (action.href) {
      act.innerHTML = `<a class="act-btn" href="${esc(action.href)}" target="_blank" rel="noopener">${ICON.external}${esc(action.label || 'Abrir')}</a>`;
    } else {
      const btn = document.createElement('button');
      btn.className = 'act-btn';
      btn.innerHTML = `${ICON.contact}${esc(action.label || 'Elegir')}`;
      btn.addEventListener('click', () => this.onAction && this.onAction(action.data));
      act.appendChild(btn);
    }
    return act;
  }

  /* Última respuesta del asistente como tarjeta flotante sobre el orbe */
  showReply(text, action = null) {
    const rc = this.el.replyCard;
    if (!rc) return;
    rc.textContent = text;
    const act = this._actionEl(action);
    if (act) rc.appendChild(act);
    rc.hidden = false;
    clearTimeout(this._replyTimer);
    this._replyTimer = setTimeout(() => { rc.hidden = true; }, action ? 12000 : 7000);
  }

  /* -------- Panel de skills -------- */
  async renderPanel(tab) {
    if (tab) this.activeTab = tab;
    document.querySelectorAll('#panelTabs .tab').forEach((b) =>
      b.classList.toggle('on', b.dataset.tab === this.activeTab));
    const h = $('#panelTitle');
    if (h) h.textContent = ({ tareas: 'Tareas', notas: 'Notas', eventos: 'Agenda', alarmas: 'Recordatorios', media: 'Fotos y videos' })[this.activeTab] || 'Mis cosas';
    const body = this.el.panelBody;
    const items = await this.memory.listItems(this._singular(this.activeTab));

    if (this.activeTab === 'tareas') body.innerHTML = this._renderTareas(items);
    else if (this.activeTab === 'notas') body.innerHTML = this._renderNotas(items);
    else if (this.activeTab === 'eventos') body.innerHTML = this._renderEventos(items);
    else if (this.activeTab === 'alarmas') body.innerHTML = this._renderAlarmas(items);
    else if (this.activeTab === 'media') body.innerHTML = await this._renderMedia(items);

    this._wirePanel();
    if (this.activeTab === 'media') this._wireMedia();
  }

  _singular(tab) { return ({ tareas: 'tarea', notas: 'nota', eventos: 'evento', alarmas: 'alarma', media: 'media' })[tab]; }

  _renderTareas(items) {
    const pend = items.filter((t) => !t.done).sort((a, b) => prioOrder(a.prio) - prioOrder(b.prio));
    const done = items.filter((t) => t.done);
    const quick = `
      <div class="inrow" style="margin-bottom:12px">
        <input class="field" id="qTarea" placeholder="Nueva tarea…">
        <button class="btn" data-add="tarea">＋</button>
      </div>`;
    const row = (t) => `
      <div class="li ${t.done ? 'done' : ''}">
        <div class="check ${t.done ? 'done' : ''}" data-toggle="${t.id}">${t.done ? '✓' : ''}</div>
        <div class="body"><div class="t">${esc(t.texto)}</div>
          <div class="s"><span class="pill-tag ${t.prio || 'media'}">${t.prio || 'media'}</span></div></div>
        <button class="del" data-del="${t.id}">${ICON.trash}</button>
      </div>`;
    return quick +
      (pend.length ? pend.map(row).join('') : `<div class="empty">Sin tareas pendientes 🎉</div>`) +
      (done.length ? `<div class="muted" style="margin:12px 2px 8px">Completadas (${done.length})</div>` + done.map(row).join('') : '');
  }

  _renderNotas(items) {
    const quick = `
      <div class="inrow" style="margin-bottom:12px">
        <input class="field" id="qNota" placeholder="Nueva nota…">
        <button class="btn" data-add="nota">＋</button>
      </div>`;
    return quick + (items.length ? items.map((n) => `
      <div class="card">
        ${n.titulo ? `<h3>${esc(n.titulo)}</h3>` : ''}
        <div class="muted" style="white-space:pre-wrap">${esc(n.texto)}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
          <span class="muted" style="font-size:11px">${new Date(n.ts).toLocaleString('es')}</span>
          <button class="del" data-del="${n.id}">${ICON.trash}</button>
        </div>
      </div>`).join('') : `<div class="empty">Aún no tienes notas.</div>`);
  }

  _renderEventos(items) {
    const hoy = new Date().toISOString().slice(0, 10);
    const evs = items.filter((e) => e.fecha >= hoy).sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
    const quick = `
      <label class="lbl">Nuevo evento</label>
      <input class="field" id="qEvTit" placeholder="Título…" style="margin-bottom:8px">
      <div class="dt" style="margin-bottom:12px">
        <input class="field" id="qEvFecha" type="date" value="${hoy}">
        <input class="field" id="qEvHora" type="time">
        <button class="btn" data-add="evento">＋</button>
      </div>`;
    return quick + (evs.length ? evs.map((e) => `
      <div class="li">
        <div class="body"><div class="t">${esc(e.titulo)}</div>
          <div class="s">${fechaCorta(e.fecha)}${e.hora ? ' · ' + e.hora : ''}</div></div>
        <button class="del" data-del="${e.id}">${ICON.trash}</button>
      </div>`).join('') : `<div class="empty">Sin eventos próximos.</div>`);
  }

  _renderAlarmas(items) {
    const arr = items.sort((a, b) => b.ts - a.ts);
    const now = new Date();
    const quick = `
      <label class="lbl">Nuevo recordatorio</label>
      <input class="field" id="qAlTxt" placeholder="¿De qué te recuerdo?" style="margin-bottom:8px">
      <div class="dt" style="margin-bottom:12px">
        <input class="field" id="qAlFecha" type="date" value="${now.toISOString().slice(0, 10)}">
        <input class="field" id="qAlHora" type="time" value="${pad(now.getHours())}:${pad((now.getMinutes() + 5) % 60)}">
        <button class="btn" data-add="alarma">＋</button>
      </div>`;
    return quick + (arr.length ? arr.map((a) => `
      <div class="li ${a.activa ? '' : 'done'}">
        <div class="check ${a.activa ? 'done' : ''}" data-toggle="${a.id}">${a.activa ? '●' : '○'}</div>
        <div class="body"><div class="t">${esc(a.texto)}</div>
          <div class="s">${cuando(a.ts)}${a.activa ? '' : ' · ' + (a.sonada ? 'sonó' : 'pausada')}</div></div>
        <button class="del" data-del="${a.id}">${ICON.trash}</button>
      </div>`).join('') : `<div class="empty">Sin recordatorios.</div>`);
  }

  /* -------- Galería: fotos y videos con descripción buscable -------- */
  async _renderMedia(items) {
    (this._urls || []).forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} });
    this._urls = [];

    // Visor de un elemento
    if (this._mediaOpen) {
      const it = items.find((x) => x.id === this._mediaOpen);
      if (it) {
        const f = this.media ? await this.media.get(it.id) : null;
        const url = f ? URL.createObjectURL(f) : null;
        if (url) this._urls.push(url);
        return `
          <button class="btn ghost block" id="mBack" style="margin-bottom:10px">Volver a la galería</button>
          <div class="media-view">
            ${it.kind === 'video'
              ? (url ? `<video src="${url}" controls playsinline></video>` : '<div class="empty">No encuentro el archivo en este dispositivo.</div>')
              : (url ? `<img src="${url}" alt="">` : '<div class="empty">No encuentro el archivo en este dispositivo.</div>')}
          </div>
          <div class="muted" style="margin-top:8px">${esc(it.descripcion || 'Sin descripción')} · ${new Date(it.ts).toLocaleString('es')}</div>
          <button class="btn ghost block" id="mDel" style="margin-top:10px;color:var(--danger)">Eliminar</button>`;
      }
      this._mediaOpen = null;
    }

    const pend = this._mediaPending ? `
      <div class="card">
        ${this._mediaPending.thumb
          ? `<img src="${this._mediaPending.thumb}" style="width:100%;border-radius:12px;margin-bottom:8px" alt="">`
          : '<div class="muted" style="margin-bottom:8px">Video guardado.</div>'}
        <label class="lbl">¿De qué se trata? (así podrás pedírmela luego)</label>
        <div class="inrow">
          <input class="field" id="mDesc" placeholder="ej: recibo del proveedor de cajas">
          <button class="btn" id="mSaveDesc">Guardar</button>
        </div>
      </div>` : '';
    const filtro = this.mediaFilter ? `
      <div class="inrow" style="margin-bottom:10px;align-items:center">
        <span class="muted" style="flex:1">Resultados de tu búsqueda</span>
        <button class="btn ghost" id="mClear" style="padding:8px 12px">Ver todo</button>
      </div>` : '';
    return `
      ${pend}
      <div class="inrow" style="margin-bottom:10px">
        <button class="btn" id="mCam" style="flex:1">Tomar foto</button>
        <button class="btn ghost" id="mVid" style="flex:1">Grabar video</button>
      </div>
      <input type="file" id="mCamIn" accept="image/*" capture="environment" style="display:none">
      <input type="file" id="mVidIn" accept="video/*" capture="environment" style="display:none">
      <input class="field" id="mSearch" placeholder="Buscar por descripción…" style="margin-bottom:10px" value="${esc(this._mediaQuery)}">
      ${filtro}
      <div class="media-grid" id="mGrid">${this._mediaGridHtml(items)}</div>`;
  }

  _mediaGridHtml(items) {
    let arr = items;
    if (this.mediaFilter) arr = arr.filter((x) => this.mediaFilter.includes(x.id));
    if (this._mediaQuery) arr = arr.filter((x) => (x.descripcion || '').toLowerCase().includes(this._mediaQuery));
    if (!arr.length) {
      return `<div class="empty" style="grid-column:1/-1">${this._mediaQuery || this.mediaFilter
        ? 'Nada coincide con esa búsqueda.'
        : 'Aún no hay fotos ni videos. Toma la primera con el botón de arriba.'}</div>`;
    }
    return arr.map((x) => `
      <button class="media-tile" data-media="${x.id}" aria-label="${esc(x.descripcion || 'elemento')}">
        ${x.kind !== 'video' && x.thumb ? `<img src="${x.thumb}" alt="">`
          : `<span class="mt-vid">${x.kind === 'video' ? ICON.video : ICON.camera}</span>`}
        ${x.descripcion ? `<span class="mt-cap">${esc(x.descripcion)}</span>` : ''}
      </button>`).join('');
  }

  _wireMediaGrid() {
    this.el.panelBody.querySelectorAll('[data-media]').forEach((b) =>
      b.addEventListener('click', () => { this._mediaOpen = b.dataset.media; this.renderPanel('media'); }));
  }

  _wireMedia() {
    const body = this.el.panelBody;
    const g = (id) => body.querySelector('#' + id);
    this._wireMediaGrid();

    const camIn = g('mCamIn'), vidIn = g('mVidIn');
    const cam = g('mCam'), vid = g('mVid');
    cam && cam.addEventListener('click', () => camIn && camIn.click());
    vid && vid.addEventListener('click', () => vidIn && vidIn.click());
    const onPick = (kind) => async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      if (!this.media) { this.toast('⚠️', 'Almacenamiento de archivos no disponible en este navegador'); return; }
      const id = 'md_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await this.media.save(id, f);
      let thumb = null;
      if (kind === 'foto') { try { thumb = await makeThumb(f); } catch (err) {} }
      this._mediaPending = { id, kind, mime: f.type, thumb };
      this.renderPanel('media');
    };
    camIn && camIn.addEventListener('change', onPick('foto'));
    vidIn && vidIn.addEventListener('change', onPick('video'));

    const saveP = g('mSaveDesc');
    saveP && saveP.addEventListener('click', async () => {
      const p = this._mediaPending;
      if (!p) return;
      const d = g('mDesc').value.trim();
      await this.memory.putItem({ type: 'media', id: p.id, kind: p.kind, mime: p.mime, thumb: p.thumb, descripcion: d });
      this._mediaPending = null;
      this.renderPanel('media');
      this.toast('✅', d ? 'Guardado; ya puedes buscarlo por su descripción' : 'Guardado sin descripción (será difícil de encontrar)');
    });

    const search = g('mSearch');
    search && search.addEventListener('input', async () => {
      this._mediaQuery = search.value.trim().toLowerCase();
      const grid = g('mGrid');
      if (grid) { grid.innerHTML = this._mediaGridHtml(await this.memory.listItems('media')); this._wireMediaGrid(); }
    });

    const clear = g('mClear');
    clear && clear.addEventListener('click', () => { this.mediaFilter = null; this.renderPanel('media'); });
    const back = g('mBack');
    back && back.addEventListener('click', () => { this._mediaOpen = null; this.renderPanel('media'); });
    const del = g('mDel');
    del && del.addEventListener('click', async () => {
      const id = this._mediaOpen;
      if (!id || !confirm('¿Eliminar esta foto o video? No se puede deshacer.')) return;
      this._mediaOpen = null;
      await this.memory.deleteItem(id);
      if (this.media) this.media.remove(id);
      this.renderPanel('media');
      this.toast('🗑️', 'Eliminado');
    });
  }

  /* Conecta los controles del panel a la memoria */
  _wirePanel() {
    const body = this.el.panelBody;
    body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      await this.memory.deleteItem(b.dataset.del); this.renderPanel();
    }));
    body.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      const it = await this.memory.getItem(b.dataset.toggle);
      if (!it) return;
      if (it.type === 'tarea') it.done = !it.done;
      if (it.type === 'alarma') { it.activa = !it.activa; if (it.activa) it.sonada = false; }
      await this.memory.putItem(it); this.renderPanel();
    }));
    body.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => this._quickAdd(b.dataset.add)));
  }

  async _quickAdd(type) {
    if (type === 'tarea') {
      const v = $('#qTarea').value.trim(); if (!v) return;
      await this.memory.putItem({ type: 'tarea', texto: v, prio: 'media', done: false });
    } else if (type === 'nota') {
      const v = $('#qNota').value.trim(); if (!v) return;
      await this.memory.putItem({ type: 'nota', texto: v, titulo: '' });
    } else if (type === 'evento') {
      const t = $('#qEvTit').value.trim(); if (!t) return;
      await this.memory.putItem({ type: 'evento', titulo: t, fecha: $('#qEvFecha').value, hora: $('#qEvHora').value });
    } else if (type === 'alarma') {
      const txt = $('#qAlTxt').value.trim(); const f = $('#qAlFecha').value; const h = $('#qAlHora').value;
      if (!txt || !f || !h) return;
      const [Y, M, D] = f.split('-').map(Number); const [hh, mm] = h.split(':').map(Number);
      const ts = new Date(Y, M - 1, D, hh, mm, 0).getTime();
      if (ts <= Date.now()) { this.toast('⏰', 'Esa hora ya pasó'); return; }
      await this.memory.putItem({ type: 'alarma', texto: txt, ts, activa: true, sonada: false });
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    }
    this.renderPanel();
    this.toast('✅', 'Guardado');
  }
}

function prioOrder(p) { return ({ alta: 0, media: 1, baja: 2 })[p] ?? 1; }

/* Miniatura JPEG (~480 px) para la cuadrícula de la galería */
async function makeThumb(blob) {
  const bmp = await createImageBitmap(blob, { resizeWidth: 480 });
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  if (bmp.close) bmp.close();
  return c.toDataURL('image/jpeg', 0.72);
}

export default UI;
