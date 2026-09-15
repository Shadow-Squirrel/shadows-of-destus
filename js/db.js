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

/* ═══ Campaign context ═══
   Every page runs inside ONE campaign. shell.js resolves which one
   (from the user's memberships + a remembered choice) and calls
   setCampaign() before any page code runs. All content reads/writes
   below are scoped to it; the database's RLS enforces the same
   boundary independently, so this scoping is convenience, not the
   security. */
let campaignId = null;
export const setCampaign = (id) => { campaignId = id; };
export const getCampaign = () => campaignId;

// Legacy mode: the multi-campaign migration hasn't been applied yet, so the
// campaign tables/columns don't exist. We then behave like the old
// single-campaign site (no campaign filter, no switcher) so nothing breaks
// in the window between deploying this code and running the migration.
let legacy = false;
export const isLegacy = () => legacy;
const notThere = (e) => /does not exist|relation|schema cache|Could not find|column .* does not exist/i.test(e?.message || "");

function cid() {
  if (!campaignId) throw new Error("No campaign selected");
  return campaignId;
}
// Add the campaign filter / stamp ONLY when we're in multi-campaign mode.
const scope = (query) => (campaignId && !legacy ? query.eq("campaign_id", campaignId) : query);
const stamp = (row) => (campaignId && !legacy ? { ...row, campaign_id: campaignId } : { ...row });
// demo rows without an explicit campaign belong to the first demo campaign
const inCampaign = (row) => legacy || (row.campaign_id ?? "demo-a") === campaignId;

/* ═══ Demo data (what you see before Supabase is connected) ═══ */
const now = Date.now();
const ago = (d) => new Date(now - d * 864e5).toISOString();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()));
// A 128-bit hex token, matching the shape the database mints for invites
// (demo mode only — real tokens come from the server).
const hexToken = () => {
  try {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return (uid() + uid()).replace(/-/g, "").slice(0, 32);
  }
};

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
    { id: uid(), title: "Region — The Emberfall Reaches", category: "region", image_url: "", description: "Sample entry. When the DM uploads real maps they appear here, big and zoomable.", sort_order: 1, revealed: true, created_at: ago(20) },
    { id: uid(), title: "Deepvein Mine — Gallery 2", category: "battle", image_url: "", description: "Battle map from Session 3.", sort_order: 2, revealed: false, created_at: ago(2) },
  ],
  party: [
    { id: uid(), character_name: "Tav Underbough", player_name: "Sample player", class_text: "Halfling Rogue 4", ddb_url: "https://www.dndbeyond.com/characters", blurb: "Has never met a lock she respected.", created_at: ago(30) },
    { id: uid(), character_name: "Brother Casque", player_name: "Sample player", class_text: "Warforged Cleric 4", ddb_url: "https://www.dndbeyond.com/characters", blurb: "A walking reliquary with doubts.", created_at: ago(30) },
  ],
  rolls: [
    { id: uid(), roller_email: "tav@example.com", label: "Sneak Attack", dice: [{ sides: 6, count: 3, results: [4, 2, 6] }], modifier: 0, total: 12, created_at: ago(0.01) },
    { id: uid(), roller_email: "dm@example.com", label: "", dice: [{ sides: 20, count: 1, results: [17] }], modifier: 5, total: 22, created_at: ago(0.02) },
  ],
  characters: [
    {
      id: "ch-demo-1", owner_email: "tav@example.com", created_at: ago(12), updated_at: ago(1),
      name: "Tav Underbough",
      sheet: {
        v: 1, name: "Tav Underbough", level: 4, alignment: "chaotic good", abilityMethod: "standard",
        race: { kind: "srd", index: "halfling", subrace: "lightfoot-halfling" },
        clazz: { kind: "srd", index: "rogue", subclass: "thief", skillChoices: ["stealth", "acrobatics", "perception", "deception"], expertise: ["stealth", "sleight-of-hand"] },
        background: { kind: "custom", name: "Urchin", skills: ["sleight-of-hand", "insight"], tools: ["Thieves' tools", "Disguise kit"], languages: [], feature: { name: "City Secrets", desc: "You know a city's back alleys and rooftops; you and companions travel through it twice as fast." } },
        abilities: { str: 8, dex: 15, con: 13, int: 12, wis: 13, cha: 14 },
        asi: [{ level: 4, kind: "asi", plus: { dex: 2 } }],
        hp: { method: "average", rolled: [], manual: null, current: null, temp: 0 },
        equipment: [
          { kind: "weapon", item: "rapier", qty: 1, equipped: true },
          { kind: "weapon", item: "dagger", qty: 2, equipped: true },
          { kind: "weapon", item: "shortbow", qty: 1, equipped: true },
          { kind: "armor", item: "leather-armor", qty: 1, equipped: true },
          { kind: "pack", item: "burglars-pack", qty: 1 },
          { kind: "gear", item: "thieves-tools", qty: 1 },
        ],
        details: { personality: "Has never met a lock she respected.", ideals: "", bonds: "", flaws: "", backstory: "", appearance: "" },
      },
    },
  ],
  presets: [
    { id: uid(), owner_email: "dm@example.com", name: "Fireball", spec: [{ sides: 6, count: 8 }], modifier: 0 },
    { id: uid(), owner_email: "dm@example.com", name: "Longsword", spec: [{ sides: 20, count: 1 }], modifier: 5 },
  ],
  encounters: [
    { id: "enc1", name: "Ambush on the Mine Road", map_id: null, grid: { cell: 70, feet: 5, show: true }, active: true, created_at: ago(1) },
  ],
  tokens: [
    { id: "tk1", encounter_id: "enc1", kind: "pc", character_id: "ch-demo-1", monster_index: "", label: "Tav", x: 3, y: 5, size: 1, color: "#7fa860", hp_current: null, hp_max: null, conditions: [], hidden: false, initiative: 14, created_at: ago(1) },
    { id: "tk2", encounter_id: "enc1", kind: "monster", character_id: null, monster_index: "goblin", label: "Goblin A", x: 8, y: 4, size: 1, color: "#c05b4d", hp_current: 7, hp_max: 7, conditions: ["prone"], hidden: false, initiative: 12, created_at: ago(1) },
    { id: "tk3", encounter_id: "enc1", kind: "monster", character_id: null, monster_index: "wolf", label: "Wolf", x: 9, y: 6, size: 1, color: "#8fa3b0", hp_current: 11, hp_max: 11, conditions: [], hidden: true, initiative: 8, created_at: ago(1) },
  ],
  // two demo campaigns so the switcher is real; existing demo content
  // above belongs to "demo-a" (see inCampaign()).
  campaigns: [
    { id: "demo-a", name: "Shadows of Destus", tagline: "It starts small. It does not stay that way.", owner_email: "dm@example.com", created_at: ago(40) },
    { id: "demo-b", name: "A Second Table", tagline: "A colder, quieter war.", owner_email: "dm@example.com", created_at: ago(3) },
  ],
  campaignMembers: [
    { id: uid(), campaign_id: "demo-a", email: "dm@example.com", role: "dm", display_name: "The DM" },
    { id: uid(), campaign_id: "demo-a", email: "tav@example.com", role: "player", display_name: "Tav's player" },
    { id: uid(), campaign_id: "demo-b", email: "dm@example.com", role: "dm", display_name: "The DM" },
  ],
  campaignCharacters: [
    { campaign_id: "demo-a", character_id: "ch-demo-1" },
  ],
  // invite links (demo mode keeps them in memory)
  invites: [],
};
// a little content in the second demo campaign so switching is visible
DEMO.sections.push({ id: uid(), campaign_id: "demo-b", sort_order: 1, title: "A Second Table", body: "This is a *different* campaign. Notice the quests, maps, and notes are all its own — nothing leaks between campaigns." });
DEMO.quests.push({ id: uid(), campaign_id: "demo-b", title: "The Other Campaign's Secret", status: "active", giver: "", location: "", reward: "", summary: "Only visible while you're viewing 'A Second Table'.", created_at: ago(2) });

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

