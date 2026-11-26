// Minimal OpenAI-compatible mock for local testing: node dev/mock-server.mjs  (port 8787)
// Streams a reply with a <think> block, and echoes the last message + context size.
import http from 'node:http';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
let lastBody = null;
const ntfy = {};
const listeners = [];
const pipes = {};
http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  // A tiny ntfy stand-in for sync pairing tests: POST /ntfy/<topic>, GET /ntfy/<topic>/sse.
  if (req.url.startsWith('/ntfy/')) {
    const [path] = req.url.split('?');
    const topic = path.split('/')[2];
    const list = (ntfy[topic] ??= []);
    if (req.method === 'POST') {
      let body = '';
      for await (const c of req) body += c;
      const m = { id: Math.random().toString(36).slice(2), time: Date.now() / 1000, event: 'message', topic, message: body };
      list.push(m);
      for (const l of listeners.filter((x) => x.topic === topic)) l.res.write(`data: ${JSON.stringify(m)}\n\n`);
      return res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(m));
    }
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(`data: ${JSON.stringify({ event: 'open', topic })}\n\n`);
    for (const m of list) res.write(`data: ${JSON.stringify(m)}\n\n`);
    const l = { topic, res };
    listeners.push(l);
    req.on('close', () => listeners.splice(listeners.indexOf(l), 1));
    return;
  }
  // Piping-server stand-in: a POST body goes to whoever GETs the same path (either may come first).
  if (req.url.startsWith('/pipe/')) {
    if (process.env.PIPELOG) console.log(req.method, req.url);
    const path = req.url.split('?')[0];
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    const w = (pipes[path] ??= {});
    if (req.method === 'POST') {
      let body = '';
      for await (const c of req) body += c;
      const deliver = (r) => { r.writeHead(200, cors).end(body); res.writeHead(200, cors).end('sent'); delete pipes[path]; };
      if (w.get) return deliver(w.get);
      w.post = deliver;
      return;
    }
    if (w.post) return w.post(res);
    w.get = res;
    return;
  }
  if (req.url.endsWith('/last')) return res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(lastBody, null, 2));
  if (req.url.split('?')[0].endsWith('/models'))
    return res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify({ data: [
      { id: 'mock/story-writer-12b', context_length: 16384, model_class: 'mistral-nemo' },
      { id: 'mock/reasoner-32b', context_length: 32768, model_class: 'qwen2' },
    ] }));
  let body = '';
  for await (const c of req) body += c;
  const j = JSON.parse(body);
  lastBody = j;
  const last = j.messages.at(-1);
  const sys = String(j.messages[0]?.content ?? '');
  // SLOWHELP in the last message streams slowly, to test closing the panel mid-reply.
  const slow = String(last.content).includes('SLOWHELP');
  const reply = async (text) => {
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
    for (const c of text.match(/[\s\S]{1,20}/g)) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
      await new Promise((r) => setTimeout(r, slow ? 120 : 5));
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: Math.round(body.length / 3.6), completion_tokens: 50 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  };
  // Side jobs, recognised by their system prompts.
  if (sys.includes('# Looking things up') && JSON.stringify(j.messages.slice(1)).includes('Yennefer')) {
    if (String(last.content).startsWith('# Lookup results')) return reply('From the wiki, Yennefer is a sorceress from Vengerberg.\n```changes\n[{"type":"codex-add","name":"Yennefer","keys":["Yennefer"],"text":"A sorceress from Vengerberg."}]\n```');
    return reply('Checking the wiki.\n```lookup\n[{"tool":"search","wiki":"witcher","query":"Yennefer"},{"tool":"read","wiki":"witcher","page":"Yennefer of Vengerberg"}]\n```');
  }
  if (sys.includes('You build Codex entries')) {
    const part = String(last.content);
    const known = { Mara: ['character', 'A detective with a scar.'], Rell: ['character', 'A smuggler who owes Mara money.'], Harrowgate: ['place', 'A rain-soaked port city.'] };
    return reply(JSON.stringify(Object.entries(known).filter(([n]) => part.split('# Part')[1]?.includes(n)).map(([name, [category, text]]) => ({ name, category, keys: [name], text }))));
  }
  if (sys.includes('You plan the scenes of one chapter')) {
    const pins = [...String(last.content).split('# Must-have moments in it')[1].matchAll(/^- (.+)$/gm)].map((m) => m[1]);
    return reply(JSON.stringify(['An opening scene.', ...pins.map((p) => p.replace('her', 'Mara')), 'A closing scene.']));
  }
  if (sys.includes("You track a story's progress against its outline")) return reply(JSON.stringify({ reached: /BEATDONE|scene goal/.test(String(last.content)), reason: 'the offer was made' }));
  if (sys.includes('You tidy Codex entries')) {
    const first = String(last.content).match(/^## (.+)$/m)?.[1];
    return reply(first ? JSON.stringify([{ type: 'codex-edit', entry: first, text: `${first}, tidied.`, keys: [first], reason: 'removed leftover brackets' }]) : '[]');
  }
  if (sys.includes('maintain the notes for a piece of fiction'))
    return reply(JSON.stringify({ suggestions: [{ type: 'codex-add', name: 'Captain Rell', keys: ['Rell', 'captain'], text: 'Harbour captain; owes Mara a favour.', reason: 'New recurring character.' }] }));
  if (sys.includes('You write recaps of a story'))
    return reply('Mara arrived at the harbour and met Captain Rell, who agreed to help her find the ship.');
  if (sys.includes('```changes'))
    return reply('Here is a setup for your story.\n\n```changes\n[{"type":"title","text":"Harbour Lights"},{"type":"background","text":"Mara Voss, a detective, hunts a smuggler in a rain-soaked port city."},{"type":"steering","text":"[Tone: noir, tense. Third person, past tense.]"},{"type":"codex-add","name":"Captain Rell","keys":["Rell"],"text":"Harbour captain."},{"type":"length","value":"scene"},{"type":"tags","tags":["noir","tense","mystery"]}]\n```');
  if (sys.includes('You condense writing-style instructions')) return reply('Short version.');
  if (sys.includes('remove stock phrases')) return reply('{"fixes":[{"n":1,"text":"Cold went through her."}]}');
  if (sys.includes('You proofread a passage')) {
    const q = String(last.content).match(/# PASSAGE TO CHECK\n([\s\S]*?)\n\n# Story after/)?.[1] ?? '';
    const w = q.match(/\b[A-Z][a-z]+\b/)?.[0];
    return reply(JSON.stringify({ issues: w ? [{ quote: w, problem: 'Name differs from the notes.', fix: w.toUpperCase() }] : [] }));
  }
  // SLOWREWRITE in the instruction streams a rewrite slowly, to test stopping it.
  if (sys.includes('revising one') && String(last.content).includes('SLOWREWRITE')) {
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
    for (let i = 0; i < 100 && !res.destroyed; i++) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `slow ${i} ` } }] })}\n\n`);
      await new Promise((r) => setTimeout(r, 100));
    }
    return res.end('data: [DONE]\n\n');
  }
  if (sys.includes('retcon note')) {
    const edits = [];
    for (const [, n, body] of String(last.content).matchAll(/## Message (\d+)\n([\s\S]*?)(?=\n\n## Message|$)/g)) {
      const sentence = body.split(/(?<=[.!?"])\s+/).find((x) => x.includes('Sanctuary'));
      if (sentence) edits.push({ m: Number(n), quote: sentence, text: sentence.replace('Sanctuary', 'Pristella') });
    }
    return reply(JSON.stringify({ edits, background: 'Subaru came back from Pristella.' }));
  }
  if (sys.includes('revising one passage')) return reply('A cleaner passage.');
  if (sys.includes('revising one message')) return reply('The whole message, rewritten as asked.');
  if (j.continue_final_message) {
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: ' and then it continued.' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
    return res.end('data: [DONE]\n\n');
  }
  if (String(last.content).includes('RAMBLE')) {
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'thinking '.repeat(400) } }] })}\n\n`);
    for (let i = 0; i < 120; i++) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `Sentence number ${i} has some words in it. ` } }] })}\n\n`);
      await new Promise((r) => setTimeout(r, 3));
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
    return res.end('data: [DONE]\n\n');
  }
  if (String(last.content).includes('LONG')) {
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'A story that was cut' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}\n\n`);
    return res.end('data: [DONE]\n\n');
  }
  if (process.env.STORY_FILE && String(last.content).includes('LIVESTORY')) return reply((await import('node:fs')).readFileSync(process.env.STORY_FILE, 'utf8'));
  const text = `You said: "${String(typeof last.content === 'string' ? last.content : '').slice(0, 80)}". The prompt had ${j.messages.length} messages. **Bold** and a second paragraph.\n\n${String(last.content).includes('SLOP') ? 'A shiver ran down her spine. ' : ''}The end.`;
  res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
  // LONECLOSE: the template opened the think block, so only the closing tag is streamed.
  const chunks = j.model.includes('reasoner') && JSON.stringify(last).includes('LONECLOSE') ? ['Let me think about', ' this carefully.</th', 'ink>\n\n', ...text.match(/.{1,6}/gs)]
    : j.model.includes('reasoner') ? ['<thi', 'nk>Let me think about', ' this carefully.</think>\n\n', ...text.match(/.{1,6}/gs)] : text.match(/.{1,6}/gs);
  for (const c of chunks) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
    await new Promise((r) => setTimeout(r, 15));
  }
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
  res.end('data: [DONE]\n\n');
}).listen(8787, () => console.log('mock on http://localhost:8787/v1'));
