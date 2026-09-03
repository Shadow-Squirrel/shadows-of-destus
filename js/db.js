// ─────────────────────────────────────────────────────────────
//  db.js — the site's librarian. Every page asks THIS file for
//  data; no page talks to the database directly.
//
//  Two modes:
//   • demo — no Supabase keys in config.js yet: serves the
//     sample data below, edits live only until you refresh.
//   • real — Supabase connected: reads/writes the database,
//     and Row Level Security (schema.sql) enforces who may
//     do what, no matter what this JavaScript says.
// ─────────────────────────────────────────────────────────────
import { CONFIG } from "./config.js";

let sb = null;              // the Supabase client (real mode only)
let mode = "demo";

export async function initDb() {
  if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
    const { createClient } = await import(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
    );
    sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    mode = "real";
  }
  return mode;
}
export const isReal = () => mode === "real";

// Unwraps a Supabase response, turning its error into a thrown one.
async function q(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}

/* ═══ Demo data (what you see before Supabase is connected) ═══ */
const now = Date.now();
const ago = (d) => new Date(now - d * 864e5).toISOString();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()));

const DEMO = {
  members: [
    { id: uid(), email: "dm@example.com", display_name: "The DM", role: "dm" },
    { id: uid(), email: "tav@example.com", display_name: "Tav's player", role: "player" },
  ],
  sections: [
    { id: uid(), sort_order: 1, title: "The World", body: `*None of this is secret. Your character grew up knowing all of it.*

Destus is scattered. Five big landmasses and a long chain of islands, set far enough apart in open water that no two of them share a road. If you're going anywhere worth going, you're going by ship, and you're going to spend three days at a quay waiting on weather while a man named Ferris tells you about his hernia.

It's a decent time to be alive. Harvests have been good. The roads are safe enough that highwaymen have to advertise. There's a war, technically, but nobody's fought a battle in sixty years and these days it mostly amounts to two countries refusing to sell each other anything and being extremely smug about it.

You'll spend this campaign in **Tormir**, on a coast where old forest runs down into tidal marsh, in a town of four hundred people that smells so aggressively of fish that the smell has opinions.` },
    { id: uid(), sort_order: 2, title: "Magic", body: `Magic is common. Not spectacular — common, the way carpentry is common.

Every village has somebody. She sells charms, blesses foundations, keeps rats out of the grain, and gets dragged into arguments about whose cow it actually is. Any inn worth the name lights its rooms without oil and keeps the cellar cold without ice. Ships carry a weather-reader the way they carry a cook, and the fee turns up on the manifest between the salt pork and the rope.

And because it's common, people use it for exactly what you'd expect people to use it for. The three most widely sold enchantments in the world keep beer cold, get stains out of linen, and are not discussed in front of children. There is an entire guild in Atropia whose members will tell you with a straight face that they specialise in "domestic comfort." Everyone knows what that means. Everyone pretends not to.

Nobody flinches at a spell. Nobody's impressed either, unless it's unusually good. A kid who lights a candle from across the room gets told to stop showing off and eat his supper.

What people respect is skill. There's a long way between the woman selling luck-knots off a market stall and someone who did nine years at the colleges in Istrim, and everyone knows precisely where that gap sits. The first costs coppers and is on every corner. The second gets consulted by kings and charges like it.

So cast freely. Nobody's burning anybody. Worst case a publican asks if you'd mind doing that outside, and he's asking because of the last group, not because of you.` },
    { id: uid(), sort_order: 3, title: "Tormir", body: `Tormir is the most important country in the world, and the reason is faintly embarrassing: it writes everything down.

Not as a figure of speech. There is a clerk in every town of any size and he has your name, your father's name, what your family owns, what you owe, what you were christened, and what you paid for your last horse. Land registers going back four hundred years. Wills, marriages, burials, manifests, harvest yields, court judgments, and a truly unhinged amount of correspondence about drainage. All of it copied, indexed, filed, and — this is the part that gets other countries — *findable*.

You cannot be born in Tormir without paperwork. You cannot die in Tormir without paperwork. A Tormiran will tell you this is why the country works, and the infuriating thing is that he's right. You can settle a dispute here by producing a document, which anywhere else would be regarded as a party trick.

The place itself is old forest and river valley. **Elderwood** in the west, **Kingshade** in the north, **Blackmire Wood** running down to the southeastern coast, the **Frostpine Range** cutting across the southwest, good farmland in the gaps between. Along the eastern shore it all gives way to marsh — reed, channel, black water, and fog off the sea most mornings.

**Crowspire**, the capital, sits deep in the forest. Spires, stone bridges, and an unreasonable number of buildings that are just archives with roofs on.

Tormirans are polite, unhurried, and utterly insufferable about their own filing.` },
    { id: uid(), sort_order: 4, title: "Everywhere Else", body: `**Vantreach** — the frozen north end of Tormir's landmass. Black pine, granite, a volcano called Varell, and four workable months a year. They build the best ships afloat and rent out sailors to anyone paying. Their history lives in songs of extraordinary length, all of which end with somebody drowning, usually shortly after making a decision about a woman that everyone else had advised against.

**The Corrin Republic** — nine rocky islands with more money than anywhere else in the world. They own the shipping and print the charts everyone navigates by. A Corriner will absolutely screw you, but it will be in writing, it will be legal, and you will have signed it yourself while thanking him for his time.

**Atropia** — the warm southern coast. Terraced hills, long bays, and the best wine anyone has ever made. Also olives, glass, dye, and the aforementioned domestic comfort industry. Enormously rich, permanently squabbling with itself, and utterly uninterested in anyone else's problems. An Atropian noble will spend more on a garden than on soldiers and think you're a peasant for raising it.

**The Kethrin Holds** — high dry mountain country in the east, and everything crossing that continent has to pass through it. They charge for the privilege. Their mercenaries are famous for executing a contract to the exact letter and then stopping dead, regardless of what's happening at the time, which has ended at least two battles in ways nobody enjoyed.

**Denovia** — far east, beyond the mountains, facing an ocean nobody has crossed. Deepest mines and finest steel in the world, and at **Istrim**, nine colleges and a library scholars spend a decade petitioning to enter. Everyone in Tormir was raised to hate Denovia. Almost nobody in Tormir has ever met one. *Play one. It'll be great.*

**The Sethari** — the grass east of the mountains, running further than anyone's bothered to map. Best horses anywhere. No cities, no books, and a memory that runs hundreds of lines long and doesn't drop a word between generations.

**The Kared Klans** — the southern island where the sea lanes meet the caravan roads. Thirty trading families who've spent eight centuries arguing about who outranks whom and have never once settled it. Spice, incense, dye, ivory, glass worth crossing an ocean for, and a marriage-alliance chart so complex it's hung on a wall.

**The Quiet Reach** — not a country. A big dead landmass sitting alone in the middle of the sea, covered in ruins. A few hundred salvagers work the coast and none of them stay past forty.` },
    { id: uid(), sort_order: 5, title: "Things Everybody Knows", body: `**The Ashwardens.** When a town burns down, these are the people who come. Crown-funded relief service, and genuinely excellent — tents up within a day, clean water, healers, hot food, and they don't leave until it's finished. Ask anyone's grandmother about the Ashwardens and settle in, because she has a story and it's a kind one.

**Bad years.** Every so often a place has one. A tremor where tremors don't happen. A fire nobody can account for. A stretch of ground that turns sour and grows nothing for a decade. Rare enough to be worth talking about, common enough that everyone's heard of a case. The Ashwardens turn up, and that's generally that.

**The gifted.** Nothing to do with magic. A few hundred people in the world are simply born with something — one specific, permanent, inexplicable knack. Might be devastating. Might be worthless. Might be genuinely humiliating. It can't be taught, can't be learned, can't be got rid of, and it's poor manners to ask.

**You're one of them.**` },
    { id: uid(), sort_order: 6, title: "Things Nobody Can Explain", body: `Every world has its loose threads. Here are Destus's, all of them things a curious person could actually chase.

**The Ashwardens are sometimes quick.** Not always. But there are stories — a granary fire where the relief wagons were on the road before the smoke cleared, a flooded valley where the tents were up the same evening. People notice, shrug, and say they must have had a column nearby. It comes up in taverns roughly as often as any other harmless oddity.

**Nobody sails near the Quiet Reach.** Every lane on every chart bends to give it a wide berth. Ask a captain why and he'll tell you the water's bad off that shore, which is true. Ask who decided the lanes should run that way and he won't have an answer, because the charts have always looked like that.

**Nobody can date the ruins.** Not *won't* — can't. Every scholar who has tried has produced a different number and been comprehensively torn apart by every other scholar. There is no agreed answer and there has never been one.

**Crowspire has three founding stories.** All official. All taught. All with documents behind them. The city that solves other people's disputes by producing paperwork cannot settle its own origin and has stopped trying.

**There's a village called Ashwatch on old charts and not on new ones.** Nobody knows what it watched.

**Children's rhymes are older than the books.** Songs and skipping-rhymes come up in places thousands of miles apart with the same words in them, some of which aren't words in any language currently spoken. Scholars find this charming and don't pursue it.

*(And for balance: people will also tell you the Corrin banks are run by a five-hundred-year-old woman, that Varell erupts when a king dies, and that there's a sea serpent in the Stormwake that only eats tax collectors. Some of what you hear is nonsense. Working out which is the game.)*` },
    { id: uid(), sort_order: 7, title: "What This Game Actually Is", body: `Four things, roughly in equal measure.

**Combat.** Plenty of it, and it will be dangerous. Positioning matters, terrain matters, and running away is frequently the correct call.

**Mystery.** Things won't add up. You'll be given real information that points in real directions and you'll be expected to actually think about it. I don't hide answers behind a single perception check — if you pull the thread, you'll get somewhere.

**Strategy.** A lot of problems in this world can't be solved by hitting them. Some of the most dangerous people you'll meet are unarmed, polite, and holding a clipboard. You'll need to plan, and the good plans will be the ones you made in advance rather than in the moment.

**Goofiness.** It's a game and we're here to enjoy ourselves. Be funny. Be filthy. Do the stupid thing occasionally. I will absolutely reward a plan that's idiotic but committed, and I will remember every single terrible decision you make and bring it back later.

Nothing in this world announces itself. No monologues, no cackling, no villains dressed as villains. The dangerous people are polite, and the scariest thing anyone hands you will be a piece of paper with your name on it.

It starts small. It does not stay that way.` },
    { id: uid(), sort_order: 8, title: "Building Your Character", body: `**First level. Any class, race, or background** that fits a world of ports, forests, farmland, and long sea crossings.

# The gift

At session zero you each roll once on a table of a hundred. Whatever comes up is yours permanently — no picking, no rerolls, no trades. Some are terrifying. Some are ridiculous. Some are going to get a laugh and then save the party's collective arse in about six sessions.

Build someone who's had it since childhood, because they have. They've built habits around it and they have opinions about it.

# You're arriving at Willowfen

Four hundred people on Tormir's southeastern coast, built on timber platforms over tidal marsh, reached by causeway or boat. It smells thoroughly of fish. You stop noticing within the hour, which everyone agrees is somehow worse.

It's their fishing festival this week, and they take it far more seriously than any outsider thinks is reasonable.

Decide why you're going — take one of these or invent better:

- work — a contract, a commission, or money somebody owes you
- somebody you knew lives there and you haven't visited in years
- you're waiting on a boat and the boat is late
- you heard the festival was worth seeing and had nothing else on
- you're passing through on the way somewhere else
- you're broke and it's the next town with a bed

# You don't know each other

Not one of you. Six strangers who turned up in the same small town in the same week for completely unrelated reasons. Please don't write a shared backstory — I need this one exactly as it is.

# Three questions

A sentence each is plenty.

- **Who would you cross an ocean for?** They don't have to like you. They don't have to be alive.
- **What are you keeping your distance from?** A place, a person, a debt, a conversation you'd rather not have.
- **What are you good at that isn't on your sheet?** Cooking, joinery, reading weather, remembering faces, calming a spooked horse, lying to an official without blinking.

# Two asks

**Play someone who can be talked into things.** Curious, broke, bored, obligated, nosy, or just decent. A character who has to be persuaded into every scene is hard work for everybody, yourself included.

**Play someone who could get attached.** You start as strangers and that matters. But it's a long campaign, and it goes considerably better if your character is the sort of person who could end up caring about five idiots they met in a swamp.` },
  ],
  quests: [
    { id: "q1", title: "Silence in the Deepvein Mine", status: "active", giver: "Foreman Hilda Coalbrow", location: "Emberfall", reward: "200gp + mining shares", summary: "Find out why every crew sent below stops sending word. The last basket winched up held only helmets.", created_at: ago(21) },
    { id: "q2", title: "The Cartographer's Debt", status: "active", giver: "Maro the mapmaker", location: "Emberfall market", reward: "A 'truthful' map of the region", summary: "Recover Maro's stolen surveying tools from the bandits on the north road.", created_at: ago(9) },
    { id: "q3", title: "Whispers at the Old Shrine", status: "rumor", giver: "Overheard at the Cinder & Song", location: "Hills east of town", reward: "—", summary: "Shepherds say the ruined shrine hums on new-moon nights. Probably nothing. Probably.", created_at: ago(5) },
    { id: "q4", title: "Rats in the Cellar (heroically)", status: "completed", giver: "Innkeep Bram", location: "Cinder & Song inn", reward: "Free lodging, forever-ish", summary: "They were not rats. They were VERY organized mice with a tiny banner. The party negotiated a treaty.", created_at: ago(30) },
  ],
  questUpdates: [
    { id: uid(), quest_id: "q1", body: "Descended to the second gallery — found claw marks that glow faintly in darkness.", created_at: ago(7) },
    { id: uid(), quest_id: "q1", body: "Hilda admits the mine broke into a natural cavern the week before the silence began.", created_at: ago(2) },
    { id: uid(), quest_id: "q4", body: "Treaty signed. The Mouse Baron demands cheese tribute each solstice.", created_at: ago(28) },
  ],
  notes: [
    { id: uid(), title: "Session 3 — Into the mine", session_number: 3, is_private: false, author_email: "tav@example.com", created_at: ago(2), body: "Things we learned:\n- The glowing claw marks match nothing in Maro's bestiary\n- Hilda is hiding something about the cave-in\n- We left rope tied at the second gallery junction (RED knot = way out)" },
    { id: uid(), title: "Don't trust the toll bridge guy", session_number: 2, is_private: false, author_email: "dm@example.com", created_at: ago(9), body: "He 'recognized' Tav from a wanted poster that he couldn't produce. Charged us double. Petty revenge is scheduled." },
  ],
  codex: [
    { id: "c1", name: "Foreman Hilda Coalbrow", kind: "person", status: "neutral", first_met: "Session 1 — Emberfall mine office", author_email: "tav@example.com", created_at: ago(20), description: "Runs the Deepvein mine. Gruff, fair wages, biceps like kegs. Knows more about the cave-in than she says." },
    { id: "c2", name: "The Mouse Baron", kind: "creature", status: "ally", first_met: "Session 1 — inn cellar", author_email: "dm@example.com", created_at: ago(28), description: "Three inches of aristocratic fury. Commands ~200 mice. Honors the treaty scrupulously; addresses the party as 'the Tall Court'." },
    { id: "c3", name: "Maro the Mapmaker", kind: "person", status: "ally", first_met: "Session 2 — market stall", author_email: "tav@example.com", created_at: ago(9), description: "Sells maps that are 'mostly true'. Owes money to someone he won't name. Nervous around dwarves." },
    { id: "c4", name: "The Thing Below (unnamed)", kind: "creature", status: "hostile", first_met: "Only its claw marks, so far", author_email: "dm@example.com", created_at: ago(7), description: "Whatever silenced the mine. Leaves faintly glowing gouges in stone. Eats lantern-light — flames gutter near the deep galleries." },
  ],
  codexNotes: [
    { id: uid(), entry_id: "c1", body: "She flinched when we mentioned the natural cavern. Follow up.", author_email: "tav@example.com", created_at: ago(2) },
    { id: uid(), entry_id: "c2", body: "Gift idea: tiny cape. Diplomatic value: immense.", author_email: "dm@example.com", created_at: ago(27) },
  ],
  maps: [
    { id: uid(), title: "Region — The Emberfall Reaches", category: "region", image_url: "", description: "Sample entry. When the DM uploads real maps they appear here, big and zoomable.", created_at: ago(20) },
    { id: uid(), title: "Deepvein Mine — Gallery 2", category: "battle", image_url: "", description: "Battle map from Session 3.", created_at: ago(2) },
  ],
  party: [
    { id: uid(), character_name: "Tav Underbough", player_name: "Sample player", class_text: "Halfling Rogue 4", ddb_url: "https://www.dndbeyond.com/characters", blurb: "Has never met a lock she respected.", created_at: ago(30) },
    { id: uid(), character_name: "Brother Casque", player_name: "Sample player", class_text: "Warforged Cleric 4", ddb_url: "https://www.dndbeyond.com/characters", blurb: "A walking reliquary with doubts.", created_at: ago(30) },
  ],
};