/* ═══ Campaigns — the tenant boundary ═══
   Each DM runs their own campaigns and invites their own players.
   A person can be a DM of some and a player in others. */
export const campaigns = {
  // every campaign the signed-in user belongs to (their memberships).
  // If the multi-campaign migration isn't applied yet, flips to legacy
  // mode and returns [] so boot() runs the old single-campaign flow.
  mine: async (email) => {
    if (!sb) return [...DEMO.campaigns];
    try {
      const rows = await q(
        sb.from("campaign_members").select("campaign_id, role, campaigns(*)").ilike("email", email)
      );
      return rows
        .map((r) => r.campaigns && { ...r.campaigns, myRole: r.role })
        .filter(Boolean)
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    } catch (e) {
      if (!notThere(e)) throw e;
      legacy = true;
      return [];
    }
  },
  // May the signed-in user create a campaign (become a DM)? Used to decide
  // whether to show "New campaign" UI. Demo always yes; if the gating
  // function isn't deployed yet (pre-migration), fall back to permissive so
  // the old open-creation behavior keeps working.
  canCreate: async () => {
    if (!sb) return true;
    try { return await q(sb.rpc("can_create_campaign")); }
    catch (e) { if (notThere(e)) return true; throw e; }
  },
  create: async (name) => {
    if (!sb) {
      const c = { id: uid(), name: name || "New Campaign", tagline: "", owner_email: "dm@example.com", created_at: new Date().toISOString(), myRole: "dm" };
      DEMO.campaigns.push(c);
      DEMO.campaignMembers.push({ id: uid(), campaign_id: c.id, email: "dm@example.com", role: "dm", display_name: "The DM" });
      return c;
    }
    return q(sb.rpc("create_campaign", { p_name: name || "New Campaign" }));
  },
  rename: async (id, name) => {
    if (!sb) { const c = DEMO.campaigns.find((x) => x.id === id); if (c) c.name = name; return; }
    await q(sb.from("campaigns").update({ name }).eq("id", id));
  },
  // The campaign's own tagline (shown under the app name). Requires the
  // `tagline` column — see supabase/apply-new-features.sql.
  setTagline: async (id, tagline) => {
    if (!sb) { const c = DEMO.campaigns.find((x) => x.id === id); if (c) c.tagline = tagline; return; }
    await q(sb.from("campaigns").update({ tagline }).eq("id", id));
  },
  remove: async (id) => {
    if (!sb) { DEMO.campaigns = DEMO.campaigns.filter((c) => c.id !== id); return; }
    await q(sb.from("campaigns").delete().eq("id", id));
  },
};

/* ═══ Invite links — how a DM adds players ═══
   A DM mints a random token for a campaign; a friend opens
   /join.html?invite=<token>, creates an account (or signs in), and is
   added to that campaign as the invite's role. The database enforces
   every rule (only a DM may mint/list/revoke; anon may peek at a token's
   campaign name; redeem requires auth) — this store just calls it.

   Legacy safety: if the invites migration isn't applied yet the RPCs /
   table won't exist, so each call swallows a "missing" error and returns
   an empty/null result instead of taking the app down. */
export const invites = {
  // Mint a new invite for a campaign you DM. Returns the row (incl. token).
  create: async (campaignId, { role = "player", expiresAt = null, maxUses = null } = {}) => {
    if (!sb) {
      const row = {
        id: uid(), campaign_id: campaignId, token: hexToken(), role,
        created_by: "dm@example.com", created_at: new Date().toISOString(),
        expires_at: expiresAt, max_uses: maxUses, uses: 0, revoked: false,
      };
      DEMO.invites.unshift(row);
      return row;
    }
    try {
      return await q(sb.rpc("create_campaign_invite", {
        p_campaign: campaignId, p_role: role, p_expires: expiresAt, p_max_uses: maxUses,
      }));
    } catch (e) { if (notThere(e)) return null; throw e; }
  },
  // Every invite for a campaign you DM (RLS returns only your own).
  list: async (campaignId) => {
    if (!sb) return DEMO.invites.filter((i) => i.campaign_id === campaignId);
    try {
      return await q(sb.from("campaign_invites").select("*").eq("campaign_id", campaignId).order("created_at", { ascending: false }));
    } catch (e) { if (notThere(e)) return []; throw e; }
  },
  // Turn a link off. (RLS only lets a DM of the campaign do this.)
  revoke: async (id) => {
    if (!sb) { const i = DEMO.invites.find((x) => x.id === id); if (i) i.revoked = true; return; }
    try { await q(sb.from("campaign_invites").update({ revoked: true }).eq("id", id)); }
    catch (e) { if (!notThere(e)) throw e; }
  },
  // Read-only peek at a token (callable before signup, anon) so the join
  // page can name the campaign. Returns the row or null for a bad/absent token.
  info: async (token) => {
    if (!sb) return { campaign_id: "demo-a", campaign_name: "Shadows of Destus", role: "player", valid: true };
    try {
      const rows = await q(sb.rpc("invite_info", { p_token: token }));
      return (rows && rows[0]) || null;
    } catch (e) { if (notThere(e)) return null; throw e; }
  },
  // Redeem a token: add the signed-in user to the campaign. Returns
  // { campaign_id, already }. Requires auth (enforced server-side).
  redeem: async (token, displayName) => {
    if (!sb) return { campaign_id: "demo-a", already: false };
    try {
      return await q(sb.rpc("redeem_invite", { p_token: token, p_display_name: displayName || null }));
    } catch (e) { if (notThere(e)) return null; throw e; }
  },
};

/* ═══ Members of the CURRENT campaign ═══
   In legacy mode (migration not yet applied) these fall back to the old
   single-campaign `members` table so the site keeps working. */
export const members = {
  // my membership row (role, name) in the current campaign
  mine: async (email) => {
    if (!sb) return DEMO.campaignMembers.find((m) => m.campaign_id === campaignId && m.email.toLowerCase() === String(email).toLowerCase()) || null;
    if (legacy) { const r = await q(sb.from("members").select("*").ilike("email", email).limit(1)); return r[0] || null; }
    const rows = await q(sb.from("campaign_members").select("*").eq("campaign_id", cid()).ilike("email", email).limit(1));
    return rows[0] || null;
  },
  list: async () => {
    if (!sb) return DEMO.campaignMembers.filter((m) => m.campaign_id === campaignId);
    if (legacy) return q(sb.from("members").select("*").order("display_name"));
    return q(sb.from("campaign_members").select("*").eq("campaign_id", cid()).order("display_name"));
  },
  add: async (email, display_name, role) => {
    if (!sb) return DEMO.campaignMembers.push({ id: uid(), campaign_id: campaignId, email, display_name, role });
    if (legacy) return void (await q(sb.from("members").insert({ email: email.toLowerCase(), display_name, role })));
    await q(sb.from("campaign_members").insert({ campaign_id: cid(), email: email.toLowerCase(), display_name, role }));
  },
  setRole: async (id, role) => {
    if (!sb) { const m = DEMO.campaignMembers.find((x) => x.id === id); if (m) m.role = role; return; }
    await q(sb.from(legacy ? "members" : "campaign_members").update({ role }).eq("id", id));
  },
  remove: async (id) => {
    if (!sb) return (DEMO.campaignMembers = DEMO.campaignMembers.filter((m) => m.id !== id));
    await q(sb.from(legacy ? "members" : "campaign_members").delete().eq("id", id));
  },
};

