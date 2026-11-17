// Satz zu Formular, reine Logik (satz.js, Tag pre-legacy-removal), woertlich uebertragen; nur hash32 kommt aus alt.js.
/* Satz zu Formular: one sentence in, a filled form out. The AI (kinds plan and liste in CADS-DEMO-wrapper lib/duell-ai.mjs)
   only gives rules and keys; every date, amount and deadline is computed here, on the device, from those rules:
   - plan  -> date slots for the poll (turns.js termin: day * 10 + hour index), German public holidays left out, an .ics file;
   - liste -> items with amounts from the rule table below (people from the sentence or the household in the profile);
   - liste aufgaben -> tasks with a due day counted back from the event day.
   Names never leave the device: a list of names in the sentence stays here and goes out as [Name]. Pure logic (no DOM). */
import { hash32, civil, daysOf, weekday } from "./alt.js";
// Ohne Date (Harness): Kalender aus alt.js civil/daysOf/weekday, bitgleich zu Date (test/z1-format.test.js).
// DTSTAMP kommt vom Host (Zeitstempel in ms); fehlt er, bricht ics ab statt die Uhr zu lesen.
function stampOf(now) { if (!Number.isInteger(now)) throw new Error("ics: Zeitstempel fehlt"); return now; }
const C = { hash32 };
var DAY = 86400000, HOURS = [10, 12, 14, 15, 16, 17, 18, 19, 20], MAX = 5;
var WD = ["so", "mo", "di", "mi", "do", "fr", "sa"];
var DAUER = [0, 15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 1440];
function ymd(day) { return civil(day); }
function dayOf(y, m, d) { return daysOf(y, m, d); }
function wd(day) { return weekday(day); }
function mon(day) { return (wd(day) + 6) % 7; }      // 0 = Monday
// Easter Sunday (anonymous Gregorian algorithm, Meeus/Jones/Butcher).
function easter(y) {
  var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  var mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return dayOf(y, mo, da);
}
// The nine public holidays of all German states (regional ones are not counted: the app does not know the state).
function holidays(y) {
  var e = easter(y), o = {};
  [[dayOf(y, 1, 1), "Neujahr|New Year's Day"], [e - 2, "Karfreitag|Good Friday"], [e + 1, "Ostermontag|Easter Monday"], [dayOf(y, 5, 1), "Tag der Arbeit|Labour Day"],
    [e + 39, "Christi Himmelfahrt|Ascension Day"], [e + 50, "Pfingstmontag|Whit Monday"], [dayOf(y, 10, 3), "Tag der Deutschen Einheit|German Unity Day"],
    [dayOf(y, 12, 25), "1. Weihnachtstag|Christmas Day"], [dayOf(y, 12, 26), "2. Weihnachtstag|Boxing Day"]].forEach(function (x) { o[x[0]] = x[1]; });
  return o;
}
function holiday(day, lang) { var n = holidays(ymd(day)[0])[day]; return n ? n.split("|")[lang === "en" ? 1 : 0] : ""; }
function range(a, b) { var o = []; for (var d = a; d <= b; d++) o.push(d); return o; }
function monthEnd(day) { var x = ymd(day); return dayOf(x[1] === 12 ? x[0] + 1 : x[0], x[1] === 12 ? 1 : x[1] + 1, 1) - 1; }
// The days a relative period means, seen from today. Where the words leave room ("naechstes Wochenende" on a Wednesday),
// both readings stay in: the poll asks instead of guessing.
function period(z, today) {
  var m = mon(today), y = ymd(today);
  switch (z) {
    case "heute": return [today];
    case "morgen": return [today + 1];
    case "diese_woche": return range(today, today + 6 - m);
    case "dieses_wochenende": return m === 6 ? [today] : range(today + 5 - m, today + 6 - m);
    case "naechste_woche": return range(today + 7 - m, today + 13 - m);
    case "naechstes_wochenende": return m <= 4 ? [today + 5 - m, today + 6 - m, today + 12 - m, today + 13 - m] : [today + 12 - m, today + 13 - m];
    case "in_zwei_wochen": var t = today + 14; return range(t - mon(t), t - mon(t) + 6);
    case "diesen_monat": return range(today, monthEnd(today));
    case "naechsten_monat": var s = monthEnd(today) + 1; return range(s, monthEnd(s));
    case "vor_weihnachten": var x = dayOf(y[0], 12, 23); if (today > x) x = dayOf(y[0] + 1, 12, 23); return range(Math.max(today, x - 22), x);
    case "zwischen_den_jahren": var a = dayOf(y[0], 12, 27); if (today > a + 3) a = dayOf(y[0] + 1, 12, 27); return range(Math.max(today, a), a + 3);
    default: return range(today + 1, today + 14);
  }
}
// "HH:MM" -> the nearest hour of the poll's grid (a tie goes to the later one: "ab 18:30" is 19 Uhr).
function nearest(h, mi) { var v = h + mi / 60, best = 0; HOURS.forEach(function (x, i) { if (Math.abs(x - v) <= Math.abs(HOURS[best] - v)) best = i; }); return best; }
var TZ = { morgens: 0, vormittags: 0, mittags: 1, nachmittags: 3, abends: 6 };
/* rule: the plan option (wochentage, tageszeiten, uhrzeit, zeitraum, ...). opt: { today, nowHour, no: profile "no time"
   keys, def: hour index when nothing is said, day: the date the sentence names ("am 12.11."; the plan format has no
   field for it, so it is read here) }. A named date is the only day: no weekday filter, a holiday is kept (it was asked
   for). -> { slots, skipped: holidays left out, rounded: the said time is not on the grid, none: only the profile ruled
   every slot out, day: the named date when there was one } */
