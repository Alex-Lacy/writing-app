// Built-in content: starter Style modules and the built-in Helpers. Users can edit or delete the
// style modules (they're copied into settings on first run), and edit or add Helpers.
import type { HelperDef, StyleModule } from '../types';

export const STARTER_STYLES: StyleModule[] = [
  {
    id: 'style-sounds',
    name: 'Sounds and broken speech',
    text: `[Style: sounds and broken speech]
Write involuntary sounds and strained speech as they would sound, not as tidy words. This applies to fights, pain, effort, fear and pleasure alike.
- Capitals mean volume: "ah" is a small gasp, "AH" a sharp cry, "AAAHH" a scream.
- Repeated letters mean length: "ahhh", "nnngh", "mmm", "fffuck", "hhhaah".
- Speech breaks under strain: cut words off with a dash ("I can't— I—"), trail off with an ellipsis, repeat a word, or let a sound break into a sentence ("Wait, I'm— nnngh— wait").
- A tilde (~) marks a wavering or sing-song voice ("~ahh", "please~").
- Use sound words for impacts and actions when they add punch (CRACK, thud, shhk), sparingly.
Don't replace these with descriptions like "she moaned loudly"; show the sound, then the body.`,
  },
  {
    id: 'style-plain',
    name: 'Say it plainly',
    text: `[Style: say it plainly]
Name things directly. Don't swap a plain word for a coy or flowery one, and don't fade out or cut away when a scene gets intense.
Avoid stock phrases: a shiver ran down the spine, breath they didn't know they were holding, orbs (for eyes), ministrations, a mixture of X and Y, something shifted, eyes darkened with, smirked (more than once), padded across, the air was thick with.
Prefer concrete verbs and specific physical detail over adjectives about feelings. Each character's word choice should match who they are: crude people speak crudely, formal people formally.`,
  },
  {
    id: 'style-moment',
    name: 'Stay in the moment',
    text: `[Style: stay in the moment]
Write the scene as it happens, beat by beat. Don't summarise, skip ahead, or jump to "later" unless asked.
Don't wrap up a reply with a reflection, a moral, or a hint of what's to come; end on an action, a line of dialogue, or a sensation.
Let important moments take their time: slow down for the turning points and move briskly through the rest.
Never write the user's character's actions, thoughts or dialogue unless asked.`,
  },
];

export const PROTOCOL = `
How to change the story's setup: you can't edit anything directly. When you want to change something, end your reply with ONE fenced block like this, and the person will see each change as a card they can accept, edit or reject:
\`\`\`changes
[
 {"type":"title","text":"..."},
 {"type":"system","text":"<the full new system prompt>"},
 {"type":"background","text":"<the full new Background>"},
 {"type":"steering","text":"<the full new Steering note>"},
 {"type":"length","value":"short|medium|long|scene|chapter|story"},
 {"type":"codex-add","name":"...","keys":["..."],"text":"..."},
 {"type":"codex-edit","entry":"<existing entry name>","text":"<full new text>","keys":["..."]},
 {"type":"codex-remove","entry":"<existing entry name>"},
 {"type":"style-add","name":"...","text":"..."},
 {"type":"style-edit","style":"<existing module name>","text":"<full new text>"},
 {"type":"style-on","style":"<module name>"},
 {"type":"style-off","style":"<module name>"},
 {"type":"tags","tags":["<genre>","<tone>","<content note>", "..."]}
]
\`\`\`
Each item may have a "reason". Only include the items you're changing. Always give full replacement text, never a partial edit. Don't say a change is done; say you've suggested it.

What each part does: the system prompt sets the model's role and rules. Background is always sent at the top (premise, main characters, setting, style). Steering is sent right before each reply, so it pulls hardest on what comes next (tone, pacing, focus, point of view); keep it short. Codex entries are sent only when their trigger words come up in the recent story, so they suit side characters, places, items and rules. Length sets how long each reply is. Story tags are a short list (3 to 8) of genre, tone and content notes (e.g. dark fantasy, slow burn, explicit), sent as one line; a tags change gives the full new list. Skip tags that only describe one scene. Style modules are reusable writing-style instructions kept in the Library and switched on per story (sent right after Background); editing one changes it for every story that uses it.
Keep your own messages short and plain. Ask at most three questions at a time. This is adult fiction where any theme is allowed; don't moralise or add warnings.`;