/* ═══ Campaign sections (home page) ═══ */
export const sections = {
  list: async () => (sb ? q(scope(sb.from("campaign_sections").select("*")).order("sort_order")) : DEMO.sections.filter(inCampaign).sort((a, b) => a.sort_order - b.sort_order)),
  save: async (row) => {
    if (!sb) {
      if (row.id) Object.assign(DEMO.sections.find((s) => s.id === row.id), row);
      else DEMO.sections.push({ ...row, id: uid(), campaign_id: campaignId });
      return;
    }
    if (row.id) await q(sb.from("campaign_sections").update({ title: row.title, body: row.body, sort_order: row.sort_order }).eq("id", row.id));
    else await q(sb.from("campaign_sections").insert(stamp(row)));
  },
  remove: async (id) => {
    if (!sb) return (DEMO.sections = DEMO.sections.filter((s) => s.id !== id));
    await q(sb.from("campaign_sections").delete().eq("id", id));
  },
};

/* ═══ Quests + their update log ═══ */
export const quests = {
  list: async () => (sb ? q(scope(sb.from("quests").select("*")).order("created_at", { ascending: false })) : sortNew(DEMO.quests.filter(inCampaign))),
  updates: async () => (sb ? q(scope(sb.from("quest_updates").select("*")).order("created_at")) : [...DEMO.questUpdates]),
  add: async (row) => {
    if (!sb) return DEMO.quests.push({ ...row, id: uid(), campaign_id: campaignId, created_at: new Date().toISOString() });
    await q(sb.from("quests").insert(stamp(row)));
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
    await q(sb.from("quest_updates").insert(stamp({ quest_id, body })));
  },
};

/* ═══ Notes ═══ */
export const notes = {
  list: async () => (sb ? q(scope(sb.from("notes").select("*")).order("created_at", { ascending: false })) : sortNew(DEMO.notes.filter(inCampaign))),
  add: async (row) => {
    if (!sb) return DEMO.notes.push({ ...row, id: uid(), campaign_id: campaignId, author_email: "dm@example.com", created_at: new Date().toISOString() });
    await q(sb.from("notes").insert(stamp(row)));
  },
  remove: async (id) => {
    if (!sb) return (DEMO.notes = DEMO.notes.filter((n) => n.id !== id));
    await q(sb.from("notes").delete().eq("id", id));
  },
};

/* ═══ Codex (people & creatures met) ═══ */
export const codex = {
  list: async () => (sb ? q(scope(sb.from("codex_entries").select("*")).order("created_at", { ascending: false })) : sortNew(DEMO.codex.filter(inCampaign))),
  notes: async () => (sb ? q(scope(sb.from("codex_notes").select("*")).order("created_at")) : [...DEMO.codexNotes]),
  add: async (row) => {
    if (!sb) {
      const e = { ...row, id: uid(), campaign_id: campaignId, author_email: "dm@example.com", created_at: new Date().toISOString() };
      DEMO.codex.push(e);
      return e;
    }
    return q(sb.from("codex_entries").insert(stamp(row)).select("id").single());
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
    await q(sb.from("codex_notes").insert(stamp({ entry_id, body })));
  },
  removeNote: async (id) => {
    if (!sb) return (DEMO.codexNotes = DEMO.codexNotes.filter((n) => n.id !== id));
    await q(sb.from("codex_notes").delete().eq("id", id));
  },
};

/* ═══ Maps ═══ */
export const maps = {
  list: async () =>
    sb
      ? q(scope(sb.from("maps").select("*")).order("sort_order").order("created_at", { ascending: false }))
      : DEMO.maps.filter(inCampaign).sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100)),
  // Map images live in a PRIVATE storage bucket. This turns their
  // storage paths into short-lived viewable URLs — and storage
  // itself re-checks that this user may see each file.
  signedUrls: async (paths) => {
    if (!sb || !paths.length) return {};
    const rows = await q(sb.storage.from("maps").createSignedUrls(paths, 3600));
    const out = {};
    rows.forEach((r) => { if (r.signedUrl) out[r.path] = r.signedUrl; });
    return out;
  },
  add: async (row) => {
    if (!sb) return DEMO.maps.push({ ...row, id: uid(), campaign_id: campaignId, created_at: new Date().toISOString() });
    await q(sb.from("maps").insert(stamp(row)));
  },
  // DM-only: upload a map image at FULL resolution (maps keep
  // their detail — no shrinking, unlike note photos). Files are
  // foldered by campaign so one campaign's images sit apart from
  // another's in storage.
  upload: async (file) => {
    if (!sb) return null; // demo mode can't store images
    const base = file.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "map";
    const ext = (file.name.split(".").pop() || "img").toLowerCase();
    const path = `${campaignId && !legacy ? cid() + "/" : ""}${base}-${uid().slice(0, 4)}.${ext}`;
    await q(sb.storage.from("maps").upload(path, file, { contentType: file.type || "image/jpeg" }));
    return path;
  },
  removeFile: async (path) => {
    if (!sb || !path) return;
    try { await sb.storage.from("maps").remove([path]); } catch {}
  },
  update: async (id, fields) => {
    if (!sb) return Object.assign(DEMO.maps.find((m) => m.id === id), fields);
    await q(sb.from("maps").update(fields).eq("id", id));
  },
  setRevealed: async (id, revealed) => {
    if (!sb) return Object.assign(DEMO.maps.find((m) => m.id === id), { revealed });
    await q(sb.from("maps").update({ revealed }).eq("id", id));
  },
  remove: async (id) => {
    if (!sb) return (DEMO.maps = DEMO.maps.filter((m) => m.id !== id));
    await q(sb.from("maps").delete().eq("id", id));
  },
};

/* ═══ Player images (note attachments + codex portraits) ═══
   Files go to the private "uploads" bucket. Big photos are
   shrunk in the browser first so the free tier lasts forever. */
export const images = {
  prepare: async (file) => {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
      return blob || file;
    } catch {
      return file; // format the browser can't redraw — send as-is
    }
  },
  upload: async (kind, file) => {
    if (!sb) return null; // demo mode can't store images
    const prepared = await images.prepare(file);
    const ext = prepared.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop() || "img").toLowerCase();
    const path = `${kind}/${uid()}.${ext}`;
    await q(sb.storage.from("uploads").upload(path, prepared, { contentType: prepared.type || file.type }));
    return path;
  },
  urls: async (paths) => {
    const wanted = paths.filter(Boolean);
    if (!sb || !wanted.length) return {};
    const rows = await q(sb.storage.from("uploads").createSignedUrls(wanted, 3600));
    const out = {};
    rows.forEach((r) => { if (r.signedUrl) out[r.path] = r.signedUrl; });
    return out;
  },
  remove: async (path) => {
    if (!sb || !path) return;
    try { await sb.storage.from("uploads").remove([path]); } catch {}
  },
};

