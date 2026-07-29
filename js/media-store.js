/* ============================================================
   media-store.js
   Archivos de fotos y videos en OPFS (Origin Private File System):
   privados, en el dispositivo, sin límites prácticos de IndexedDB.
   Los METADATOS (descripción, tipo, miniatura, fecha) viven como
   ítems `type: 'media'` en el MemoryStore, así entran en la
   búsqueda semántica y en el export/import (los archivos en sí
   no se exportan; solo viajan sus descripciones y miniaturas).
   ============================================================ */

export class MediaStore {
  async _dir() {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle('media', { create: true });
  }

  static supported() {
    return !!(navigator.storage && navigator.storage.getDirectory);
  }

  async save(id, blob) {
    const dir = await this._dir();
    const fh = await dir.getFileHandle(id, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  }

  async get(id) {
    try {
      const dir = await this._dir();
      const fh = await dir.getFileHandle(id);
      return await fh.getFile();
    } catch (e) { return null; }
  }

  async remove(id) {
    try {
      const dir = await this._dir();
      await dir.removeEntry(id);
    } catch (e) {}
  }
}

export default MediaStore;
