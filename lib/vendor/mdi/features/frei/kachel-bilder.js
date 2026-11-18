// Freie Karte 2, Klaerungsdialog: die Bilder der Kacheln und was sie zeigen. Reine Daten und Funktionen ohne DOM, Uhr
// oder Netz; der Wrapper vendort die Datei mit klaerung.js (CADS-DEMO-wrapper bin/vendor-mdi.mjs).
//
// Jedes Bild hat ein Hauptwort (de/en, so wie die Bild-Text-Pruefung es dem Vision-Modell anbietet) und Woerter, die es
// zeigt. Der Server prueft jede Kachel mit bildFuer(): passt das Wort im Label nicht zum Bild des Modells, nimmt er das
// Bild, das das Wort zeigt; kennt er kein passendes Bild, zeigt er NEUTRAL – nie ein falsches Bild (Befund B5: "Ein Baer"
// mit Pinguin, "Ein Eichhoernchen" mit Hase, weil es weder Baer noch Eichhoernchen gab und das Modell das Naechste nahm).
//
// Woerter stehen normalisiert (klein, ae/oe/ue/ss). Ab 4 Zeichen gilt ein Wort auch als Ende eines Worts ("baer" ->
// "Eisbaer", "boot" -> "Segelboot", mit Endung -e/-en/-n/-s/-es/-er/-chen) und als Anfang, wenn danach eine Endung oder ein
// Wortteil von mindestens 4 Zeichen folgt ("pinguin" -> "Pinguine", "hund" -> "Hundehuette", nicht "hundert"); kuerzere
// Woerter gelten nur genau ("eis" trifft nicht "Reise"). Ein Ende wiegt mehr als ein Anfang (das Grundwort eines
// Kompositums steht hinten: "Tigerente" ist eine Ente). Keine Waffen, kein Blut.

