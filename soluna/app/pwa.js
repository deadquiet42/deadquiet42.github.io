async function requestPersistentStorage() {
  if (!navigator.storage?.persist || !navigator.storage?.persisted) return;

  try {
    if (!await navigator.storage.persisted()) {
      await navigator.storage.persist();
    }
  } catch (error) {
    console.warn('Soluna could not request persistent storage.', error);
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((error) => {
      console.warn('Soluna could not enable offline use.', error);
    });

    requestPersistentStorage();
  });
}
