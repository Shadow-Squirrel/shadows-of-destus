-- ═════════════════════════════════════════════════════════════
--  Shadows of Destus — the player primer, as Home page sections.
--
--  Run this AFTER schema.sql (Supabase → SQL Editor → paste →
--  Run). Safe to re-run: it wipes and reloads the Home sections
--  (it touches nothing else — quests, notes, codex are safe).
--
--  Player-facing content only. The primer says "none of this is
--  secret" — keep it that way: DM secrets never go in this repo,
--  because the repo is public.
--
--  The $primer$...$primer$ markers are Postgres "dollar quotes":
--  everything between them is plain text, apostrophes and all.
-- ═════════════════════════════════════════════════════════════

delete from campaign_sections;

insert into campaign_sections (title, body, sort_order) values

('The World', $primer$*None of this is secret. Your character grew up knowing all of it.*

Destus is scattered. Five big landmasses and a long chain of islands, set far enough apart in open water that no two of them share a road. If you're going anywhere worth going, you're going by ship, and you're going to spend three days at a quay waiting on weather while a man named Ferris tells you about his hernia.

It's a decent time to be alive. Harvests have been good. The roads are safe enough that highwaymen have to advertise. There's a war, technically, but nobody's fought a battle in sixty years and these days it mostly amounts to two countries refusing to sell each other anything and being extremely smug about it.

You'll spend this campaign in **Tormir**, on a coast where old forest runs down into tidal marsh, in a town of four hundred people that smells so aggressively of fish that the smell has opinions.$primer$, 1),

('Magic', $primer$Magic is common. Not spectacular — common, the way carpentry is common.

Every village has somebody. She sells charms, blesses foundations, keeps rats out of the grain, and gets dragged into arguments about whose cow it actually is. Any inn worth the name lights its rooms without oil and keeps the cellar cold without ice. Ships carry a weather-reader the way they carry a cook, and the fee turns up on the manifest between the salt pork and the rope.

And because it's common, people use it for exactly what you'd expect people to use it for. The three most widely sold enchantments in the world keep beer cold, get stains out of linen, and are not discussed in front of children. There is an entire guild in Atropia whose members will tell you with a straight face that they specialise in "domestic comfort." Everyone knows what that means. Everyone pretends not to.

Nobody flinches at a spell. Nobody's impressed either, unless it's unusually good. A kid who lights a candle from across the room gets told to stop showing off and eat his supper.

What people respect is skill. There's a long way between the woman selling luck-knots off a market stall and someone who did nine years at the colleges in Istrim, and everyone knows precisely where that gap sits. The first costs coppers and is on every corner. The second gets consulted by kings and charges like it.

So cast freely. Nobody's burning anybody. Worst case a publican asks if you'd mind doing that outside, and he's asking because of the last group, not because of you.$primer$, 2),

('Tormir', $primer$Tormir is the most important country in the world, and the reason is faintly embarrassing: it writes everything down.

Not as a figure of speech. There is a clerk in every town of any size and he has your name, your father's name, what your family owns, what you owe, what you were christened, and what you paid for your last horse. Land registers going back four hundred years. Wills, marriages, burials, manifests, harvest yields, court judgments, and a truly unhinged amount of correspondence about drainage. All of it copied, indexed, filed, and — this is the part that gets other countries — *findable*.

You cannot be born in Tormir without paperwork. You cannot die in Tormir without paperwork. A Tormiran will tell you this is why the country works, and the infuriating thing is that he's right. You can settle a dispute here by producing a document, which anywhere else would be regarded as a party trick.

The place itself is old forest and river valley. **Elderwood** in the west, **Kingshade** in the north, **Blackmire Wood** running down to the southeastern coast, the **Frostpine Range** cutting across the southwest, good farmland in the gaps between. Along the eastern shore it all gives way to marsh — reed, channel, black water, and fog off the sea most mornings.

**Crowspire**, the capital, sits deep in the forest. Spires, stone bridges, and an unreasonable number of buildings that are just archives with roofs on.

Tormirans are polite, unhurried, and utterly insufferable about their own filing.$primer$, 3),

('Everywhere Else', $primer$**Vantreach** — the frozen north end of Tormir's landmass. Black pine, granite, a volcano called Varell, and four workable months a year. They build the best ships afloat and rent out sailors to anyone paying. Their history lives in songs of extraordinary length, all of which end with somebody drowning, usually shortly after making a decision about a woman that everyone else had advised against.

**The Corrin Republic** — nine rocky islands with more money than anywhere else in the world. They own the shipping and print the charts everyone navigates by. A Corriner will absolutely screw you, but it will be in writing, it will be legal, and you will have signed it yourself while thanking him for his time.

**Atropia** — the warm southern coast. Terraced hills, long bays, and the best wine anyone has ever made. Also olives, glass, dye, and the aforementioned domestic comfort industry. Enormously rich, permanently squabbling with itself, and utterly uninterested in anyone else's problems. An Atropian noble will spend more on a garden than on soldiers and think you're a peasant for raising it.

**The Kethrin Holds** — high dry mountain country in the east, and everything crossing that continent has to pass through it. They charge for the privilege. Their mercenaries are famous for executing a contract to the exact letter and then stopping dead, regardless of what's happening at the time, which has ended at least two battles in ways nobody enjoyed.

**Denovia** — far east, beyond the mountains, facing an ocean nobody has crossed. Deepest mines and finest steel in the world, and at **Istrim**, nine colleges and a library scholars spend a decade petitioning to enter. Everyone in Tormir was raised to hate Denovia. Almost nobody in Tormir has ever met one. *Play one. It'll be great.*

**The Sethari** — the grass east of the mountains, running further than anyone's bothered to map. Best horses anywhere. No cities, no books, and a memory that runs hundreds of lines long and doesn't drop a word between generations.

**The Kared Klans** — the southern island where the sea lanes meet the caravan roads. Thirty trading families who've spent eight centuries arguing about who outranks whom and have never once settled it. Spice, incense, dye, ivory, glass worth crossing an ocean for, and a marriage-alliance chart so complex it's hung on a wall.

**The Quiet Reach** — not a country. A big dead landmass sitting alone in the middle of the sea, covered in ruins. A few hundred salvagers work the coast and none of them stay past forty.$primer$, 4),

('Things Everybody Knows', $primer$**The Ashwardens.** When a town burns down, these are the people who come. Crown-funded relief service, and genuinely excellent — tents up within a day, clean water, healers, hot food, and they don't leave until it's finished. Ask anyone's grandmother about the Ashwardens and settle in, because she has a story and it's a kind one.

**Bad years.** Every so often a place has one. A tremor where tremors don't happen. A fire nobody can account for. A stretch of ground that turns sour and grows nothing for a decade. Rare enough to be worth talking about, common enough that everyone's heard of a case. The Ashwardens turn up, and that's generally that.

**The gifted.** Nothing to do with magic. A few hundred people in the world are simply born with something — one specific, permanent, inexplicable knack. Might be devastating. Might be worthless. Might be genuinely humiliating. It can't be taught, can't be learned, can't be got rid of, and it's poor manners to ask.

**You're one of them.**$primer$, 5),

('Things Nobody Can Explain', $primer$Every world has its loose threads. Here are Destus's, all of them things a curious person could actually chase.

**The Ashwardens are sometimes quick.** Not always. But there are stories — a granary fire where the relief wagons were on the road before the smoke cleared, a flooded valley where the tents were up the same evening. People notice, shrug, and say they must have had a column nearby. It comes up in taverns roughly as often as any other harmless oddity.

**Nobody sails near the Quiet Reach.** Every lane on every chart bends to give it a wide berth. Ask a captain why and he'll tell you the water's bad off that shore, which is true. Ask who decided the lanes should run that way and he won't have an answer, because the charts have always looked like that.

**Nobody can date the ruins.** Not *won't* — can't. Every scholar who has tried has produced a different number and been comprehensively torn apart by every other scholar. There is no agreed answer and there has never been one.

**Crowspire has three founding stories.** All official. All taught. All with documents behind them. The city that solves other people's disputes by producing paperwork cannot settle its own origin and has stopped trying.

**There's a village called Ashwatch on old charts and not on new ones.** Nobody knows what it watched.

**Children's rhymes are older than the books.** Songs and skipping-rhymes come up in places thousands of miles apart with the same words in them, some of which aren't words in any language currently spoken. Scholars find this charming and don't pursue it.

*(And for balance: people will also tell you the Corrin banks are run by a five-hundred-year-old woman, that Varell erupts when a king dies, and that there's a sea serpent in the Stormwake that only eats tax collectors. Some of what you hear is nonsense. Working out which is the game.)*$primer$, 6),

('What This Game Actually Is', $primer$Four things, roughly in equal measure.

**Combat.** Plenty of it, and it will be dangerous. Positioning matters, terrain matters, and running away is frequently the correct call.

**Mystery.** Things won't add up. You'll be given real information that points in real directions and you'll be expected to actually think about it. I don't hide answers behind a single perception check — if you pull the thread, you'll get somewhere.

**Strategy.** A lot of problems in this world can't be solved by hitting them. Some of the most dangerous people you'll meet are unarmed, polite, and holding a clipboard. You'll need to plan, and the good plans will be the ones you made in advance rather than in the moment.

**Goofiness.** It's a game and we're here to enjoy ourselves. Be funny. Be filthy. Do the stupid thing occasionally. I will absolutely reward a plan that's idiotic but committed, and I will remember every single terrible decision you make and bring it back later.

Nothing in this world announces itself. No monologues, no cackling, no villains dressed as villains. The dangerous people are polite, and the scariest thing anyone hands you will be a piece of paper with your name on it.

It starts small. It does not stay that way.$primer$, 7),

('Building Your Character', $primer$**First level. Any class, race, or background** that fits a world of ports, forests, farmland, and long sea crossings.

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

**Play someone who could get attached.** You start as strangers and that matters. But it's a long campaign, and it goes considerably better if your character is the sort of person who could end up caring about five idiots they met in a swamp.$primer$, 8);
