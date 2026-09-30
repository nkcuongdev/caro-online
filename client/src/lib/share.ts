export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  // Fallback for insecure origins (e.g. LAN IP in dev) and older browsers.
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

export const canNativeShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/**
 * Uses the Web Share API when available, otherwise copies the link.
 * Resolves to what actually happened so the UI can give the right feedback.
 */
export async function shareLink(url: string, text: string): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  if (canNativeShare()) {
    const data = { title: 'Caro Online', text, url };
    if (!navigator.canShare || navigator.canShare(data)) {
      try {
        await navigator.share(data);
        return 'shared';
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return 'cancelled';
      }
    }
  }
  return (await copyText(url)) ? 'copied' : 'failed';
}
