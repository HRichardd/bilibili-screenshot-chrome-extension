let database;
async function db() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('bili-frame-capture', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}
export async function loadDirectory() {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('settings').objectStore('settings').get('directory');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}
export async function storeDirectory(handle) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('settings', 'readwrite');
    tx.objectStore('settings').put(handle, 'directory');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('目录保存事务被取消。'));
  });
}
