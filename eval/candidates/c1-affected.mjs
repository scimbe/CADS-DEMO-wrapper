// c1 (orga wishes under "Karte" go to the catalog; broader word lists for a date, money and food): which prompts it can change.
// The route differs when the needs of the wish differ between the two libs, or when the new card check fires.
export function affected(text, ui, age, base, cand) {
  const key = (lib) => JSON.stringify(lib.needsOf(text).map((n) => n.any));
  if (key(base) !== key(cand)) return true;
  return ui.art === 'card' && cand.needsOf(text).length > 0;
}
