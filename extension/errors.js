export function explainError(error) {
  const reasons = {
    NotAllowedError: '没有文件夹写入权限，请在助手中点击“重新授权”，或重新选择文件夹。',
    NotFoundError: '保存文件夹或文件已不存在，请重新选择保存文件夹。',
    QuotaExceededError: '存储空间不足，请清理磁盘空间或更换保存文件夹。',
    NoModificationAllowedError: '文件无法写入，可能正被其他程序占用，请关闭占用程序或更换文件夹。',
    SecurityError: '浏览器阻止了此操作，请确认文件夹授权和浏览器设置。'
  };
  return reasons[error?.name] || error?.message || '操作失败，请重试。';
}
