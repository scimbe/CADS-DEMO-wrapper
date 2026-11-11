// Harness swarm: what the person sees after "Erschaffen", as a short structured description (for the judge and for the
// persona's correction). Pure: the catalog lookup is passed in (byId of the vendored daily.js, what the app itself uses).

const plain = (t) => String(t || '').replace(/-\|(\p{Ll})/gu, '$1').replace(/-\|/g, '-').replace(/\|/g, ' ').trim();
const LAUF_HAS = { lu: 'Lücken zum Springen', hi: 'Hindernisse', mu: 'Münzen/Sammelsachen', ge: 'Gegner', fa: 'Dinge fallen von oben', du: 'Ducken' };
// what the app says for a server note (apps/duell-web i18n create_lim_*, create_engine_*), short and in German
const NOTE = { drinks: 'Hinweis: Getränk mit Alkohol wurde weggelassen.', money18: 'Hinweis: Geld sammeln erst ab 18 – die Karte plant ohne Geld.', nosend: 'Hinweis: Die App schreibt niemandem selbst, du teilst den Link.',
  async: 'Hinweis: Läuft nicht live, sondern Zug um Zug per Link.', duel: 'Hinweis: Ein Duell per Link.', 'engine:flug': 'Hinweis: Daraus wurde ein Flugspiel (Knopf: „Lieber Jump & Run“).', 'engine:lauf': 'Hinweis: Daraus wurde ein Jump & Run (Knopf: „Lieber Fliegen“).' };

