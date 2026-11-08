(() => {
  if (globalThis.__biliFrameCaptureInstalled) return;
  globalThis.__biliFrameCaptureInstalled = true;
  const CHUNK_SIZE = 512 * 1024;
  const MAX_BASE64 = 32 * 1024 * 1024;
  let pending = 0;

  function toast(text, failed = false, recovery = true) {
    const id = failed ? '__bili_capture_error' : '__bili_capture_toast';
    const old = document.getElementById(id);
    old?.remove();
    const box = document.createElement('div');
    box.id = id;
    box.textContent = text;
    Object.assign(box.style, {
      background: failed ? '#8f302c' : '#105f52', color: '#fff',
      padding: '14px 20px', borderRadius: '10px', font: '14px/1.6 system-ui',
      maxWidth: '100%', overflowWrap: 'anywhere', pointerEvents: failed ? 'auto' : 'none'
    });
    if (failed && recovery) {
      const button = document.createElement('button');
      button.textContent = '打开截图设置';
      Object.assign(button.style, { marginLeft: '12px', cursor: 'pointer', padding: '4px 8px', color: '#183833', background: '#fff', border: '0', borderRadius: '4px' });
      button.addEventListener('click', () => chrome.runtime.sendMessage({ target: 'background', type: 'open-assistant' }).catch(() => {}));
      box.append(button);
    }
    let stack = document.getElementById('__bili_capture_notices');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = '__bili_capture_notices';
      Object.assign(stack.style, {
        position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)',
        zIndex: '2147483647', display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '12px', width: '80vw', pointerEvents: 'none'
      });
    }
    (document.fullscreenElement || document.body).append(stack);
    if (failed) stack.prepend(box);
    else stack.append(box);
    setTimeout(() => box.remove(), failed ? 7000 : 3500);
  }

  async function assistant(type, fields) {
    let response;
    try { response = await chrome.runtime.sendMessage({ target: 'assistant', type, ...fields }); }
    catch { throw new Error('后台未连接，请检查扩展是否启用并刷新视频页。'); }
    if (!response) throw new Error('后台没有响应，请重新加载扩展并刷新视频页。');
    if (!response.ok) throw new Error(response.error || '保存失败。');
    return response;
  }

  function readFrame() {
    if (!/^\/video\//.test(location.pathname)) throw new Error('当前不是支持的 Bilibili 普通视频页。');
    const candidates = [...document.querySelectorAll('video')].map(video => {
      const rect = video.getBoundingClientRect();
      const style = getComputedStyle(video);
      return { video, area: rect.width * rect.height, visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' };
    }).filter(item => item.visible).sort((a, b) => b.area - a.area);
    if (!candidates.length) throw new Error('没有找到可见视频，请等待播放器加载完成。');
    if (candidates.length > 1 && candidates[1].area >= candidates[0].area * 0.9) throw new Error('无法确定主视频，请关闭其他播放窗口后重试。');
    const video = candidates[0].video;
    if (!video.videoWidth || !video.videoHeight || video.readyState < 2) throw new Error('视频尚无可用画面，请先播放后重试。');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const time = video.currentTime;
    const capturedAt = Date.now();
    canvas.getContext('2d').drawImage(video, 0, 0);
    let data;
    try { data = canvas.toDataURL('image/png').split(',')[1]; }
    catch (error) {
      if (error.name === 'SecurityError') throw new Error('当前视频受到跨域或内容保护限制，无法直接提取原始帧。');
      throw error;
    }
    if (!data || data.length > MAX_BASE64) throw new Error('当前 PNG 超过 24 MiB 上限，请降低视频清晰度后重试。');
    return {
      data, width: canvas.width, height: canvas.height, time, capturedAt,
      title: document.querySelector('h1.video-title, h1')?.textContent?.trim() || document.title,
      bv: location.pathname.match(/BV[\w]+/)?.[0] || 'video',
      part: new URL(location.href).searchParams.get('p') || '1'
    };
  }

  async function capture() {
    if (pending >= 3) {
      const error = '截图队列已满（最多 3 张），本次截图未接收。请等待保存完成后重试。';
      toast(error, true, false);
      return { ok: false, error };
    }
    pending++;
    const requestId = crypto.randomUUID();
    let reserved = false;
    try {
      await assistant('reserve', { requestId });
      reserved = true;
      const frame = readFrame();
      const { data, ...meta } = frame;
      await assistant('begin', { requestId, meta, length: data.length });
      for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
        await assistant('chunk', { requestId, offset, data: data.slice(offset, offset + CHUNK_SIZE) });
      }
      const saved = await assistant('finish', { requestId });
      toast(`已保存 ${saved.width} × ${saved.height}：${saved.filename}`);
      return saved;
    } catch (error) {
      if (reserved) await assistant('abort', { requestId }).catch(() => {});
      toast(error.message, true);
      return { ok: false, error: error.message };
    } finally { pending--; }
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || message.target !== 'capture') return;
    capture().then(reply, error => reply({ ok: false, error: error.message }));
    return true;
  });
})();
