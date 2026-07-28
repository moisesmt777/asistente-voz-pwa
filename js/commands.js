/* ============================================================
   commands.js
   Enrutador de intenciones (skills) en español. Interpreta el texto
   del usuario para acciones DETERMINISTAS y rápidas (sin LLM):
   crear/consultar/completar/borrar notas, tareas, eventos y alarmas,
   además de navegación. Si no reconoce una intención, devuelve
   { handled:false } y el orquestador delega en el cerebro conversacional.
   ============================================================ */

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export class CommandRouter {
  constructor(memory) { this.memory = memory; }

  /* Punto de entrada. Devuelve un objeto de resultado o {handled:false}. */
  async handle(rawText) {
    const t = (rawText || '').trim();
    if (!t) return { handled: false };
    const low = t.toLowerCase();

    // --- Navegación ---
    const nav = low.match(/\b(abre|abrir|ve a|mu[eé]strame|muestra|ir a)\s+(las?\s+|mis?\s+)?(notas?|tareas?|pendientes|agenda|calendario|eventos?|alarmas?|recordatorios?|ajustes|configuraci[oó]n)/);
    if (nav) {
      const dest = this._mapTab(nav[3]);
      return this._ok('navegar', `Abriendo ${dest}.`, { action: 'open', tab: dest, silent: true });
    }

    // --- Consultas (lecturas) ---
    const q = await this._detectQuery(low);
    if (q) return q;

    // --- Completar / borrar tareas por texto ---
    const done = low.match(/\b(marca|completa|termin[éeó]|hecho|complet[ao])\s+(la tarea\s+)?(.+)/);
    if (done && /tarea|complet|marca|hecho|termin/.test(low)) {
      const target = done[3].trim();
      const r = await this._completeTaskByText(target);
      if (r) return r;
    }

    // --- Alarma / recordatorio con hora ---
    if (/\b(recu[eé]rdame|recuerda|alarma|av[ií]same|recordatorio|pon(?:me)?\s+(una|un)?\s*(alarma|recordatorio))\b/.test(low)) {
      let when = parseHora(low);
      const texto = extraerTextoRecordatorio(t);
      if (when) {
        // un recordatorio necesita hora: si solo se dijo un día, usa las 9:00
        if (!when.hasTime) { const d = new Date(when.ts); d.setHours(9, 0, 0, 0); when.ts = d.getTime(); }
        const item = await this.memory.putItem({ type: 'alarma', texto, ts: when.ts, activa: true, sonada: false });
        return this._ok('crear_alarma', `Listo, te recordaré "${texto}" ${cuando(when.ts)}.`,
          { action: 'refresh', tab: 'alarmas', item, utterance: t });
      }
      // Sin hora clara -> lo guardamos como tarea
      const tk = await this.memory.putItem({ type: 'tarea', texto, prio: 'media', done: false });
      return this._ok('crear_tarea', `No capté la hora, lo agendé como tarea: "${texto}".`,
        { action: 'refresh', tab: 'tareas', item: tk, utterance: t });
    }

    // --- Nota ---
    if (/\b(nota|anota|apunta|nueva nota|crea(?:r)?\s+(una)?\s*nota)\b/.test(low)) {
      let texto = t.replace(/^.*?\b(nota|anota|apunta|escribe)\b[:,]?\s*/i, '').trim();
      texto = texto.replace(/^(que|de que|sobre)\s+/i, '');
      if (!texto) texto = t;
      const item = await this.memory.putItem({ type: 'nota', texto, titulo: '' });
      return this._ok('crear_nota', `Nota guardada: "${short(texto)}".`,
        { action: 'refresh', tab: 'notas', item, utterance: t });
    }

    // --- Evento / cita ---
    if (/\b(evento|cita|reuni[oó]n|agendar|agenda|programa)\b/.test(low)) {
      const when = parseHora(low);
      // quita solo el verbo disparador (conserva "reunión", "cita"… como parte del título)
      let titulo = t.replace(/^.*?\b(agenda(?:r)?|programa(?:r)?|crea(?:r)?|pon(?:me)?|nuev[oa])\b\s*(una?\s+|el\s+|un\s+)?/i, '').trim();
      titulo = titulo.replace(/^evento\b[:,]?\s*/i, '').trim();
      // recorta expresiones de fecha/hora sin cortar en el artículo "el"
      titulo = titulo.replace(/\b(a las?|para las?|en\s+\d|mañana|hoy|pasado ma[ñn]ana|el\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|d[ií]a))\b.*/i, '').trim() || titulo || t;
      titulo = titulo.replace(/\s+/g, ' ');
      const fecha = when ? ymd(new Date(when.ts)) : ymd(new Date());
      const hora = (when && when.hasTime) ? hhmm(new Date(when.ts)) : '';
      const item = await this.memory.putItem({ type: 'evento', titulo, fecha, hora });
      return this._ok('crear_evento', `Evento agendado: "${titulo}" para ${fechaCorta(fecha)}${hora ? ' a las ' + hora : ''}.`,
        { action: 'refresh', tab: 'eventos', item, utterance: t });
    }

    // --- Tarea ---
    if (/\b(tarea|pendiente|agrega|a[ñn]ade|agregar|tengo que|debo)\b/.test(low)) {
      let prio = 'media';
      if (/\b(urgente|importante|prioridad alta|alta prioridad)\b/.test(low)) prio = 'alta';
      if (/\b(sin prisa|baja prioridad|cuando pueda)\b/.test(low)) prio = 'baja';
      // 1) quita el verbo disparador  2) quita el sustantivo de relleno "tarea/pendiente"
      let texto = t.replace(/^.*?\b(agrega(?:r)?|a[ñn]ade|nueva|crea(?:r)?|apunta|pon(?:me)?|tengo que|debo)\b\s*/i, '').trim();
      texto = texto.replace(/^(una?\s+|la\s+|el\s+)?(tarea|pendiente)s?\b[:,]?\s*/i, '').trim();
      texto = texto.replace(/\b(urgente|importante|prioridad alta|alta prioridad|sin prisa|baja prioridad|cuando pueda)\b/gi, '').trim().replace(/\s+/g, ' ');
      if (!texto) texto = t;
      const item = await this.memory.putItem({ type: 'tarea', texto, prio, done: false });
      return this._ok('crear_tarea', `Tarea agregada: "${texto}"${prio !== 'media' ? ' (prioridad ' + prio + ')' : ''}.`,
        { action: 'refresh', tab: 'tareas', item, utterance: t });
    }

    return { handled: false };
  }

  /* -------- Consultas de lectura -------- */
  async _detectQuery(low) {
    if (/\b(qu[eé] (tengo|hay).*(pendiente|tarea)|mis tareas|tareas pendientes|qu[eé] tareas)\b/.test(low)) {
      const pend = (await this.memory.listItems('tarea')).filter((t) => !t.done);
      const reply = pend.length
        ? `Tienes ${pend.length} tarea${pend.length > 1 ? 's' : ''} pendiente${pend.length > 1 ? 's' : ''}: ${pend.slice(0, 6).map((t) => t.texto).join(', ')}.`
        : 'No tienes tareas pendientes.';
      return this._ok('consulta_tareas', reply, { action: 'open', tab: 'tareas' });
    }
    if (/\b(l[eé]eme|mis notas|qu[eé] notas|ver notas)\b/.test(low)) {
      const notas = await this.memory.listItems('nota');
      const reply = notas.length
        ? `Tus últimas notas: ${notas.slice(0, 5).map((n) => n.texto).join('. ')}.`
        : 'Aún no tienes notas.';
      return this._ok('consulta_notas', reply, { action: 'open', tab: 'notas' });
    }
    if (/\b(mi agenda|mis eventos|qu[eé] eventos|qu[eé] tengo hoy|qu[eé] hay hoy|agenda de hoy|ver mi agenda|ver agenda)\b/.test(low)) {
      const hoy = ymd(new Date());
      const evs = (await this.memory.listItems('evento')).filter((e) => e.fecha >= hoy)
        .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
      const reply = evs.length
        ? `Próximos eventos: ${evs.slice(0, 5).map((e) => `${e.titulo} el ${fechaCorta(e.fecha)}${e.hora ? ' a las ' + e.hora : ''}`).join('; ')}.`
        : 'No tienes eventos próximos.';
      return this._ok('consulta_eventos', reply, { action: 'open', tab: 'eventos' });
    }
    if (/\b(mis alarmas|qu[eé] alarmas|mis recordatorios)\b/.test(low)) {
      const al = (await this.memory.listItems('alarma')).filter((a) => a.activa).sort((a, b) => a.ts - b.ts);
      const reply = al.length
        ? `Tienes ${al.length} recordatorio${al.length > 1 ? 's' : ''}: ${al.slice(0, 5).map((a) => `${a.texto} ${cuando(a.ts)}`).join('; ')}.`
        : 'No tienes alarmas activas.';
      return this._ok('consulta_alarmas', reply, { action: 'open', tab: 'alarmas' });
    }
    return null;
  }

  async _completeTaskByText(target) {
    const pend = (await this.memory.listItems('tarea')).filter((t) => !t.done);
    const norm = (s) => s.toLowerCase().replace(/[^\wáéíóúñ ]/gi, '');
    const nt = norm(target);
    const match = pend.find((t) => norm(t.texto).includes(nt) || nt.includes(norm(t.texto)));
    if (!match) return null;
    match.done = true;
    await this.memory.putItem(match);
    return this._ok('completar_tarea', `Marqué como hecha: "${match.texto}".`, { action: 'refresh', tab: 'tareas' });
  }

  _mapTab(word) {
    const map = {
      notas: 'notas', nota: 'notas', tareas: 'tareas', tarea: 'tareas', pendientes: 'tareas',
      agenda: 'eventos', calendario: 'eventos', eventos: 'eventos', evento: 'eventos',
      alarmas: 'alarmas', alarma: 'alarmas', recordatorios: 'alarmas', recordatorio: 'alarmas',
      ajustes: 'ajustes', 'configuración': 'ajustes', configuracion: 'ajustes'
    };
    return map[word] || 'tareas';
  }

  _ok(cmd, reply, extra = {}) {
    return Object.assign({ handled: true, cmd, reply, speak: reply }, extra);
  }
}

