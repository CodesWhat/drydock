/**
 * Save text as a file through a throwaway link. Returns false when the browser
 * cannot make an object URL. The text never leaves the page: the URL is a blob
 * and is revoked as soon as the click has been dispatched.
 */
export function downloadTextFile(filename: string, text: string): boolean {
  const createObjectUrl = globalThis.URL?.createObjectURL;
  if (typeof createObjectUrl !== 'function') {
    return false;
  }
  const objectUrl = createObjectUrl(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  globalThis.URL.revokeObjectURL(objectUrl);
  return true;
}
