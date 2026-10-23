import { renderGalleryCanvas } from './render.js';

const EXPORT_SIZE = 4096;

function stamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function setupDownload(drawLog, buttonId = 'download') {
  const button = document.getElementById(buttonId);
  if (!button) return;

  const status = document.getElementById('submissionStatus');
  let statusTimer = null;

  function setStatus(message, state, durationMs = 0) {
    if (!status) return;
    if (statusTimer) clearTimeout(statusTimer);
    status.textContent = message;
    status.hidden = !message;
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
    if (durationMs > 0) {
      statusTimer = setTimeout(() => setStatus('', null), durationMs);
    }
  }

  button.addEventListener('click', () => {
    if (!Array.isArray(drawLog) || drawLog.length === 0) {
      setStatus('Add at least one shape before downloading.', 'error', 3000);
      return;
    }

    button.disabled = true;
    setStatus('Preparing…', 'loading');

    // Let the status paint before the large render.
    requestAnimationFrame(() => setTimeout(() => {
      try {
        const canvas = renderGalleryCanvas(drawLog, EXPORT_SIZE);
        canvas.toBlob(blob => {
          button.disabled = false;
          if (!blob) {
            setStatus('Download failed. Please try again.', 'error', 3000);
            return;
          }
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `geogrowth-${stamp()}.png`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          setStatus('', null);
        }, 'image/png');
      } catch (err) {
        console.error('Download failed:', err);
        button.disabled = false;
        setStatus('Download failed. Please try again.', 'error', 3000);
      }
    }, 0));
  });
}