const sortNew = (arr) => [...arr].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

/* ═══ Auth (real mode; demo pretends you're the DM) ═══ */
export const auth = {
  async session() {
    if (!sb) return { email: "dm@example.com" };
    const { data } = await sb.auth.getSession();
    return data.session ? { email: data.session.user.email } : null;
  },
  signIn: (email, password) => q(sb.auth.signInWithPassword({ email, password })),
  signUp: (email, password) => q(sb.auth.signUp({ email, password })),
  signOut: () => sb.auth.signOut(),
};

/* ═══ Members (the invite list) ═══ */
export const members = {
  mine: async (email) => {
    if (!sb) return DEMO.members[0];
    const rows = await q(sb.from("members").select("*").ilike("email", email).limit(1));
    return rows[0] || null;
  },
  list: async () => (sb ? q(sb.from("members").select("*").order("display_name")) : DEMO.members),
  add: async (email, display_name, role) => {
    if (!sb) return DEMO.members.push({ id: uid(), email, display_name, role });
    await q(sb.from("members").insert({ email: email.toLowerCase(), display_name, role }));
  },
  remove: async (id) => {
    if (!sb) return (DEMO.members = DEMO.members.filter((m) => m.id !== id));
    await q(sb.from("members").delete().eq("id", id));
  },
};