/** -> { kind: 'card'|'notyet'|'refused'|'crisis'|'error', text } ; r: the outcome of sut.runCase */
export function describe(r, byId = () => null, lang = 'de') {
  const en = lang === 'en', title = (idea) => (idea ? plain((en && idea.en ? idea.en : idea.de || {}).t) : '');
  if (!r) return { kind: 'error', text: 'Keine Antwort.' };
  if (r.error) return { kind: 'error', text: 'Fehler: ' + r.error };
  if (r.crisis) return { kind: 'crisis', text: 'Die App zeigt Hilfe-Nummern (Krisenhilfe) statt einer Karte.' };
  if (r.bald) return { kind: 'notyet', text: `Die App sagt: „${r.bald}“ gibt es noch nicht. Am nächsten dran: ${(r.catalog || []).map((id) => title(byId(id))).filter(Boolean).join(', ') || 'nichts'}.` };
  if (r.s1 || r.fail) return { kind: 'refused', text: `Die App sagt (in der Sprache der Person): Das geht so nicht (abgelehnt${r.fail ? ', Grund intern: ' + r.fail + (r.why ? '/' + r.why : '') : ', Wortfilter'}).` };
  if (r.notyet) {
    const n = r.notyet && typeof r.notyet === 'object' ? r.notyet : {};
    const cat = (r.catalog || []).map((id) => title(byId(id))).filter(Boolean);
    const alt = r.alt ? (r.alt.kind === 'katalog' ? `Vorschlag: Katalogkarte „${title(byId(r.alt.id)) || r.alt.id}“.` : `Vorschlag: als ${r.alt.id === 'G1' ? 'Flugspiel' : r.alt.id === 'G2' ? 'Jump & Run' : r.alt.id} mit dem Satz „${r.alt.satz}“.`) : '';
    const what = n.what === 'genre' ? `Rückfrage: Dein Satz klingt nach ${n.name === 'G2' ? 'Jump & Run' : 'Fliegen'}, gewählt war ${n.chosen === 'G2' ? 'Jump & Run' : 'Fliegen'} – welches willst du?`
      : n.what === 'feature' ? `Die App sagt: „${n.name}“ kann die freie Karte noch nicht.` : n.what === 'game' ? `Die App sagt: ${n.name ? '„' + n.name + '“' : 'Dieses Spiel'} kann die freie Karte noch nicht.`
        : r.reason ? `Die App sagt: Das kann die freie Karte noch nicht (Grund: ${r.reason}).` : 'Die App sagt: Das kann die freie Karte noch nicht.';
    // apps/duell-web create-ui.js: a notyet without name and reason says create_notyet, then the catalog chips; a tap on one
    // opens that catalog card in the editor (own title there)
    if ((!n.what && !r.reason) || n.what === 'kategorie') {
      const ui = en ? ['The free card cannot make this yet. Nothing is charged.', 'The catalog has this:'] : ['Das kann die freie Karte noch nicht. Dafür wird nichts abgebucht.', 'Im Katalog gibt es dafür:'];
      return { kind: 'notyet', text: `Die App sagt (in der Sprache der Person): „${ui[0]}“${cat.length ? ` „${ui[1]}“ ` + cat.map((c) => '[→ ' + c + ']').join(' ') + ' (ein Tipp öffnet die Katalogkarte im Editor, dort mit eigenem Titel).' : ''}` };
    }
    return { kind: 'notyet', text: [what, alt, cat.length ? 'Ähnliche Katalogkarten: ' + cat.join(', ') + '.' : ''].filter(Boolean).join(' ') };
  }
  const o = r.options && r.options[0];
  if (!o || !o.doc) return { kind: 'error', text: 'Keine Karte.' };
  const d = o.doc, lines = [];
  if (d.k === 'card') lines.push(`Karte (Stil ${d.st})${d.t ? ', Titel „' + d.t + '“' : ''}: „${d.x}“`, `Sticker: ${(d.sk || []).map((s) => s.e).join(' ') || '-'}`);
  else if (d.k === 'photo') lines.push(`Meme auf deinem eigenen Foto (Stil ${d.st})${d.t ? ', Titel „' + d.t + '“' : ''}: oben „${d.x || ''}“, unten „${d.y || ''}“`);
  else if (d.k === 'game') {
    const g = d.g || {};
    lines.push(`Flugspiel (antippen, um durch Lücken zu fliegen): Titel „${g.title}“, Figur ${g.emoji}, Welt ${g.theme}, Hintergrund ${g.look && g.look.d}`,
      `Strecke: ${(g.route || []).map((s) => `${s.t}/${s.p} ${s.e}`).join(' → ')}; Schwierigkeit: ${g.params && g.params.gap >= 170 ? 'leicht' : g.params && g.params.gap <= 115 ? 'schwer' : 'normal'}`);
  } else if (d.k === 'lauf') {
    const l = d.l || {}, p = l.p || {};
    lines.push(`Jump & Run (antippen zum Springen): Titel „${d.t}“, ${l.m === 'ziel' ? 'Level mit Ziel' : 'Endlos-Lauf'}, Welt ${l.w}, Figur ${l.e}, Hindernis ${l.o}, Sammeln ${l.c}, Gegner ${l.f}`,
      `Auf der Strecke: ${Object.entries(LAUF_HAS).filter(([k]) => p[k] > 0).map(([, v]) => v).join(', ') || 'nur Laufen'}`);
  } else if (d.k === 'turn' && d.pk) lines.push(`Quiz „${d.pk.t}“ mit ${d.pk.q.length} Fragen:`, ...d.pk.q.map((q, i) => `${i + 1}. ${q[0]} – richtig: ${q[1]}; falsch: ${q.slice(2).join(', ')}`));
  else if (d.i) {
    const idea = byId(d.i);
    const L = idea ? (en && idea.en ? idea.en : idea.de) : null;
    lines.push(`Katalogkarte „${L ? plain(L.t) : d.i}“ (${L ? L.s : ''}) mit eigenem Titel „${d.t || ''}“${d.s ? ', Untertitel „' + d.s + '“' : ''}${d.w ? ', Wort „' + d.w + '“' : ''}`,
      `Art: ${d.k === 'duel' ? 'Duell per Link' : 'Zug-Karte per Link, eins nach dem anderen'}`);
  } else lines.push('Karte vom Typ ' + d.k);
  for (const n of [].concat(r.note || [])) { const m = /^(days|people|chars):(\d+)$/.exec(n); lines.push(m ? `Hinweis: Grenze ${m[1] === 'days' ? 'Tage' : m[1] === 'people' ? 'Personen' : 'Zeichen'} = ${m[2]}.` : NOTE[n] || ''); }
  return { kind: 'card', text: lines.filter(Boolean).join('\n') };
}

/** The card after an editor wish (KINDS.wish changes): the fields the editor applies, the rest listed. -> { doc, rest } */
export function applyWish(doc, changes = {}) {
  const d = JSON.parse(JSON.stringify(doc || {})), rest = {};
  for (const [k, v] of Object.entries(changes || {})) {
    if (['x', 'y', 't', 's', 'w', 'st', 'f'].includes(k)) d[k] = v;
    else if (k === 'stickers' && Array.isArray(v)) d.sk = v.map((e) => ({ e }));
    else if (d.k === 'game' && d.g && ['title', 'emoji', 'theme'].includes(k)) d.g[k] = v;
    else rest[k] = v;
  }
  return { doc: d, rest };
}
