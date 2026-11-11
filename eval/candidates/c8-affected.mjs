// c8 = c5 (S1 false alarms) + c6 (money under 18 / refused money wish: no strike) + c7 (food: narrower, "Was machen wir
// jetzt?" first): the prompts whose S1 screen or needs differ, every card wish with a need, and every wish with a money need
export function affected(text, ui, age, base, cand, { baseAi, candAi }) {
  const scr = (ai) => { const K = ai.KINDS.karte, d = K.read({ text, art: ui.art || 'card' }); d.age = age; return ai.screenInput(K, d) + '|' + (K.soft(d) || ''); };
  if (scr(baseAi) !== scr(candAi)) return true;
  const key = (lib) => JSON.stringify(lib.needsOf(text).map((n) => n.any));
  if (key(base) !== key(cand)) return true;
  const needs = cand.needsOf(text);
  return (ui.art === 'card' && needs.length > 0) || needs.some((n) => n.any.includes('collect.money'));
}
