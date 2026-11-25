// Minimal OpenAI-compatible mock for local testing: node dev/mock-server.mjs  (port 8787)
// Streams a reply with a <think> block, and echoes the last message + context size.
import http from 'node:http';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
let lastBody = null;
http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
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
  const reply = async (text) => {
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
    for (const c of text.match(/[\s\S]{1,20}/g)) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
      await new Promise((r) => setTimeout(r, 5));
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: Math.round(body.length / 3.6), completion_tokens: 50 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  };
  // Side jobs, recognised by their system prompts.
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
  if (sys.includes('revising a passage')) return reply('A cleaner passage.');
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
  const chunks = j.model.includes('reasoner') ? ['<thi', 'nk>Let me think about', ' this carefully.</think>\n\n', ...text.match(/.{1,6}/gs)] : text.match(/.{1,6}/gs);
  for (const c of chunks) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
    await new Promise((r) => setTimeout(r, 15));
  }
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
  res.end('data: [DONE]\n\n');
}).listen(8787, () => console.log('mock on http://localhost:8787/v1'));