/* ═══ Dice — rolled by the DATABASE, broadcast to the table ═══ */
export const dice = {
  list: async () =>
    sb
      ? q(scope(sb.from("rolls").select("*")).order("created_at", { ascending: false }).limit(30))
      : sortNew(DEMO.rolls).slice(0, 30),
  // Real mode calls the server's roll_dice() so results can't be
  // forged. Demo mode rolls locally (and forgets on refresh).
  roll: async (label, spec, modifier) => {
    if (!sb) {
      const rolled = spec.map((s) => ({
        sides: s.sides, count: s.count,
        results: Array.from({ length: s.count }, () => 1 + Math.floor(Math.random() * s.sides)),
      }));
      const total = rolled.reduce((t, d) => t + d.results.reduce((a, b) => a + b, 0), 0) + modifier;
      const row = { id: uid(), roller_email: "dm@example.com", label, dice: rolled, modifier, total, created_at: new Date().toISOString() };
      DEMO.rolls.unshift(row);
      return row;
    }
    return legacy
      ? q(sb.rpc("roll_dice", { p_label: label, p_spec: spec, p_modifier: modifier }))
      : q(sb.rpc("roll_dice", { p_campaign: cid(), p_label: label, p_spec: spec, p_modifier: modifier }));
  },
  // A d20 check with normal / advantage / disadvantage. The
  // database rolls both dice and keeps the right one (roll_check).
  // Falls back to a local (unshared) roll if the migration that
  // adds roll_check hasn't been applied yet — flagged local:true.
  rollCheck: async (label, modifier, mode = "normal") => {
    const local = () => {
      const n = mode === "normal" ? 1 : 2;
      const results = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 20));
      const kept = n === 1 ? results[0] : mode === "adv" ? Math.max(...results) : Math.min(...results);
      return {
        id: uid(), roller_email: "dm@example.com", label,
        dice: [{ sides: 20, count: n, results, ...(n === 2 ? { keep: mode === "adv" ? "high" : "low" } : {}) }],
        modifier, total: kept + modifier, created_at: new Date().toISOString(),
      };
    };
    if (!sb) { const row = local(); DEMO.rolls.unshift(row); return row; }
    try {
      return legacy
        ? await q(sb.rpc("roll_check", { p_label: label, p_modifier: modifier, p_mode: mode }))
        : await q(sb.rpc("roll_check", { p_campaign: cid(), p_label: label, p_modifier: modifier, p_mode: mode }));
    } catch (e) {
      if (/roll_check|schema cache|does not exist|Could not find/i.test(e.message || "")) return { ...local(), local: true };
      throw e;
    }
  },
  // Live feed: cb fires whenever anyone in THIS campaign rolls.
  // RLS already limits the stream to the caller's campaigns, and we
  // also filter by the current campaign so a DM watching one table
  // doesn't see another of their own campaigns' rolls.
  onRoll: (cb, statusCb) => {
    if (!sb) return () => {};
    const here = campaignId;
    const ch = sb
      .channel("rolls-feed-" + here)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "rolls", filter: `campaign_id=eq.${here}` }, (p) => cb(p.new))
      .subscribe((status) => statusCb && statusCb(status));
    return () => { try { sb.removeChannel(ch); } catch {} };
  },
  presets: {
    list: async () => (sb ? q(scope(sb.from("roll_presets").select("*")).order("created_at")) : [...DEMO.presets]),
    save: async (row) => {
      if (!sb) {
        if (row.id) Object.assign(DEMO.presets.find((p) => p.id === row.id), row);
        else DEMO.presets.push({ ...row, id: uid(), owner_email: "dm@example.com" });
        return;
      }
      if (row.id) await q(sb.from("roll_presets").update({ name: row.name, spec: row.spec, modifier: row.modifier }).eq("id", row.id));
      else await q(sb.from("roll_presets").insert(stamp(row)));
    },
    remove: async (id) => {
      if (!sb) return (DEMO.presets = DEMO.presets.filter((p) => p.id !== id));
      await q(sb.from("roll_presets").delete().eq("id", id));
    },
  },
};

/* ═══ Characters — full sheets built on this site ═══
   Three modes:
     demo  — sample data, like everything else.
     real  — the characters table (members read all, write own).
     local — Supabase is connected but the characters migration
             hasn't been applied yet: sheets park in THIS browser
             (localStorage) so nothing is lost, and move to the
             database the moment the migration lands. */
const CHAR_LS_KEY = "sod-characters";
let charMode = null; // resolved on first list(): "db" | "local"
const lsChars = () => { try { return JSON.parse(localStorage.getItem(CHAR_LS_KEY) || "[]"); } catch { return []; } };
const lsPutChars = (rows) => { try { localStorage.setItem(CHAR_LS_KEY, JSON.stringify(rows)); } catch {} };
const missingTable = (e) => /does not exist|relation|schema cache|Could not find/i.test(e.message || "");

export const characters = {
  mode: () => (!sb ? "demo" : charMode === "local" ? "local" : "real"),
  // The characters IN the current campaign — its party. Characters are
  // owned by their player (portable across campaigns) and appear here
  // once linked into this campaign (campaign_characters).
  list: async () => {
    if (!sb) {
      const ids = new Set(DEMO.campaignCharacters.filter((l) => l.campaign_id === campaignId).map((l) => l.character_id));
      return DEMO.characters.filter((c) => ids.has(c.id));
    }
    if (charMode !== "local") {
      try {
        // legacy (no multi-campaign yet): the whole DB is one table's party
        if (legacy) {
          const rows = await q(sb.from("characters").select("*").order("updated_at", { ascending: false }));
          charMode = "db";
          return rows;
        }
        const rows = await q(
          sb.from("campaign_characters").select("character:characters(*)").eq("campaign_id", cid())
        );
        charMode = "db";
        return rows.map((r) => r.character).filter(Boolean).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      } catch (e) {
        if (!missingTable(e)) throw e;
        charMode = "local";
      }
    }
    return lsChars().sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  },
  // every character the signed-in player owns, across all campaigns —
  // the pool they pick from when adding an existing hero to a campaign.
  mine: async (email) => {
    if (!sb) return DEMO.characters.filter((c) => c.owner_email?.toLowerCase() === String(email).toLowerCase());
    if (charMode === "local") return lsChars();
    try { return await q(sb.from("characters").select("*").ilike("owner_email", email).order("updated_at", { ascending: false })); }
    catch (e) { if (!missingTable(e)) throw e; charMode = "local"; return lsChars(); }
  },
  // add / remove one of a player's characters to the current campaign
  linkToCampaign: async (characterId) => {
    if (!sb) {
      if (!DEMO.campaignCharacters.some((l) => l.campaign_id === campaignId && l.character_id === characterId))
        DEMO.campaignCharacters.push({ campaign_id: campaignId, character_id: characterId });
      return;
    }
    if (charMode === "local" || legacy || !campaignId) return;
    await q(sb.from("campaign_characters").upsert({ campaign_id: cid(), character_id: characterId }));
  },
  unlinkFromCampaign: async (characterId) => {
    if (!sb) { DEMO.campaignCharacters = DEMO.campaignCharacters.filter((l) => !(l.campaign_id === campaignId && l.character_id === characterId)); return; }
    if (charMode === "local" || legacy || !campaignId) return;
    await q(sb.from("campaign_characters").delete().eq("campaign_id", cid()).eq("character_id", characterId));
  },
  // row: {id?, name, sheet}; ownerEmail is used in demo/local modes
  // (in real mode the DATABASE stamps the owner via my_email()).
  // A brand-new character is auto-linked into the current campaign.
  save: async (row, ownerEmail) => {
    const stamp = new Date().toISOString();
    if (!sb) {
      const ex = row.id && DEMO.characters.find((x) => x.id === row.id);
      if (ex) { Object.assign(ex, { name: row.name, sheet: row.sheet, updated_at: stamp }); return ex; }
      const fresh = { id: uid(), owner_email: ownerEmail || "dm@example.com", name: row.name, sheet: row.sheet, created_at: stamp, updated_at: stamp };
      DEMO.characters.unshift(fresh);
      DEMO.campaignCharacters.push({ campaign_id: campaignId, character_id: fresh.id });
      return fresh;
    }
    const saveLocal = () => {
      const all = lsChars();
      const ex = row.id && all.find((x) => x.id === row.id);
      if (ex) { Object.assign(ex, { name: row.name, sheet: row.sheet, updated_at: stamp }); lsPutChars(all); return ex; }
      const fresh = { id: uid(), owner_email: ownerEmail, name: row.name, sheet: row.sheet, created_at: stamp, updated_at: stamp, local: true };
      all.unshift(fresh);
      lsPutChars(all);
      return fresh;
    };
    if (charMode === "local") return saveLocal();
    // charMode may still be null here (saving before any list() resolved it,
    // e.g. opening characters.html#new directly). Try the DB; if the table
    // isn't there yet, fall back to localStorage instead of losing the sheet.
    try {
      if (row.id)
        return await q(sb.from("characters").update({ name: row.name, sheet: row.sheet }).eq("id", row.id).select().single());
      const created = await q(sb.from("characters").insert({ name: row.name, sheet: row.sheet }).select().single());
      // a new hero joins the current campaign's party
      if (campaignId) { try { await q(sb.from("campaign_characters").upsert({ campaign_id: campaignId, character_id: created.id })); } catch {} }
      return created;
    } catch (e) {
      if (!missingTable(e)) throw e;
      charMode = "local";
      return saveLocal();
    }
  },
  remove: async (id) => {
    if (!sb) return (DEMO.characters = DEMO.characters.filter((x) => x.id !== id));
    if (charMode === "local") return lsPutChars(lsChars().filter((x) => x.id !== id));
    try {
      await q(sb.from("characters").delete().eq("id", id));
    } catch (e) {
      if (!missingTable(e)) throw e;
      charMode = "local";
      lsPutChars(lsChars().filter((x) => x.id !== id));
    }
  },
  // once the migration is applied, move any parked local sheets in.
  // Resolve the mode first so a null charMode doesn't fire inserts at a
  // table that may not exist yet.
  migrateLocal: async () => {
    if (!sb) return 0;
    if (charMode === null) { try { await characters.list(); } catch {} }
    if (charMode === "local") return 0;
    const parked = lsChars();
    if (!parked.length) return 0;
    try {
      for (const row of parked) {
        const created = await q(sb.from("characters").insert({ name: row.name, sheet: row.sheet }).select().single());
        if (campaignId) { try { await q(sb.from("campaign_characters").upsert({ campaign_id: campaignId, character_id: created.id })); } catch {} }
      }
    } catch (e) {
      if (missingTable(e)) { charMode = "local"; return 0; }
      throw e;
    }
    lsPutChars([]);
    return parked.length;
  },
};