/* ============================================================
   Utilidades de fecha/hora en español (compartidas)
   ============================================================ */
export function fechaCorta(y) {
  const d = parseYmd(y);
  const t = ymd(new Date());
  const m = ymd(new Date(Date.now() + 864e5));
  if (y === t) return 'hoy';
  if (y === m) return 'mañana';
  return `${d.getDate()} de ${MESES[d.getMonth()]}`;
}
export function cuando(ts) {
  const d = new Date(ts), now = new Date();
  if (ymd(d) === ymd(now)) return 'hoy a las ' + hhmm(d);
  return `${fechaCorta(ymd(d))} a las ${hhmm(d)}`;
}
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function short(s) { return s.length > 42 ? s.slice(0, 42) + '…' : s; }

export function extraerTextoRecordatorio(t) {
  let x = t
    .replace(/^.*?\b(recu[eé]rdame|recuerda|av[ií]same|pon(?:me)?\s+(una|un)?\s*(alarma|recordatorio)|alarma|recordatorio)\b\s*(de|que|para)?\s*/i, '')
    .replace(/\b(a las?|para las?|en)\s+.*/i, '')
    .replace(/\b(el|este|pr[oó]ximo)?\s*(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/gi, '')
    .replace(/\b(hoy|mañana|pasado ma[ñn]ana|esta (tarde|noche|mañana)|al mediod[ií]a|a medianoche)\b/gi, '')
    .replace(/\s+/g, ' ').trim();
  return x || 'Recordatorio';
}

/* Días de la semana (sin acentos como clave) */
const WEEKDAYS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const noAccent = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/* Parser de expresiones horarias en español.
   Devuelve { ts, hasTime } o null. hasTime=false cuando solo se dio un día. */
export function parseHora(low) {
  const now = new Date();
  let base = new Date(now);
  let dayGiven = false;

  // Día relativo
  if (/\bpasado ma[ñn]ana\b/.test(low)) { base.setDate(base.getDate() + 2); dayGiven = true; }
  else if (/\bma[ñn]ana\b/.test(low)) { base.setDate(base.getDate() + 1); dayGiven = true; }

  // Día de la semana ("el lunes", "próximo martes")
  const wm = low.match(/\b(?:el|este|pr[oó]ximo|la)?\s*(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/);
  if (wm) {
    const target = WEEKDAYS[noAccent(wm[1])];
    let add = (target - base.getDay() + 7) % 7;
    if (add === 0) add = 7; // "el lunes" = el próximo, no hoy
    base.setDate(base.getDate() + add);
    dayGiven = true;
  }

  // "en N minutos/horas"
  let m = low.match(/\ben\s+(\d{1,3}|un|una|dos|tres|cuatro|cinco|diez|quince|veinte|treinta|media)\s*(minutos?|min|horas?|h)\b/);
  if (m) {
    const num = palabraNum(m[1]);
    const d = new Date(now);
    if (m[1] === 'media') d.setMinutes(d.getMinutes() + 30);
    else if (/hora|h/.test(m[2])) d.setHours(d.getHours() + num);
    else d.setMinutes(d.getMinutes() + num);
    return { ts: d.getTime(), hasTime: true };
  }

  // "a las 5", "a las 17:30", "a las 5 y media", "a las 5 de la tarde"
  m = low.match(/\ba\s+la[s]?\s+(\d{1,2})(?:\s*(?:[:.]|y)\s*(\d{1,2}|media|cuarto))?\s*(de la (mañana|tarde|noche)|am|pm|a\.m\.|p\.m\.)?/);
  if (!m) m = low.match(/\b(?:para las?)\s+(\d{1,2})(?:\s*(?:[:.]|y)\s*(\d{1,2}|media|cuarto))?\s*(de la (mañana|tarde|noche)|am|pm)?/);
  if (m) {
    let h = parseInt(m[1], 10);
    let min = 0;
    if (m[2]) { if (m[2] === 'media') min = 30; else if (m[2] === 'cuarto') min = 15; else min = parseInt(m[2], 10) || 0; }
    const suf = m[3] || '';
    if (/tarde|noche|pm|p\.m\./.test(suf) && h < 12) h += 12;
    if (/mañana|am|a\.m\./.test(suf) && h === 12) h = 0;
    base.setHours(h, min, 0, 0);
    if (base.getTime() <= Date.now() && !dayGiven) {
      if (!suf && h < 12) base.setHours(h + 12, min, 0, 0);
      if (base.getTime() <= Date.now()) base.setDate(base.getDate() + 1);
    }
    return { ts: base.getTime(), hasTime: true };
  }

  if (/\bmediod[ií]a\b/.test(low)) { base.setHours(12, 0, 0, 0); if (base <= now) base.setDate(base.getDate() + 1); return { ts: base.getTime(), hasTime: true }; }
  if (/\bmedianoche\b/.test(low)) { base.setHours(0, 0, 0, 0); if (base <= now) base.setDate(base.getDate() + 1); return { ts: base.getTime(), hasTime: true }; }

  // Solo se dio un día (sin hora explícita)
  if (dayGiven) { base.setHours(9, 0, 0, 0); return { ts: base.getTime(), hasTime: false }; }
  return null;
}
function palabraNum(w) {
  const map = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, diez: 10, quince: 15, veinte: 20, treinta: 30, media: 30 };
  return map[w] !== undefined ? map[w] : (parseInt(w, 10) || 0);
}

export default CommandRouter;