function slots(rule, opt) {
  opt = opt || {};
  var today = opt.today, no = opt.no || [], hours = [], rounded = "";
  var hm = typeof rule.uhrzeit === "string" && rule.uhrzeit.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) { var at = nearest(+hm[1], +hm[2]); hours = [at]; if (HOURS[at] !== +hm[1] || +hm[2]) rounded = rule.uhrzeit; }
  else (rule.tageszeiten || []).forEach(function (z) { if (TZ[z] != null && hours.indexOf(TZ[z]) < 0) hours.push(TZ[z]); });
  if (!hours.length) hours = [opt.def == null ? 6 : opt.def];
  hours.sort(function (a, b) { return a - b; });
  var fixed = opt.day || 0, days = !fixed && (rule.wochentage || []).length ? rule.wochentage : null, skipped = [], pairs = [], ruled = 0, byDay = [];
  (fixed ? [fixed] : period(rule.zeitraum, today)).forEach(function (d) {
    if (d < today || (days && days.indexOf(WD[wd(d)]) < 0)) return;
    if (!fixed && holiday(d)) { skipped.push(d); return; }
    var mine = [];
    hours.forEach(function (h) {
      if (d === today && HOURS[h] <= (opt.nowHour == null ? 24 : opt.nowHour)) return;
      var weekday = mon(d) < 5;
      if ((no.indexOf("sa") >= 0 && wd(d) === 6) || (no.indexOf("so") >= 0 && wd(d) === 0) || (no.indexOf("tag") >= 0 && weekday && HOURS[h] < 17) || (no.indexOf("abend") >= 0 && HOURS[h] >= 20)) { ruled++; return; }
      pairs.push(d * 10 + h); mine.push(d * 10 + h);
    });
    if (mine.length) byDay.push(mine);
  });
  // At most MAX, spread evenly over the days; a day keeps all its times ("morgens und abends" stays together on one day).
  var pick = pairs, per = Math.max(1, hours.length), nd = Math.max(1, Math.floor(MAX / per));
  if (pairs.length > MAX) {
    pick = [];
    if (byDay.length <= nd) byDay.forEach(function (x) { pick = pick.concat(x); });
    else for (var i = 0; i < nd; i++) pick = pick.concat(byDay[nd === 1 ? 0 : Math.round(i * (byDay.length - 1) / (nd - 1))]);
    pick = pick.slice(0, MAX);
  }
  return { slots: pick, skipped: skipped, rounded: rounded, none: !pairs.length && ruled > 0, day: fixed };
}

