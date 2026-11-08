import { loadDirectory, storeDirectory } from './directory.js';
import { explainError } from './errors.js';
const $ = id => document.getElementById(id);
let directory;
const send = (type, data = {}) => chrome.runtime.sendMessage({ target: 'background', type, ...data });
function status(text, failed = false) { $('status').textContent = text; $('status').dataset.error = String(failed); }
async function refreshDirectory() {
  directory = await loadDirectory();
  const permission = directory ? await directory.queryPermission({ mode: 'readwrite' }) : 'none';
  $('directory').textContent = directory ? `${directory.name} · ${permission === 'granted' ? '已授权' : '需要重新授权'}` : '尚未选择文件夹';
}
function action(id, fn) {
  $(id).addEventListener('click', async () => {
    $(id).disabled = true;
    try { await fn(); } catch (error) { if (error.name !== 'AbortError') status(explainError(error), true); }
    finally { $(id).disabled = false; }
  });
}
action('choose', async () => {
  const selected = await showDirectoryPicker({ mode: 'readwrite', id: 'bili-screenshots' });
  await storeDirectory(selected);
  const response = await send('ensure-writer');
  if (!response?.ok) throw new Error(response?.error || '隐藏保存文档创建失败');
  const ready = await send('writer-status');
  if (!ready?.ok || ready.permission !== 'granted') throw new Error(`隐藏文档没有获得写入权限：${ready?.permission || ready?.error || '未知'}`);
  await refreshDirectory(); status('保存目录已就绪。可以关闭设置页，在视频页用快捷键截图。');
});
action('authorize', async () => {
  if (!directory) throw new Error('请先选择目录。');
  await directory.requestPermission({ mode: 'readwrite' });
  const response = await send('ensure-writer');
  if (!response?.ok) throw new Error(response?.error || '隐藏保存文档创建失败');
  const ready = await send('writer-status');
  if (!ready?.ok || ready.permission !== 'granted') throw new Error(`隐藏文档没有获得写入权限：${ready?.permission || ready?.error || '未知'}`);
  await refreshDirectory(); status('保存权限已恢复，可以关闭设置页继续截图。');
});
action('probe', async () => {
  const result = await send('writer-status');
  if (!result?.ok) throw new Error(result?.error || '后台不可用');
  await refreshDirectory();
  status(result.permission === 'granted' ? '保存目录已授权，可以关闭设置页继续截图。' : '请先选择文件夹或点击“重新授权”。', result.permission !== 'granted');
});
action('simulate', async () => {
  const result = await send('simulate');
  if (!result?.ok) throw new Error(result?.error || '测试设置失败');
  $('simulate').textContent = result.enabled ? '取消模拟失败' : '模拟下一次保存失败';
  status(result.enabled ? '下一次后台保存将模拟失败。' : '已取消模拟失败。');
});
action('shortcuts', async () => {
  const result = await send('shortcuts');
  if (!result?.ok) throw new Error(result?.error || '请手动打开浏览器的扩展快捷键管理页。');
});
async function refreshTabs() {
  const tabs = await chrome.tabs.query({ url: 'https://www.bilibili.com/video/*' });
  $('video-tabs').replaceChildren();
  for (const tab of tabs) { const option = document.createElement('option'); option.value = tab.id; option.textContent = tab.title || tab.url; $('video-tabs').append(option); }
}
action('refresh', refreshTabs);
action('capture', async () => {
  if (!$('video-tabs').value) throw new Error('请先打开并选择一个 Bilibili 视频页。');
  const result = await send('capture-tab', { tabId: Number($('video-tabs').value) });
  if (!result?.ok) throw new Error(result?.error || '截图失败'); status(`已保存：${result.filename}`);
});
async function refresh() {
  await refreshDirectory();
  const commands = await chrome.commands.getAll();
  $('shortcut').textContent = commands.find(command => command.name === 'capture-frame')?.shortcut || '未绑定';
  const { lastResult } = await chrome.storage.local.get('lastResult');
  $('last').textContent = lastResult ? `${lastResult.ok ? '成功' : '失败'}：${lastResult.filename || lastResult.error}` : '';
}
window.addEventListener('focus', () => refresh().catch(error => status(error.message, true)));
chrome.storage.onChanged.addListener(() => refresh().catch(console.error));
Promise.all([refresh(), refreshTabs()]).then(async () => {
  $('runtime').textContent = `版本 ${chrome.runtime.getManifest().version}`;
  const result = await send('writer-status');
  if (!result?.ok) throw new Error(result?.error || '无法读取保存状态。');
  status(result.permission === 'granted' ? '已准备就绪。可以关闭本页，用快捷键截图。' : '请选择保存文件夹或重新授权。', result.permission !== 'granted');
}).catch(error => status(error.message, true));