/* ═══ Campaign sections (home page) ═══ */
export const sections = {
  list: async () => (sb ? q(sb.from("campaign_sections").select("*").order("sort_order")) : [...DEMO.sections].sort((a, b) => a.sort_order - b.sort_order)),
  save: async (row) => {
    if (!sb) {
      if (row.id) Object.assign(DEMO.sections.find((s) => s.id === row.id), row);
      else DEMO.sections.push({ ...row, id: uid() });
      return;
    }
    if (row.id) await q(sb.from("campaign_sections").update({ title: row.title, body: row.body, sort_order: row.sort_order }).eq("id", row.id));
    else await q(sb.from("campaign_sections").insert(row));
  },
  remove: async (id) => {
    if (!sb) return (DEMO.sections = DEMO.sections.filter((s) => s.id !== id));
    await q(sb.from("campaign_sections").delete().eq("id", id));
  },
};

/* ═══ Quests + their update log ═══ */
export const quests = {
  list: async () => (sb ? q(sb.from("quests").select("*").order("created_at", { ascending: false })) : sortNew(DEMO.quests)),
  updates: async () => (sb ? q(sb.from("quest_updates").select("*").order("created_at")) : [...DEMO.questUpdates]),
  add: async (row) => {
    if (!sb) return DEMO.quests.push({ ...row, id: uid(), created_at: new Date().toISOString() });
    await q(sb.from("quests").insert(row));
  },
  update: async (id, fields) => {
    if (!sb) return Object.assign(DEMO.quests.find((x) => x.id === id), fields);
    await q(sb.from("quests").update(fields).eq("id", id));
  },
  remove: async (id) => {
    if (!sb) return (DEMO.quests = DEMO.quests.filter((x) => x.id !== id));
    await q(sb.from("quests").delete().eq("id", id));
  },
  addUpdate: async (quest_id, body) => {
    if (!sb) return DEMO.questUpdates.push({ id: uid(), quest_id, body, created_at: new Date().toISOString() });
    await q(sb.from("quest_updates").insert({ quest_id, body }));
  },
};