/** [Bild, Hauptwort de, Hauptwort en, Woerter] */
const B = [
  ["⛵", "Ein Segelboot", "A sailboat", "segelboot segelschiff segel segler segeln boot sailboat sailing sail boat"],
  ["🚤", "Ein Motorboot", "A speedboat", "motorboot speedboot schnellboot rennboot boot speedboat motorboat boat"],
  ["🛶", "Ein Kanu", "A canoe", "kanu kajak paddelboot paddeln paddel canoe kayak paddle"],
  ["🚢", "Ein Schiff", "A ship", "schiff dampfer kreuzfahrt ozeandampfer frachter ship steamer cruise"],
  ["🦆", "Eine Ente", "A duck", "ente badeente entchen erpel duck duckling"],
  ["🐸", "Ein Frosch", "A frog", "frosch froesche kroete frog toad"],
  ["🐙", "Ein Krake", "An octopus", "krake kraken oktopus tintenfisch octopus squid"],
  ["🦝", "Ein Waschbär", "A raccoon", "waschbaer raccoon"],
  ["🐌", "Eine Schnecke", "A snail", "schnecke langsam gemuetlich snail slug slow"],
  ["🦖", "Ein T-Rex", "A T. rex", "dino dinosaurier saurier rex trex tyrannosaurus dinosaur"],
  ["🐶", "Ein Hund", "A dog", "hund hunde hundchen welpe dackel dog puppy doggy"],
  ["🐱", "Eine Katze", "A cat", "katze kater kaetzchen mieze kitty cat kitten"],
  ["🦄", "Ein Einhorn", "A unicorn", "einhorn unicorn"],
  ["🐝", "Eine Biene", "A bee", "biene hummel bee bumblebee"],
  ["🐧", "Ein Pinguin", "A penguin", "pinguin penguin"],
  ["🦉", "Eine Eule", "An owl", "eule uhu kauz owl"],
  ["🐳", "Ein Wal", "A whale", "wal wale walfisch whale"],
  ["🐠", "Ein Fisch", "A fish", "fisch fische goldfisch fishy fish"],
  ["🐉", "Ein Drache", "A dragon", "drache drachen dragon"],
  ["🦋", "Ein Schmetterling", "A butterfly", "schmetterling falter butterfly"],
  ["🐞", "Ein Marienkäfer", "A ladybird", "marienkaefer kaefer ladybird ladybug beetle"],
  ["🐢", "Eine Schildkröte", "A turtle", "schildkroete langsam gemuetlich turtle tortoise slow"],
  ["🐇", "Ein Hase", "A rabbit", "hase hasen haeschen kaninchen osterhase rabbit bunny hare"],
  ["🐻", "Ein Bär", "A bear", "baer teddy grizzly bear bears"],
  ["🐿️", "Ein Eichhörnchen", "A squirrel", "eichhoernchen eichhorn hoernchen squirrel chipmunk"],
  ["🦊", "Ein Fuchs", "A fox", "fuchs fuechse fox"],
  ["🐼", "Ein Panda", "A panda", "panda pandabaer"],
  ["🐨", "Ein Koala", "A koala", "koala"],
  ["🦁", "Ein Löwe", "A lion", "loewe loewin lion lioness"],
  ["🐯", "Ein Tiger", "A tiger", "tiger"],
  ["🐘", "Ein Elefant", "An elephant", "elefant elephant"],
  ["🦒", "Eine Giraffe", "A giraffe", "giraffe"],
  ["🐴", "Ein Pferd", "A horse", "pferd pony fohlen horse foal"],
  ["🐮", "Eine Kuh", "A cow", "kuh kuehe rind kalb cow cows calf"],
  ["🐷", "Ein Schwein", "A pig", "schwein ferkel pig piglet"],
  ["🐔", "Ein Huhn", "A chicken", "huhn huehner henne hahn kueken chicken hen rooster chick"],
  ["🐭", "Eine Maus", "A mouse", "maus maeuse mouse mice"],
  ["🦔", "Ein Igel", "A hedgehog", "igel hedgehog"],
  ["🐺", "Ein Wolf", "A wolf", "wolf woelfe wolves"],
  ["🐒", "Ein Affe", "A monkey", "affe affen monkey ape"],
  ["🐑", "Ein Schaf", "A sheep", "schaf schafe lamm sheep lamb"],
  ["🦀", "Eine Krabbe", "A crab", "krabbe krebs crab"],
  ["🦈", "Ein Hai", "A shark", "hai haie haifisch shark"],
  ["🐬", "Ein Delfin", "A dolphin", "delfin delphin dolphin"],
  ["🦜", "Ein Papagei", "A parrot", "papagei parrot"],
  ["🐊", "Ein Krokodil", "A crocodile", "krokodil alligator crocodile"],
  ["🦓", "Ein Zebra", "A zebra", "zebra"],
  ["🦘", "Ein Känguru", "A kangaroo", "kaenguru kangaroo"],
  ["🐦", "Ein Vogel", "A bird", "vogel voegel spatz meise amsel bird sparrow"],
  ["🍕", "Eine Pizza", "A pizza", "pizza"],
  ["🍩", "Ein Donut", "A donut", "donut doughnut krapfen"],
  ["🍪", "Ein Keks", "A cookie", "keks kekse plaetzchen cookie biscuit"],
  ["🎂", "Ein Kuchen", "A cake", "kuchen torte geburtstag cake birthday"],
  ["🍉", "Eine Melone", "A watermelon", "melone wassermelone watermelon melon"],
  ["🍓", "Eine Erdbeere", "A strawberry", "erdbeere erdbeeren strawberry"],
  ["🥨", "Eine Brezel", "A pretzel", "brezel breze pretzel"],
  ["🧁", "Ein Muffin", "A cupcake", "muffin cupcake toertchen"],
  ["🍎", "Ein Apfel", "An apple", "apfel aepfel apple"],
  ["🍌", "Eine Banane", "A banana", "banane banana"],
  ["🥕", "Eine Karotte", "A carrot", "karotte moehre rueebli carrot"],
  ["🍦", "Ein Eis", "An ice cream", "eis speiseeis eiscreme eistuete softeis icecream ice cream"],
  ["🚀", "Eine Rakete", "A rocket", "rakete rocket"],
  ["🛸", "Ein Ufo", "A UFO", "ufo ufos raumschiff untertasse spaceship saucer"],
  ["👽", "Ein Alien", "An alien", "alien aliens ausserirdischer marsmensch"],
  ["🪐", "Ein Planet", "A planet", "planet planeten saturn weltall weltraum space"],
  ["🌟", "Ein Stern", "A star", "stern sterne sternchen star stars"],
  ["☄️", "Ein Komet", "A comet", "komet meteor meteorit asteroid comet"],
  ["🌈", "Ein Regenbogen", "A rainbow", "regenbogen bunt farbig rainbow colorful colourful"],
  ["☀️", "Die Sonne", "The sun", "sonne sonnig sommer sun sunny summer"],
  ["🌙", "Der Mond", "The moon", "mond nacht moon night"],
  ["❄️", "Eine Schneeflocke", "A snowflake", "schneeflocke schnee winter eisig frost snowflake snow"],
  ["⛄", "Ein Schneemann", "A snowman", "schneemann snowman"],
  ["🌊", "Eine Welle", "A wave", "welle wellen meer ozean wave waves sea ocean"],
  ["🌸", "Eine Kirschblüte", "A blossom", "bluete blueten kirschbluete blossom"],
  ["🌻", "Eine Sonnenblume", "A sunflower", "sonnenblume blume blumen sunflower flower"],
  ["🍀", "Ein Kleeblatt", "A four-leaf clover", "kleeblatt klee glueck glueckspilz clover luck lucky"],
  ["🌳", "Ein Baum", "A tree", "baum baeume wald tree trees forest"],
  ["⛰️", "Ein Berg", "A mountain", "berg berge gebirge huegel mountain mountains hill"],
  ["🏠", "Ein Haus", "A house", "haus haeuser zuhause house home"],
  ["🎈", "Ein Luftballon", "A balloon", "luftballon ballon balloon"],
  ["🎉", "Eine Party", "A party", "party feier konfetti celebration confetti"],
  ["🎁", "Ein Geschenk", "A present", "geschenk paket ueberraschung present gift surprise"],
  ["🎮", "Ein Controller", "A game controller", "controller konsole zocken gamepad videospiel"],
  ["🎲", "Ein Würfel", "Dice", "wuerfel wuerfeln zufall dice random"],
  ["🧩", "Ein Puzzle", "A puzzle", "puzzle puzzleteil puzzles"],
  ["🏆", "Ein Pokal", "A trophy", "pokal trophaee sieg sieger gewinnen gewinner meister trophy winner win champion"],
  ["⚽", "Ein Fußball", "A football", "fussball fussballer kicken soccer football"],
  ["🏀", "Ein Basketball", "A basketball", "basketball korb basket"],
  ["🎯", "Eine Zielscheibe", "A target", "zielscheibe ziel zielen treffer dart darts target bullseye aim"],
  ["🎨", "Eine Malpalette", "A paint palette", "malen farbe farben palette kunst bild painting paint palette art"],
  ["🎵", "Musik", "Music", "musik lied lieder melodie note noten music song tune"],
  ["🎸", "Eine Gitarre", "A guitar", "gitarre guitar"],
  ["🥁", "Eine Trommel", "A drum", "trommel trommeln schlagzeug drum drums"],
  ["📚", "Bücher", "Books", "buch buecher lesen bibliothek wissen book books reading"],
  ["✏️", "Ein Stift", "A pencil", "stift bleistift schreiben zeichnen pencil pen write draw"],
  ["🗺️", "Eine Landkarte", "A map", "landkarte weltkarte map"],
  ["🏰", "Eine Burg", "A castle", "burg schloss ritterburg castle palace"],
  ["🏝️", "Eine Insel", "An island", "insel inseln strand island beach"],
  ["🧭", "Ein Kompass", "A compass", "kompass richtung compass direction"],
  ["💧", "Ein Wassertropfen", "A water drop", "wasser tropfen wasserbombe wasserbomben nass spritzen platsch water drop droplet splash wet"],
  ["🫧", "Seifenblasen", "Bubbles", "seifenblase seifenblasen blase blasen bubble bubbles"],
  ["🎃", "Ein Kürbis", "A pumpkin", "kuerbis halloween pumpkin"],
  ["💡", "Eine Glühbirne", "A light bulb", "gluehbirne lampe licht idee einfall bulb light lamp idea"],
  ["⏱️", "Eine Stoppuhr", "A stopwatch", "stoppuhr uhr zeit sekunden minuten countdown stopwatch clock timer time seconds"],
  ["⚡", "Ein Blitz", "Lightning", "blitz blitzschnell schnell strom energie gewitter lightning bolt fast quick electric"],
  ["💥", "Ein Knall", "A bang", "knall knallen peng bumm boom explosion platzen bang pop"],
  ["🚗", "Ein Auto", "A car", "auto autos wagen rennauto car cars racecar"],
  ["🚲", "Ein Fahrrad", "A bicycle", "fahrrad rad radfahren velo bike bicycle"],
  ["🚂", "Ein Zug", "A train", "zug zuege eisenbahn lok lokomotive bahn train locomotive"],
  ["🚌", "Ein Bus", "A bus", "bus busse schulbus"],
  ["🚜", "Ein Traktor", "A tractor", "traktor trecker tractor"],
  ["🚁", "Ein Hubschrauber", "A helicopter", "hubschrauber helikopter heli helicopter"],
  ["✈️", "Ein Flugzeug", "An airplane", "flugzeug flieger fliegen airplane plane aeroplane jet"],
  ["🛷", "Ein Schlitten", "A sled", "schlitten rodel rodeln schlittenfahren sled sledge sledding toboggan"],
  ["⛷️", "Ski", "Skiing", "ski skier skifahren skifahrer skiing skiier"],
  ["🛹", "Ein Skateboard", "A skateboard", "skateboard skaten skater"],
  ["🙂", "Du selbst", "You", "ich du selbst allein alleine mich dich you me myself yourself alone"],
  ["😄", "Ein Lachen", "A big smile", "lachen lustig froehlich witzig spass laugh funny happy fun smile grin"],
  ["😎", "Cool", "Cool", "cool laessig sonnenbrille sunglasses"],
  ["🤖", "Ein Roboter", "A robot", "roboter robo robot robots"],
  ["🧙", "Ein Zauberer", "A wizard", "zauberer zauberin hexe hexer magier zaubern zauber wizard witch magician magic"],
  ["🧚", "Eine Fee", "A fairy", "fee feen elfe fairy"],
  ["🦸", "Ein Superheld", "A superhero", "superheld superheldin held heldin superhero hero"],
  ["👵", "Oma", "Grandma", "oma omi grossmutter grandma granny grandmother"],
  ["👴", "Opa", "Grandpa", "opa opi grossvater grandpa grandfather"],
  ["👪", "Die Familie", "The family", "familie eltern family parents"],
  ["👧", "Ein Mädchen", "A girl", "maedchen tochter schwester girl daughter sister"],
  ["👦", "Ein Junge", "A boy", "junge sohn bruder boy son brother"],
  ["👶", "Ein Baby", "A baby", "baby babys saeugling"],
  ["🗳️", "Eine Wahlurne", "A ballot box", "wahlurne wahl abstimmung abstimmen umfrage vote voting poll ballot"],
  ["❓", "Ein Fragezeichen", "A question mark", "frage fragen fragezeichen quiz raten raetsel question quiz riddle"],
];

