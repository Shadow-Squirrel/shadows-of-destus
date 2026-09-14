// Standard backgrounds beyond the SRD's single Acolyte entry.
//
// Backgrounds are almost entirely game MECHANICS — which two skills, which
// tools, how many languages, a small feature — and mechanics aren't
// copyrightable. The feature DESCRIPTIONS here are written fresh (paraphrased
// benefits, not the Player's Handbook's wording) so this stays clear for
// commercial use. Merged into BACKGROUNDS by tools/build-srd.mjs.
//
// Same shape as a generated background: {index, name, skills:[idx,idx],
// tools:[names], languages:{choose}|null, feature:{name,desc}, suggestions}.

const noSuggestions = { traits: [], ideals: [], bonds: [], flaws: [] };
const bg = (index, name, skills, tools, langChoose, feature) => ({
  index, name, skills, tools,
  languages: langChoose ? { choose: langChoose } : null,
  feature,
  suggestions: noSuggestions,
});

export const EXTRA_BACKGROUNDS = {
  charlatan: bg("charlatan", "Charlatan", ["deception", "sleight-of-hand"],
    ["Disguise kit", "Forgery kit"], 0,
    { name: "False Identity", desc: "You have a second identity — complete with documents, established acquaintances, and a convincing disguise — and you can forge papers so long as you've seen an example of the kind you want to copy." }),

  criminal: bg("criminal", "Criminal", ["deception", "stealth"],
    ["One gaming set", "Thieves' tools"], 0,
    { name: "Criminal Contact", desc: "You have a reliable contact in the criminal underworld who acts as your liaison to a network of other lawbreakers. You know how to get messages to and from that contact, even over great distances, using local go-betweens." }),

  entertainer: bg("entertainer", "Entertainer", ["acrobatics", "performance"],
    ["Disguise kit", "One musical instrument"], 0,
    { name: "By Popular Demand", desc: "You can always find a place to perform — an inn, tavern, theater, or noble's court. There you receive free lodging and food of a modest standard, and your performances make you something of a local celebrity." }),

  "folk-hero": bg("folk-hero", "Folk Hero", ["animal-handling", "survival"],
    ["One type of artisan's tools", "Vehicles (land)"], 0,
    { name: "Rustic Hospitality", desc: "Because you're one of the common folk, ordinary people will shelter and hide you from the law or anyone else searching for you, at no risk to themselves unless you give them cause." }),

  "guild-artisan": bg("guild-artisan", "Guild Artisan", ["insight", "persuasion"],
    ["One type of artisan's tools"], 1,
    { name: "Guild Membership", desc: "Your guild will provide lodging and food if needed and pay for your funeral. In some cities the guildhall is a center of power; fellow guild members will support you, and the guild's letters of introduction open doors." }),

  hermit: bg("hermit", "Hermit", ["medicine", "religion"],
    ["Herbalism kit"], 1,
    { name: "Discovery", desc: "Your seclusion gave you access to a unique and powerful discovery — a great truth about the cosmos, the location of something long forgotten, or a secret that could unsettle those in power. Work out the details with your DM." }),

  noble: bg("noble", "Noble", ["history", "persuasion"],
    ["One gaming set"], 1,
    { name: "Position of Privilege", desc: "People are inclined to think the best of you. You're welcome in high society, and common folk try to accommodate you and avoid your displeasure. You can secure an audience with a local noble when you need one." }),

  outlander: bg("outlander", "Outlander", ["athletics", "survival"],
    ["One musical instrument"], 1,
    { name: "Wanderer", desc: "You have an excellent memory for maps and geography, and can always recall the general layout of terrain, settlements, and features around you. You can find fresh water and food for yourself and up to five others each day in the wild." }),

  sage: bg("sage", "Sage", ["arcana", "history"],
    [], 2,
    { name: "Researcher", desc: "When you don't know a piece of lore, you often know where and from whom you can find it — a library, a scholar, another sage, or someone who once studied it. Some knowledge may be dangerous, hidden, or lost entirely." }),

  sailor: bg("sailor", "Sailor", ["athletics", "perception"],
    ["Navigator's tools", "Vehicles (water)"], 0,
    { name: "Ship's Passage", desc: "You can secure free passage on a sailing ship for yourself and your companions, calling in favors among the crews you've worked with. You may have to work your way across, and you can't guarantee a reputable captain or smooth voyage." }),

  soldier: bg("soldier", "Soldier", ["athletics", "intimidation"],
    ["One gaming set", "Vehicles (land)"], 0,
    { name: "Military Rank", desc: "You have a military rank from your career as a soldier. Soldiers loyal to your former organization still recognize your authority, defer to you if lower in rank, and you can invoke your rank to requisition simple equipment or gain temporary passage." }),

  urchin: bg("urchin", "Urchin", ["sleight-of-hand", "stealth"],
    ["Disguise kit", "Thieves' tools"], 0,
    { name: "City Secrets", desc: "You know the secret patterns and flow of cities and can find passages others would miss. When not in combat, you can lead companions through a city at twice the normal travel pace between two locations you know." }),
};
