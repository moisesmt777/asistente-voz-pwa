# 🗺️ Hoja de ruta — Asistente de voz con los mejores avances

Guía por fases para llevar tu asistente desde la base que ya construimos hasta un nivel **best‑in‑class**: IA en el dispositivo, voz precisa, wake word real y memoria que se adapta a ti. Está ordenada por **impacto ÷ esfuerzo**: cada fase deja algo funcionando y útil por sí sola, así nunca te quedas con algo a medias.

Marca cada casilla `[ ]` → `[x]` conforme avances.

> **Estado — 28 jul 2026:**
> · **Fase 0** ✅ COMPLETA: repo en https://github.com/moisesmt777/asistente-voz-pwa, app en https://moisesmt777.github.io/asistente-voz-pwa/, instalada y probada en el teléfono (POCO X8 Pro Max).
> · **Fase 1** ✅ COMPLETA: Qwen3 1.7B corriendo en el dispositivo, confirmado.
> · **Fase 2A** ⏸️ código integrado y EN ESPERA: Picovoice exige correo de empresa para crear la cuenta. Cuando lo tengas: AccessKey en Ajustes + entrenar keyword `asistente` (`.ppn` → `assets/porcupine/`). Mientras, funciona la escucha continua.
> · **Fase 3** ✅ implementada en código (RAG local con multilingual‑e5‑small, panel de Aprendizaje, exportar/importar) — pendiente de probar en tu teléfono.
> · **Rediseño UI (v1.4.0):** pantalla principal tipo launcher (iconos de colores con contadores: Tareas, Notas, Agenda, Recordatorios, Conversación, Ajustes); el orbe se acerca al icono de lo que estés usando; la conversación vive en su propio panel; iconografía SVG profesional (sin emojis).

---

## Punto de partida (lo que YA tienes)

Tu repositorio `asistente-voz-pwa` ya usa la vía más avanzada disponible: **PWA offline‑first**, **WebLLM** (LLM en WebGPU) con **cerebro de reglas de respaldo**, **Web Speech API** (STT/TTS), adaptador **Whisper** preparado, **memoria en IndexedDB** y **prompting adaptativo**. La hoja de ruta parte de aquí y sube el listón.

**Requisitos generales que conviene tener a mano:**
- Un teléfono Android con **Chrome reciente** y, para el LLM local, **WebGPU** (gama media‑alta con ~6 GB de RAM o más).
- La app servida por **HTTPS** (GitHub Pages o Vercel) — sin esto no hay voz ni instalación.
- Espacio de almacenamiento: los modelos se descargan una vez (~1 GB el LLM) y se cachean.

---

## FASE 0 — Publicar y tenerlo en el teléfono (base sólida)

**Objetivo:** que el asistente actual viva online y quede instalado como app en tu Android.

