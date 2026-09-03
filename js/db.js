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
    { id: uid(), sort_order: 1, title: "The Story So Far", body: "The party met in the ash-choked town of **Emberfall**, where the mines went silent a season ago. Something below is *eating the light*.\n\nThis is sample text — once your database is connected, the DM edits these sections right here on the page." },
    { id: uid(), sort_order: 2, title: "House Rules", body: "- Drinking a potion is a bonus action\n- Nat 1 on a death save counts as two failures\n- Inspiration can be traded between players" },
    { id: uid(), sort_order: 3, title: "Table Schedule", body: "We play **every other Saturday**, 6pm. Bring snacks. The map table is sacred — no dice on the miniatures." },
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
