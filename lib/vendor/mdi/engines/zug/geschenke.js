// Geschenkideen ohne KI (geschenke.js, Tag pre-legacy-removal), woertlich: feste Liste, Budget in Euro, was passt und
// fuer wen. Fuenf Ideen je Frage: Vorlieben zuerst, dann die Reihenfolge aus dem Seed im Link, auf jedem Handy gleich.
// Die optionale KI (Art liste) liefert nur Texte; fromAi() saeubert sie und laesst weg, was kein Geschenk sein soll.
import TEXT from "./geschenke.json" with { type: "json" };
import { hash32, mulberry32, clean, fold as qfold } from "./alt.js";
export const MAX = 40, N = 5;
// [Textschluessel (gi_), Euro, Vorlieben, fuer wen]: k Kind, t Teen, a Erwachsene, o Grosseltern, b Kollegin/Kollege
export const LIST = [
  ["tea_tasting", 10, "tee", "aob"], ["coffee_beans", 15, "tee", "aob"], ["nice_mug", 10, "tee gemuet", "taob"],
  ["travel_mug", 15, "tee reisen sport", "tab"], ["tea_strainer", 15, "tee", "aob"], ["hot_chocolate", 5, "suess tee", "ktaob"],
  ["small_succulent", 5, "pflanze", "taob"], ["herb_pots", 10, "pflanze kochen", "aob"], ["flower_bulbs", 10, "pflanze", "aob"],
  ["seed_set", 5, "pflanze", "kaob"], ["mini_greenhouse", 20, "pflanze", "kao"], ["gardening_gloves", 15, "pflanze sport", "ao"],
  ["desk_plant", 15, "pflanze", "ab"], ["bird_feeder", 15, "pflanze", "kao"], ["notebook", 10, "lesen", "taob"],
  ["wooden_bookmark", 5, "lesen", "taob"], ["paperback_bookshop", 15, "lesen", "taob"], ["clip_reading", 15, "lesen technik", "taob"],
  ["picture_book", 15, "lesen", "k"], ["bookshop_voucher", 20, "lesen", "taob"], ["good_pen", 10, "lesen", "aob"],
  ["shaped_sticky", 5, "lesen basteln", "tb"], ["comic_book", 10, "lesen", "kt"], ["reading_magnifier", 15, "lesen technik", "o"],
  ["spice_blend", 10, "kochen", "aob"], ["baking_mix", 10, "kochen suess", "taob"], ["cookie_cutters", 5, "kochen basteln", "ktaob"],
  ["cookbook", 20, "kochen lesen", "tao"], ["good_olive", 15, "kochen", "aob"], ["wooden_spoons", 10, "kochen", "ao"],
  ["lunch_box", 10, "kochen", "ktb"], ["voucher_cook", 5, "kochen", "ao"], ["card_game", 10, "spiel", "ktaob"],
  ["dice_game", 10, "spiel", "ktaob"], ["puzzle_book", 5, "spiel lesen", "taob"], ["500_piece", 15, "spiel gemuet", "tao"],
  ["board_game", 30, "spiel", "ktao"], ["wooden_brain", 10, "spiel", "ktaob"], ["travel_card", 5, "spiel reisen", "ktab"],
  ["sudoku_pad", 5, "spiel", "aob"], ["large_print", 5, "spiel lesen", "o"], ["bubble_wand", 5, "spiel sport", "k"],
  ["headphone_case", 10, "musik technik reisen", "tab"], ["song_book", 15, "musik", "kao"], ["harmonica", 20, "musik", "kta"],
  ["shaker_eggs", 5, "musik", "k"], ["concert_voucher", 50, "musik", "ta"], ["simple_headphones", 20, "musik technik", "ta"],
  ["colouring_book", 5, "basteln", "kao"], ["coloured_pencils", 10, "basteln", "kta"], ["modelling_clay", 5, "basteln", "k"],
  ["origami_paper", 5, "basteln", "ktab"], ["beginners_knitting", 20, "basteln gemuet", "tao"], ["watercolour_paints", 15, "basteln", "ktao"],
  ["stamp_set", 10, "basteln", "ktb"], ["sticker_book", 5, "basteln", "k"], ["science_kit", 30, "technik basteln", "kt"],
  ["homemade_photo", 20, "basteln gemuet", "ao"], ["skipping_rope", 5, "sport", "kta"], ["frisbee", 5, "sport", "ktab"],
  ["water_bottle", 15, "sport reisen", "ktab"], ["head_torch", 20, "sport reisen technik", "ta"], ["badminton_set", 15, "sport", "kta"],
  ["bike_light", 15, "sport technik", "ta"], ["local_walking", 15, "sport reisen lesen", "ao"], ["cable_organiser", 10, "technik", "tab"],
  ["phone_stand", 10, "technik", "taob"], ["small_power", 20, "technik reisen", "tab"], ["small_bluetooth", 30, "technik musik", "ta"],
  ["torch", 10, "technik sport", "ktao"], ["desk_organiser", 15, "technik lesen", "ab"], ["luggage_tag", 5, "reisen", "tab"],
  ["travel_neck", 15, "reisen gemuet", "tao"], ["scratch_off", 20, "reisen", "ta"], ["travel_guide", 20, "reisen lesen", "ao"],
  ["voucher_day", 5, "reisen gemuet", "ktao"], ["cosy_socks", 5, "gemuet", "ktaob"], ["candle_jar", 10, "gemuet", "aob"],
  ["hot_water", 15, "gemuet", "ktao"], ["fleece_blanket", 30, "gemuet", "ktao"], ["cuddly_toy", 15, "gemuet", "k"],
  ["photo_album", 15, "gemuet basteln", "ao"], ["mini_zen", 10, "gemuet pflanze", "ab"], ["cinema_voucher", 20, "gemuet", "ta"],
  ["fair_trade", 5, "suess", "ktaob"], ["home_baked", 5, "suess kochen", "ktaob"], ["jar_sweets", 10, "suess", "ktaob"],
  ["honey_beekeeper", 10, "suess kochen", "aob"]
];

