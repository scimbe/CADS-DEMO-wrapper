// c5 (S1 false alarms: exam "verhauen", negated "dumm", "kurze Pausen" next to "trinken", 💊 next to one's own medicine):
// every prompt whose S1 screen differs between the two libs
export function affected(text, ui, age, base, cand, { baseAi, candAi }) {
  const scr = (ai) => { const K = ai.KINDS.karte, d = K.read({ text, art: ui.art || 'card' }); d.age = age; return ai.screenInput(K, d) + '|' + (K.soft(d) || ''); };
  return scr(baseAi) !== scr(candAi);
}
