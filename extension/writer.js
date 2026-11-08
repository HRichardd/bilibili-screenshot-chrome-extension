import { loadDirectory } from './directory.js';
import { uniqueFile, makeFilename } from './filename.js';
import { explainError } from './errors.js';
const jobs = new Map();
let queue = Promise.resolve();
let simulated = false;
let directoryLease = null;
export async function writerStatus() {
  const directory = directoryLease = await loadDirectory();
  return { ok: true, name: directory?.name || '', permission: directory ? await directory.queryPermission({ mode: 'readwrite' }) : 'none', pending: jobs.size, mode: 'offscreen', capabilities: {
    indexedDB: typeof indexedDB !== 'undefined', createImageBitmap: typeof createImageBitmap === 'function',
    fileHandle: typeof FileSystemFileHandle !== 'undefined', writable: typeof FileSystemFileHandle !== 'undefined' && typeof FileSystemFileHandle.prototype.createWritable === 'function'
  } };
}
export function toggleSimulation() {
  if (jobs.size) throw new Error('请等待截图保存完成后再进行故障验证。');
  simulated = !simulated; return { ok: true, enabled: simulated };
}
function release(id) { const job = jobs.get(id); if (job) clearTimeout(job.timer); jobs.delete(id); }
function touch(id, job) { clearTimeout(job.timer); job.timer = setTimeout(() => release(id), 60000); }
export async function processFrame(message, sender) {
  if (!/^https:\/\/www\.bilibili\.com\/video\//.test(sender.tab?.url || '')) throw new Error('不支持的来源。');
  if (typeof message.requestId !== 'string' || message.requestId.length > 80) throw new Error('无效请求。');
  const id = `${sender.tab.id}:${message.requestId}`;
  if (message.type === 'reserve') {
    const directory = directoryLease = await loadDirectory();
    if (!directory) throw new Error('未找到保存目录，请打开截图设置选择目录。');
    const permission = await directory.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('保存目录未授权，请打开截图设置点击“重新授权”。授权完成后可以关闭设置页。');
    if (jobs.size >= 3) throw new Error('截图队列已满，本次截图未接收，请稍后重试。');
    if (jobs.has(id)) throw new Error('重复请求。');
    const job = { directory, chunks: [], received: 0, phase: 'reserved' };
    jobs.set(id, job); touch(id, job); return { ok: true };
  }
  const job = jobs.get(id);
  if (!job) throw new Error('截图请求已过期或后台已重新启动，请重新截图。');
  if (message.type === 'abort') { release(id); return { ok: true }; }
  if (message.type === 'begin') {
    if (job.phase !== 'reserved' || !Number.isSafeInteger(message.length) || message.length < 1 || message.length > 32 * 1024 * 1024) throw new Error('图片大小无效。');
    const m = message.meta;
    if (!m || !Number.isFinite(m.time) || !Number.isFinite(m.capturedAt) || !Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width < 1 || m.height < 1) throw new Error('图片元数据无效。');
    job.meta = m; job.length = message.length; job.phase = 'receiving'; touch(id, job); return { ok: true };
  }
  if (message.type === 'chunk') {
    if (job.phase !== 'receiving' || message.offset !== job.received || typeof message.data !== 'string' || message.data.length > 512 * 1024 || !/^[A-Za-z0-9+/=]+$/.test(message.data) || job.received + message.data.length > job.length) throw new Error('图片传输错误。');
    job.chunks.push(message.data); job.received += message.data.length; touch(id, job); return { ok: true };
  }
  if (message.type !== 'finish' || job.phase !== 'receiving' || job.received !== job.length) throw new Error('图片传输不完整。');
  job.phase = 'saving'; clearTimeout(job.timer);
  const save = async () => {
    try {
      if (await job.directory.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('后台目录权限已失效，请打开截图设置重新授权。');
      const raw = atob(job.chunks.join('')); job.chunks = [];
      const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
      if (![137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)) throw new Error('图片不是有效 PNG。');
      const blob = new Blob([bytes], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob);
      const valid = bitmap.width === job.meta.width && bitmap.height === job.meta.height; bitmap.close();
      if (!valid) throw new Error('PNG 尺寸校验失败。');
      if (simulated) { simulated = false; throw new Error('模拟保存失败：未创建图片，再次截图恢复正常。'); }
      const { filename, handle } = await uniqueFile(job.directory, makeFilename(job.meta));
      const stream = await handle.createWritable();
      try { await stream.write(blob); await stream.close(); } catch (error) { await stream.abort().catch(() => {}); throw error; }
      const result = { ok: true, filename, width: job.meta.width, height: job.meta.height, time: job.meta.time, bytes: blob.size, mode: 'offscreen' };
      await chrome.runtime.sendMessage({ target: 'background', type: 'writer-result', result }).catch(console.error); return result;
    } finally { release(id); }
  };
  const result = queue.then(save, save); queue = result.catch(() => {}); return result;
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.target === 'offscreen-control' && sender.id === chrome.runtime.id && !sender.tab?.url?.startsWith('https:')) {
    (message.type === 'status' ? writerStatus() : message.type === 'simulate' ? Promise.resolve().then(toggleSimulation) : Promise.reject(new Error('未知控制消息')))
      .then(reply, error => reply({ ok: false, error: explainError(error) }));
    return true;
  }
  if (message.target !== 'assistant' || sender.id !== chrome.runtime.id) return;
  processFrame(message, sender).then(reply, error => { release(`${sender.tab?.id}:${message.requestId}`); reply({ ok: false, error: explainError(error) }); });
  return true;
});
