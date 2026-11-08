// Minimal Chrome DevTools Protocol client over the WebSocket built into Node 22: no dependency to install.

/**
 * Connects to the first page of a Chrome started with `--remote-debugging-port`.
 * @param {number} port
 */
export async function connect(port) {
  let target;
  for (let attempt = 0; attempt < 50 && target === undefined; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = targets.find((candidate) => candidate.type === 'page');
    } catch {
      // Chrome is not listening yet: the next attempt retries, and the loop ends in an explicit error below.
    }
    if (target === undefined) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (target === undefined) {
    throw new Error(`Chrome n’a pas répondu sur le port ${port}`);
  }

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('connexion DevTools refusée'));
  });

  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id === undefined) {
      listeners.forEach((listener) => listener(message));
      return;
    }
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      call.reject(new Error(JSON.stringify(message.error)));
    } else {
      call.resolve(message.result);
    }
  };

  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        nextId += 1;
        pending.set(nextId, { resolve, reject });
        socket.send(JSON.stringify({ id: nextId, method, params }));
      }),
    on: (listener) => listeners.push(listener),
    close: () => socket.close(),
  };
}
