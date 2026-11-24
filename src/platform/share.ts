/** Native file sharing requires transient activation. Prepare the exact file before enabling its button. */
export function canShareFile(file: File): boolean {
  try { return typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] }) === true; }
  catch { return false; }
}

export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function shareFile(file: File): Promise<'shared' | 'saved' | 'cancelled'> {
  if (canShareFile(file)) {
    try { await navigator.share({ files: [file] }); return 'shared'; }
    catch (error) {
      if ((error as Error)?.name === 'AbortError') return 'cancelled';
      // Controller clicks on some browsers do not grant native share-sheet activation.
    }
  }
  downloadFile(file);
  return 'saved';
}