- [x] Subir el repositorio a GitHub. *(Hecho el 28‑jul‑2026 → https://github.com/moisesmt777/asistente-voz-pwa)*
- [x] Activar el despliegue. *(Hecho: Settings → Pages → Source: **Deploy from a branch** → `main` / root. Nota: se usó esta vía en lugar de GitHub Actions porque subir `deploy.yml` requiere un token con scope `workflow`; el resultado es idéntico. **No cambiar a "GitHub Actions"** sin subir antes el workflow.)*
- [x] Abrir la URL `https://moisesmt777.github.io/asistente-voz-pwa/` en Chrome de Android. *(28‑jul‑2026, POCO X8 Pro Max)*
- [x] Instalarla: *⋮ → Instalar aplicación*. Conceder micrófono y notificaciones.
- [x] Probar en modo avión que sigue funcionando (offline‑first).

**Listo cuando:** puedes crear notas/tareas/alarmas por voz desde el ícono de tu pantalla de inicio, incluso sin internet.

---

## FASE 1 — El cerebro de verdad: LLM local multilingüe

**Objetivo:** pasar del cerebro de reglas a un modelo de lenguaje real en el dispositivo, para conversar y entender pedidos libres, no solo comandos.

**Tecnología:** WebLLM + **Qwen3 1.7B** (el mejor equilibrio español/tamaño para teléfono). Alternativas: **Gemma 3 1B** (equipos modestos) o **Phi‑4 Mini 3.8B** (gama alta).

- [x] En `ai-brain.js`, fijar el modelo por defecto a Qwen3 1.7B. *(Hecho: ID verificado `Qwen3-1.7B-q4f16_1-MLC` en WebLLM **0.2.84**; la versión de la librería quedó fijada en el import para que los IDs no se rompan con el tiempo.)*
- [x] Añadir Gemma 3 1B y Phi‑4 Mini a la lista de modelos seleccionables en Ajustes. *(Hecho: `gemma3-1b-it-q4f16_1-MLC` —el más ligero, 0.7 GB de VRAM— y `Phi-4-mini-instruct-q4f16_1-MLC`. Bonus: Qwen3 0.6B y **Qwen3.5 2B**, última generación.)*
- [x] Mostrar barra de progreso de descarga (ya está el gancho `initProgressCallback`). *(Ya venía cableada en Ajustes; además ahora la app **reactiva automáticamente** el último modelo usado al arrancar, con progreso en la cabecera.)*
- [x] Probar en tu teléfono: descargar el modelo una vez y confirmar que responde en español con la app cerrada de internet. *(Confirmado el 28‑jul‑2026 en el POCO X8 Pro Max)*
- [x] Ajustar `temperature`/`max_tokens` para respuestas breves aptas para leer en voz alta. *(0.6 / 256; a los Qwen3 se les desactiva además el "razonamiento" `<think>` para que la voz no lo lea.)*

**Listo cuando:** le puedes preguntar cosas abiertas ("resúmeme mis tareas de hoy y sugiéreme por cuál empezar") y responde con criterio, offline.

---

## FASE 2 — Voz de nivel profesional

**Objetivo:** wake word real, reconocimiento más preciso y una voz más natural.

### 2A. Palabra de activación con Porcupine (Picovoice)
Reemplaza la "escucha continua" actual (que gasta batería) por detección neuronal eficiente.

- [ ] Crear una cuenta gratuita en **Picovoice Console** y obtener un **AccessKey**. *(Tu paso: la AccessKey se pega en Ajustes → 👂 Palabra de activación y **solo se guarda en tu dispositivo**, nunca en el repo.)*
- [x] Integrar `@picovoice/porcupine-web` (corre en WASM en el navegador). *(Hecho: `porcupine-web@4.0.1` + `web-voice-processor@4.0.10` fijados por CDN; modelo base español v3.0 ~1 MB cacheado offline por el SW; el SDK guarda modelo y keyword en IndexedDB.)*
- [ ] Entrenar la palabra clave **"asistente"** en Console (idioma **Español**, plataforma **Web/WASM**) y guardar el archivo como `assets/porcupine/asistente_es_wasm.ppn` (instrucciones en el README de esa carpeta).
- [x] Definir la palabra clave y conectar su evento a `startListening()`. *(Código listo: detección → pausa Porcupine → evento `wake` → escucha; se reanuda al volver a reposo, sin pelear por el micrófono con el STT ni el TTS.)*
- [x] Sustituir el wake word basado en Web Speech por este. *(Con retroceso automático: si falta la AccessKey o el `.ppn`, se usa la escucha continua de siempre; el motor se elige en Ajustes: Auto / Porcupine / Web Speech.)*

**Listo cuando:** dices tu palabra clave con la pantalla encendida y el asistente despierta, sin drenar la batería.

### 2B. STT preciso con Whisper en segundo plano
Para dictados largos o entornos ruidosos, más exacto que la Web Speech API.

- [ ] Mover la transcripción Whisper a un **Web Worker** (patrón `browser‑whisper`) para no congelar la interfaz.
- [ ] Usar `whisper-base` o `whisper-small` cuantizado según el teléfono.
- [ ] Dejar la Web Speech API como opción rápida por defecto y Whisper como modo "alta precisión" en Ajustes (ya existe el selector).

**Listo cuando:** puedes elegir "alta precisión", dictar una nota larga y transcribe bien sin trabar la app.

### 2C. Voz más humana con Kokoro TTS (opcional)
- [ ] Integrar **Kokoro TTS** (vía ONNX/Transformers.js, p. ej. `kokoro-js`) como voz offline de alta calidad.
- [ ] Mantener `SpeechSynthesis` nativa como respaldo sin descarga.

**Listo cuando:** el asistente te habla con una voz natural aunque estés sin internet.

---

## FASE 3 — Que se adapte a ti (memoria + aprendizaje)

**Objetivo:** que el asistente recuerde, personalice y "aprenda" de tu uso — el corazón de tu idea original.

- [x] Reforzar el **prompting adaptativo** ya existente: inyectar tus preferencias, tus comandos más usados y tu contexto (tareas/eventos) en cada respuesta. *(Hecho: además, los recuerdos recuperados por significado se inyectan al system prompt y el tono del asistente es editable en Ajustes → Aprendizaje.)*
- [x] Añadir **búsqueda semántica local (RAG)** sobre tus notas: generar *embeddings* con Transformers.js (modelo multilingüe pequeño, p. ej. `multilingual-e5-small`) y guardarlos en IndexedDB, para que responda "¿qué anoté sobre el proveedor?" buscando por significado. *(Hecho: `Xenova/multilingual-e5-small` cuantizado ~110 MB —descarga única activable en Ajustes—; prefijos query/passage, similitud coseno; indexa notas, tareas, eventos y alarmas al vuelo. Sin LLM también responde "¿qué anoté sobre…?" directamente con los recuerdos.)*
- [x] Guardar blobs grandes (audios, modelos) en **OPFS** en vez de IndexedDB. *(N/A por ahora: la app no persiste blobs propios — los modelos los cachean el navegador y las librerías, y los audios no se guardan. Se retomará si Kokoro/Whisper locales lo necesitan.)*
- [x] Panel de "Aprendizaje": ver y editar lo que el asistente ha memorizado sobre ti (transparencia y control). *(Card en Ajustes: tono, comandos más usados con su feedback, estado del índice semántico con reindexado y "olvidar estadísticas".)*
- [x] Exportar/importar tu memoria (respaldo cifrado opcional). *(JSON con ítems, historial, preferencias y estadísticas; los vectores se regeneran reindexando tras importar. Cifrado: pendiente como opcional.)*
- [ ] Probar en tu teléfono: activar la búsqueda semántica en Ajustes → Aprendizaje, crear un par de notas y preguntar "¿qué anoté sobre…?".

**Listo cuando:** notas que responde cada vez más "a tu medida" y puede recuperar información pasada por significado, no solo por palabra exacta.

---

## FASE 4 — Robustez de producción (PWA sólida)

**Objetivo:** que sea estable, actualizable y cómoda en el día a día.

- [ ] Migrar el Service Worker a **Workbox** (precache versionado, rutas y limpieza automáticas).
- [ ] Manejo de **actualizaciones**: avisar "hay una versión nueva" y recargar con `SKIP_WAITING`.
- [ ] Gestión de **cuota de almacenamiento** y aviso si falta espacio para el modelo.
- [ ] Afinar **notificaciones** y alarmas; documentar la limitación de segundo plano.
- [ ] Probar en 2–3 teléfonos distintos (gama alta y media) y medir tiempos de respuesta.
- [ ] Añadir un modo "sin WebGPU" claro para que en teléfonos modestos siga siendo 100% útil con reglas.

**Listo cuando:** la usas a diario sin sustos, se actualiza sola y funciona bien en más de un dispositivo.

---

## FASE 5 — Futuro (opcional, gran alcance)

**Objetivo:** ir más allá de la PWA cuando lo desees.

- [ ] **"Otras apps con permiso"** (tu idea inicial): integrar servicios que autorices — p. ej. calendario de Google, correo o mensajería — mediante conectores, siempre con tu consentimiento explícito.
- [ ] **Alarmas en segundo plano reales**: requieren **Web Push + un servidor** (rompe el modelo 100% offline, pero es la única vía con la app cerrada).
- [ ] **App nativa Android** si buscas máximo rendimiento e integración: **MediaPipe LLM Inference** (Google) o **ExecuTorch** (Meta).
- [ ] **Acelerador Chrome**: usar la **IA integrada de Chrome (Gemini Nano, Prompt API)** cuando esté disponible, para respuestas sin descargar modelo.
- [ ] **Sincronización cifrada** entre tus dispositivos (extremo a extremo), opcional.

---

## Orden recomendado y esfuerzo

| Prioridad | Fase | Impacto | Esfuerzo |
|---|---|---|---|
| 1 | Fase 0 · Publicar e instalar | Alto (lo usas ya) | Bajo |
| 2 | Fase 1 · LLM local Qwen3 | Muy alto | Medio |
| 3 | Fase 2A · Wake word Porcupine | Alto | Medio |
| 4 | Fase 3 · Memoria/RAG | Alto | Medio‑alto |
| 5 | Fase 2B/2C · Whisper + Kokoro | Medio | Medio |
| 6 | Fase 4 · Robustez | Medio | Medio |
| 7 | Fase 5 · Futuro | Variable | Alto |

**Regla de oro:** completa la Fase 0 primero (tenerlo en la mano manda), luego la Fase 1 (el salto de "comandos" a "asistente inteligente"). Con esas dos ya tienes un asistente que impresiona; el resto es refinamiento.

---

## ¿Qué es "lo mejor posible" al terminar?

Un asistente que: se instala como app, funciona **sin internet**, te **entiende hablando en español** con un LLM que corre **en tu propio teléfono** (sin nube, sin costos, privado), **despierta por voz** con wake word eficiente, **te habla con voz natural**, y **se adapta** a tus hábitos recordando tu contexto. Es, literalmente, el tope de lo que la tecnología web permite hoy para un asistente personal.

---

*Stack de referencia: WebLLM + Qwen3 1.7B (WebGPU) · Porcupine (wake word) · Whisper/Web Speech (STT) · Kokoro/SpeechSynthesis (TTS) · Transformers.js + IndexedDB/OPFS (memoria y RAG) · Workbox (PWA).*