// ---------- .ics for one slot: floating local time (RFC 5545 form 1), no names, no place ----------
function pad(n) { return (n < 10 ? "0" : "") + n; }
function stamp(ms) { var day = Math.floor(ms / DAY), rest = ms - day * DAY, d = civil(day); return d[0] + pad(d[1]) + pad(d[2]) + "T" + pad(Math.floor(rest / 3600000)) + pad(Math.floor((rest % 3600000) / 60000)) + "00"; }
function esc(v) { return String(v).replace(/[\\;,]/g, function (c) { return "\\" + c; }).replace(/\n/g, "\\n"); }
function fold75(line) {
  var out = [], cur = "", n = 0;
  Array.from(line).forEach(function (ch) { var b = new TextEncoder().encode(ch).length; if (n + b > 75) { out.push(cur); cur = " "; n = 1; } cur += ch; n += b; });
  out.push(cur); return out.join("\r\n");
}
function ics(slot, title, mins, now) {
  var day = Math.floor(slot / 10), h = HOURS[slot % 10], start = day * DAY + h * 3600000, len = DAUER.indexOf(mins) > 0 ? mins : 60;
  var when = len >= 1440 ? ["DTSTART;VALUE=DATE:" + stamp(day * DAY).slice(0, 8), "DTEND;VALUE=DATE:" + stamp((day + 1) * DAY).slice(0, 8)] : ["DTSTART:" + stamp(start), "DTEND:" + stamp(start + len * 60000)];
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//My Daily Idea//Termin//DE", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    "UID:termin-" + C.hash32(String(title) + "|" + slot) + "@bunsenbrenner.org", "DTSTAMP:" + stamp(stampOf(now)) + "Z"].concat(when, ["SUMMARY:" + esc(title || "Termin"), "END:VEVENT", "END:VCALENDAR"]).map(fold75).join("\r\n") + "\r\n";
}

// ---------- the way without AI: a small rule reader for German and English (concept: "zuerst ein lokaler Regel-Parser") ----------
function norm(s) { return " " + String(s || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9:.€ ]+/g, " ").replace(/\.(?!\d)/g, " ").replace(/\s+/g, " ") + " "; }
var DAYS = [["mo", "montag", "monday"], ["di", "dienstag", "tuesday"], ["mi", "mittwoch", "wednesday"], ["do", "donnerstag", "thursday"], ["fr", "freitag", "friday"], ["sa", "samstag|sonnabend", "saturday"], ["so", "sonntag", "sunday"]];
var NUM = { ein: 1, eine: 1, einer: 1, einen: 1, one: 1, an: 1, a: 1, zwei: 2, two: 2, drei: 3, three: 3, vier: 4, four: 4, fuenf: 5, five: 5, sechs: 6, six: 6, acht: 8, eight: 8 };
var PLACES = [["online", /\b(online|video|zoom|call|teams)\b/], ["zuhause", /\b(bei (mir|uns)|zuhause|zu hause|at (my|our) place|at home)\b/], ["park", /\bpark\b/], ["draussen", /\b(draussen|garten|outside|garden)\b/],
  ["cafe", /\b(cafe|kaffee trinken)\b/], ["restaurant", /\brestaurant\b/], ["schule", /\b(schule|klasse|school)\b/], ["buero", /\b(buero|office)\b/], ["verein", /\b(verein|club)\b/], ["sporthalle", /\b(sporthalle|halle|gym)\b/]];
