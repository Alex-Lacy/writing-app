// Default rule set for the Cliché Filter.
//
// Written for this app from public research on AI creative-writing "slop":
// EQ-Bench slop-score (overused words, trigrams, not-X-but-Y contrasts), the
// antislop-sampler phrase frequency lists, and community banned-phrase lists for
// roleplay front ends. The rules below are our own; they favour precision over
// recall, so they target clichéd constructions rather than single common words.
//
// Formats (see the Cliché Filter parser):
//   DEFAULT_WORDLISTS: `NAME== alt1|alt2` per line; %OTHER% references another list.
//   DEFAULT_RULES:     `#! [rule-id] Description` header, then one or more
//                      `/pattern/flags` lines. %NAME% expands to (?:list).
//
// Remember: this is a template literal, so a regex \b is written \\b here.

export const DEFAULT_WORDLISTS = `# Pronouns
SUBJ== she|he|i|you|they|we
OBJ== her|him|me|you|them|us
POSS== her|his|my|your|their|our|its
SELF== herself|himself|myself|yourself|themselves|themself|ourselves

# Emotions that turn up in "a mix of X and Y" / "a wave of X" clichés
EMOTION== fear|excitement|anticipation|trepidation|curiosity|amusement|determination|awe|wonder|relief|guilt|desire|longing|apprehension|nervousness|confusion|anger|frustration|hope|dread|sadness|regret|surprise|annoyance|affection|arousal|lust|shame|pride|disbelief|concern|worry|resignation|defiance|admiration|irritation|embarrassment|joy|grief|panic|unease|tenderness|gratitude|nostalgia|melancholy|vulnerability|hurt|jealousy|satisfaction|triumph|exhilaration

# Body / sensation vocabulary for intimate-scene rules
SENSATION== pleasure|ecstasy|bliss|desire|arousal|need|lust|heat|electricity|sensation|want
`;