export const WHO = { kind: "k", teen: "t", partner: "a", eltern: "a", oma: "o", freund: "a", kollege: "b" };
const STEM = ["alkohol", "wein", "bier", "sekt", "schnaps", "likor", "likoer", "whisky", "whiskey", "wodka", "vodka", "prosecco", "cocktail", "liquor", "liqueur", "wine", "beer",
  "zigar", "tabak", "cigar", "tobacco", "vape", "shisha", "casino", "kasino", "lotto", "lotterie", "lottery", "gambl", "betting", "wettschein", "sportwett",
  "diat", "diaet", "abnehm", "kalorie", "diet", "slimming", "parfum", "parfuem", "perfume", "deodorant", "dessous", "unterwasche", "unterwaesche", "lingerie", "underwear", "erotik", "erotic", "sexy"];
const WORD = ["gin", "rum", "sex", "deo", "bet", "wette", "wetten", "spirits", "weight"];
const END = ["wein", "bier", "sekt", "schnaps", "likor", "likoer", "wette", "wetten", "diat"];
const FINE = ["schwein", "insekt"];
function ends(w, l) { return l.some((s) => w.length >= s.length && w.slice(-s.length) === s); }
function bad(w) { return WORD.indexOf(w) >= 0 || STEM.some((s) => w.indexOf(s) === 0) || (ends(w, END) && !ends(w, FINE)); }
function fold(s) { return String(s).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss"); }
export function text(x, lang) { return (TEXT[lang] || TEXT.de)["gi_" + x[0]]; }
/** ask: { who, euro, likes: [key, key] } -> fuenf Texte in der Sprache (geschenke.js:59). */
export function ideas(seed, ask, lang) {
  const f = WHO[ask.who] || "a", likes = ask.likes || [], r = mulberry32(hash32("gift|" + seed + "|" + ask.who + "|" + ask.euro + "|" + likes.join(",")));
  return LIST.filter((x) => x[3].indexOf(f) >= 0 && x[1] <= ask.euro).map((x) => {
    const hit = likes.filter((l) => x[2].split(" ").indexOf(l) >= 0).length;
    return { x, s: hit * 4 + (x[1] * 2 >= ask.euro ? 1 : 0) + r() };
  }).sort((a, b) => b.s - a.s).slice(0, N).map((o) => text(o.x, lang));
}
export function ok(s) { return !fold(s).split(/[^a-z0-9]+/).some(bad); }
/** Antwort der KI-Art liste (posten[].n) -> hoechstens fuenf saubere, neue, harmlose Texte. */
export function fromAi(opt) {
  const out = [], seen = Object.create(null);
  ((opt && opt.posten) || []).forEach((p) => {
    const t = clean(p && p.n, MAX), k = qfold(t);
    if (out.length < N && t && k && !seen[k] && ok(t)) { seen[k] = 1; out.push(t); }
  });
  return out;
}
