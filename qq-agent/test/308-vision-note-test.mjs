// 308：图档化（vision-note）单元测试 —— 缓存、端点判定、替换语义、失败回退。
// 全部离线：complete 用注入的桩函数，不发起任何网络请求。
import fs from 'node:fs';
import path from 'node:path';
import {
  applyVisionNotes, createNoteCache, defaultNoteCache, isLocalEndpoint, mediaHash, visionEndpoint, writeNote,
} from '../src/kernel/vision-note.js';
import { eq, ok, section, summary, mktmp } from './helpers.mjs';

const IMG = (seed) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,AAA${seed}` } });
const cfgWith = (api, providers = []) => ({ api, providers });

section('端点判定');
ok(isLocalEndpoint('http://127.0.0.1:8080/v1'), '127.0.0.1 视为本地');
ok(isLocalEndpoint('http://localhost:11434/v1'), 'localhost 视为本地');
ok(isLocalEndpoint('http://[::1]:8000/v1'), 'IPv6 回环视为本地');
ok(!isLocalEndpoint('https://api.deepseek.com/v1'), '公网端点不是本地');
ok(!isLocalEndpoint(''), '空端点不是本地');
ok(!isLocalEndpoint('not a url'), '非法 URL 不是本地');

section('视觉端点解析（与 selectPrimaryModelTarget 同口径）');
eq(visionEndpoint(cfgWith({})), '', '没有 visionModel 就没有端点');
eq(visionEndpoint({}), '', '空 cfg 不抛错');
eq(visionEndpoint(cfgWith({ visionModel: 'm', baseUrl: 'http://127.0.0.1:1/v1' })), 'http://127.0.0.1:1/v1', '退回 api.baseUrl');
eq(
  visionEndpoint(cfgWith({ visionModel: 'm', baseUrl: 'http://main/v1', provider: 'p1' }, [{ id: 'p1', baseURL: 'http://prov/v1' }])),
  'http://prov/v1',
  'provider 命中时用它的端点',
);
eq(
  visionEndpoint(cfgWith({ visionModel: 'm', visionProvider: 'v1' }, [{ id: 'v1', baseURL: 'http://127.0.0.1:8080/v1' }])),
  'http://127.0.0.1:8080/v1',
  'visionProvider 优先',
);
eq(visionEndpoint(cfgWith({ visionModel: 'm', visionProvider: 'missing' })), '', 'visionProvider 找不到渠道时不猜端点');

section('指纹');
const h1 = mediaHash(IMG(1)), h2 = mediaHash(IMG(2));
ok(h1.length === 64, 'sha256 十六进制');
ok(h1 === mediaHash(IMG(1)), '同图同 hash');
ok(h1 !== h2, '不同图不同 hash');
eq(mediaHash({ type: 'text', text: 'hi' }), '', '非图片 part 无 hash');
eq(mediaHash(null), '', 'null 不抛错');
eq(mediaHash({ type: 'image_url', image_url: { url: 'https://cdn/x.png' } }), mediaHash({ type: 'image_url', image_url: { url: 'https://cdn/x.png' } }), '远程 URL 也按字符串取指纹');
ok(mediaHash({ type: 'image_url', image_url: { url: 'https://cdn/x.png' } }) !== mediaHash(IMG(1)), '远程与 data URL 不冲突');

section('缓存落盘与淘汰');
const dir = mktmp('qqa-note-');
const file = path.join(dir, 'vision-notes.json');
const cache = createNoteCache({ file, limit: 3, log: { warn() {} } });
eq(cache.get(h1), '', '空缓存取不到');
cache.set(h1, '主体：猫', 'm');
eq(cache.get(h1), '主体：猫', '写入后可读');
ok(fs.existsSync(file), '缓存文件已落盘');
const reloaded = createNoteCache({ file, limit: 3, log: { warn() {} } });
eq(reloaded.get(h1), '主体：猫', '重新加载后仍在');
for (let i = 0; i < 5; i++) cache.set(`hash-${i}`, `note-${i}`);
ok(cache.size <= 4, `上限生效（实际 ${cache.size}）`);
eq(cache.get(h1), '', '最早写入的被淘汰');
eq(cache.get('hash-4'), 'note-4', '最新写入保留');
const broken = createNoteCache({ file: path.join(dir, 'missing', 'deep', 'x.json'), log: { warn() {} } });
broken.set('k', 'v');
eq(broken.get('k'), 'v', '目录不存在时自动创建');
const corrupt = path.join(dir, 'corrupt.json');
fs.writeFileSync(corrupt, '{not json');
const corruptCache = createNoteCache({ file: corrupt, log: { warn() {} } });
eq(corruptCache.get('any'), '', '损坏文件按空缓存处理');
ok(defaultNoteCache().get !== undefined, '默认缓存可用');

section('applyVisionNotes：惰性');
{
  let calls = 0;
  const complete = async () => { calls++; return { message: { content: 'x' } }; };
  const parts = [IMG(1)];
  const out = await applyVisionNotes({ parts, cfg: cfgWith({}), complete, log: { warn() {} } });
  ok(out.parts[0] === parts[0], '没有 visionModel 时原样返回同一个 part');
  eq(out.replaced, 0, '未替换');
  eq(calls, 0, '不调用视觉模型');
  eq((await applyVisionNotes({ parts: [], cfg: cfgWith({ visionModel: 'm', baseUrl: 'http://127.0.0.1:1/v1' }), complete })).parts.length, 0, '空列表安全');
  eq((await applyVisionNotes({ parts: null, cfg: cfgWith({ visionModel: 'm', baseUrl: 'http://127.0.0.1:1/v1' }), complete })).parts.length, 0, 'null 安全');
}

section('applyVisionNotes：本地端点未命中 → 生成并替换');
{
  const seen = new Set();
  const prompts = [];
  const complete = async (payload) => {
    prompts.push(payload);
    return { message: { content: '```\n主体：一只橘猫\n画面：趴在窗台\n文字：无\n细节：胡须清晰\n```' } };
  };
  const notes = createNoteCache({ file: path.join(mktmp('qqa-note2-'), 'n.json'), log: { warn() {} } });
  const cfg = cfgWith({ visionModel: 'minicpm-v', baseUrl: 'http://127.0.0.1:8080/v1' });
  const out = await applyVisionNotes({ parts: [IMG(1)], cfg, complete, cache: notes, log: { warn() {} }, seen });
  eq(prompts.length, 1, '只调用一次视觉模型');
  eq(prompts[0].messages.length, 1, '只发一条最小消息，不带历史/人设');
  eq(prompts[0].messages[0].content.length, 2, '短提示词 + 一张图');
  ok(!('tools' in prompts[0]) || prompts[0].tools == null, '不带工具定义');
  eq(out.replaced, 1, '替换 1 张');
  eq(out.parts[0].type, 'text', '图像 part 变成文本 part');
  ok(out.parts[0].text.includes('主体：一只橘猫'), '图档内容进入文本');
  ok(!out.parts[0].text.includes('```'), '围栏被清掉');
  eq(notes.get(mediaHash(IMG(1))), '主体：一只橘猫\n画面：趴在窗台\n文字：无\n细节：胡须清晰', '图档进缓存');
  ok(seen.has(mediaHash(IMG(1))), '记入本次运行的 seen');
}

