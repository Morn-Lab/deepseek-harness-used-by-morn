// vision-note：把"看图"的结果沉淀成一次性文字图档（image → note）。
// 目的：主模型（通常是纯文本模型）不接收图片 token，历史里只留文字；
//       看图模型只做一次"单图 + 短提示词"的最小调用，不携带整轮上下文。
// 语义（与 agent-runner L350 的媒体补发配合）：
//   1. 视觉端点为空 → 完全惰性，原样返回（现有行为不变）。
//   2. 视觉端点属本地（127.0.0.1/localhost/::1/...）→ 未命中就本地生成图档（0 成本），替换图像 part。
//   3. 视觉端点属云端 → 只有命中缓存才替换（不额外花钱），未命中保持原图，走今天的老路径。
//   4. 同一 run 内第二次看同一张图（同 hash）→ 发原图（细节逃生口，见 seen）。
//   5. 任何异常 → 回退原图，不阻断主流程。
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT, resolveDataDir } from './env.js';

export const NOTE_PROMPT = [
  '你是图像标注器，只输出四行标签文本，不要编号，不要解释：',
  '主体=',
  '画面=',
  '文字=',
  '细节=',
].join('\n');

const NOTE_LIMIT = 1200;     // 图档字符上限（提示词要求 4 行，留出富余）
const NOTE_MAX_TOKENS = 220; // 单图档输出上限：2B 模型实测 4 行约 30–60 token，留足又不给跑飞的空间
const NOTE_TIMEOUT_MS = 25000;
const CACHE_LIMIT = 400;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0', 'host.docker.internal']);

function hostOf(endpoint) {
  try { return new URL(endpoint).hostname.toLowerCase(); } catch { return ''; }
}

/** 端点是否指向本机（本地推理服务不花钱）。 */
export function isLocalEndpoint(endpoint) {
  const host = hostOf(endpoint);
  return Boolean(host) && LOCAL_HOSTS.has(host);
}

/**
 * 解析视觉专用模型的端点：没有 visionModel 就没必要看图档。
 * 与 llm.selectPrimaryModelTarget 的取址口径保持一致（visionProvider → provider → baseUrl）。
 */
export function visionEndpoint(cfg) {
  const api = cfg?.api ?? {};
  if (!String(api.visionModel ?? '').trim()) return '';
  const providers = Array.isArray(cfg?.providers) ? cfg.providers : [];
  const endpointOf = (id) => {
    const hit = providers.filter((p) => p?.id === id);
    if (hit.length !== 1) return '';
    return String(hit[0]?.baseURL ?? hit[0]?.baseUrl ?? '').trim();
  };
  if (api.visionProvider) return endpointOf(api.visionProvider);
  if (api.provider) return endpointOf(api.provider) || String(api.baseUrl ?? '').trim();
  return String(api.baseUrl ?? '').trim();
}

/** 图像 part 的内容指纹；非图片 part 返回 ''。 */
export function mediaHash(part) {
  if (!part || typeof part !== 'object') return '';
  const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
  if (typeof url !== 'string' || !url) return '';
  return createHash('sha256').update(url).digest('hex');
}

/** 图档缓存：单个 JSON 文件 + 原子写 + 上限淘汰（按写入顺序，先进先出）。 */
export function createNoteCache({ file, limit = CACHE_LIMIT, log = console } = {}) {
  let notes = Object.create(null);
  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && typeof raw.notes === 'object' && raw.notes) notes = raw.notes;
    } catch { notes = Object.create(null); }
  };
  const save = () => {
    try {
      const keys = Object.keys(notes);
      if (keys.length > limit) {
        for (const key of keys.slice(0, keys.length - limit)) delete notes[key];
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, notes }), 'utf8');
      fs.renameSync(tmp, file);
    } catch (err) { log?.warn?.(`[vision-note] 图档缓存写入失败：${err?.message ?? err}`); }
  };
  return {
    get(hash) {
      load();
      const hit = notes[hash];
      return typeof hit?.note === 'string' && hit.note ? hit.note : '';
    },
    set(hash, note, model = '') {
      load();
      notes[hash] = { note, model, at: Date.now() };
      save();
    },
    get size() { load(); return Object.keys(notes).length; },
  };
}