/** Bild, wenn die Kachel nichts zeigt, das ein Bild der Liste traegt: neutral, nie ein falsches Bild */
export const NEUTRAL = "💬";
/** Die Bilder, aus denen das Modell waehlt (Enum im Schema), in fester Reihenfolge */
export const EMOJI = B.map((b) => b[0]);
/** Bild -> { de, en, woerter } */
export const BILDER = Object.freeze(Object.fromEntries(B.map(([e, de, en, w]) => [e, Object.freeze({ de, en, woerter: Object.freeze(w.split(" ")) })])));

/** Text fuer den Vergleich: klein, Umlaute ausgeschrieben, nur Buchstaben und Ziffern als Woerter */
export function norm(s) {
  return String(s).toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/\p{M}/gu, "").split(/[^a-z0-9]+/).filter(Boolean);
}
const ENDUNG = /^(e|en|n|s|es|er|ern|chen)?$/;
/** Wie gut ein Wort t ein Stichwort w trifft: 3 genau, 2 als Ende (Kompositum), 1 als Anfang, 0 nicht */
function treffer(t, w) {
  if (t === w) return 3;
  if (w.length < 4) return 0;
  const i = t.lastIndexOf(w);
  if (i > 0 && ENDUNG.test(t.slice(i + w.length))) return 2;
  if (t.startsWith(w)) { const r = t.slice(w.length); if (ENDUNG.test(r) || r.length >= 4) return 1; }   // "hundert" ist kein Hund
  return 0;
}
/** Index Stichwort -> Bilder; ein Stichwort darf mehreren Bildern gehoeren ("boot": Segel- und Motorboot) */
const WORT = new Map();
for (const [e, b] of Object.entries(BILDER)) for (const w of b.woerter) WORT.set(w, (WORT.get(w) || []).concat(e));

