import { loadDirectory, storeDirectory } from './directory.js';
import { makeFilename, uniqueFile } from './filename.js';
import { explainError } from './errors.js';

const $ = id => document.getElementById(id);
const jobs = new Map();
const MAX_LENGTH = 32 * 1024 * 1024;
let directory = null;
let writeQueue = Promise.resolve();
const channel = 'bili-frame-assistant';
let ownsAssistant = false;
let simulateNextFailure = false;

function status(text, failed = false) {
  $('status').textContent = text;
  $('status').dataset.error = String(failed);
}
async function refreshDirectory() {
  const permission = directory ? await directory.queryPermission({ mode: 'readwrite' }) : 'none';
  $('directory').textContent = directory ? `${directory.name} · ${permission === 'granted' ? '已授权，可保存' : '需要点击重新授权'}` : '尚未选择保存文件夹';
  return permission;
}
function release(id) {
  const job = jobs.get(id);
  if (job) { clearTimeout(job.timer); jobs.delete(id); }
  $('queue').textContent = `待处理截图：${jobs.size} / 3`;
}
function resetTimeout(id, job) {
  clearTimeout(job.timer);
  job.timer = setTimeout(() => { release(id); status('截图传输超时，请重新截图。', true); }, 60000);
}
async function processMessage(message, sender) {
  if (!ownsAssistant) throw new Error('当前助手未就绪，请保留一个助手标签页。');
  if (!/^https:\/\/www\.bilibili\.com\/video\//.test(sender.tab?.url || '')) throw new Error('不支持的来源。');
  if (typeof message.requestId !== 'string' || message.requestId.length > 80) throw new Error('无效请求。');
  const id = `${sender.tab.id}:${message.requestId}`;
  if (message.type === 'reserve') {
    if (!directory || await refreshDirectory() !== 'granted') throw new Error('请打开截图助手，选择保存文件夹或重新授权。');
    if (jobs.size >= 3) throw new Error('截图队列已满，请稍后重试。');
    if (jobs.has(id)) throw new Error('重复截图请求。');
    const job = { directory, chunks: [], received: 0, phase: 'reserved' };
    jobs.set(id, job); resetTimeout(id, job);
    $('queue').textContent = `待处理截图：${jobs.size} / 3`;
    return { ok: true };
  }
  const job = jobs.get(id);
  if (!job) throw new Error('截图请求已过期，请重新截图。');
  if (message.type === 'abort') { release(id); return { ok: true }; }
  resetTimeout(id, job);
  if (message.type === 'begin') {
    if (job.phase !== 'reserved' || !Number.isSafeInteger(message.length) || message.length < 1 || message.length > MAX_LENGTH) throw new Error('图片大小无效。');
    const m = message.meta;
    if (!m || !Number.isFinite(m.time) || !Number.isFinite(m.capturedAt) || !Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width < 1 || m.height < 1) throw new Error('图片元数据无效。');
    job.meta = m; job.length = message.length; job.phase = 'receiving';
    status(`正在接收 ${m.width} × ${m.height} 视频帧…`);
    return { ok: true };
  }
  if (message.type === 'chunk') {
    if (job.phase !== 'receiving' || message.offset !== job.received || typeof message.data !== 'string' || message.data.length > 512 * 1024 || !/^[A-Za-z0-9+/=]+$/.test(message.data) || job.received + message.data.length > job.length) throw new Error('图片数据顺序或大小错误。');
    job.chunks.push(message.data); job.received += message.data.length;
    return { ok: true };
  }
  if (message.type !== 'finish' || job.phase !== 'receiving' || job.received !== job.length) throw new Error('图片传输不完整。');
  job.phase = 'saving';
  clearTimeout(job.timer);
  const save = async () => {
    try {
      if (await job.directory.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('文件夹写入授权已失效，请重新授权。');
      const raw = atob(job.chunks.join(''));
      job.chunks = [];
      const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
      if (![137,80,78,71,13,10,26,10].every((byte, i) => bytes[i] === byte)) throw new Error('图片不是有效的 PNG 数据。');
      const blob = new Blob([bytes], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob);
      const dimensionsMatch = bitmap.width === job.meta.width && bitmap.height === job.meta.height;
      bitmap.close();
      if (!dimensionsMatch) throw new Error('PNG 尺寸校验失败。');
      if (simulateNextFailure) {
        simulateNextFailure = false;
        $('simulate').textContent = '模拟下一次保存失败';
        throw new Error('模拟保存失败：本次截图未创建文件。测试已自动结束，再次截图可正常保存。');
      }
      const { filename, handle } = await uniqueFile(job.directory, makeFilename(job.meta));
      const stream = await handle.createWritable();
      try { await stream.write(blob); await stream.close(); }
      catch (error) { await stream.abort().catch(() => {}); throw error; }
      const result = { ok: true, filename, width: job.meta.width, height: job.meta.height, time: job.meta.time, bytes: blob.size };
      status(`已保存：${filename}`);
      $('last').textContent = `${result.width} × ${result.height} · ${(blob.size / 1024 / 1024).toFixed(2)} MiB · ${job.directory.name}`;
      await chrome.storage.local.set({ lastResult: { ...result, at: Date.now() } }).catch(console.error);
      return result;
    } finally { release(id); }
  };
  const pending = writeQueue.then(save, save);
  writeQueue = pending.catch(() => {});
  return pending;
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.target !== 'assistant' || sender.id !== chrome.runtime.id || !ownsAssistant) return;
  if (message.type === 'ping') {
    if (sender.tab?.url?.startsWith('https:')) return;
    refreshDirectory().then(permission => reply({ ok: true, name: directory?.name || '', permission, pending: jobs.size }), error => reply({ ok: false, error: error.message }));
    return true;
  }
  processMessage(message, sender).then(reply, error => {
    release(`${sender.tab?.id}:${message.requestId}`);
    status(explainError(error), true);
    reply({ ok: false, error: explainError(error) });
  });
  return true;
});