var BRING = [["getraenke", /getraenk|drinks/], ["salat", /salat|salad/], ["snacks", /snack|chips/], ["kuchen", /kuchen|cake/], ["grillgut", /grillgut|wurst|wuerst|sausage/], ["brot", /\bbrot|bread/],
  ["dessert", /dessert|nachtisch/], ["obst", /\bobst|fruit/], ["geschirr", /geschirr|teller|plates/], ["spiele", /\bspiele\b|\bgames\b/], ["musik", /musik|music/], ["deko", /\bdeko|decoration/]];
function localPlan(satz) {
  var n = norm(satz), r = { titel: "", wochentage: [], tageszeiten: [], uhrzeit: "", dauer_min: 0, zeitraum: "offen", ort: "offen", mitbringen: [], budget_eur: 0, thema: "", ideen: [], regeltext: "" }, hit = 0;
  DAYS.forEach(function (d) { if (new RegExp(" (" + d[1] + "|" + d[2] + ")").test(n)) r.wochentage.push(d[0]); });
  if (!r.wochentage.length && /wochenende|weekend/.test(n)) r.wochentage = ["sa", "so"];
  if (!r.wochentage.length && /unter der woche|werktags|wochentags|weekdays?/.test(n)) r.wochentage = ["mo", "di", "mi", "do", "fr"];
  var dayBefore = new RegExp("(" + DAYS.map(function (d) { return d[1]; }).join("|") + ") ?morgen");
  if (/morgens|morning| frueh /.test(n) || dayBefore.test(n)) r.tageszeiten.push("morgens");
  if (/vormittag|brunch/.test(n)) r.tageszeiten.push("vormittags");
  if (/(^|[^r])mittag|\bnoon\b|lunch/.test(n.replace(/vormittag|nachmittag/g, ""))) r.tageszeiten.push("mittags");
  if (/nachmittag|afternoon/.test(n)) r.tageszeiten.push("nachmittags");
  if (/ abends? |evening|tonight/.test(n) || (/abend/.test(n) && !r.tageszeiten.length)) r.tageszeiten.push("abends");   // "Spieleabend": evening, unless the sentence says when
  // "18:30", "19 Uhr", "7pm", "12am" (midnight), and a bare hour after "um/ab/gegen/at" ("morgen um 9").
  var t = n.match(/ (\d{1,2}):(\d{2}) /) || n.match(/ (\d{1,2})[.:]?(\d{2})? ?uhr /) || n.match(/ (\d{1,2})(?::(\d{2}))? ?(pm|am) /) || n.match(/ (?:um|ab|gegen|at) (\d{1,2}) (?!uhr )/);
  if (t && +t[1] <= 23 && (!t[3] || (+t[1] >= 1 && +t[1] <= 12))) { var h = t[3] ? +t[1] % 12 + (t[3] === "pm" ? 12 : 0) : +t[1], mi = t[2] ? +t[2] : 0; if (mi <= 59) r.uhrzeit = pad(h) + ":" + pad(mi); }
  var du = n.match(/ (\d{1,2}|ein|eine|einer|zwei|drei|vier|fuenf|sechs|acht|one|two|three|four|five|six|eight|an|a) (stunden?|std|hours?|h) /), dm = n.match(/ (\d{1,3}) (minuten|min|minutes) /);
  var mins = /halbe stunde|half an hour/.test(n) ? 30 : du ? (+du[1] || NUM[du[1]]) * 60 : dm ? +dm[1] : 0;
  if (mins) { r.dauer_min = DAUER.reduce(function (a, b) { return Math.abs(b - mins) < Math.abs(a - mins) ? b : a; }, 0); }
  var dn = DAYS.map(function (d) { return d[1] + "|" + d[2]; }).join("|");
  r.zeitraum = /zwischen den jahren/.test(n) ? "zwischen_den_jahren" : /vor weihnachten|before christmas/.test(n) ? "vor_weihnachten" : /naechsten monat|next month/.test(n) ? "naechsten_monat" :
    /diesen monat|this month/.test(n) ? "diesen_monat" : /in (zwei|2) wochen|in two weeks/.test(n) ? "in_zwei_wochen" : /naechstes wochenende|next weekend/.test(n) ? "naechstes_wochenende" :
    new RegExp("(naechsten|next) (samstag|sonntag|sonnabend|saturday|sunday)").test(n) ? "naechstes_wochenende" : /naechste woche|next week/.test(n) || new RegExp("(naechsten|next) (" + dn + ")").test(n) ? "naechste_woche" :
    /dieses wochenende|this weekend/.test(n) || new RegExp("(diesen|this) (samstag|sonntag|saturday|sunday)").test(n) ? "dieses_wochenende" : /diese woche|this week/.test(n) || new RegExp("(diesen|this) (" + dn + ")").test(n) ? "diese_woche" :
    / (heute|today|tonight) /.test(n) ? "heute" : / tomorrow /.test(n) || (/ morgen /.test(n) && !dayBefore.test(n)) ? "morgen" : "offen";
  PLACES.some(function (p) { if (p[1].test(n)) { r.ort = p[0]; return true; } return false; });
  BRING.forEach(function (b) { if (b[1].test(n) && /bring|mitbring/.test(n)) r.mitbringen.push(b[0]); });
  var eur = n.match(/ (\d{1,4}) ?(€|euro|eur) /); if (eur) r.budget_eur = Math.min(1000, +eur[1]);
  hit = r.wochentage.length + r.tageszeiten.length + (r.uhrzeit ? 1 : 0) + (r.zeitraum !== "offen" ? 1 : 0) + (dateIn(n, dayOf(2000, 1, 1)) ? 1 : 0);
  // The title: the words before the first word about time or place, at most three.
  var CLOCK = /^\d{1,2}([:.]\d{2})?(am|pm|uhr|h)?$/, stop = /^(bei|am|um|im|in|an|ab|mit|fuer|naechste\w*|diese\w*|jeden|jede|heute|morgen|at|on|in|next|this|with|for|every|today|tomorrow|zwischen|vor|unter|irgendwann|egal|online)$/;
  var words = [], raw = String(satz || "").replace(/[,.;:!?].*$/, "").split(/\s+/).filter(Boolean);
  for (var i = 0; i < raw.length && words.length < 3; i++) { var w = norm(raw[i]).trim(); if (stop.test(w) || CLOCK.test(w) || DAYS.some(function (d) { return new RegExp("^(" + d[1] + "|" + d[2] + ")").test(w); })) break; words.push(raw[i]); }
  r.titel = words.join(" ").slice(0, 40);
  if (r.titel) r.titel = r.titel.charAt(0).toUpperCase() + r.titel.slice(1);
  return hit ? r : null;
}
// Which plan the server should read the sentence as, on the date card: an invitation when it sounds like one.
function planArt(satz, business) {
  if (business) return "termin";
  return /einlad|party|feier|fest\b|geburtstag|grill|brunch|picknick|filmabend|spieleabend|bei (mir|uns)|bringt|mitbring|invite|bbq|picnic/.test(norm(satz)) ? "einladung" : "termin";
}
function listArt(satz, mitbring) { return mitbring || /mitbring|bringt|bring /.test(norm(satz)) ? "mitbring" : "einkauf"; }