section('applyVisionNotes：缓存命中不再调用');
{
  let calls = 0;
  const complete = async () => { calls++; return { message: { content: '新图档' } }; };
  const notes = createNoteCache({ file: path.join(mktmp('qqa-note3-'), 'n.json'), log: { warn() {} } });
  notes.set(mediaHash(IMG(9)), '旧图档');
  const out = await applyVisionNotes({ parts: [IMG(9)], cfg: cfgWith({ visionModel: 'm', baseUrl: 'http://127.0.0.1:8080/v1' }), complete, cache: notes, log: { warn() {} } });
  eq(calls, 0, '命中缓存不调用模型');
  eq(out.replaced, 1, '仍然替换成图档');
  ok(out.parts[0].text.includes('旧图档'), '用缓存里的图档');
}

section('applyVisionNotes：云端端点只在命中时替换');
{
  let calls = 0;
  const complete = async () => { calls++; return { message: { content: 'x' } }; };
  const notes = createNoteCache({ file: path.join(mktmp('qqa-note4-'), 'n.json'), log: { warn() {} } });
  const cfg = cfgWith({ visionModel: 'qwen-vl', baseUrl: 'https://api.example.com/v1' });
  const miss = await applyVisionNotes({ parts: [IMG(3)], cfg, complete, cache: notes, log: { warn() {} } });
  eq(miss.replaced, 0, '云端未命中不改写');
  eq(miss.parts[0].type, 'image_url', '原图照发');
  eq(calls, 0, '云端未命中不额外调用（不额外花钱）');
  notes.set(mediaHash(IMG(3)), '云端旧图档');
  const hit = await applyVisionNotes({ parts: [IMG(3)], cfg, complete, cache: notes, log: { warn() {} } });
  eq(hit.replaced, 1, '云端命中才替换');
  eq(calls, 0, '命中同样不调用');
}