/* ═══ VTT — the live battle map ═══
   encounters (which map, grid, which one is live) + tokens
   (who stands where, HP, conditions). Everything syncs over
   Supabase Realtime; spell effects ride a broadcast channel
   and are never stored. Demo mode plays solo in memory. */
export const vtt = {
  encounters: {
    list: async () =>
      sb ? q(scope(sb.from("encounters").select("*")).order("created_at", { ascending: false })) : DEMO.encounters.filter(inCampaign),
    save: async (row) => {
      if (!sb) {
        const ex = row.id && DEMO.encounters.find((e) => e.id === row.id);
        if (ex) { Object.assign(ex, row); return ex; }
        const fresh = { grid: { cell: 70, feet: 5, show: true }, active: false, ...row, id: uid(), campaign_id: campaignId, created_at: new Date().toISOString() };
        DEMO.encounters.unshift(fresh);
        return fresh;
      }
      if (row.id) {
        const { id, ...fields } = row;
        return q(sb.from("encounters").update(fields).eq("id", id).select().single());
      }
      return q(sb.from("encounters").insert(stamp(row)).select().single());
    },
    remove: async (id) => {
      if (!sb) {
        DEMO.encounters = DEMO.encounters.filter((e) => e.id !== id);
        DEMO.tokens = DEMO.tokens.filter((t) => t.encounter_id !== id);
        return;
      }
      await q(sb.from("encounters").delete().eq("id", id));
    },
    // exactly one battle is "live" per campaign
    setActive: async (id) => {
      if (!sb) return DEMO.encounters.filter(inCampaign).forEach((e) => (e.active = e.id === id));
      await q(scope(sb.from("encounters").update({ active: false })).eq("active", true));
      if (id) await q(sb.from("encounters").update({ active: true }).eq("id", id));
    },
  },
  tokens: {
    list: async (encounterId) =>
      sb
        ? q(sb.from("tokens").select("*").eq("encounter_id", encounterId).order("created_at"))
        : DEMO.tokens.filter((t) => t.encounter_id === encounterId),
    add: async (row) => {
      if (!sb) {
        const fresh = { x: 2, y: 2, size: 1, color: "", conditions: [], hidden: false, monster_index: "", character_id: null, hp_current: null, hp_max: null, initiative: null, ...row, id: uid(), campaign_id: campaignId, created_at: new Date().toISOString() };
        DEMO.tokens.push(fresh);
        return fresh;
      }
      return q(sb.from("tokens").insert(stamp(row)).select().single());
    },
    update: async (id, fields) => {
      if (!sb) return Object.assign(DEMO.tokens.find((t) => t.id === id) || {}, fields);
      await q(sb.from("tokens").update(fields).eq("id", id));
    },
    remove: async (id) => {
      if (!sb) return (DEMO.tokens = DEMO.tokens.filter((t) => t.id !== id));
      await q(sb.from("tokens").delete().eq("id", id));
    },
    // fires on token/encounter changes IN THIS CAMPAIGN. RLS already
    // limits the stream to the caller's campaigns; the campaign_id
    // filter keeps a DM's other campaigns off this battle map.
    onChange: (cb, statusCb) => {
      if (!sb) return () => {};
      const here = campaignId;
      const ch = sb
        .channel("vtt-sync-" + here)
        .on("postgres_changes", { event: "*", schema: "public", table: "tokens", filter: `campaign_id=eq.${here}` }, (p) => cb({ table: "tokens", type: p.eventType, new: p.new, old: p.old }))
        .on("postgres_changes", { event: "*", schema: "public", table: "encounters", filter: `campaign_id=eq.${here}` }, (p) => cb({ table: "encounters", type: p.eventType, new: p.new, old: p.old }))
        .subscribe((status) => statusCb && statusCb(status));
      return () => { try { sb.removeChannel(ch); } catch {} };
    },
  },
  // ephemeral spell/effect animations, broadcast to every open map IN
  // THIS CAMPAIGN (the channel name is campaign-specific, so another
  // campaign's battle never receives them).
  fx: {
    join: (onFx) => {
      if (!sb) return { send: (p) => { try { onFx(p); } catch {} }, leave: () => {} };
      const ch = sb
        .channel("vtt-fx-" + campaignId, { config: { broadcast: { self: true } } })
        .on("broadcast", { event: "fx" }, (msg) => { try { onFx(msg.payload); } catch {} })
        .subscribe();
      return {
        send: (p) => { try { ch.send({ type: "broadcast", event: "fx", payload: p }); } catch {} },
        leave: () => { try { sb.removeChannel(ch); } catch {} },
      };
    },
  },
};

/* ═══ AI image generation ═══
   Portraits and battle maps from FLUX.1 [schnell], produced by the
   `generate-image` Edge Function (which alone holds the paid
   provider key). The browser never calls the provider; it invokes
   the function with the user's JWT attached. The database enforces
   the monthly cost caps atomically BEFORE any paid call — see
   supabase/migrations/…_ai_images.sql and docs/AI-IMAGES.md.

   "Not set up yet" is a first-class state: before the function is
   deployed / a provider key is set, generate() throws with
   code "not-configured" and usage() returns null, so the UI can
   show a calm "set up AI generation" note instead of breaking. */
const notConfigured = () => Object.assign(new Error("AI images aren't set up yet"), { code: "not-configured" });

