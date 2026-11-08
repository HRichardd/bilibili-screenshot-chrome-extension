export function cleanName(value, limit = 64) {
  let name = String(value).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim();
  name = Array.from(name).slice(0, limit).join('').replace(/[. ]+$/g, '');
  if (!name) name = 'bilibili';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name;
}

export function frameTime(seconds) {
  const ms = Math.max(0, Math.round(Number(seconds) * 1000) || 0);
  const pad = (value, n = 2) => String(value).padStart(n, '0');
  return `${pad(Math.floor(ms / 3600000))}-${pad(Math.floor(ms / 60000) % 60)}-${pad(Math.floor(ms / 1000) % 60)}-${pad(ms % 1000, 3)}`;
}

export function makeFilename(meta) {
  const d = new Date(meta.capturedAt);
  const pad = (v, n = 2) => String(v).padStart(n, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
  return `${cleanName(meta.title)}_${cleanName(meta.bv, 20)}_P${cleanName(meta.part, 6)}_${frameTime(meta.time)}_${stamp}.png`;
}

export async function uniqueFile(directory, name) {
  for (let i = 0; i < 10000; i++) {
    const candidate = i ? name.replace(/\.png$/, `_${i}.png`) : name;
    try { await directory.getFileHandle(candidate); }
    catch (error) {
      if (error.name === 'NotFoundError') return { filename: candidate, handle: await directory.getFileHandle(candidate, { create: true }) };
      throw error;
    }
  }
  throw new Error('同名文件过多，请更换保存目录。');
}
