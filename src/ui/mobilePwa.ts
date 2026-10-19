/** HTTPS production only; relative scope supports GitHub Pages and leaves Electron/dev alone. */
export function setupMobilePwa(): void {
  if (
    !import.meta.env.PROD ||
    !('serviceWorker' in navigator) ||
    !/^https?:$/.test(location.protocol)
  )
    return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
      .catch(() => {
        // Browser policy, storage exhaustion or private mode: the online game still works.
      });
  });
}
