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
  constructor(memory) {
    this.memory = memory;
    this.semantic = null; // SemanticMemory (lo conecta app.js) para buscar fotos por significado
  }

  /* Punto de entrada. Devuelve un objeto de resultado o {handled:false}. */
  async handle(rawText) {
    const t = (rawText || '').trim();
    if (!t) return { handled: false };
    const low = t.toLowerCase();

    // --- Fotos y videos: buscar por descripción / abrir cámara ---
    let m = t.match(/\b(?:mu[ée]strame|ens[ée][ñn]ame|busca(?:me)?|ver|encuentra)\s+(?:las?\s+|los?\s+|mis\s+)?(fotos?|videos?|im[áa]genes?)\s+(?:de la|del|de|con|sobre)\s+(.+)$/i);
    if (m) {
      const kind = /video/i.test(m[1]) ? 'video' : 'foto';
      const qy = m[2].trim().replace(/[.?!]$/, '');
      const res = await this._searchMedia(qy, /imagen|foto/i.test(m[1]) ? 'foto' : (/video/i.test(m[1]) ? 'video' : null));
      if (!res.length)
        return this._ok('buscar_media', `No encontré ${m[1]} que coincidan con "${qy}".`, { action: 'open', tab: 'media' });
      return this._ok('buscar_media', `Encontré ${res.length} ${res.length === 1 ? (kind === 'video' ? 'video' : 'foto') : m[1]} de ${qy}. Te ${res.length === 1 ? 'lo' : 'los'} muestro.`,
        { action: 'media', tab: 'media', mediaIds: res.map((r) => r.id), utterance: t });
    }
    if (/\b(?:toma(?:r)?|saca(?:r)?|haz)\s+(?:una\s+)?foto\b/.test(low) &&
        !/\b(tengo que|debo|recu[eé]rdame|recuerda|av[ií]same|tarea|alarma|ma[ñn]ana)\b/.test(low))
      return this._ok('capturar_foto', 'Abriendo la galería: toca "Tomar foto".', { action: 'open', tab: 'media' });
    if (/\bgraba(?:r)?\s+(?:un\s+)?v[ií]deo\b/.test(low) &&
        !/\b(tengo que|debo|recu[eé]rdame|recuerda|tarea|alarma)\b/.test(low))
      return this._ok('capturar_video', 'Abriendo la galería: toca "Grabar video".', { action: 'open', tab: 'media' });

    // --- Navegación ---
    const nav = low.match(/\b(abre|abrir|ve a|mu[eé]strame|muestra|ir a)\s+(las?\s+|mis?\s+)?(notas?|tareas?|pendientes|agenda|calendario|eventos?|alarmas?|recordatorios?|fotos?|videos?|galer[ií]a|ajustes|configuraci[oó]n)/);
    if (nav) {
      const dest = this._mapTab(nav[3]);
      return this._ok('navegar', `Abriendo ${dest}.`, { action: 'open', tab: dest, silent: true });
    }

    // --- Contactos: guardar dato ("recuerda que el número de mamá es…") ---
    // (antes que las alarmas: "recuerda…" no debe crear un recordatorio aquí)
    m = t.match(/\b(?:recuerda|guarda|apunta)\s+(?:que\s+)?el\s+(n[úu]mero|tel[ée]fono|correo|email|mail)\s+de\s+(.+?)\s+(?:es|:)\s*(.+)$/i);
    if (m) {
      const esMail = /correo|email|mail/i.test(m[1]);
      const nombre = m[2].trim().replace(/^(mi|la|el)\s+/i, '');
      const valor = esMail ? m[3].trim().replace(/[.,;]$/, '') : m[3].replace(/[^\d+]/g, '');
      if (!valor) return this._ok('guardar_contacto', 'No capté el dato. ¿Me lo repites?');
      const prev = (await this._contacto(nombre)) || { type: 'contacto', id: 'ct_' + normName(nombre), nombre };
      if (esMail) prev.email = valor; else prev.telefono = valor;
      await this.memory.putItem(prev);
      return this._ok('guardar_contacto', `Guardado: el ${esMail ? 'correo' : 'número'} de ${prev.nombre} es ${valor}.`, { utterance: t });
    }

    // --- Contactos: consultar ---
    m = low.match(/\b(?:cu[áa]l es|dime|dame)\s+el\s+(n[úu]mero|tel[ée]fono|correo|email)\s+de\s+(.+)/);
    if (m) {
      const esMail = /correo|email/.test(m[1]);
      const c = await this._contacto(m[2].replace(/[.?!]$/, ''));
      if (!c || !(esMail ? c.email : c.telefono))
        return this._ok('consulta_contacto', `No tengo ese dato. Dime: "recuerda que el ${esMail ? 'correo' : 'número'} de ${m[2].trim().replace(/[.?!]$/, '')} es…".`);
      const valor = esMail ? c.email : c.telefono;
      return this._ok('consulta_contacto', `El ${esMail ? 'correo' : 'número'} de ${c.nombre} es ${valor}.`,
        esMail ? { link: 'mailto:' + valor, linkLabel: 'Escribir correo' } : { link: 'tel:' + valor, linkLabel: 'Llamar' });
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

    // --- Acción: llamar (deep link tel:) ---
    m = t.match(/\b(?:llama(?:r)?|ll[áa]male|marca(?:r)?)\s+(?:a|al)?\s*(.+)$/i);
    if (m && !/\b(se|me|te|le)\s+llama/i.test(low) && !/\b(nota|tarea|evento|alarma)\b/i.test(low)) {
      const dest = m[1].trim().replace(/^(mi|la|el)\s+/i, '').replace(/\s+por\s+tel[ée]fono$/i, '').replace(/[.?!]$/, '');
      if (/^[\d+\s.-]{6,}$/.test(dest)) {
        const num = dest.replace(/[^\d+]/g, '');
        return this._ok('llamar', `Llamada al ${num} preparada. Confirma con el botón.`,
          { link: 'tel:' + num, linkLabel: 'Llamar', utterance: t });
      }
      const c = await this._contacto(dest);
      if (c && c.telefono)
        return this._ok('llamar', `Llamada a ${c.nombre} preparada. Confirma con el botón.`,
          { link: 'tel:' + c.telefono, linkLabel: 'Llamar a ' + c.nombre, utterance: t });
      return this._ok('llamar', `No tengo el número de ${dest}. Elígelo de tus contactos o dime: "recuerda que el número de ${dest} es…".`,
        { pick: { accion: 'tel', nombre: dest }, utterance: t });
    }

    // --- Acción: mensaje (WhatsApp / SMS) con el texto ya escrito ---
    let msg = t.match(/\b(?:escr[íi]bele|env[íi]ale|m[áa]ndale|mandale)\s+(?:un\s+)?(?:mensaje\s+|sms\s+|whatsapp\s+|wasap\s+|texto\s+)?(?:por\s+whatsapp\s+|por\s+sms\s+|por\s+mensaje\s+)?a\s+(.+?)(?:\s+que\s+|\s*:\s*)(.+)$/i);
    if (!msg) msg = t.match(/\b(?:whatsapp|wasap)\s+(?:a|para)\s+(.+?)(?:\s+que\s+|\s*:\s*)(.+)$/i);
    if (msg) {
      const canal = /\bsms\b/i.test(low) ? 'sms' : 'wa';
      const nombre = msg[1].trim().replace(/^(mi|la|el)\s+/i, '');
      const body = msg[2].trim();
      const c = await this._contacto(nombre);
      if (c && c.telefono) {
        const link = canal === 'wa'
          ? 'https://wa.me/' + c.telefono.replace(/\D/g, '') + '?text=' + encodeURIComponent(body)
          : 'sms:' + c.telefono + '?body=' + encodeURIComponent(body);
        return this._ok('mensaje', `Mensaje para ${c.nombre} preparado: "${short(body)}". Solo te falta enviarlo.`,
          { link, linkLabel: canal === 'wa' ? 'Abrir WhatsApp' : 'Abrir SMS', utterance: t });
      }
      return this._ok('mensaje', `No tengo el número de ${nombre}. Elígelo de tus contactos o dime: "recuerda que el número de ${nombre} es…".`,
        { pick: { accion: canal, nombre, body }, utterance: t });
    }

    // --- Acción: correo (mailto:) ---
    m = t.match(/\b(?:correo|email|mail)\s+(?:a|para)\s+(.+?)(?:\s+asunto\s+(.+?))?(?:\s+(?:que\s+diga|diciendo|cuerpo)\s+(.+))?$/i);
    if (m) {
      const destRaw = m[1].trim().replace(/[.?!]$/, '');
      let addr = /\S+@\S+/.test(destRaw) ? destRaw : null;
      let quien = destRaw;
      if (!addr) {
        const c = await this._contacto(destRaw);
        if (c && c.email) { addr = c.email; quien = c.nombre; }
      }
      if (!addr)
        return this._ok('correo', `No tengo el correo de ${destRaw}. Dime: "recuerda que el correo de ${destRaw} es…".`, { utterance: t });
      const params = [];
      if (m[2]) params.push('subject=' + encodeURIComponent(m[2].trim()));
      if (m[3]) params.push('body=' + encodeURIComponent(m[3].trim()));
      return this._ok('correo', `Correo para ${quien} preparado.`,
        { link: 'mailto:' + addr + (params.length ? '?' + params.join('&') : ''), linkLabel: 'Abrir correo', utterance: t });
    }

    // --- Acción: mapas (buscar lugar o ruta) ---
    let dir = t.match(/\b(?:c[óo]mo\s+llego\s+a(?:l)?|ll[ée]vame\s+a(?:l)?)\s+(.+)$/i);
    let busca = !dir && (t.match(/\b(?:d[óo]nde\s+(?:queda|hay|est[áa]n?))\s+(.+)$/i)
      || t.match(/\bbusca(?:me)?\s+(.+?)\s+(?:en\s+(?:el\s+)?maps?|en\s+el\s+mapa|cerca(?:\s+de\s+m[íi])?)\s*[.?!]?$/i));
    if ((dir || busca) && !/\b(nota|tarea|evento|alarma|agenda)\b/i.test(low)) {
      const lugar = (dir ? dir[1] : busca[1]).trim().replace(/^(mi|la|el|un|una)\s+/i, '').replace(/[.?!¿]+$/, '');
      const url = dir
        ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(lugar)
        : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lugar);
      return this._ok('mapa', dir ? `Ruta a ${lugar} lista.` : `Búsqueda de "${lugar}" en el mapa lista.`,
        { link: url, linkLabel: 'Abrir Maps', utterance: t });
    }

    // --- Acción: música (YouTube) ---
    m = t.match(/\b(?:pon(?:me)?|reproduce|reprod[úu]ceme|quiero\s+escuchar)\s+(?:m[úu]sica\s+(?:de\s+)?|la\s+canci[óo]n\s+|algo\s+de\s+)(.+)$/i)
      || t.match(/\breproduce\s+(.+)$/i);
    if (m && !/\b(alarma|recordatorio|nota|tarea|evento)\b/i.test(low)) {
      const qy = m[1].trim().replace(/[.?!]$/, '');
      return this._ok('musica', `Música de ${qy} lista en YouTube.`,
        { link: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(qy), linkLabel: 'Abrir YouTube', utterance: t });
    }

    // --- Acción: búsqueda web ---
    m = t.match(/\b(?:busca(?:me)?\s+en\s+(?:internet|google|la\s+web)|googlea)\s+(.+)$/i);
    if (m) {
      const qy = m[1].trim().replace(/[.?!]$/, '');
      return this._ok('buscar_web', `Búsqueda de "${short(qy)}" preparada.`,
        { link: 'https://www.google.com/search?q=' + encodeURIComponent(qy), linkLabel: 'Buscar en Google', utterance: t });
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

  /* Busca fotos/videos por descripción: coincidencia de texto + semántica */
  async _searchMedia(query, kind) {
    const all = (await this.memory.listItems('media')).filter((x) => !kind || x.kind === kind);
    const q = normName(query);
    const sub = all.filter((x) => normName(x.descripcion || '').includes(q));
    let sem = [];
    if (this.semantic && this.semantic.ready) {
      try {
        sem = (await this.semantic.search(query, 12, 0.74))
          .filter((r) => r.type === 'media')
          .map((r) => all.find((x) => x.id === r.id))
          .filter(Boolean);
      } catch (e) {}
    }
    const seen = new Set();
    return [...sub, ...sem].filter((x) => !seen.has(x.id) && seen.add(x.id));
  }

  /* -------- Contactos en memoria (mini-agenda local) -------- */
  async _contacto(nombre) {
    const q = normName(nombre);
    if (!q) return null;
    const all = await this.memory.listItems('contacto');
    return all.find((c) => normName(c.nombre) === q)
      || all.find((c) => normName(c.nombre).includes(q) || q.includes(normName(c.nombre)));
  }

  _mapTab(word) {
    const map = {
      notas: 'notas', nota: 'notas', tareas: 'tareas', tarea: 'tareas', pendientes: 'tareas',
      agenda: 'eventos', calendario: 'eventos', eventos: 'eventos', evento: 'eventos',
      alarmas: 'alarmas', alarma: 'alarmas', recordatorios: 'alarmas', recordatorio: 'alarmas',
      fotos: 'media', foto: 'media', videos: 'media', video: 'media', 'galería': 'media', galeria: 'media',
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

/* Normaliza nombres para comparar contactos (sin acentos ni signos) */
export const normName = (s) => (s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').trim();

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