section('applyVisionNotes：seen 命中发原图（细节逃生口）');
{
  let calls = 0;
  const complete = async () => { calls++; return { message: { content: 'n' } }; };
  const notes = createNoteCache({ file: path.join(mktmp('qqa-note5-'), 'n.json'), log: { warn() {} } });
  notes.set(mediaHash(IMG(4)), '已缓存图档');
  const seen = new Set([mediaHash(IMG(4))]);
  const out = await applyVisionNotes({ parts: [IMG(4)], cfg: cfgWith({ visionModel: 'm', baseUrl: 'http://127.0.0.1:8080/v1' }), complete, cache: notes, log: { warn() {} }, seen });
  eq(out.replaced, 0, '第二次看同一张图不替换');
  eq(out.parts[0].type, 'image_url', '发原图');
  eq(calls, 0, '也不再调用');
}

section('applyVisionNotes：失败回退与混合 parts');
{
  const boom = async () => { throw new Error('endpoint down'); };
  const notes = createNoteCache({ file: path.join(mktmp('qqa-note6-'), 'n.json'), log: { warn() {} } });
  const parts = [{ type: 'text', text: '普通文本' }, IMG(5)];
  const out = await applyVisionNotes({ parts, cfg: cfgWith({ visionModel: 'm', baseUrl: 'http://localhost:9/v1' }), complete: boom, cache: notes, log: { warn() {} } });
  eq(out.parts.length, 2, 'part 数量不变');
  eq(out.parts[0].type, 'text', '非图片原样保留');
  eq(out.parts[1].type, 'image_url', '生成失败回退原图');
  eq(out.replaced, 0, '失败不算替换');
  eq(out.total, 1, '统计只算图片');

  const empty = async () => ({ message: { content: '   ' } });
  const out2 = await applyVisionNotes({ parts: [IMG(6)], cfg: cfgWith({ visionModel: 'm', baseUrl: 'http://localhost:9/v1' }), complete: empty, cache: notes, log: { warn() {} } });
  eq(out2.replaced, 0, '空图档不替换');
}

