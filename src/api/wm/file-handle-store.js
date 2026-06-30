// file-handle-store.js — IndexedDB store for FileSystemFileHandles keyed by window id.
//
// A FileSystemFileHandle survives a page reload (unlike a blob URL), so a file-backed
// window can be reopened on project load. Two consumers: the in-window file browser
// (file-browser flow) and wm's _restoreFileWindow (project restore). Two consumers =
// a real seam — extracted from wm.js (ADR: extract embedded renderers). Leaf: depends
// only on the global indexedDB, no wm/DOM coupling, so it is testable with a fake IDB.

const _IDB_NAME = 'vl-wm-handles';
const _IDB_STORE = 'handles';

function _openHandleDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB_NAME, 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(_IDB_STORE);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function storeWinHandle(winId, handle) {
  try {
    const db = await _openHandleDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(_IDB_STORE, 'readwrite');
      tx.objectStore(_IDB_STORE).put(handle, winId);
      tx.oncomplete = res;
      tx.onerror = rej;
    });
    db.close();
  } catch (_) {}
}

export async function loadWinHandle(winId) {
  try {
    const db = await _openHandleDB();
    const handle = await new Promise((res, rej) => {
      const req = db.transaction(_IDB_STORE).objectStore(_IDB_STORE).get(winId);
      req.onsuccess = () => res(req.result ?? null);
      req.onerror = rej;
    });
    db.close();
    return handle;
  } catch (_) {
    return null;
  }
}

export async function deleteWinHandle(winId) {
  try {
    const db = await _openHandleDB();
    const tx = db.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).delete(winId);
    db.close();
  } catch (_) {}
}