// 默认缓存：落在当前数据目录（QQ_AGENT_DATA_DIR > <appRoot>/data<n>），按目录路径复用。
let defaultCache = null;
let defaultCacheKey = '';
export function defaultNoteCache(log = console) {
  const dataDir = resolveDataDir(process.env, APP_ROOT);
  if (!defaultCache || defaultCacheKey !== dataDir) {
    defaultCacheKey = dataDir;
    defaultCache = createNoteCache({ file: path.join(dataDir, 'vision-notes.json'), log });
  }
  return defaultCache;
}

function textOf(res) {
  const content = res?.message?.content ?? res?.content ?? '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((x) => (typeof x === 'string' ? x : x?.text ?? '')).join('\n');
  }
  return '';
}

function tidy(raw) {
  let text = String(raw ?? '').replace(/^```[a-z]*\s*/i, '').replace(/```$/,'').trim();
  text = text.split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
  if (text.length > NOTE_LIMIT) text = `${text.slice(0, NOTE_LIMIT)}…`;
  return text;
}

// 全局串行队列：本地模型 GPU 只有一块，并发看图只会互相拖慢。
let chain = Promise.resolve();
function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

function withTimeout(signal, ms) {
  if (typeof AbortSignal?.timeout !== 'function') return signal ?? null;
  const timer = AbortSignal.timeout(ms);
  if (!signal) return timer;
  try { return AbortSignal.any([signal, timer]); } catch { return signal; }
}

/**
 * 用视觉模型给单张图写图档。仅做"一张图 + 短提示词"的最小调用，不携带历史/人设/工具。
 * 失败返回 ''（调用方回退原图）。
 */
export async function writeNote({ part, cfg, complete, signal, log = console, timeoutMs = NOTE_TIMEOUT_MS }) {
  if (typeof complete !== 'function') return '';
  try {
    const res = await enqueue(() => complete({
      messages: [{ role: 'user', content: [{ type: 'text', text: NOTE_PROMPT }, part] }],
      tools: null,
      cfg,
      maxTokens: NOTE_MAX_TOKENS,
      signal: withTimeout(signal, timeoutMs),
      log,
    }));
    const note = tidy(textOf(res));
    if (!note) log?.warn?.('[vision-note] 视觉模型返回空图档，回退原图');
    return note;
  } catch (err) {
    log?.warn?.(`[vision-note] 生成图档失败，回退原图：${err?.message ?? err}`);
    return '';
  }
}

/**
 * 把图像 parts 换成图档文本 parts。
 * @returns {{parts: object[], total: number, replaced: number}}
 */
export async function applyVisionNotes({ parts, cfg, complete, cache, signal = null, log = console, seen = null, maxImages = 4 }) {
  const list = Array.isArray(parts) ? parts : [];
  const stat = { parts: list, total: 0, replaced: 0 };
  const endpoint = visionEndpoint(cfg);
  if (!endpoint || list.length === 0) return stat;
  // 手动止血开关：排查问题时可用 QQ_AGENT_VISION_NOTE=off 退回"发原图"。
  if (String(process.env.QQ_AGENT_VISION_NOTE ?? '').toLowerCase() === 'off') return stat;
  const local = isLocalEndpoint(endpoint);
  let budget = maxImages;
  const out = [];
  for (const part of list) {
    const hash = mediaHash(part);
    if (!hash) { out.push(part); continue; }
    stat.total += 1;
    // 同一次 run 里第二次看同一张图：模型在要细节，发原图。
    if (seen?.has?.(hash)) { out.push(part); continue; }
    let note = cache?.get?.(hash) ?? '';
    if (!note && local && budget > 0) {
      budget -= 1;
      note = await writeNote({ part, cfg, complete, signal, log });
      if (note) cache?.set?.(hash, note, String(cfg?.api?.visionModel ?? ''));
    }
    if (!note) { out.push(part); continue; }
    seen?.add?.(hash);
    stat.replaced += 1;
    out.push({ type: 'text', text: `[图片图档] ${note}` });
  }
  return { parts: out, total: stat.total, replaced: stat.replaced };
}