section('applyVisionNotes：单轮图片张数上限');
{
  let calls = 0;
  const complete = async () => { calls++; return { message: { content: `n${calls}` } }; };
  const notes = createNoteCache({ file: path.join(mktmp('qqa-note7-'), 'n.json'), log: { warn() {} } });
  const out = await applyVisionNotes({
    parts: [IMG(11), IMG(12), IMG(13)], maxImages: 2,
    cfg: cfgWith({ visionModel: 'm', baseUrl: 'http://127.0.0.1:8080/v1' }), complete, cache: notes, log: { warn() {} },
  });
  eq(calls, 2, '超上限的图不再调用');
  eq(out.replaced, 2, '只替换前两张');
  eq(out.parts[2].type, 'image_url', '第三张保持原图');
}

section('writeNote：异常与超时');
{
  eq(await writeNote({ part: IMG(7), cfg: {}, complete: null, log: { warn() {} } }), '', '没有 complete 返回空串');
  eq(await writeNote({ part: IMG(7), cfg: {}, complete: async () => ({ message: { content: 'ok' } }), log: { warn() {} } }), 'ok', '正常返回图档');
  eq(await writeNote({ part: IMG(7), cfg: {}, complete: async () => { throw new Error('x'); }, log: { warn() {} } }), '', '抛错返回空串');
  const arrayContent = async () => ({ message: { content: [{ type: 'text', text: '主体：猫' }, { type: 'text', text: '画面：窗台' }] } });
  eq(await writeNote({ part: IMG(7), cfg: {}, complete: arrayContent, log: { warn() {} } }), '主体：猫\n画面：窗台', '数组 content 也能拼');
  const tooLong = async () => ({ message: { content: 'a'.repeat(4000) } });
  const cut = await writeNote({ part: IMG(7), cfg: {}, complete: tooLong, log: { warn() {} } });
  ok(cut.length <= 1201, '超长图档被截断');
}

const survived = await applyVisionNotes({
  parts: [IMG(1)],
  cfg: cfgWith({ visionModel: 'm', baseUrl: 'http://127.0.0.1:1/v1' }),
  complete: async () => { throw new Error('x'); },
  log: { warn() {} },
}).then((r) => r.replaced === 0 && r.parts[0].type === 'image_url', () => false);
ok(survived, '内部异常不向外抛，回退原图');

section('止血开关');
{
  const previous = process.env.QQ_AGENT_VISION_NOTE;
  process.env.QQ_AGENT_VISION_NOTE = 'off';
  let calls = 0;
  const notes = createNoteCache({ file: path.join(mktmp('qqa-note8-'), 'n.json'), log: { warn() {} } });
  const out = await applyVisionNotes({
    parts: [IMG(21)], cfg: cfgWith({ visionModel: 'm', baseUrl: 'http://127.0.0.1:8080/v1' }),
    complete: async () => { calls++; return { message: { content: 'n' } }; }, cache: notes, log: { warn() {} },
  });
  eq(out.replaced, 0, '开关关闭时不替换');
  eq(calls, 0, '开关关闭时不调用视觉模型');
  ok(out.parts[0].type === 'image_url', '开关关闭时发原图');
  if (previous === undefined) delete process.env.QQ_AGENT_VISION_NOTE;
  else process.env.QQ_AGENT_VISION_NOTE = previous;
}