// ---------- names stay on the device: "Wichteln mit Anna, Ben und Carla" -> the names here, [Name] for the server ----------
var NOT_NAMES = /^(Euro|Eur|Budget|Thema|Freunden?|Familie|Kollegen|Klasse|Team|Büro|Verein|Weihnachten|Advent|Geschenke?|Spaß|Leuten|Personen|Kindern?|Eltern|Oma|Opa|Mama|Papa|Allen|Uns|Euch|Friends|Family|Team|Colleagues)$/;
function names(satz) {
  // Letters with accents too ("Zoë", "Chloé", "Émile"): \p{Lu}\p{Ll} instead of A-Z.
  var s = String(satz || ""), found = [], NAME = "\\p{Lu}\\p{Ll}{1,11}(?:-\\p{Lu}\\p{Ll}{1,11})?";
  var re = new RegExp("(\\b(?:mit|with|für|for|von)\\s+|:\\s*)(" + NAME + "(?:\\s*(?:,|\\bund\\b|\\band\\b|&)\\s*" + NAME + "){2,})(?!\\p{L})", "gu");
  var out = s.replace(re, function (all, lead, list) {
    var l = list.split(/\s*(?:,|\bund\b|\band\b|&)\s*/).filter(Boolean), real = l.filter(function (x) { return !NOT_NAMES.test(x); });
    if (!real.length) return all;      // "mit Freunden, Familie und Kollegen": no names at all
    // A group word in the list ("und Familie") stays as it is; every name next to it still goes out as [Name].
    real.forEach(function (x) { if (found.indexOf(x) < 0 && Array.from(x).length <= 12) found.push(x); });
    return lead + l.map(function (x) { return NOT_NAMES.test(x) ? x : "[Name]"; }).join(", ");
  });
  return { names: found.slice(0, 12), satz: out };
}