export const ai = {
  // {campaignId, kind:'map'|'portrait', prompt} → {path, url, kind, mapId}
  // Throws with .code==='not-configured' when AI isn't set up, or with
  // the database's clean cap message ("DM monthly limit reached", …).
  generate: async ({ campaignId, kind, prompt }) => {
    if (!sb) throw new Error("AI generation needs the live database — it isn't available in demo mode.");
    const cid = campaignId || campaignId === 0 ? campaignId : getCampaign();
    const { data, error } = await sb.functions.invoke("generate-image", {
      body: { campaignId: cid, kind, prompt },
    });
    if (error) {
      // supabase-js wraps non-2xx as FunctionsHttpError with a Response
      // in error.context — read the JSON body for a clean message.
      let msg = error.message || "Image generation failed";
      try {
        const b = await error.context.json();
        if (b?.error === "not-configured") throw notConfigured();
        if (b?.error) msg = b.error;
      } catch (inner) {
        if (inner?.code === "not-configured") throw inner;
        // function not deployed at all → treat as "not set up yet"
        if (/Failed to send|Function not found|404|not found/i.test(msg)) throw notConfigured();
      }
      throw new Error(msg);
    }
    if (data?.error === "not-configured") throw notConfigured();
    if (data?.error) throw new Error(data.error);
    return { path: data?.path, url: data?.url, kind: data?.kind, mapId: data?.mapId ?? null };
  },
  // The signed-in DM's usage this month: {ym, used, cap, remaining,
  // global_used, global_cap} — or null if the AI migration/RPC isn't
  // present yet (so callers can show the "not set up" note).
  usage: async () => {
    if (!sb) return null;
    try { return await q(sb.rpc("ai_usage")); }
    catch (e) {
      if (/does not exist|Could not find|schema cache|function/i.test(e?.message || "")) return null;
      throw e;
    }
  },
  // signed, short-lived URLs for stored portraits (the 'ai-art' bucket)
  artUrls: async (paths) => {
    const wanted = (paths || []).filter(Boolean);
    if (!sb || !wanted.length) return {};
    const rows = await q(sb.storage.from("ai-art").createSignedUrls(wanted, 3600));
    const out = {};
    rows.forEach((r) => { if (r.signedUrl) out[r.path] = r.signedUrl; });
    return out;
  },
  // {campaignId, prompt} → a stat-block object (see js/pages/monsters.js).
  // Uses the SEPARATE AI *text* budget (Claude via the generate-monster
  // Edge Function). Throws .code==='not-configured' when unset, or the
  // database's clean cap message.
  generateMonster: async ({ campaignId, prompt }) => {
    if (!sb) throw new Error("AI generation needs the live database — it isn't available in demo mode.");
    const cid = campaignId || campaignId === 0 ? campaignId : getCampaign();
    const { data, error } = await sb.functions.invoke("generate-monster", {
      body: { campaignId: cid, prompt },
    });
    if (error) {
      let msg = error.message || "Monster generation failed";
      try {
        const b = await error.context.json();
        if (b?.error === "not-configured") throw notConfigured();
        if (b?.error) msg = b.error;
      } catch (inner) {
        if (inner?.code === "not-configured") throw inner;
        if (/Failed to send|Function not found|404|not found/i.test(msg)) throw notConfigured();
      }
      throw new Error(msg);
    }
    if (data?.error === "not-configured") throw notConfigured();
    if (data?.error) throw new Error(data.error);
    return data?.monster || null;
  },
  // AI DM-prep accelerator: {campaignId, description, partyLevel, partySize,
  // difficulty, srd:[{i,n,cr}]} → a plan object
  //   { title, summary, map_prompt, monsters:[{name, srd_index, count, cr,
  //     homebrew_prompt}] }
  // Spends ONE slot of the AI *text* budget (the plan itself). The map and any
  // generated homebrew monsters are billed separately as the caller runs them.
  // Throws .code==='not-configured' when unset, or the DB's clean cap message.
  planEncounter: async ({ campaignId, description, partyLevel, partySize, difficulty, srd }) => {
    if (!sb) throw new Error("AI generation needs the live database — it isn't available in demo mode.");
    const cid = campaignId || campaignId === 0 ? campaignId : getCampaign();
    const { data, error } = await sb.functions.invoke("plan-encounter", {
      body: { campaignId: cid, description, partyLevel, partySize, difficulty, srd },
    });
    if (error) {
      let msg = error.message || "Encounter planning failed";
      try {
        const b = await error.context.json();
        if (b?.error === "not-configured") throw notConfigured();
        if (b?.error) msg = b.error;
      } catch (inner) {
        if (inner?.code === "not-configured") throw inner;
        if (/Failed to send|Function not found|404|not found/i.test(msg)) throw notConfigured();
      }
      throw new Error(msg);
    }
    if (data?.error === "not-configured") throw notConfigured();
    if (data?.error) throw new Error(data.error);
    return data?.plan || null;
  },
  // AI Create-Adventure: {campaignId, brief, partyLevel, partySize, difficulty,
  // scenes, srd:[{i,n,cr}]} → a full adventure object
  //   { title, location, overview, xp_budget, scenes:[{title, kind, boss,
  //     read_aloud, dm_notes, monsters:[…], puzzle, treasure}],
  //     npcs:[{name, role, personality, secret, voice, lines:[]}],
  //     treasure_overall }
  // Spends ONE slot of the AI *text* budget (the whole adventure). Any battle
  // maps and generated monsters are billed separately when the DM stages a
  // combat scene onto the Battle map. Throws .code==='not-configured' when
  // unset, or the database's clean cap message.
  planAdventure: async ({ campaignId, brief, partyLevel, partySize, difficulty, scenes, srd }) => {
    if (!sb) throw new Error("AI generation needs the live database — it isn't available in demo mode.");
    const cid = campaignId || campaignId === 0 ? campaignId : getCampaign();
    const { data, error } = await sb.functions.invoke("plan-adventure", {
      body: { campaignId: cid, brief, partyLevel, partySize, difficulty, scenes, srd },
    });
    if (error) {
      let msg = error.message || "Adventure planning failed";
      try {
        const b = await error.context.json();
        if (b?.error === "not-configured") throw notConfigured();
        if (b?.error) msg = b.error;
      } catch (inner) {
        if (inner?.code === "not-configured") throw inner;
        if (/Failed to send|Function not found|404|not found/i.test(msg)) throw notConfigured();
      }
      throw new Error(msg);
    }
    if (data?.error === "not-configured") throw notConfigured();
    if (data?.error) throw new Error(data.error);
    return data?.adventure || null;
  },
  // {campaignId, kind:'spell'|…, prompt} → a schema-shaped draft object for
  // that homebrew editor (see supabase/functions/generate-homebrew). Draws the
  // SAME AI *text* budget as monsters. Throws .code==='not-configured' when
  // unset, or the database's clean cap message.
  generateHomebrew: async ({ campaignId, kind, prompt }) => {
    if (!sb) throw new Error("AI generation needs the live database — it isn't available in demo mode.");
    const cid = campaignId || campaignId === 0 ? campaignId : getCampaign();
    const { data, error } = await sb.functions.invoke("generate-homebrew", {
      body: { campaignId: cid, kind, prompt },
    });
    if (error) {
      let msg = error.message || "Generation failed";
      try {
        const b = await error.context.json();
        if (b?.error === "not-configured") throw notConfigured();
        if (b?.error) msg = b.error;
      } catch (inner) {
        if (inner?.code === "not-configured") throw inner;
        if (/Failed to send|Function not found|404|not found/i.test(msg)) throw notConfigured();
      }
      throw new Error(msg);
    }
    if (data?.error === "not-configured") throw notConfigured();
    if (data?.error) throw new Error(data.error);
    return data?.result || null;
  },
  // The signed-in DM's AI *text* usage this month, or null if not set up.
  textUsage: async () => {
    if (!sb) return null;
    try { return await q(sb.rpc("ai_text_usage")); }
    catch (e) {
      if (/does not exist|Could not find|schema cache|function/i.test(e?.message || "")) return null;
      throw e;
    }
  },
};