/** Die Bilder, die ein Text zeigt, mit Staerke: Map Bild -> beste Trefferstaerke */
export function bilderIn(text) {
  const out = new Map();
  for (const t of norm(text)) for (const [w, es] of WORT) {
    const s = treffer(t, w);
    if (s) for (const e of es) if ((out.get(e) || 0) < s) out.set(e, s);
  }
  return out;
}

/**
 * Das Bild fuer eine Kachel -> { emoji, grund }. grund: "passt" (Label zeigt das Bild des Modells), "unter" (Label nennt
 * nichts Bekanntes, die Unterzeile traegt das Bild des Modells), "getauscht" (das Label nennt etwas, das ein anderes Bild
 * zeigt: dieses Bild), "neutral" (kein Bild passt sicher: NEUTRAL). Die Unterzeile tauscht nie ein Bild, sie bestaetigt nur.
 */
export function bildFuer(label, sub, emoji) {
  const l = bilderIn(label);
  if (l.size) {
    const best = Math.max(...l.values());
    if (l.get(emoji) === best) return { emoji, grund: "passt" };
    return { emoji: EMOJI.find((e) => l.get(e) === best), grund: "getauscht" };
  }
  if (sub && bilderIn(sub).has(emoji)) return { emoji, grund: "unter" };
  return { emoji: NEUTRAL, grund: "neutral" };
}