// ---------- amounts: the rule table. m: pro_person scales with the people, fix is one of it, nach_bedarf has no amount ----------
// Per person, by unit and category ("_" for any other category). Mass in g, volume in ml, the rest in pieces.
var PER = {
  g: { fleisch_fisch: 200, vegetarisch: 150, obst_gemuese: 150, trockenwaren: 100, milch_kaese: 60, suesses_snacks: 50, tiefkuehl: 150, gewuerze_saucen: 20, backwaren: 100, konserven: 100, _: 100 },
  ml: { getraenke: 1000, milch_kaese: 100, _: 50 },
  stueck: { fleisch_fisch: 2, vegetarisch: 2, backwaren: 2, _: 1 },
  flasche: { getraenke: 0.5, _: 0.25 }, packung: { _: 0.25 }, beutel: { _: 0.25 }, dose: { _: 0.25 }, glas: { _: 0.25 }, bund: { _: 0.25 }
};
var UNIT = { de: { g: "g", kg: "kg", ml: "ml", l: "l", stueck: "Stück", flasche: "Fl.", packung: "Pck.", beutel: "Btl.", dose: "Dose", glas: "Glas", bund: "Bund" }, en: { g: "g", kg: "kg", ml: "ml", l: "l", stueck: "pcs", flasche: "btl", packung: "pk", beutel: "bag", dose: "can", glas: "jar", bund: "bunch" } };
function num(x, lang) { var s = String(Math.round(x * 10) / 10); return lang === "en" ? s : s.replace(".", ","); }
function cut(s, n) { s = String(s).trim(); return Array.from(s).length > n ? Array.from(s).slice(0, n).join("").trim() : s; }
/* One item -> { text, qty, amount } for the shopping list (text at most 24 characters, qty a count 1-99). p: people for this
   item. Pieces and packs become the count ("12× Bratwurst"), mass and volume go into the text ("Mehl 500 g"). */
function amount(item, p, lang) {
  var u = item.e === "kg" ? "g" : item.e === "l" ? "ml" : item.e, tab = PER[u] || PER.packung, per = tab[item.kat] != null ? tab[item.kat] : tab._, U = UNIT[lang === "en" ? "en" : "de"];
  if (item.m === "nach_bedarf" || p < 1) return { text: cut(item.n, 24), qty: 1, amount: "" };
  if (u === "g" || u === "ml") {
    if (item.m === "fix") return { text: cut(item.n, 24), qty: 1, amount: "" };
    var v = per * p, big = v >= 1000, show = big ? num(Math.ceil(v / 500) * 0.5, lang) + " " + (u === "g" ? U.kg : U.l) : Math.ceil(v / 50) * 50 + " " + (u === "g" ? U.g : U.ml);
    return { text: cut(item.n, 23 - show.length) + " " + show, qty: 1, amount: show };
  }
  var q = item.m === "fix" ? 1 : Math.max(1, Math.min(99, Math.ceil(per * p)));
  return { text: cut(item.n, 24), qty: q, amount: q + " " + (U[item.e] || "") };
}
/* The whole list: o = the liste option, p people, v of them vegetarian. A meat item (veg false) is for p - v, an item of the
   vegetarian category for v (or everybody when nobody is), the rest for everybody. noMeat: the profile says vegetarian. */
