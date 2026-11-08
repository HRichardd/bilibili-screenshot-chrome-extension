const isVideo = url => /^https:\/\/www\.bilibili\.com\/video\//.test(url || '');

async function openAssistant() {
  const url = chrome.runtime.getURL('assistant.html');
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(tab => tab.url === url);
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

async function capture(tab) {
  let result;
  try {
    if (!tab?.id || !isVideo(tab.url)) throw new Error('请切换到 Bilibili 普通视频页后按快捷键。');
    result = await chrome.tabs.sendMessage(tab.id, { target: 'capture', type: 'capture' });
    if (!result) throw new Error('未收到截图结果，请刷新视频页后重试。');
  } catch (error) {
    result = { ok: false, error: error.message.includes('Receiving end')
      ? '视频页尚未连接扩展，请刷新视频页，并确认截图助手已打开。' : error.message };
  }
  await chrome.storage.local.set({ lastResult: { ...result, at: Date.now() } }).catch(console.error);
  await chrome.action.setBadgeText({ text: result.ok ? 'OK' : '!' }).catch(console.error);
  await chrome.action.setBadgeBackgroundColor({ color: result.ok ? '#117d69' : '#bd3f35' }).catch(console.error);
  return result;
}

chrome.action.onClicked.addListener(() => { openAssistant().catch(console.error); });
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'capture-frame') return;
  (async () => {
    const current = tab || (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    await capture(current);
  })().catch(console.error);
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.target !== 'background' || sender.id !== chrome.runtime.id) return;
  if (message.type === 'open-assistant') {
    openAssistant().then(() => reply({ ok: true }), error => reply({ ok: false, error: error.message }));
    return true;
  }
  if (sender.tab?.url?.startsWith('https:')) return;
  if (message.type === 'dashboard') {
    (async () => {
      const [tabs, commands, stored, assistant] = await Promise.all([
        chrome.tabs.query({ active: true, lastFocusedWindow: true }),
        chrome.commands.getAll(), chrome.storage.local.get('lastResult'),
        chrome.runtime.sendMessage({ target: 'assistant', type: 'ping' }).catch(() => null)
      ]);
      return { ok: true, video: isVideo(tabs[0]?.url), shortcut: commands.find(c => c.name === 'capture-frame')?.shortcut || '', assistant: assistant || null, last: stored.lastResult || null };
    })().then(reply, error => reply({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'capture-active') {
    (async () => capture((await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]))()
      .then(reply, error => reply({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'shortcuts') {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).then(() => reply({ ok: true }), error => reply({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'capture-tab') {
    (async () => {
      const tab = await chrome.tabs.get(message.tabId);
      return capture(tab);
    })().then(reply, error => reply({ ok: false, error: error.message }));
    return true;
  }
});
