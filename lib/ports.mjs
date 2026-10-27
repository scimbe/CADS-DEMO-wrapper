// Free TCP ports for a run's own helper server (Temporal dev server). Every run asks for its own
// pair, so two visitors never collide on 7233/8233. Ports handed out are remembered for the process
// lifetime of the run (`release`) so two concurrent callers cannot receive the same one while the
// first has not bound it yet.
import net from 'node:net';

const taken = new Set();

function probe() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

/** n distinct free ports on 127.0.0.1. */
export async function allocatePorts(n = 2) {
  const got = [];
  for (let guard = 0; got.length < n && guard < 50; guard++) {
    const p = await probe();
    if (taken.has(p) || got.includes(p)) continue;
    taken.add(p); got.push(p);
  }
  if (got.length < n) { got.forEach((p) => taken.delete(p)); throw new Error('keine freien Ports'); }
  return got;
}

export function releasePorts(ports) { for (const p of ports || []) taken.delete(p); }