function shopList(o, p, v, lang, noMeat) {
  v = Math.max(0, Math.min(v || 0, p));
  return (o.posten || []).filter(function (x) { return !(noMeat && x.veg === false); }).map(function (x) {
    var who = x.m !== "pro_person" ? p : x.veg === false ? p - v : x.kat === "vegetarisch" && v ? v : p;
    var a = amount(x, who, lang); a.n = x.n; a.kat = x.kat; a.m = x.m; a.skip = who < 1; return a;
  }).filter(function (a) { return !a.skip && a.text; });
}

// ---------- deadlines: relative to the event day, counted here ----------
var FRIST = { sofort: null, "2_wochen_vorher": -14, "1_woche_vorher": -7, "3_tage_vorher": -3, "1_tag_vorher": -1, am_tag: 0, danach: 1 };
// -> the due day (a day number), 0 for none; never before today.
function due(frist, event, today) { if (frist === "offen" || !(frist in FRIST)) return 0; var d = FRIST[frist] === null ? today : event + FRIST[frist]; return Math.max(today, d); }
/* A calendar date in a normed sentence ("12.11.", "3.1.27"), else 0: only a real day ("31.2." is none) and not a time
   ("um 10.11 Uhr"). Without a year the next such day from today. */
function dateIn(n, today) {
  var re = / (\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?!\d)/g, m;
  while ((m = re.exec(n))) {
    var rest = n.slice(m.index + m[0].length), before = n.slice(0, m.index + 1);
    if (/^ ?(uhr|h) /.test(rest) || / (um|ab|gegen|bis|at) $/.test(before)) continue;
    var yr = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : ymd(today)[0], mo = +m[2], da = +m[1], d = dayOf(yr, mo, da), x = ymd(d);
    if (x[1] !== mo || x[2] !== da) continue;
    if (!m[3] && d < today) { d = dayOf(yr + 1, mo, da); x = ymd(d); if (x[1] !== mo || x[2] !== da) continue; }      // 29.2. next year
    return d;
  }
  return 0;
}
// The date the sentence names ("Treffen am 12.11. um 19 Uhr"), else 0: the date card asks for that day only.
function namedDay(satz, today) { return dateIn(norm(satz), today); }
// The event day from the sentence when it names one ("am 14.12.", "Samstag", "in 3 Wochen", "morgen"), else 0.
function eventDay(satz, today) {
  var n = norm(satz), m, fixed = dateIn(n, today);
  if (fixed) return fixed;
  if ((m = n.match(/ in (\d{1,2}|zwei|drei|vier|two|three|four) (tagen|wochen|days|weeks) /))) return today + (+m[1] || NUM[m[1]]) * (/w/.test(m[2]) ? 7 : 1);
  if (/ uebermorgen /.test(n)) return today + 2;
  if (/ (morgen|tomorrow) /.test(n)) return today + 1;
  for (var i = 0; i < DAYS.length; i++) if (new RegExp(" (am |on |naechsten |next )?(" + DAYS[i][1] + "|" + DAYS[i][2] + ")").test(n)) { var k = (i + 1) % 7, ahead = (k - wd(today) + 7) % 7 || 7; return today + ahead; }
  return 0;
}
// Tasks for the todo list (turns.js todoFrom): [[what, "", due day]], who stays empty: people pick a task themselves.
function tasks(o, event, today) { return (o.aufgaben || []).map(function (x) { return [x.was, "", due(x.frist, event, today)]; }); }

export { HOURS, PER, amount, dayOf, due, easter, eventDay, holiday, holidays, ics, listArt, localPlan, namedDay, names, period, planArt, shopList, slots, tasks };
