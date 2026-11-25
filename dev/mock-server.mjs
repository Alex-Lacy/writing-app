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
  const text = `You said: "${String(typeof last.content === 'string' ? last.content : '').slice(0, 80)}". The prompt had ${j.messages.length} messages. **Bold** and a second paragraph.\n\nThe end.`;
  res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
  const chunks = j.model.includes('reasoner') ? ['<thi', 'nk>Let me think about', ' this carefully.</think>\n\n', ...text.match(/.{1,6}/gs)] : text.match(/.{1,6}/gs);
  for (const c of chunks) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
    await new Promise((r) => setTimeout(r, 15));
  }
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
  res.end('data: [DONE]\n\n');
}).listen(8787, () => console.log('mock on http://localhost:8787/v1'));