section('端到端：agent-runner 补发媒体时走图档');
{
  const { runAgent } = await import('../src/kernel/agent-runner.js');
  const image = IMG(31);
  // 注意：runner 复用同一个 messages 数组，必须在调用发生时快照，事后读会被后续轮次改写。
  const snapshots = [];
  const response = (toolCalls = []) => ({
    message: { role: 'assistant', content: '好', ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  const callLLM = async (payload) => {
    const text = JSON.stringify(payload.messages);
    snapshots.push({
      n: payload.messages.length,
      isNote: payload.messages.length === 1,
      hasImage: text.includes('image_url'),
      hasTools: payload.tools != null,
      text,
    });
    // 只有一条消息的那次是图档调用（没有历史/人设/工具）
    if (payload.messages.length === 1) return { message: { role: 'assistant', content: '主体：一只猫\n画面：窗台\n文字：无\n细节：胡须清楚' } };
    return snapshots.filter((s) => !s.isNote).length === 1
      ? response([{ id: 'c1', type: 'function', function: { name: 'peek', arguments: '{}' } }])
      : response();
  };
  const noteCacheFile = path.join(mktmp('qqa-note9-'), 'vision-notes.json');
  const dataDir = path.dirname(noteCacheFile);
  const previousDataDir = process.env.QQ_AGENT_DATA_DIR;
  process.env.QQ_AGENT_DATA_DIR = dataDir;
  try {
    const result = await runAgent({
      session: { usage: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }, sent: [] },
      systemPrompt: 'fixture', userPrompt: 'fixture', tools: [],
      cfg: { api: { maxRounds: 2, visionModel: 'vm', baseUrl: 'http://127.0.0.1:1234/v1' }, providers: [] },
      log: {}, callLLM,
      invokeTool: async () => ({ ok: true, result: '图在这里', mediaParts: [image] }),
    });
    eq(snapshots.length, 3, '跑了两轮 + 一次图档调用');
    const noteCalls = snapshots.filter((s) => s.isNote);
    eq(noteCalls.length, 1, '只有一次图档调用');
    eq(noteCalls[0].hasImage, true, '图档调用确实带图');
    eq(noteCalls[0].hasTools, false, '图档调用不带工具定义');
    const chatCalls = snapshots.filter((s) => !s.isNote);
    eq(chatCalls.length, 2, '主循环两轮');
    eq(chatCalls[0].hasImage, false, '第一轮还没有图');
    eq(chatCalls[1].text.includes('"image_url"'), false, '第二轮请求里已没有图片 part');
    ok(chatCalls[1].text.includes('主体：一只猫'), '主模型看到的是文字图档');
    // 末尾还会追加"剩余轮次提醒"的 user 消息，所以要按内容找图档消息。
    const userNotes = result.messages.filter((m) => m.role === 'user' && JSON.stringify(m.content).includes('[图片图档]'));
    eq(userNotes.length, 1, '落盘消息里是图档而不是图片');
    ok(fs.existsSync(noteCacheFile), '图档写入了数据目录的缓存文件');
    eq(JSON.parse(fs.readFileSync(noteCacheFile, 'utf8')).notes[mediaHash(image)].note.includes('一只猫'), true, '缓存键是图片指纹');
  } finally {
    if (previousDataDir === undefined) delete process.env.QQ_AGENT_DATA_DIR;
    else process.env.QQ_AGENT_DATA_DIR = previousDataDir;
  }
}

section('端到端：无 visionModel 时 runner 行为不变');
{
  const { runAgent } = await import('../src/kernel/agent-runner.js');
  const image = IMG(41);
  const requests = [];
  const response = (toolCalls = []) => ({
    message: { role: 'assistant', content: '好', ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  const callLLM = async (payload) => {
    requests.push(payload);
    return requests.length === 1
      ? response([{ id: 'c1', type: 'function', function: { name: 'peek', arguments: '{}' } }])
      : response();
  };
  const result = await runAgent({
    session: { usage: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }, sent: [] },
    systemPrompt: 'fixture', userPrompt: 'fixture', tools: [],
    cfg: { api: { maxRounds: 2, visionModel: '', baseUrl: 'http://127.0.0.1:1234/v1' }, providers: [] },
    log: {}, callLLM,
    invokeTool: async () => ({ ok: true, result: '图在这里', mediaParts: [image] }),
  });
  eq(requests.length, 2, '没有额外调用');
  ok(JSON.stringify(requests[1].messages).includes('image_url'), '原图仍照发');
  ok(JSON.stringify(requests[1].messages).includes('请直接'), '系统提示语保持原样');
  ok(result.messages.some((m) => m.role === 'user' && Array.isArray(m.content)), '落盘消息仍是媒体消息');
}

summary('308-vision-note');
