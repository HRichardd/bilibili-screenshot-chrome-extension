let creating;
export async function ensureWriter() {
  if (!chrome.offscreen || !chrome.runtime.getContexts) throw new Error('当前浏览器不支持隐藏保存文档，请使用 Chrome / Edge 116 或更高版本。');
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL('offscreen.html')] });
  if (contexts.length) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: 'offscreen.html', reasons: ['BLOBS'],
      justification: 'Decode and validate captured PNG blobs and write them to the user-authorized screenshot directory without a visible tab.'
    }).finally(() => { creating = null; });
  }
  await creating;
}
async function call(type) {
  await ensureWriter();
  const response = await chrome.runtime.sendMessage({ target: 'offscreen-control', type });
  if (!response?.ok) throw new Error(response?.error || '隐藏保存文档未响应。');
  return response;
}
export const writerStatus = () => call('status');
export const toggleSimulation = () => call('simulate');
