// c2 (refines c1: more phrasings for date, money and food; a date needs a named group; greetings narrowed): the prompts whose
// needs differ, and every card wish with any need (the greeting and group guards may decide differently)
export function affected(text, ui, age, base, cand) {
  const key = (lib) => JSON.stringify(lib.needsOf(text).map((n) => n.any));
  if (key(base) !== key(cand)) return true;
  return ui.art === 'card' && (cand.needsOf(text).length > 0 || base.needsOf(text).length > 0);
}
