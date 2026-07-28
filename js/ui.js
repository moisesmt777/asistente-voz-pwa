/* ============================================================
   ui.js
   Capa de presentación reactiva: máquina de estados visual del
   asistente (idle / listening / thinking / speaking / offline),
   conversación con burbujas, hojas (panel de skills y ajustes),
   toasts y render de notas/tareas/eventos/alarmas.
   ============================================================ */
import { fechaCorta, cuando } from './commands.js';

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
      panel: $('#panel'), panelOverlay: $('#panelOverlay'), panelBody: $('#panelBody'),
      settings: $('#settings'), settingsOverlay: $('#settingsOverlay'), settingsBody: $('#settingsBody'),
      toasts: $('#toasts')
    };
    this.onFeedback = null; // (msgId, dir) => {}
    this.activeTab = 'tareas';
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
  sys(text) { return this._bubble('sys', esc(text)); }

  addBot(text, { mode = 'rules', id = null } = {}) {
    const b = document.createElement('div');
    b.className = 'bubble bot';
    b.innerHTML = `<div class="b-text">${esc(text)}</div>` +
      `<div class="meta">${mode === 'llm' ? '🧠 IA local' : '⚙️ reglas'}</div>`;
    if (id) {
      const fb = document.createElement('div');
      fb.className = 'fb';
      fb.innerHTML = `<button data-d="1" title="Útil">👍</button><button data-d="-1" title="Mejorable">👎</button>`;
      fb.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
        this.onFeedback && this.onFeedback(id, parseInt(btn.dataset.d, 10));
        fb.innerHTML = `<span style="font-size:12px;color:var(--txt-faint)">¡Gracias por tu feedback!</span>`;
      }));
      b.appendChild(fb);
    }
    this.el.conv.appendChild(b);
    this._scroll();
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
    t.innerHTML = `<span class="ti">${icon}</span><span>${msg}</span>`;
    this.el.toasts.appendChild(t);
    setTimeout(() => {
      t.style.transition = '.3s'; t.style.opacity = '0'; t.style.transform = 'translateY(-10px)';
      setTimeout(() => t.remove(), 300);
    }, ms);
  }

  /* -------- Hojas (sheets) -------- */
  openSheet(which) {
    const s = this.el[which], o = this.el[which + 'Overlay'];
    o.classList.add('show'); s.classList.add('open');
  }
  closeSheet(which) {
    const s = this.el[which], o = this.el[which + 'Overlay'];
    o.classList.remove('show'); s.classList.remove('open');
  }

  /* -------- Panel de skills -------- */
  async renderPanel(tab) {
    if (tab) this.activeTab = tab;
    document.querySelectorAll('#panelTabs .tab').forEach((b) =>
      b.classList.toggle('on', b.dataset.tab === this.activeTab));
    const body = this.el.panelBody;
    const items = await this.memory.listItems(this._singular(this.activeTab));

    if (this.activeTab === 'tareas') body.innerHTML = this._renderTareas(items);
    else if (this.activeTab === 'notas') body.innerHTML = this._renderNotas(items);
    else if (this.activeTab === 'eventos') body.innerHTML = this._renderEventos(items);
    else if (this.activeTab === 'alarmas') body.innerHTML = this._renderAlarmas(items);

    this._wirePanel();
  }

  _singular(tab) { return ({ tareas: 'tarea', notas: 'nota', eventos: 'evento', alarmas: 'alarma' })[tab]; }

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
        <button class="del" data-del="${t.id}">🗑️</button>
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
          <button class="del" data-del="${n.id}">🗑️</button>
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
          <div class="s">📅 ${fechaCorta(e.fecha)} ${e.hora ? '· 🕐 ' + e.hora : ''}</div></div>
        <button class="del" data-del="${e.id}">🗑️</button>
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
        <div class="check ${a.activa ? 'done' : ''}" data-toggle="${a.id}">${a.activa ? '⏰' : '○'}</div>
        <div class="body"><div class="t">${esc(a.texto)}</div>
          <div class="s">${cuando(a.ts)}${a.activa ? '' : ' · ' + (a.sonada ? 'sonó' : 'pausada')}</div></div>
        <button class="del" data-del="${a.id}">🗑️</button>
      </div>`).join('') : `<div class="empty">Sin recordatorios.</div>`);
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

export default UI;