/* ═══ Homebrew monsters (custom stat blocks, per campaign) ═══
   Ordinary content, like maps: party members read, only a DM writes
   (direct-write RLS). Built by hand or with AI; an optional portrait
   lives in the 'ai-art' bucket (reuse ai.artUrls to view it). */
export const homebrewMonsters = {
  list: async () =>
    sb
      ? q(scope(sb.from("homebrew_monsters").select("*")).order("created_at", { ascending: false }))
      : (DEMO.homebrewMonsters || []).filter(inCampaign),
  // row: {id?, name, cr, data, art_path}
  save: async (row) => {
    const fields = { name: row.name || "New monster", cr: row.cr || "", data: row.data || {}, art_path: row.art_path ?? null };
    if (!sb) {
      DEMO.homebrewMonsters ||= [];
      if (row.id) return Object.assign(DEMO.homebrewMonsters.find((m) => m.id === row.id) || {}, fields);
      const m = { ...fields, id: uid(), campaign_id: campaignId, created_at: new Date().toISOString() };
      DEMO.homebrewMonsters.push(m); return m;
    }
    if (row.id) { await q(sb.from("homebrew_monsters").update(fields).eq("id", row.id)); return { id: row.id }; }
    return q(sb.from("homebrew_monsters").insert(stamp(fields)).select("id").single());
  },
  remove: async (id) => {
    if (!sb) return (DEMO.homebrewMonsters = (DEMO.homebrewMonsters || []).filter((m) => m.id !== id));
    await q(sb.from("homebrew_monsters").delete().eq("id", id));
  },
};

/* ═══ Homebrew spells (a campaign's shared custom spellbook) ═══
   Same ownership as monsters: party members read, only a DM writes.
   `data` is the custom-spell object the character model understands
   (js/dnd/model.js), so a spell added to a sheet casts + animates
   through the existing custom-spell plumbing. */
export const homebrewSpells = {
  list: async () =>
    sb
      ? q(scope(sb.from("homebrew_spells").select("*")).order("created_at", { ascending: false }))
      : (DEMO.homebrewSpells || []).filter(inCampaign),
  // row: {id?, name, level, school, data}
  save: async (row) => {
    const lvl = Number.isFinite(+row.level) ? Math.max(0, Math.min(9, +row.level)) : 0;
    const fields = { name: row.name || "New spell", level: lvl, school: row.school || "", data: row.data || {} };
    if (!sb) {
      DEMO.homebrewSpells ||= [];
      if (row.id) return Object.assign(DEMO.homebrewSpells.find((m) => m.id === row.id) || {}, fields);
      const m = { ...fields, id: uid(), campaign_id: campaignId, created_at: new Date().toISOString() };
      DEMO.homebrewSpells.push(m); return m;
    }
    if (row.id) { await q(sb.from("homebrew_spells").update(fields).eq("id", row.id)); return { id: row.id }; }
    return q(sb.from("homebrew_spells").insert(stamp(fields)).select("id").single());
  },
  remove: async (id) => {
    if (!sb) return (DEMO.homebrewSpells = (DEMO.homebrewSpells || []).filter((m) => m.id !== id));
    await q(sb.from("homebrew_spells").delete().eq("id", id));
  },
};

/* ═══ Homebrew items (a campaign's shared armory) ═══
   Same ownership as spells/monsters: party members read, DM writes.
   `data` is the full item (type, rarity, attunement, props, desc);
   giving one to a hero copies it into that sheet's inventory. */
export const homebrewItems = {
  list: async () =>
    sb
      ? q(scope(sb.from("homebrew_items").select("*")).order("created_at", { ascending: false }))
      : (DEMO.homebrewItems || []).filter(inCampaign),
  // row: {id?, name, type, rarity, data}
  save: async (row) => {
    const fields = { name: row.name || "New item", type: row.type || "", rarity: row.rarity || "", data: row.data || {} };
    if (!sb) {
      DEMO.homebrewItems ||= [];
      if (row.id) return Object.assign(DEMO.homebrewItems.find((m) => m.id === row.id) || {}, fields);
      const m = { ...fields, id: uid(), campaign_id: campaignId, created_at: new Date().toISOString() };
      DEMO.homebrewItems.push(m); return m;
    }
    if (row.id) { await q(sb.from("homebrew_items").update(fields).eq("id", row.id)); return { id: row.id }; }
    return q(sb.from("homebrew_items").insert(stamp(fields)).select("id").single());
  },
  remove: async (id) => {
    if (!sb) return (DEMO.homebrewItems = (DEMO.homebrewItems || []).filter((m) => m.id !== id));
    await q(sb.from("homebrew_items").delete().eq("id", id));
  },
};

/* ═══ Homebrew origins (shared player options: races, subclasses, …) ═══
   One table keyed by `kind`. Party members read, DM writes. `data`
   is a blob the character rules engine consumes (raceInfo / custom
   subclass), so applying one to a sheet re-derives correctly. */
export const homebrewOptions = {
  list: async (kind) => {
    if (!sb) return (DEMO.homebrewOptions || []).filter(inCampaign).filter((o) => !kind || o.kind === kind);
    let query = scope(sb.from("homebrew_options").select("*"));
    if (kind) query = query.eq("kind", kind);
    return q(query.order("created_at", { ascending: false }));
  },
  // row: {id?, kind, name, data}
  save: async (row) => {
    const fields = { kind: row.kind, name: row.name || "New option", data: row.data || {} };
    if (!sb) {
      DEMO.homebrewOptions ||= [];
      if (row.id) return Object.assign(DEMO.homebrewOptions.find((m) => m.id === row.id) || {}, fields);
      const m = { ...fields, id: uid(), campaign_id: campaignId, created_at: new Date().toISOString() };
      DEMO.homebrewOptions.push(m); return m;
    }
    if (row.id) { await q(sb.from("homebrew_options").update(fields).eq("id", row.id)); return { id: row.id }; }
    return q(sb.from("homebrew_options").insert(stamp(fields)).select("id").single());
  },
  remove: async (id) => {
    if (!sb) return (DEMO.homebrewOptions = (DEMO.homebrewOptions || []).filter((m) => m.id !== id));
    await q(sb.from("homebrew_options").delete().eq("id", id));
  },
};

/* ═══ Adventures (saved AI DM-prep documents, per campaign) ═══
   One row = one adventure the DM generated or wrote: a named location
   plus a `data` blob (scenes, NPCs, treasure, XP note — see
   js/pages/adventures.js). Same ownership as the homebrew content:
   party members read, only a DM writes. Combat scenes are staged onto
   the Battle map by handing their roster to the VTT's ⚡ AI-prep builder. */
export const adventures = {
  list: async () =>
    sb
      ? q(scope(sb.from("adventures").select("*")).order("created_at", { ascending: false }))
      : (DEMO.adventures || []).filter(inCampaign),
  // row: {id?, title, location, data}
  save: async (row) => {
    const fields = { title: row.title || "New adventure", location: row.location || "", data: row.data || {} };
    if (!sb) {
      DEMO.adventures ||= [];
      if (row.id) return Object.assign(DEMO.adventures.find((m) => m.id === row.id) || {}, fields);
      const m = { ...fields, id: uid(), campaign_id: campaignId, created_at: new Date().toISOString() };
      DEMO.adventures.unshift(m); return m;
    }
    if (row.id) { await q(sb.from("adventures").update(fields).eq("id", row.id)); return { id: row.id }; }
    return q(sb.from("adventures").insert(stamp(fields)).select("*").single());
  },
  remove: async (id) => {
    if (!sb) return (DEMO.adventures = (DEMO.adventures || []).filter((m) => m.id !== id));
    await q(sb.from("adventures").delete().eq("id", id));
  },
};

