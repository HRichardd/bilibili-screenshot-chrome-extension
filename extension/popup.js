const $ = id => document.getElementById(id);
const send = type => chrome.runtime.sendMessage({ target: 'background', type });
let capturing = false;
function status(text, failed = false) {
  $('status').textContent = text;
  $('status').dataset.error = String(failed);
}
async function refresh() {
  const data = await send('dashboard');
  if (!data?.ok) throw new Error(data?.error || '无法读取扩展状态。');
  const ready = data.assistant?.ok && data.assistant.permission === 'granted';
  $('directory').textContent = data.assistant?.name || '尚未选择目录';
  $('shortcut').textContent = data.shortcut || '未绑定';
  $('capture').disabled = capturing || !ready || !data.video;
  if (!capturing) {
    if (!data.assistant?.ok) status(data.assistant?.error || '后台不可用，请打开设置检查。', true);
    else if (!ready) status('请在设置中选择文件夹或重新授权。', true);
    else if (!data.video) status('请先切换到 Bilibili 普通视频页。');
    else status(`可以截图 · 待处理 ${data.assistant.pending} / 3`);
  }
  $('last').textContent = data.last ? `最近${data.last.ok ? '保存：' : '失败：'}${data.last.ok ? data.last.filename : data.last.error}` : '尚无截图记录';
}
$('assistant').addEventListener('click', async () => {
  try { const result = await send('open-assistant'); if (!result?.ok) throw new Error(result?.error || '打开失败'); window.close(); }
  catch (error) { status(error.message, true); }
});
$('shortcuts').addEventListener('click', async () => {
  try { const result = await send('shortcuts'); if (!result?.ok) throw new Error(result?.error || '打开失败'); window.close(); }
  catch (error) { status(error.message, true); }
});
$('capture').addEventListener('click', async () => {
  capturing = true; $('capture').disabled = true; status('正在保存当前视频帧…');
  try {
    const result = await send('capture-active');
    if (!result?.ok) throw new Error(result?.error || '截图失败');
    status(`已保存 ${result.width} × ${result.height}：${result.filename}`);
    $('last').textContent = `最近保存：${result.filename}`;
  } catch (error) { status(error.message, true); }
  finally { capturing = false; $('capture').disabled = false; }
});
refresh().catch(error => status(error.message, true));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.lastResult) {
    const last = changes.lastResult.newValue;
    $('last').textContent = last ? `最近${last.ok ? '保存：' : '失败：'}${last.ok ? last.filename : last.error}` : '尚无截图记录';
  }
});