export const DEFAULT_RULES = `
# =====================================================================
# Stock phrases
# =====================================================================

#! [shiver-spine] Shivers or chills running down a spine, e.g. "a shiver ran down her spine"
/\\b(?:shiver|chill|tingle|thrill|jolt)s?\\b[^.!?\\n]{0,30}?\\b(?:down|up|along)\\s+(?:%POSS%|the)\\s+spine\\b/i

#! [testament-to] "A testament to" as a stock way to assign significance, e.g. "a testament to her resilience"
/\\b(?:a|an)\\s+(?:\\w+\\s+)?testament\\s+to\\b/i

#! [tapestry] Tapestry/symphony/kaleidoscope metaphors, e.g. "a rich tapestry of sound", "a symphony of scents"
/\\b(?:a|the)\\s+(?:\\w+\\s+)?tapestry\\s+of\\b/i
/\\b(?:rich|intricate|vibrant|complex)\\s+tapestry\\b/i
/\\b(?:a|the)\\s+(?:\\w+\\s+)?(?:symphony|kaleidoscope|cacophony|maelstrom)\\s+of\\b/i

#! [emotion-whirlwind] Storms and floods of feelings, e.g. "a whirlwind of emotions"
/\\b(?:whirlwind|storm|maelstrom|torrent|tidal\\s+wave|roller-?\\s?coaster|tumult|riot|tangle|swirl)\\s+of\\s+(?:emotions?|feelings?|%EMOTION%)\\b/i

#! [mix-of-emotions] Blended emotions, e.g. "a mix of fear and excitement"
/\\b(?:mix|mixture|blend|cocktail|combination|jumble|heady\\s+mix)\\s+of\\s+%EMOTION%\\s*,?\\s+and\\b/i

#! [barely-whisper] Voice barely above a whisper, e.g. "her voice barely above a whisper"
/\\b(?:barely|scarcely|little|hardly)\\s+(?:above|more\\s+than|louder\\s+than)\\s+a\\s+whisper\\b/i
/\\bvoice\\s+(?:was\\s+)?(?:barely|scarcely|hardly)\\s+(?:audible|a\\s+whisper)\\b/i

#! [maybe-just-maybe] "Maybe, just maybe" hedge, e.g. "maybe, just maybe, they'd make it"
/\\b(?:maybe|perhaps),?\\s+just\\s+(?:maybe|perhaps)\\b/i

#! [air-thick-with] The air thick/heavy/charged with something, e.g. "the air was thick with tension"
/\\b(?:air|atmosphere)\\s+(?:was|is|hung|grew|felt|seemed|became|had\\s+grown)\\s+(?:\\w+\\s+)?(?:thick|heavy|charged|electric|alive|pregnant)\\s+with\\b/i
/\\b(?:hung|hangs|hanging)\\s+(?:thick|heavy)\\s+in\\s+the\\s+air\\b/i

#! [air-crackled] Air or space crackling/humming with energy, e.g. "the air crackled with tension"
/\\b(?:air|atmosphere|room|space\\s+between\\s+(?:them|us))\\s+(?:crackled|crackling|crackles|hummed|humming|thrummed|thrumming|buzzed|sizzled|sparked)\\s+with\\b/i

#! [felt-like-eternity] What felt like an eternity, e.g. "for what felt like an eternity"
/\\bwhat\\s+(?:felt|seemed)\\s+like\\s+(?:an\\s+eternity|hours|forever|a\\s+lifetime|ages)\\b/i
/\\b(?:felt|seemed)\\s+like\\s+an\\s+eternity\\b/i

#! [held-breath-unknowingly] A breath they didn't know they'd been holding, e.g. "she let out a breath she didn't know she'd been holding"
/\\bbreath\\s+(?:that\\s+)?%SUBJ%\\s+(?:didn['’]?t|did\\s+not|hadn['’]?t|had\\s+not)\\s+(?:even\\s+)?(?:know|realize|realise|notice)\\b/i
/\\b(?:didn['’]?t|did\\s+not|hadn['’]?t)\\s+(?:even\\s+)?(?:know|realize|realise)\\s+%SUBJ%(?:\\s+had|['’]d)\\s+been\\s+holding\\b/i

#! [couldnt-help-but] Couldn't help but feel/wonder/smile, e.g. "she couldn't help but smile"
/\\b(?:couldn['’]?t|could\\s+not|can['’]?t|cannot)\\s+help\\s+but\\s+(?:feel|wonder|notice|smile|think|marvel|admire|laugh|grin|be)\\b/i

#! [couldnt-shake-feeling] Couldn't shake the feeling, e.g. "he couldn't shake the feeling that something was wrong"
/\\b(?:couldn['’]?t|could\\s+not|can['’]?t)\\s+shake\\s+(?:the|a|this|that)\\s+(?:nagging\\s+|uneasy\\s+|sinking\\s+)?(?:feeling|sense|thought|impression)\\b/i

#! [something-shifted] Something shifting/stirring inside or between people, e.g. "something shifted between them"
/\\bsomething\\s+(?:shifted|stirred|unfurled|loosened|softened|clicked|cracked\\s+open|broke\\s+open|settled)\\s+(?:in|inside|within|between|deep\\s+in)\\s+(?:%OBJ%|%POSS%|them|the\\s+two)\\b/i

#! [world-narrowed] The world narrowing or falling away, e.g. "the world narrowed to his touch"
/\\b(?:the|her|his|my|their)\\s+(?:whole\\s+|entire\\s+)?world\\s+(?:narrowed|narrowing|shrank|shrinking|fell\\s+away|tilted|tilting|ceased\\s+to\\s+exist|melted\\s+away|faded\\s+away|stopped\\s+turning|tilted\\s+on\\s+its\\s+axis)\\b/i
/\\b(?:the\\s+)?rest\\s+of\\s+the\\s+world\\s+(?:fell|faded|melted|dropped|slipped)\\s+away\\b/i

#! [held-its-breath] The world/room holding its breath, e.g. "the whole city seemed to hold its breath"
/\\b(?:world|room|forest|city|night|air|house|universe|everything|crowd|street)\\s+(?:seemed\\s+to\\s+|seemed\\s+to\\s+be\\s+)?(?:held|hold|holding|holds)\\s+its\\s+breath\\b/i

#! [palpable] Palpable tension/silence, e.g. "the tension was palpable"
/\\bpalpable\\s+(?:tension|silence|excitement|fear|anticipation|relief|desire|hunger|grief|anger|energy|unease|sense)\\b/i
/\\b(?:tension|silence|excitement|fear|anticipation|relief|desire|hunger|grief|anger|unease)\\s+(?:was|were|is|felt|grew|became)\\s+(?:almost\\s+)?palpable\\b/i

#! [hung-in-the-air] Words or questions hanging in the air, e.g. "the question hung in the air between them"
/\\b(?:words?|question|silence|accusation|confession|threat|promise|tension|unspoken|admission|statement|implication)\\s+(?:\\w+\\s+)?(?:hung|hanging|hangs|lingered|lingering)\\s+(?:heavy\\s+|thick\\s+)?(?:in\\s+the\\s+air|between\\s+(?:them|us))\\b/i

#! [unspoken] Unspoken promises/understandings, e.g. "an unspoken understanding passed between them"
/\\bunspoken\\s+(?:words|promise|promises|question|questions|understanding|tension|agreement|truth|things|challenge|invitation|connection|bond|language|message|vow)\\b/i

#! [electric-jolt] Electricity and jolts from touch, e.g. "his touch sent a jolt of electricity through her"
/\\b(?:jolt|spark|current|bolt|surge|shock|zing)s?\\s+of\\s+(?:electricity|lightning)\\b/i
/\\bsen(?:t|ds|ding)\\s+(?:a\\s+)?(?:jolts?|sparks?|shocks?|currents?|electricity|tingles?|shockwaves?)\\s+(?:of\\s+\\w+\\s+)?(?:through|down|up|along|across)\\b/i
/\\b(?:skin|flesh)\\s+(?:tingled|tingling|burned|burning|sang|singing)\\s+where\\b/i

#! [stock-scenery] Stock scenery, e.g. "the sun dipped below the horizon, casting long shadows", "dust motes danced"
/\\bcast(?:s|ing)?\\s+(?:long|dancing|eerie)\\s+shadows\\b/i
/\\b(?:sun|light)\\s+(?:dipped|dipping|sank|sinking|slipped|slipping)\\s+below\\s+the\\s+horizon\\b/i
/\\bpainting\\s+the\\s+sky\\s+(?:in\\s+)?(?:hues|shades)\\s+of\\b/i
/\\bdust\\s+motes\\s+(?:danc|swirl|drift|float|twirl|spiral)\\w*/i

#! [heart-and-blood] Stock heart/blood reactions, e.g. "her heart hammered against her ribs", "his heart skipped a beat", "his blood ran cold"
/\\bheart\\s+(?:pounding|hammering|thundering|racing|slamming|thudding)\\s+(?:in|against)\\s+%POSS%\\s+(?:chest|ribs|ribcage|rib\\s+cage)\\b/i
/\\bheart\\s+(?:pounded|hammered|thundered|slammed|thudded|beat)\\s+against\\s+%POSS%\\s+(?:ribs|ribcage|rib\\s+cage|chest|sternum)\\b/i
/\\bheart\\s+(?:skip(?:ped|s)?|stuttered|stutters|stumbled)\\s+a\\s+beat\\b/i
/\\bblood\\s+(?:r[au]n|running|turned)\\s+(?:to\\s+)?(?:cold|ice)\\b/i

#! [breath-caught] Breath catching or hitching, e.g. "her breath caught in her throat"
/\\bbreath\\s+(?:caught|catching|hitched|hitching|stuttered|stalled)\\s+in\\s+%POSS%\\s+(?:throat|chest|lungs)\\b/i
/\\b%POSS%\\s+breath\\s+hitch(?:ed|es|ing)?\\b/i

#! [steadying-breath] Steadying/shaky breaths and steeling oneself, e.g. "she took a steadying breath, steeling herself"
/\\b(?:took|takes|taking|drew|draws|drawing)\\s+a\\s+(?:deep,?\\s+)?(?:steadying|shaky|shuddering|fortifying|calming|ragged)\\s+breath\\b/i
/\\bsteel(?:ed|ing|s)\\s+%SELF%\\b/i

#! [mind-racing] Mind racing or reeling, e.g. "her mind raced with possibilities"
/\\b%POSS%\\s+mind\\s+(?:racing|raced|races|reeling|reeled|whirling|whirled|spinning|spun|whirring)\\b/i

#! [sense-of] Abstract "sense of" feelings, e.g. "a renewed sense of purpose", "she felt a profound sense of peace"
/\\b(?:renewed|newfound|new-found)\\s+(?:sense\\s+of\\s+)?(?:purpose|determination|resolve|hope|confidence|strength)\\b/i
/\\bquiet\\s+(?:determination|resolve|strength|confidence|intensity)\\b/i
/\\bfelt\\s+a\\s+(?:strange|profound|deep|growing|sudden|overwhelming|renewed|newfound|quiet|familiar|creeping)\\s+sense\\s+of\\b/i

#! [ready-to-face] Ready to face whatever lies ahead, e.g. "ready to face whatever challenges lay ahead"
/\\bready\\s+to\\s+face\\s+whatever\\b/i
/\\bwhatever\\s+(?:challenges\\s+|trials\\s+|dangers\\s+)?(?:lay|lies|may\\s+lie|might\\s+lie|awaited|awaits)\\s+(?:ahead|before)\\b/i
/\\bwhatever\\s+(?:came|comes|might\\s+come)\\s+next\\b/i

#! [distant-dog] Somewhere, a dog barked, e.g. "Somewhere in the distance, a dog barked."
/\\b(?:somewhere|in\\s+the\\s+distance|far\\s+off|far\\s+away|outside)[^.!?\\n]{0,25},\\s+an?\\s+(?:dog|owl|siren|car\\s+alarm|bird|church\\s+bell|clock|baby|train|wolf|coyote)\\s+(?:barked|hooted|wailed|howled|sang|called|chimed|struck|cried|whistled|began|started)\\b/i

#! [days-into-weeks] Time-skip formula, e.g. "days turned into weeks"
/\\b(?:days|weeks|months)\\s+(?:turned|bled|blurred|stretched|melted)\\s+into\\s+(?:weeks|months|years)\\b/i

#! [something-akin] Flicker of something akin to an emotion, e.g. "a flicker of something akin to regret"
/\\b(?:flicker|pang|twinge|glimmer|spark|stab|hint|flash)\\s+of\\s+something\\b/i
/\\b(?:something|emotion|feeling)\\s+akin\\s+to\\b/i

#! [wave-washed-over] A wave of emotion washing over someone, e.g. "a wave of relief washed over her"
/\\b(?:wave|surge|rush|flood|wash)\\s+of\\s+(?:\\w+\\s+)?(?:%EMOTION%|emotion|nausea|warmth|exhaustion|calm)\\s+(?:wash(?:ed|es|ing)?|crash(?:ed|es|ing)?|surg(?:ed|es|ing)|roll(?:ed|s|ing)?|flood(?:ed|s|ing)?|swept|sweeping)\\s+(?:over|through)\\b/i

#! [weight-of] The weight of words/gazes/decisions, e.g. "the weight of his gaze"
/\\bthe\\s+(?:full\\s+)?weight\\s+of\\s+(?:it\\s+all|everything|%POSS%\\s+(?:words|decision|choices?|actions|confession|gaze|stare|secret|past|responsibility|regret|stare|attention)|the\\s+(?:world|moment|situation|words|decision|truth|silence|unspoken))\\b/i

#! [something-uniquely-them] Scent or presence that is "uniquely him", e.g. "cedar and something uniquely him"
/\\bsomething\\s+(?:uniquely|distinctly|purely|entirely|essentially|undeniably)\\s+(?:him|her|hers|his|them|theirs|you|yours|me|mine|\\w+['’]s)\\b/i

#! [every-fiber] Every fibre / the core of one's being, e.g. "every fiber of her being", "the core of his being"
/\\bevery\\s+(?:fib(?:er|re)|nerve(?:\\s+ending)?|cell|atom|inch)\\s+of\\s+%POSS%\\s+(?:being|body|soul)\\b/i
/\\b(?:core|center|centre|depths|essence)\\s+of\\s+%POSS%\\s+(?:being|soul|existence)\\b/i

#! [stock-similes] Stock similes, e.g. "clung like a second skin", "hit him like a physical blow"
/\\blike\\s+a\\s+second\\s+skin\\b/i
/\\blike\\s+a\\s+physical\\s+(?:blow|force|thing|weight|touch|presence|slap)\\b/i

# =====================================================================
# Constructions
# =====================================================================

#! [not-just-but] Not just X, but Y / not just X—it's Y (plain "not only X but also Y" is left alone), e.g. "It wasn't just a house—it was a home."
/\\bnot\\s+(?:just|merely|simply)\\s+[^.!?\\n]{1,60}?(?:,|;|—|–|\\s-{1,2})\\s*(?:but|it\\s+was|it['’]s|this\\s+was|they\\s+were|she\\s+was|he\\s+was)\\b/i
/\\bnot\\s+only\\s+[^.!?\\n]{1,60}?(?:—|–|\\s-{1,2})\\s*(?:but|it\\s+was|it['’]s|this\\s+was|they\\s+were)\\b/i
/\\bnot\\s+only\\s+[^.!?\\n]{1,60}?[,;]\\s*(?:it\\s+was|it['’]s|this\\s+was|they\\s+were|she\\s+was|he\\s+was)\\b/i
/\\b(?:wasn['’]?t|isn['’]?t|weren['’]?t|aren['’]?t)\\s+(?:just|only|merely|simply)\\s+[^.!?\\n]{1,60}?(?:,|;|—|–|\\s-{1,2})\\s*(?:but|it\\s+was|it['’]s|this\\s+was|they\\s+were|she\\s+was|he\\s+was)\\b/i

#! [not-x-it-was-y] Negate-then-correct across clauses, e.g. "It wasn't fear. It was something worse."
/\\b(it|this|that|he|she|they)(?:\\s+(?:was|is|were|are)n['’]t|\\s+(?:was|is|were|are)\\s+not|['’]s\\s+not|['’]re\\s+not)\\s+[^.!?;:\\n]{1,60}?(?:[.;:!]|\\s*[—–]|\\s+-{1,2})\\s*\\1(?:['’]s|['’]re|\\s+(?:was|is|were|are))\\b/i

#! [not-because-but-because] Not because X, but because Y, e.g. "not because she was afraid, but because she cared"
/\\bnot\\s+because\\s+[^.!?\\n]{1,80}?,?\\s+but\\s+because\\b/i

#! [fragment-not-but] Sentence-initial "Not X, but Y" fragments, e.g. "Not with anger, but with something softer."
/(?<=^|[.!?"”]\\s{1,3})Not\\s+(?:a|an|the|with|from|in|for|out\\s+of)\\s+[^.!?\\n]{1,40}?(?:,|—|–|\\.)\\s*(?:but|But|Not)\\b/m

#! [less-x-than-y] Less X than Y / less X and more Y, e.g. "It was less a question than a command."
/\\bless\\s+(?:a|an|like|of\\s+an?)\\s+[^.!?,\\n]{1,40}?\\s+(?:than|and\\s+more)\\s+(?:an?|like|of)\\b/i

#! [was-it-or-was-it] Rhetorical either/or question pair, e.g. "Was it fear? Or was it something else?"
/\\b(?:was|is)\\s+it\\s+[^.!?\\n]{1,40}\\?\\s+Or\\s+(?:was|is)\\s+it\\b/i

#! [heres-the-thing] Rhetorical "here's the thing" setup, e.g. "But here's the thing:"
/\\b(?:but\\s+)?here['’]s\\s+the\\s+(?:thing|kicker|truth|catch|part)\\s*[:,—–]/i

#! [something-else-entirely] Vague escalation to "something else", e.g. "something else entirely" / "something darker, something more"
/\\bsomething\\s+else\\s+entirely\\b/i
/\\bsomething\\s+(?:more|darker|deeper|else|older|softer)\\s*(?:,|—|–)\\s*something\\b/i

#! [the-kind-of-that] "The kind of [abstract noun] that…", e.g. "the kind of silence that presses on your ears"
/\\bthe\\s+kind\\s+of\\s+(?:silence|quiet|stillness|smile|look|laugh|tired|exhaustion|calm|grief|warmth|ache|hunger|kiss|touch|pause|beautiful|quiet\\s+\\w+)\\s+that\\b/i

#! [somewhere-between] A sound somewhere between X and Y, e.g. "a sound somewhere between a laugh and a sob"
/\\b(?:somewhere|something)\\s+between\\s+an?\\s+\\w+\\s+and\\s+an?\\s+\\w+/i

#! [staccato-fragments] Three one-word sentences in a row, e.g. "Slow. Deliberate. Final."
/(?<=^|[.!?"”]\\s{1,3})(?!(?:Mrs?|Ms|Dr|St)\\.)[A-Z][a-z]+\\.\\s+(?!(?:Mrs?|Ms|Dr|St)\\.)[A-Z][a-z]+\\.\\s+(?!(?:Mrs?|Ms|Dr|St)\\.)[A-Z][a-z]+\\./m

#! [repeated-opener] Three consecutive sentences starting with the same word, e.g. "She walked. She paused. She turned."
/(?<=^|[.!?]["”]?\\s{1,3})(?!(?:The|A|An|And|But|I)\\b)([A-Z][a-z]+)\\b[^.!?\\n]*[.!?]["”]?\\s+\\1\\b[^.!?\\n]*[.!?]["”]?\\s+\\1\\b/m

#! [em-dash-cluster] Four or more em dashes in one paragraph, e.g. "She paused—just for a second—then—"
/—[^\\n—]*—[^\\n—]*—[^\\n—]*—/

#! [despite-herself] Reacting "despite herself", e.g. "she smiled despite herself"
/\\bdespite\\s+%SELF%\\b/i

#! [answer-enough] Silence as an answer, e.g. "Her silence was answer enough."
/\\banswer\\s+enough\\b/i
/\\b(?:an?\\s+)?answer\\s+in\\s+itself\\b/i

# =====================================================================
# Dialogue tags and reactions
# =====================================================================

#! [said-voice-adjective] Said, [her] voice [adjective], e.g. "she said, her voice barely steady"
/\\b(?:said|says|asked|asks|whispered|replied|murmured|answered|added|admitted|continued)\\s*,\\s*%POSS%\\s+voice\\s+(?:barely|steady|soft|low|firm|trembling|filled|laced|tinged|thick|dripping|a\\s+mix|devoid|calm|hoarse|husky|rough|gentle|quiet|tight|strained|cracking|breaking)\\b/i

#! [voice-dripping-with] Voice dripping with something or described as a rumble, e.g. "his voice dripping with sarcasm", "his voice a low rumble"
/\\bvoice\\s+(?:dripping|laced|thick|heavy|tinged|rough|husky|hoarse|heavy|dark)\\s+with\\b/i
/\\bvoice\\s+(?:a|an)\\s+(?:low|husky|throaty|silky|velvet|velvety|dangerous|soft|deep|gravelly)\\s+(?:rumble|growl|purr|murmur|caress|whisper)\\b/i

#! [low-chuckle] Low/dark chuckles, e.g. "he let out a low chuckle"
/\\b(?:low|dark|deep|throaty|rich|husky|warm|soft)\\s+chuckle\\b/i
/\\bchuckl(?:ed|es|ing)\\s+(?:darkly|softly|lowly|low|deeply|warmly)\\b/i

#! [coy-dialogue-tag] Coy dialogue tags, e.g. '"Come here," she purred.' / "she said playfully"
/[,!?…]["”]\\s+%SUBJ%\\s+(?:purred|husked|breathed|crooned|rasped)\\b/i
/\\b(?:purred|husked)\\s*,\\s*["“]/i
/\\b(?:said|says|asked|asks|replied|whispered|murmured|teased|purred)\\s+(?:playfully|teasingly|huskily|seductively|sultrily|coyly|mischievously|cheekily|suggestively)\\b/i

#! [hint-of-amusement] A hint of amusement in someone's voice or eyes, e.g. "a hint of amusement in his voice"
/\\b(?:hint|note|trace|touch|edge|glint|thread)\\s+of\\s+(?:amusement|mischief|mirth|teasing|playfulness|challenge|steel|danger|humor|humour|sarcasm|smugness)\\s+in\\s+%POSS%\\s+(?:voice|tone|eyes|gaze|expression)\\b/i

#! [raised-eyebrow] Raised/arched/quirked or waggled eyebrows, e.g. "she arched an eyebrow"
/\\b(?:raised|raises|raising|arched|arches|arching|quirked|quirks|quirking|cocked|cocks|cocking)\\s+an?\\s+(?:\\w+\\s+)?(?:eyebrow|brow)\\b/i
/\\bwaggl(?:ed|es|ing|e)\\s+%POSS%\\s+(?:eye)?brows\\b/i

#! [a-beat] "A beat." as a stage direction, e.g. "A beat. Then she laughed." / "without missing a beat"
/(?<=^|[.!?"”]\\s{1,3})(?:a|one|another)\\s+beat(?:\\s+of\\s+silence)?[.,]/im
/\\bafter\\s+a\\s+(?:long\\s+)?beat\\b/i
/\\ba\\s+beat\\s+of\\s+(?:silence|stillness|hesitation)\\b/i
/\\bwithout\\s+missing\\s+a\\s+beat\\b/i

#! [conspiratorial] Conspiratorial whispers and leans, e.g. "she leaned in conspiratorially"
/\\bconspiratorially\\b/i
/\\bconspiratorial\\s+(?:whisper|tone|wink|grin|smile|look|glance|lean|murmur|air|voice)\\b/i

#! [padded-across] "Padded" as a walking verb, e.g. "she padded across the kitchen"
/\\bpadd(?:ed|ing|s)\\s+(?:barefoot\\s+|softly\\s+|silently\\s+|quietly\\s+)?(?:across|over|down|into|out|through|along|toward|towards|back|to|up|around)\\b/i

# =====================================================================
# Body, eyes and voice
# =====================================================================

#! [eyes-sparkling-with] Eyes sparkling/glinting with mischief, e.g. "eyes sparkling with mischief"
/\\b(?:eyes|gaze)\\s+(?:sparkl|twinkl|gleam|glint|danc|shin|glitter|glimmer|light)\\w*\\s+(?:up\\s+)?with\\s+(?:mischief|amusement|mirth|humor|humour|curiosity|delight|desire|lust|hunger|playfulness|unshed\\s+tears|something)\\b/i

#! [mischievous-glint] Mischievous/wicked glints, grins and smirks, e.g. "a mischievous glint in her eye"
/\\b(?:mischievous|playful|wicked|predatory|knowing|dangerous|devilish|impish|roguish)\\s+(?:glint|gleam|twinkle|sparkle|glimmer)\\b/i
/\\b(?:wicked|predatory|devilish|wolfish|impish|roguish|lopsided)\\s+(?:grin|smirk)\\b/i
/\\b(?:a|the)\\s+(?:\\w+\\s+)?(?:glint|twinkle|gleam)\\s+in\\s+%POSS%\\s+eyes?\\b/i

#! [orbs] Eyes called "orbs", e.g. "her emerald orbs"
/\\b(?:blue|green|brown|hazel|grey|gray|amber|emerald|sapphire|chocolate|azure|cerulean|honey|steel|steely|icy|violet|obsidian|onyx|crimson|golden|silver|dark|piercing|sparkling)(?:[- ]\\w+)?\\s+orbs\\b/i

#! [eyes-stock] Stock eye business, e.g. "eyes wide with fear", "his eyes never leaving hers", "her eyes fluttered closed"
/\\beyes\\s+(?:wide|widening|widened|filled)\\s+with\\s+(?:a\\s+)?(?:mix(?:ture)?\\s+of\\s+)?(?:fear|terror|shock|wonder|disbelief|surprise|awe|horror|curiosity|panic|alarm)\\b/i
/\\b(?:eyes|gaze)\\s+never\\s+(?:leaving|left|wavering|wavered|straying)\\b/i
/\\b(?:eyes|lashes|eyelids|lids)\\s+flutter(?:ed|ing|s)?\\s+(?:closed|shut|open)\\b/i

#! [brow-furrowed-in] Brow furrowed in concentration, e.g. "her brow furrowed in confusion"
/\\bbrows?\\s+(?:furrowed|furrowing|furrows|knitted|knitting|knit)\\s+(?:together\\s+)?in\\s+(?:concentration|confusion|concern|thought|worry)\\b/i

#! [ghost-of-smile] The ghost/hint of a smile, e.g. "the ghost of a smile"
/\\b(?:ghost|hint|whisper|flicker|trace|suggestion)\\s+of\\s+a\\s+(?:smile|grin|smirk|laugh)\\b/i

#! [smile-playing-lips] Smile playing on/tugging at lips, e.g. "a smile tugging at the corners of her mouth"
/\\b(?:smile|smirk|grin)\\s+(?:play(?:ed|ing|s)?|tugg(?:ed|ing)|tugs?|danc(?:ed|ing|es)|curl(?:ed|ing|s)?)\\s+(?:at|on|across)\\s+(?:the\\s+corners?\\s+of\\s+)?%POSS%\\s+(?:lips|mouth)\\b/i
/\\b(?:smile|smirk|grin)\\s+tug(?:ged|ging|s)?\\s+at\\s+the\\s+corners?\\s+of\\b/i
/\\bcorners?\\s+of\\s+%POSS%\\s+(?:mouth|lips)\\s+(?:twitch|quirk|curl|lift|tug|turn)(?:ed|ing|s)?\\s+(?:up|upward)?/i
/\\bnodded\\s*,\\s+a\\s+(?:small|slight|faint|soft|tight|wry)\\s+smile\\b/i

#! [spreading-across-face] Smile or blush spreading across a face, e.g. "a slow grin spread across his face"
/\\b(?:smile|grin|smirk|blush|flush)\\s+(?:spread(?:ing|s)?|crept|creeping|creeps|bloomed|blooming|blossomed)\\s+across\\s+%POSS%\\s+(?:face|features|lips|cheeks)\\b/i

#! [smile-not-reaching-eyes] A smile that didn't reach the eyes, e.g. "a smile that didn't quite reach his eyes"
/\\b(?:smile|grin|laugh)\\s+(?:that\\s+)?(?:didn['’]?t|did\\s+not|never|doesn['’]?t)\\s+(?:quite\\s+)?reach(?:ed)?\\s+%POSS%\\s+eyes\\b/i

#! [unreadable-expression] Unreadable/inscrutable expressions, e.g. "an unreadable expression on his face"
/\\b(?:unreadable|inscrutable)\\s+(?:expression|look|emotion|something|mask)\\b/i
/\\bexpression\\s+(?:was\\s+)?(?:unreadable|inscrutable)\\b/i

#! [tension-tells] Stock tension tells, e.g. "a muscle ticked in his jaw", "her knuckles turning white"
/\\bmuscle\\s+(?:ticked|ticking|ticks|tic(?:k)?ed|jumped|jumping|twitched|twitching|feathered|flexed|worked|jerked)\\s+in\\s+%POSS%\\s+jaw\\b/i
/\\bknuckles\\s+(?:turning\\s+|turned\\s+|going\\s+|gone\\s+|blanching\\s+)?white\\b/i

#! [bit-lip] Biting one's lower lip, e.g. "she bit her lower lip"
/\\bb(?:it|ite|ites|iting)\\s+(?:down\\s+on\\s+)?%POSS%\\s+(?:lower\\s+|bottom\\s+)?lip\\b/i

#! [hair-tuck-and-run] Tucking a strand of hair / running a hand through hair, e.g. "she tucked a loose strand of hair behind her ear"
/\\btuck(?:ed|ing|s)?\\s+an?\\s+(?:loose\\s+|stray\\s+|errant\\s+|wayward\\s+)?(?:strand|lock|wisp|curl)\\s+of\\s+(?:\\w+\\s+)?hair\\s+behind\\b/i
/\\b(?:ran|runs|running|raked|rakes|raking|dragged|drags|dragging)\\s+a\\s+(?:\\w+\\s+)?hand\\s+through\\s+%POSS%\\s+(?:\\w+\\s+)?hair\\b/i

# =====================================================================
# Intimate-scene clichés
# =====================================================================

#! [ministrations] "Ministrations" for touch, e.g. "she moaned under his ministrations"
/\\bministrations?\\b/i

#! [claimed-lips] Claiming lips/mouths, e.g. "he claimed her lips in a searing kiss"
/\\bclaim(?:ed|ing|s)?\\s+%POSS%\\s+(?:lips|mouth)\\b/i
/\\b(?:searing|bruising|punishing|possessive)\\s+kiss\\b/i
/\\bkiss-(?:swollen|bruised|reddened)\\b/i

#! [moan-escaped] A moan escaping someone's lips, e.g. "a soft moan escaped her lips"
/\\b(?:a|an)\\s+(?:\\w+\\s+)?(?:moan|whimper|gasp|groan|sigh|mewl|keen)\\s+(?:escaped|escapes|slipped\\s+(?:from|past|out\\s+of)|tore\\s+from|was\\s+torn\\s+from|spilled\\s+from|fell\\s+from)\\b/i

#! [arched-into] Arching into a touch, e.g. "she arched into his touch"
/\\barch(?:ed|ing|es)\\s+(?:%POSS%\\s+back\\s+)?(?:into|against|off|up\\s+into|up\\s+off)\\s+(?:%OBJ%|%POSS%|the)\\b/i

#! [pleasure-coursed] Pleasure coursing or in waves, e.g. "pleasure coursed through her", "waves of pleasure"
/\\b%SENSATION%\\s+(?:coursed|coursing|courses|surged|surging|surges|shot|shooting|rippled|rippling|radiated|radiating|spiraled|spiralled|spiraling|spiralling|thrummed|thrumming|crackled)\\s+(?:through|across|along|up|down)\\b/i
/\\bwaves?\\s+(?:after\\s+wave\\s+)?of\\s+(?:pleasure|ecstasy|bliss|desire|arousal|sensation)\\b/i

#! [stars-behind-eyes] Stars exploding behind eyes, e.g. "stars exploded behind her eyelids"
/\\b(?:stars|fireworks|white\\s+light|colou?rs|lights)\\s+(?:exploded|exploding|burst|bursting|bloomed|blooming|danced|dancing|erupted|erupting)\\s+(?:behind|across|before)\\s+%POSS%\\s+(?:eyes|eyelids|vision|lids)\\b/i

#! [dam-broke] The dam breaking / the coil snapping, e.g. "the coil inside her snapped"
/\\b(?:the|a)\\s+dam\\s+(?:inside\\s+%OBJ%\\s+)?(?:broke|burst|gave\\s+way|shattered)\\b/i
/\\bcoil\\s+(?:\\w+\\s+){0,4}?(?:snapped|tightened|tightening|sprang|unwound|broke|unraveled|unravelled)\\b/i

#! [with-need] Swollen/throbbing/aching with need, e.g. "throbbing with need"
/\\b(?:swollen|throbbing|aching|slick|wet|trembling|desperate|hard|heavy|dripping|shaking)\\s+with\\s+(?:need|want|desire|arousal|lust)\\b/i

#! [core-euphemisms] Euphemistic core / pooling heat, e.g. "her aching core", "heat pooled low in her belly", "bundle of nerves"
/\\b(?:%POSS%|the)\\s+(?:aching|throbbing|wet|molten|slick|heated|needy|clenching|dripping|burning)\\s+core\\b/i
/\\b(?:heat|warmth|desire|need|arousal|want)\\s+pool(?:ed|ing|s)?\\s+(?:low\\s+)?(?:in|between)\\s+%POSS%\\s+(?:core|belly|stomach|abdomen|thighs|legs|groin)\\b/i
/\\bbundle\\s+of\\s+nerves\\b/i

#! [pliant] Going pliant, e.g. "she melted, soft and pliant beneath him"
/\\b(?:went|goes|grew|became|turned|melted|melting)\\s+(?:soft\\s+and\\s+)?pliant\\b/i
/\\bpliant\\s+(?:and\\s+\\w+\\s+)?(?:beneath|under|against|in\\s+%POSS%\\s+(?:arms|hands|grip))\\b/i

#! [taut-peaks] Taut peaks and pebbled nipples, e.g. "her nipples pebbled into taut peaks"
/\\btaut\\s+(?:peaks?|buds?|nipples?)\\b/i
/\\b(?:peaks?|buds?|nipples?)\\s+(?:\\w+\\s+)?(?:pebbled|tightened|hardened)\\s+(?:into|to)\\s+(?:taut|hard|stiff|tight)\\b/i

#! [eyes-dark-desire] Eyes darkened with desire, pupils blown, e.g. "his eyes darkened with desire"
/\\b(?:eyes|gaze)\\s+(?:darkened|darkening|dark|heavy-lidded|hooded|smouldering|smoldering)\\s+with\\s+(?:desire|lust|need|hunger|want|arousal|heat)\\b/i
/\\bpupils\\s+(?:were\\s+)?(?:blown|dilated)\\s+(?:wide|with|black)\\b/i

#! [trail-of-kisses] Kiss trails, featherlight touches, ghosting breath, e.g. "he trailed kisses down her neck", "his breath ghosted over her ear"
/\\btrail(?:ed|ing|s)?\\s+(?:a\\s+(?:line|path|trail)\\s+of\\s+|of\\s+)?(?:hot\\s+|open-mouthed\\s+|feather-?\\s?light\\s+|lazy\\s+|wet\\s+|soft\\s+)?kisses\\s+(?:along|down|up|over|across)\\b/i
/\\b(?:feather-?\\s?light|butterfly)\\s+(?:kisses|touch|touches|caress|caresses|strokes)\\b/i
/\\b(?:breath|lips|fingers|fingertips|mouth)\\s+ghost(?:ed|ing|s)?\\s+(?:over|across|along|against)\\b/i

#! [came-undone] Coming undone / shattering around someone, e.g. "she came undone beneath him"
/\\b(?:came|coming|comes|come)\\s+undone\\b/i
/\\bshatter(?:ed|ing|s)?\\s+(?:apart\\s+)?(?:around|beneath|under|in\\s+%POSS%\\s+arms)\\s+(?:%OBJ%|%POSS%)\\b/i

#! [possessive-mine] Possessive growls, e.g. '"Mine," he growled.' / "a growl rumbled low in his chest"
/["“]Mine[.,!]?["”]\\s*,?\\s*(?:%SUBJ%\\s+)?(?:growled|snarled|rumbled|breathed|whispered|purred|murmured)\\b/i
/\\b(?:growl|rumble|groan|purr)\\s+(?:rumbled|rumbling|vibrated|vibrating|built|building|started|rose)\\s+(?:low\\s+)?(?:in|from|deep\\s+in|up\\s+from)\\s+%POSS%\\s+(?:chest|throat)\\b/i

#! [body-sang] Bodies singing and nerves on fire, e.g. "every nerve in her body sang"
/\\b(?:%POSS%|every)\\s+(?:body|skin|blood|nerves?|nerve\\s+endings?)\\s+(?:(?:in\\s+%POSS%\\s+body\\s+)?)(?:sang|sings|singing|hummed|thrummed|sizzled|ignited|caught\\s+fire|was\\s+on\\s+fire|came\\s+alive)\\b/i

# =====================================================================
# Endings and filler
# =====================================================================

#! [that-was-enough] Reflective closer, e.g. "And for now, that was enough." / "that made all the difference"
/\\b(?:and\\s+)?(?:for\\s+now,?\\s+)?(?:that|this|it)\\s+was\\s+(?:enough|everything|all\\s+that\\s+mattered)(?=\\s*["”]?\\s*[.!]|\\s*$)/i
/\\b(?:and\\s+)?maybe\\s+(?:that|this|it)\\s+was\\s+(?:okay|ok|alright|all\\s+right|enough|fine)\\b/i
/\\bmade\\s+all\\s+the\\s+difference\\b/i

#! [in-that-moment-knew] Epiphany beat, e.g. "In that moment, she knew."
/\\bin\\s+that\\s+(?:moment|instant),?\\s+%SUBJ%\\s+(?:knew|realized|realised|understood)\\b/i
/\\b(?:and\\s+)?(?:suddenly\\s+)?%SUBJ%\\s+knew,?\\s+with\\s+(?:a\\s+)?(?:\\w+\\s+)?certainty\\b/i

#! [first-time-long-time] For the first time in a long time, e.g. "for the first time in years, he felt at peace"
/\\bfor\\s+the\\s+first\\s+time\\s+in\\s+(?:a\\s+long\\s+time|(?:what\\s+felt\\s+like\\s+)?(?:years|forever|ages|a\\s+long\\s+while|recent\\s+memory))\\b/i

#! [never-the-same] Nothing would ever be the same, e.g. "nothing would ever be the same again"
/\\b(?:nothing|things|life|everything)\\s+would\\s+(?:never|not)\\s+(?:ever\\s+)?be\\s+the\\s+same\\b/i
/\\b(?:and\\s+)?(?:everything|something)\\s+had\\s+(?:changed|shifted)\\s*[.!]/i

#! [narrator-foreshadow] Narrator foreshadowing, e.g. "only time would tell", "one thing was certain", "little did she know"
/\\b(?:only\\s+)?time\\s+would\\s+tell\\b/i
/\\bone\\s+thing\\s+(?:was|is|remained)\\s+(?:certain|clear|for\\s+sure|sure)\\b/i
/\\blittle\\s+did\\s+%SUBJ%\\s+know\\b/i
/\\bunbeknownst\\s+to\\b/i

#! [new-beginning] Grand closing beginnings, e.g. "the beginning of something beautiful", "the future stretched out before them"
/\\bthe\\s+(?:beginning|start)\\s+of\\s+something\\s+(?:new|beautiful|more|different|real|wonderful|special)\\b/i
/\\b(?:a|the)\\s+new\\s+chapter\\s+(?:in|of)\\s+%POSS%\\b/i
/\\bthe\\s+future\\s+(?:stretched|stretching|lay|loomed|unfolded|beckoned)\\s+(?:out\\s+)?(?:before|ahead\\s+of|in\\s+front\\s+of)\\b/i
/\\bthe\\s+road\\s+ahead\\s+would\\s+be\\b/i

#! [face-it-together] Facing it together, e.g. "whatever came, they would face it together"
/\\b(?:face|faced|facing)\\s+(?:it|this|them|anything|whatever\\s+\\w+(?:\\s+\\w+)?)\\s+together\\b/i

#! [heart-reacts] A heart that quickens, leaps or sinks, e.g. "her heart quickened", "his heart leapt"
/\\b(?:%POSS%|\\w+['’]s)\\s+heart\\s+(?:quickened|leapt|leaped|lurched|sank|soared|raced|stuttered|swelled|clenched|twisted)\\b/i

#! [neck-hairs] Hairs rising on the neck, e.g. "the hairs on the back of her neck stood up"
/\\b(?:hairs?|skin)\\s+(?:on|at)\\s+the\\s+(?:back|nape)\\s+of\\s+%POSS%\\s+neck\\s+(?:stood|rose|prickled|bristled|lifted)\\b/i

#! [jaw-clenched] Jaws clenching and tightening, e.g. "his jaw clenched", "she clenched her jaw"
/\\b(?:%POSS%|\\w+['’]s)\\s+jaw\\s+(?:clenched|tightened|tensed|set|hardened|ticked|flexed)\\b/i
/\\b(?:clenched|clenching|clenches|tightened|set)\\s+%POSS%\\s+jaw\\b/i

#! [voice-held-note] A voice holding a note of something, e.g. "his voice held a note of desperate hope"
/\\b%POSS%\\s+voice\\s+(?:held|carried|had|bore)\\s+(?:a|an)\\s+(?:\\w+\\s+)?(?:note|hint|edge|trace|tinge|thread)\\s+of\\b/i

#! [quick-shallow-breath] Breath coming quick and shallow, e.g. "breath coming quick and shallow"
/\\bbreath(?:ing)?\\s+(?:coming|came|comes)\\s+(?:in\\s+)?(?:quick|short|shallow|ragged|fast|harsh)\\b/i
`;