/* ═══ Notes ═══ */
export const notes = {
  list: async () => (sb ? q(sb.from("notes").select("*").order("created_at", { ascending: false })) : sortNew(DEMO.notes)),
  add: async (row) => {
    if (!sb) return DEMO.notes.push({ ...row, id: uid(), author_email: "dm@example.com", created_at: new Date().toISOString() });
    await q(sb.from("notes").insert(row));
  },
  remove: async (id) => {
    if (!sb) return (DEMO.notes = DEMO.notes.filter((n) => n.id !== id));
    await q(sb.from("notes").delete().eq("id", id));
  },
};

/* ═══ Codex (people & creatures met) ═══ */
export const codex = {
  list: async () => (sb ? q(sb.from("codex_entries").select("*").order("created_at", { ascending: false })) : sortNew(DEMO.codex)),
  notes: async () => (sb ? q(sb.from("codex_notes").select("*").order("created_at")) : [...DEMO.codexNotes]),
  add: async (row) => {
    if (!sb) return DEMO.codex.push({ ...row, id: uid(), author_email: "dm@example.com", created_at: new Date().toISOString() });
    await q(sb.from("codex_entries").insert(row));
  },
  update: async (id, fields) => {
    if (!sb) return Object.assign(DEMO.codex.find((x) => x.id === id), fields);
    await q(sb.from("codex_entries").update(fields).eq("id", id));
  },
  remove: async (id) => {
    if (!sb) return (DEMO.codex = DEMO.codex.filter((x) => x.id !== id));
    await q(sb.from("codex_entries").delete().eq("id", id));
  },
  addNote: async (entry_id, body) => {
    if (!sb) return DEMO.codexNotes.push({ id: uid(), entry_id, body, author_email: "dm@example.com", created_at: new Date().toISOString() });
    await q(sb.from("codex_notes").insert({ entry_id, body }));
  },
  removeNote: async (id) => {
    if (!sb) return (DEMO.codexNotes = DEMO.codexNotes.filter((n) => n.id !== id));
    await q(sb.from("codex_notes").delete().eq("id", id));
  },
};

/* ═══ Maps ═══ */
export const maps = {
  list: async () => (sb ? q(sb.from("maps").select("*").order("created_at", { ascending: false })) : sortNew(DEMO.maps)),
  add: async (row) => {
    if (!sb) return DEMO.maps.push({ ...row, id: uid(), created_at: new Date().toISOString() });
    await q(sb.from("maps").insert(row));
  },
  remove: async (id) => {
    if (!sb) return (DEMO.maps = DEMO.maps.filter((m) => m.id !== id));
    await q(sb.from("maps").delete().eq("id", id));
  },
};

/* ═══ Party roster (links to D&D Beyond) ═══ */
export const party = {
  list: async () => (sb ? q(sb.from("party_characters").select("*").order("created_at")) : [...DEMO.party]),
  add: async (row) => {
    if (!sb) return DEMO.party.push({ ...row, id: uid(), created_at: new Date().toISOString() });
    await q(sb.from("party_characters").insert(row));
  },
  remove: async (id) => {
    if (!sb) return (DEMO.party = DEMO.party.filter((p) => p.id !== id));
    await q(sb.from("party_characters").delete().eq("id", id));
  },
};
