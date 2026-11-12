// Strukturgleichheit fuer JSON-Werte (Ersatz fuer ajv/dist/runtime/equal in den erzeugten Validatoren, uniqueItems/enum).
export function deepEqual(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === "object" && typeof b === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false; return true; }
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) return false;
    return true;
  }
  return a !== a && b !== b; // NaN
}

/** Verschachtelungstiefe iterativ pruefen (Review M1): tiefe Strukturen lassen Validatoren rekursiv ueberlaufen. */
export function depthOk(v, max = 8) {
  const stack = [[v, 0]];
  while (stack.length) {
    const [x, d] = stack.pop();
    if (x && typeof x === "object") {
      if (d >= max) return false;
      for (const k in x) if (Object.prototype.hasOwnProperty.call(x, k)) stack.push([x[k], d + 1]);
    }
  }
  return true;
}