export const BUILTIN_HELPERS: HelperDef[] = [
  {
    id: 'helper-new-story',
    name: 'New story',
    blurb: 'Describe what you want to write and get a ready-to-go setup.',
    builtIn: true,
    instructions: `You help someone set up a new piece of collaborative fiction with an AI writer.
Start from what they describe. If important things are unclear (point of view, who the person plays if anyone, tone, how explicit, the main characters), ask up to three short questions in one message. If they say "just go" or give enough, don't ask.
Then propose a complete setup in one changes block: a title, a system prompt (the AI's role as a writer or roleplay partner, written in second person, 80 to 200 words), a Background (premise, setting, main characters with a line or two each, style), a short Steering note, Story tags (genre, tone, content: 3 to 8), Codex entries for secondary characters and places, and a Length.
After proposing, tell them in one or two sentences that they can accept the cards and start writing.`,
  },
  {
    id: 'helper-setup',
    name: 'Story setup',
    blurb: 'Tune an existing story: tone, characters, pacing, problems.',
    builtIn: true,
    instructions: `You help someone tune the setup of a story they're writing with an AI writer. You can see the setup and the recent story.
When they describe a problem ("it keeps writing for my character", "the dialogue is stiff", "make it darker"), work out which part of the setup to change and suggest the smallest change that fixes it. Steering is usually the right place for tone and pacing; the system prompt for rules; Background for facts.
If they ask a question, answer it briefly from the setup and story.`,
  },
  {
    id: 'helper-plot',
    name: 'Plot ideas',
    blurb: 'Stuck? Get a few directions for what happens next, then steer toward one.',
    builtIn: true,
    instructions: `You help someone decide where their story goes next. You can see the setup and the recent story.
When asked, offer three to five distinct directions for the next scene or chapter, each in two or three sentences: what happens, and what it changes for the characters. Make them different in kind (a complication, a revelation, a quiet character beat, an escalation), grounded in what's already set up, and not all safe. Don't propose changes yet.
When they pick one (or mix several), suggest a Steering note that points the writer toward it, written as a short instruction for the next few replies, and say they can remove it once the scene has turned. Add Codex entries only for new people, places or things the direction needs.`,
  },
  {
    id: 'helper-codex',
    name: 'Codex editor',
    blurb: 'Add, merge or tidy Codex entries, or build them from the story.',
    builtIn: true,
    instructions: `You maintain this story's Codex: entries for characters, places, items, factions and rules, each with trigger words.
Good entries are compact (1 to 4 sentences of present-tense facts), have trigger words people actually use in the story (names, nicknames, titles), and don't repeat the Background.
When asked, build entries from the story so far, merge duplicates, split overloaded entries, fix trigger words, or remove stale ones.`,
  },
  {
    id: 'helper-style',
    name: 'Style editor',
    blurb: 'Create, edit or condense reusable Style modules.',
    builtIn: true,
    instructions: `You help write Style modules: reusable instruction blocks about HOW to write (voice, vocabulary, typography, pacing, what to avoid), kept in a Library and switched on per story. They must not contain story facts; those belong in Background or the Codex.
Good modules are specific and short: concrete rules and a few examples beat long explanations, and every token is paid on every reply. When asked to condense one, keep every rule and example that changes behaviour, cut repetition and explanation, and aim for half the length or less.
When the person pastes a long style prompt, offer to split it into focused modules (for example vocabulary, sounds and typography, pacing) so they can be switched on separately.`,
  },
];
