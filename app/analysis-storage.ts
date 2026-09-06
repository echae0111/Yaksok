const DB_NAME = "yaksok-analysis-cache";
const STORE_NAME = "results";
const LAST_DOCUMENT = "last-document";

export type SavedDocument<A, M> = {
  format: 1;
  hash: string;
  file: Blob;
  fileName: string;
  lastModified: number;
  analysis: A;
  messages: M[];
};

function openCache() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Resolve writes only after the entire transaction has committed, including quota errors.
async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const db = await openCache();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    let value: T;
    transaction.oncomplete = () => { db.close(); resolve(value); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error("저장하지 못했어요.")); };
    transaction.onerror = () => { /* The abort event reports the failure. */ };
    try { run(transaction.objectStore(STORE_NAME), (result) => { value = result; }); }
    catch (error) { transaction.abort(); db.close(); reject(error); }
  });
}

export async function getCachedAnalysis<T>(key: string): Promise<T | null> {
  try {
    return await transact<T | null>("readonly", (store, result) => {
      store.get(key).onsuccess = (event) => result((event.target as IDBRequest<T>).result ?? null);
    });
  } catch { return null; }
}

export async function setCachedAnalysis<T>(key: string, value: T): Promise<boolean> {
  try {
    await transact<void>("readwrite", (store) => { store.put(value, key); });
    return true;
  } catch { return false; }
}

export async function documentHash(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validDocument<A, M>(value: SavedDocument<A, M> | null | undefined): value is SavedDocument<A, M> {
  return !!value && value.format === 1 && value.file instanceof Blob && !!value.analysis && Array.isArray(value.messages);
}

export async function getSavedDocument<A, M>(hash: string) {
  const value = await getCachedAnalysis<SavedDocument<A, M>>(`document:${hash}`);
  return validDocument(value) ? value : null;
}

export async function restoreLastDocument<A, M>(): Promise<SavedDocument<A, M> | null> {
  try {
    return await transact("readonly", (store, result) => {
      store.get(LAST_DOCUMENT).onsuccess = (event) => {
        const hash = (event.target as IDBRequest<string>).result;
        if (!hash) { result(null); return; }
        store.get(`document:${hash}`).onsuccess = (documentEvent) => {
          const value = (documentEvent.target as IDBRequest<SavedDocument<A, M>>).result;
          result(validDocument(value) ? value : null);
        };
      };
    });
  } catch { return null; }
}

export async function saveDocument<A, M>(hash: string, file: File, analysis: A): Promise<SavedDocument<A, M>> {
  return transact("readwrite", (store, result) => {
    const key = `document:${hash}`;
    store.get(key).onsuccess = (event) => {
      const existing = (event.target as IDBRequest<SavedDocument<A, M>>).result;
      // First completed analysis wins even if two tabs analyze the same file at once.
      const value: SavedDocument<A, M> = validDocument(existing) ? existing : {
        format: 1, hash, file, fileName: file.name, lastModified: file.lastModified, analysis, messages: [],
      };
      store.put(value, key);
      store.put(hash, LAST_DOCUMENT);
      result(value);
    };
  });
}

export async function saveMessages<M>(hash: string, messages: M[]) {
  return transact<void>("readwrite", (store) => {
    const key = `document:${hash}`;
    store.get(key).onsuccess = (event) => {
      const document = (event.target as IDBRequest<SavedDocument<unknown, M>>).result;
      if (!validDocument(document)) { store.transaction.abort(); return; }
      store.put({ ...document, messages }, key);
    };
  });
}

export async function clearLastDocument() {
  try {
    await transact<void>("readwrite", (store) => { store.delete(LAST_DOCUMENT); });
    return true;
  } catch { return false; }
}