function action(id, callback) {
  $(id).addEventListener('click', async () => {
    $(id).disabled = true;
    try { await callback(); }
    catch (error) { if (error.name !== 'AbortError') status(explainError(error), true); }
    finally { $(id).disabled = false; }
  });
}
action('choose', async () => {
  const selected = await showDirectoryPicker({ mode: 'readwrite', id: 'bili-screenshots' });
  await storeDirectory(selected);
  directory = selected;
  await refreshDirectory();
  status('目录已保存。可以点击“试写验证”，或切回 B 站按快捷键。');
});
action('authorize', async () => {
  if (!directory) throw new Error('请先选择保存文件夹。');
  const permission = await directory.requestPermission({ mode: 'readwrite' });
  await refreshDirectory();
  if (permission !== 'granted') throw new Error('未获得目录写入权限。');
  status('目录授权成功。');
});
action('probe', async () => {
  if (!directory || await refreshDirectory() !== 'granted') throw new Error('请先选择并授权保存目录。');
  const name = `bili-capture-write-test-${Date.now()}.txt`;
  const file = await directory.getFileHandle(name, { create: true });
  const stream = await file.createWritable();
  try { await stream.write('Bilibili screenshot directory write test\n' + new Date().toISOString()); await stream.close(); }
  catch (error) { await stream.abort().catch(() => {}); throw error; }
  status(`试写成功：${name}`);
});
action('simulate', async () => {
  if (jobs.size) throw new Error('请等待所有截图保存完成后再开始失败验证。');
  simulateNextFailure = !simulateNextFailure;
  $('simulate').textContent = simulateNextFailure ? '取消模拟失败' : '模拟下一次保存失败';
  status(simulateNextFailure ? '测试已开启：下一张进入保存步骤的截图会模拟失败，不创建文件；随后自动恢复。' : '已取消模拟失败。');
});
action('shortcuts', async () => {
  const response = await chrome.runtime.sendMessage({ target: 'background', type: 'shortcuts' });
  if (!response?.ok) throw new Error(response?.error || '请手动打开浏览器扩展快捷键页面。');
});
async function refreshTabs() {
  const previous = $('video-tabs').value;
  const tabs = (await chrome.tabs.query({ url: 'https://www.bilibili.com/video/*' })).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  $('video-tabs').replaceChildren();
  for (const tab of tabs) {
    const option = document.createElement('option');
    option.value = tab.id; option.textContent = tab.title || tab.url;
    $('video-tabs').append(option);
  }
  if (tabs.some(tab => String(tab.id) === previous)) $('video-tabs').value = previous;
  if (!tabs.length) {
    const option = document.createElement('option'); option.value = ''; option.textContent = '请先打开 Bilibili 视频页'; $('video-tabs').append(option);
  }
}
action('refresh', refreshTabs);
action('capture', async () => {
  const tabId = Number($('video-tabs').value);
  if (!tabId) throw new Error('请先打开并选择一个 Bilibili 视频标签页。');
  status('正在截图…');
  const response = await chrome.runtime.sendMessage({ target: 'background', type: 'capture-tab', tabId });
  if (!response?.ok) throw new Error(response?.error || '截图失败。');
});
async function refreshShortcut() {
  const commands = await chrome.commands.getAll();
  $('shortcut').textContent = commands.find(command => command.name === 'capture-frame')?.shortcut || '未绑定，请修改快捷键';
}
window.addEventListener('focus', () => { refreshShortcut().catch(console.error); refreshDirectory().catch(console.error); });
async function initialize() {
  directory = await loadDirectory();
  await Promise.all([refreshDirectory(), refreshShortcut(), refreshTabs()]);
  const stored = await chrome.storage.local.get('lastResult');
  if (stored.lastResult) $('last').textContent = `最近结果：${stored.lastResult.ok ? stored.lastResult.filename : stored.lastResult.error}`;
  $('runtime').textContent = `${navigator.userAgent} · 扩展 ${chrome.runtime.getManifest().version}`;
  status('助手已就绪。请保留此标签页，可以放在后台。');
}
// A Web Lock prevents two assistant pages from acknowledging or writing the same frame.
navigator.locks.request(channel, { ifAvailable: true }, async lock => {
  if (!lock) {
    status('已有另一个截图助手在运行。请使用原助手，或关闭原助手后刷新本页。', true);
    document.querySelectorAll('button').forEach(button => { button.disabled = true; });
    return;
  }
  await initialize();
  ownsAssistant = true;
  await new Promise(() => {});
}).catch(error => { ownsAssistant = false; status(`初始化失败：${error.message}`, true); });