/* ═══ NPCs (the DM's private cast, per campaign) ═══
   DM-ONLY: only the campaign DM can read or write these, because they
   carry secrets the players must not see (enforced by RLS, not the
   browser). `data` holds the NPC blob (race, role, personality, secret,
   voice, inventory — see js/pages/npcs.js); an optional AI portrait
   lives in the 'ai-art' bucket (view it with ai.artUrls). "Reveal" makes
   a public codex entry and stores its id in codex_entry_id. */
export const npcs = {
  list: async () =>
    sb
      ? q(scope(sb.from("campaign_npcs").select("*")).order("created_at", { ascending: false }))
      : (DEMO.npcs || []).filter(inCampaign),
  // row: {id?, name, data, art_path?, codex_entry_id?}
  save: async (row) => {
    const fields = {
      name: row.name || "New NPC", data: row.data || {},
      art_path: row.art_path ?? null, codex_entry_id: row.codex_entry_id ?? null,
    };
    if (!sb) {
      DEMO.npcs ||= [];
      if (row.id) return Object.assign(DEMO.npcs.find((m) => m.id === row.id) || {}, fields);
      const m = { ...fields, id: uid(), campaign_id: campaignId, created_at: new Date().toISOString() };
      DEMO.npcs.unshift(m); return m;
    }
    if (row.id) { await q(sb.from("campaign_npcs").update(fields).eq("id", row.id)); return { id: row.id }; }
    return q(sb.from("campaign_npcs").insert(stamp(fields)).select("*").single());
  },
  remove: async (id) => {
    if (!sb) return (DEMO.npcs = (DEMO.npcs || []).filter((m) => m.id !== id));
    await q(sb.from("campaign_npcs").delete().eq("id", id));
  },
};

/* ═══ Party roster (links to D&D Beyond) ═══ */
export const party = {
  list: async () => (sb ? q(scope(sb.from("party_characters").select("*")).order("created_at")) : DEMO.party.filter(inCampaign)),
  add: async (row) => {
    if (!sb) return DEMO.party.push({ ...row, id: uid(), campaign_id: campaignId, created_at: new Date().toISOString() });
    await q(sb.from("party_characters").insert(stamp(row)));
  },
  remove: async (id) => {
    if (!sb) return (DEMO.party = DEMO.party.filter((p) => p.id !== id));
    await q(sb.from("party_characters").delete().eq("id", id));
  },
};

/* ═══ Profiles + account (avatar, contact, password) ═══
   Every signed-in user has ONE profile row (keyed by their email). You can
   read your own and your campaign-mates' public bits; you can write only
   your own — the DATABASE (RLS + save_profile) enforces all of that, this
   store just calls it. Passwords / resets are Supabase Auth, not SQL.

   Demo mode keeps a fake in-memory profile and turns the auth calls into a
   friendly "not in demo" error (guard() surfaces it as a toast). If the
   profiles migration isn't applied yet, reads return null and writes throw a
   clear message instead of taking the page down. */
let demoProfile = {
  email: "dm@example.com", display_name: "You (DM preview)", avatar_path: null,
  contact: { discord: "", timezone: "", pronouns: "" },
};

// The signed-in user's email, lowercased — the same identity my_email()
// uses in the database, so avatar folders and profile rows line up.
async function ownEmail() {
  if (!sb) return "dm@example.com";
  const { data } = await sb.auth.getUser();
  return (data?.user?.email || "").toLowerCase();
}

export const profile = {
  // The signed-in user's own profile row, or null if they haven't saved one.
  mine: async () => {
    if (!sb) return { ...demoProfile };
    try {
      const email = await ownEmail();
      const rows = await q(sb.from("profiles").select("*").ilike("email", email).limit(1));
      return rows[0] || null;
    } catch (e) { if (notThere(e)) return null; throw e; }
  },

  // Save display name + contact. avatar_path is left null so save_profile
  // KEEPS the current avatar (see the SQL's coalesce). Returns the row.
  save: async ({ displayName, contact }) => {
    if (!sb) {
      demoProfile = { ...demoProfile, display_name: displayName ?? "", contact: contact || {} };
      return { ...demoProfile };
    }
    try {
      return await q(sb.rpc("save_profile", {
        p_display_name: displayName ?? null,
        p_avatar_path: null,
        p_contact: contact || {},
      }));
    } catch (e) {
      if (notThere(e)) throw new Error("Profiles aren't set up on this database yet.");
      throw e;
    }
  },

  // Upload a new avatar into the user's OWN folder (avatars/<email>/…), then
  // point the profile at it. save_profile overwrites display_name + contact,
  // so we read the current row first and pass those back unchanged. Returns
  // the public URL of the freshly uploaded image.
  uploadAvatar: async (file) => {
    if (!sb) throw new Error("Avatar uploads aren't available in demo mode.");
    const email = await ownEmail();
    const ext = ((file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "")) || "png";
    const path = `${email}/avatar-${uid().slice(0, 8)}.${ext}`;
    try {
      await q(sb.storage.from("avatars").upload(path, file, { contentType: file.type || "image/png", upsert: false }));
    } catch (e) {
      if (notThere(e)) throw new Error("Avatar storage isn't set up on this database yet.");
      throw e;
    }
    let cur = null;
    try { cur = await profile.mine(); } catch {}
    await q(sb.rpc("save_profile", {
      p_display_name: cur?.display_name ?? null,
      p_avatar_path: path,
      p_contact: cur?.contact || {},
    }));
    return profile.avatarUrl(path);
  },

  // Public URL for a stored avatar path (null-safe; demo has no storage).
  avatarUrl: (path) => {
    if (!path || !sb) return null;
    const { data } = sb.storage.from("avatars").getPublicUrl(path);
    return data?.publicUrl || null;
  },

  /* ── account / auth (thin wrappers over Supabase Auth) ── */

  // Re-authenticate with the CURRENT password first (proves it's really you),
  // then set the new one. A wrong current password is a clean, specific error.
  changePassword: async (currentPw, newPw) => {
    if (!sb) throw new Error("Password changes aren't available in demo mode.");
    const email = await ownEmail();
    const { error } = await sb.auth.signInWithPassword({ email, password: currentPw });
    if (error) throw new Error("Current password is incorrect");
    await q(sb.auth.updateUser({ password: newPw }));
  },

  // Email a reset link that lands back on our public reset.html page.
  sendReset: async (email) => {
    if (!sb) throw new Error("Password reset isn't available in demo mode.");
    await q(sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/reset.html" }));
  },

  // Finish a reset: the recovery link has already signed the user in, so we
  // just set the new password on the current session.
  completeReset: async (newPw) => {
    if (!sb) throw new Error("Password reset isn't available in demo mode.");
    await q(sb.auth.updateUser({ password: newPw }));
  },

  // Optional, clearly-separate email change: Supabase sends a confirmation
  // link to the new address; the change only takes effect once it's clicked.
  changeEmail: async (newEmail) => {
    if (!sb) throw new Error("Email changes aren't available in demo mode.");
    await q(sb.auth.updateUser({ email: newEmail }));
  },

  // Is there an authenticated session right now? (reset.html uses this to
  // tell a valid recovery link from an expired/absent one.) Demo: none.
  hasSession: async () => {
    if (!sb) return false;
    const { data } = await sb.auth.getSession();
    return !!data.session;
  },

  // supabase-js parses the recovery token from the URL and fires this with
  // event === 'PASSWORD_RECOVERY'. Returns an unsubscribe function.
  onPasswordRecovery: (cb) => {
    if (!sb) return () => {};
    const { data } = sb.auth.onAuthStateChange((event) => { if (event === "PASSWORD_RECOVERY") cb(); });
    return () => { try { data.subscription.unsubscribe(); } catch {} };
  },
};
