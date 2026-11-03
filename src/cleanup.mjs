// What must be undone on the way out, normal or not: containers, temp dirs, child
// processes. Everything registered here is synchronous so a signal handler can run it.
const tasks = new Set();

export function track(fn) {
  tasks.add(fn);
  return () => tasks.delete(fn);
}

export function runCleanup() {
  for (const fn of [...tasks].reverse()) {
    tasks.delete(fn);
    try { fn(); } catch { /* the rest still have to run */ }
  }
}

export function exitOnSignals() {
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.on(signal, () => {
      runCleanup();
      process.exit(code);
    });
  }
}
