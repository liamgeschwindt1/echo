export function bindOsmLoader({ button, cancel, status, load, apply, timeoutMs = 35000 }) {
  let active = null;

  async function run() {
    if (active) return;
    const controller = new AbortController();
    active = controller;
    const started = Date.now();
    button.disabled = true;
    cancel.hidden = false;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((timeoutMs - (Date.now() - started)) / 1000));
      button.textContent = `Loading (${remaining}s left)...`;
      status.textContent = `Waiting for OpenStreetMap. Stops within ${Math.ceil(timeoutMs / 1000)} seconds. You can cancel.`;
    };
    update();
    const interval = setInterval(update, 1000);
    const timeout = setTimeout(() => {
      controller.abort(new Error('Map loading timed out. OpenStreetMap may be unavailable. Try again or choose a smaller tile.'));
    }, timeoutMs);
    let onAbort;
    const aborted = new Promise((resolve, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const result = await Promise.race([aborted, load(controller.signal)]);
      controller.signal.throwIfAborted();
      apply(result);
      status.textContent = 'Map loaded.';
    } catch (err) {
      status.textContent = controller.signal.aborted
        ? controller.signal.reason.message
        : `OpenStreetMap load failed: ${err.message}`;
    } finally {
      clearTimeout(timeout);
      clearInterval(interval);
      controller.signal.removeEventListener('abort', onAbort);
      active = null;
      button.disabled = false;
      button.textContent = 'Load map';
      cancel.hidden = true;
    }
  }

  button.addEventListener('click', run);
  cancel.addEventListener('click', () => active?.abort(new Error('Map loading cancelled. Current scene unchanged.')));
  return run;
}
