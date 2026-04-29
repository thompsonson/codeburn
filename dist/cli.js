#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/fs-utils.ts
import { readFile as readFile3, stat as stat3 } from "fs/promises";
import { readFileSync, statSync, createReadStream } from "fs";
import { createInterface } from "readline";
function verbose() {
  return process.env.CODEBURN_VERBOSE === "1";
}
function warn(msg) {
  if (verbose()) process.stderr.write(`codeburn: ${msg}
`);
}
async function readViaStream(filePath) {
  const chunks = [];
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) chunks.push(line);
  return chunks.join("\n");
}
async function readSessionFile(filePath) {
  let size;
  try {
    size = (await stat3(filePath)).size;
  } catch (err) {
    warn(`stat failed for ${filePath}: ${err.code ?? "unknown"}`);
    return null;
  }
  if (size > MAX_SESSION_FILE_BYTES) {
    warn(`skipped oversize file ${filePath} (${size} bytes > cap ${MAX_SESSION_FILE_BYTES})`);
    return null;
  }
  try {
    if (size >= STREAM_THRESHOLD_BYTES) return await readViaStream(filePath);
    return await readFile3(filePath, "utf-8");
  } catch (err) {
    warn(`read failed for ${filePath}: ${err.code ?? "unknown"}`);
    return null;
  }
}
function readSessionFileSync(filePath) {
  let size;
  try {
    size = statSync(filePath).size;
  } catch (err) {
    warn(`stat failed for ${filePath}: ${err.code ?? "unknown"}`);
    return null;
  }
  if (size > MAX_SESSION_FILE_BYTES) {
    warn(`skipped oversize file ${filePath} (${size} bytes > cap ${MAX_SESSION_FILE_BYTES})`);
    return null;
  }
  try {
    return readFileSync(filePath, "utf-8");
  } catch (err) {
    warn(`read failed for ${filePath}: ${err.code ?? "unknown"}`);
    return null;
  }
}
async function* readSessionLines(filePath) {
  let size;
  try {
    size = (await stat3(filePath)).size;
  } catch (err) {
    warn(`stat failed for ${filePath}: ${err.code ?? "unknown"}`);
    return;
  }
  if (size > MAX_SESSION_FILE_BYTES) {
    warn(`skipped oversize file ${filePath} (${size} bytes > cap ${MAX_SESSION_FILE_BYTES})`);
    return;
  }
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) yield line;
  } catch (err) {
    warn(`stream read failed for ${filePath}: ${err.code ?? "unknown"}`);
  } finally {
    stream.destroy();
  }
}
var MAX_SESSION_FILE_BYTES, STREAM_THRESHOLD_BYTES;
var init_fs_utils = __esm({
  "src/fs-utils.ts"() {
    "use strict";
    MAX_SESSION_FILE_BYTES = 128 * 1024 * 1024;
    STREAM_THRESHOLD_BYTES = 8 * 1024 * 1024;
  }
});

// src/providers/claude.ts
import { readdir as readdir2, stat as stat4 } from "fs/promises";
import { basename, join as join5 } from "path";
import { homedir as homedir4 } from "os";
function getClaudeDir() {
  return process.env["CLAUDE_CONFIG_DIR"] || join5(homedir4(), ".claude");
}
function getProjectsDir() {
  return join5(getClaudeDir(), "projects");
}
function getDesktopSessionsDir() {
  if (process.platform === "darwin") return join5(homedir4(), "Library", "Application Support", "Claude", "local-agent-mode-sessions");
  if (process.platform === "win32") return join5(homedir4(), "AppData", "Roaming", "Claude", "local-agent-mode-sessions");
  return join5(homedir4(), ".config", "Claude", "local-agent-mode-sessions");
}
async function findDesktopProjectDirs(base) {
  const results = [];
  async function walk(dir, depth) {
    if (depth > 8) return;
    const entries = await readdir2(dir).catch(() => []);
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".git") continue;
      const full = join5(dir, entry);
      const s = await stat4(full).catch(() => null);
      if (!s?.isDirectory()) continue;
      if (entry === "projects") {
        const projectDirs = await readdir2(full).catch(() => []);
        for (const pd of projectDirs) {
          const pdFull = join5(full, pd);
          const pdStat = await stat4(pdFull).catch(() => null);
          if (pdStat?.isDirectory()) results.push(pdFull);
        }
      } else {
        await walk(full, depth + 1);
      }
    }
  }
  await walk(base, 0);
  return results;
}
var shortNames, claude;
var init_claude = __esm({
  "src/providers/claude.ts"() {
    "use strict";
    shortNames = {
      "claude-opus-4-7": "Opus 4.7",
      "claude-opus-4-6": "Opus 4.6",
      "claude-opus-4-5": "Opus 4.5",
      "claude-opus-4-1": "Opus 4.1",
      "claude-opus-4": "Opus 4",
      "claude-sonnet-4-6": "Sonnet 4.6",
      "claude-sonnet-4-5": "Sonnet 4.5",
      "claude-sonnet-4": "Sonnet 4",
      "claude-3-7-sonnet": "Sonnet 3.7",
      "claude-3-5-sonnet": "Sonnet 3.5",
      "claude-haiku-4-5": "Haiku 4.5",
      "claude-3-5-haiku": "Haiku 3.5"
    };
    claude = {
      name: "claude",
      displayName: "Claude",
      modelDisplayName(model) {
        const canonical = model.replace(/@.*$/, "").replace(/-\d{8}$/, "");
        for (const [key, name] of Object.entries(shortNames)) {
          if (canonical.startsWith(key)) return name;
        }
        return canonical;
      },
      toolDisplayName(rawTool) {
        return rawTool;
      },
      async discoverSessions() {
        const sources = [];
        const projectsDir = getProjectsDir();
        try {
          const entries = await readdir2(projectsDir);
          for (const dirName of entries) {
            const dirPath = join5(projectsDir, dirName);
            const dirStat = await stat4(dirPath).catch(() => null);
            if (dirStat?.isDirectory()) {
              sources.push({ path: dirPath, project: dirName, provider: "claude" });
            }
          }
        } catch {
        }
        const desktopDirs = await findDesktopProjectDirs(getDesktopSessionsDir());
        for (const dirPath of desktopDirs) {
          sources.push({ path: dirPath, project: basename(dirPath), provider: "claude" });
        }
        return sources;
      },
      createSessionParser() {
        return {
          async *parse() {
          }
        };
      }
    };
  }
});

// src/models.ts
import { readFile as readFile4, writeFile as writeFile4, mkdir as mkdir5 } from "fs/promises";
import { join as join6 } from "path";
import { homedir as homedir5 } from "os";
function getCacheDir2() {
  return join6(homedir5(), ".cache", "codeburn");
}
function getCachePath() {
  return join6(getCacheDir2(), "litellm-pricing.json");
}
function parseLiteLLMEntry(entry) {
  if (entry.input_cost_per_token === void 0 || entry.output_cost_per_token === void 0) return null;
  return {
    inputCostPerToken: entry.input_cost_per_token,
    outputCostPerToken: entry.output_cost_per_token,
    cacheWriteCostPerToken: entry.cache_creation_input_token_cost ?? entry.input_cost_per_token * 1.25,
    cacheReadCostPerToken: entry.cache_read_input_token_cost ?? entry.input_cost_per_token * 0.1,
    webSearchCostPerRequest: WEB_SEARCH_COST,
    fastMultiplier: entry.provider_specific_entry?.fast ?? 1
  };
}
async function fetchAndCachePricing() {
  const response = await fetch(LITELLM_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const pricing = /* @__PURE__ */ new Map();
  for (const [name, entry] of Object.entries(data)) {
    const costs = parseLiteLLMEntry(entry);
    if (!costs) continue;
    pricing.set(name, costs);
    const stripped = name.replace(/^[^/]+\//, "");
    if (stripped !== name && !pricing.has(stripped)) pricing.set(stripped, costs);
  }
  await mkdir5(getCacheDir2(), { recursive: true });
  await writeFile4(getCachePath(), JSON.stringify({
    timestamp: Date.now(),
    data: Object.fromEntries(pricing)
  }));
  return pricing;
}
async function loadCachedPricing() {
  try {
    const raw = await readFile4(getCachePath(), "utf-8");
    const cached = JSON.parse(raw);
    if (Date.now() - cached.timestamp > CACHE_TTL_MS2) return null;
    return new Map(Object.entries(cached.data));
  } catch {
    return null;
  }
}
async function loadPricing() {
  const cached = await loadCachedPricing();
  if (cached) {
    pricingCache = cached;
    return;
  }
  try {
    pricingCache = await fetchAndCachePricing();
  } catch {
    pricingCache = new Map(Object.entries(FALLBACK_PRICING));
  }
}
function setModelAliases(aliases) {
  userAliases = aliases;
}
function resolveAlias(model) {
  if (Object.hasOwn(userAliases, model)) return userAliases[model];
  if (Object.hasOwn(BUILTIN_ALIASES, model)) return BUILTIN_ALIASES[model];
  return model;
}
function getCanonicalName(model) {
  return model.replace(/@.*$/, "").replace(/-\d{8}$/, "").replace(/^[^/]+\//, "");
}
function getModelCosts(model) {
  const canonical = resolveAlias(getCanonicalName(model));
  if (pricingCache?.has(canonical)) return pricingCache.get(canonical);
  for (const [key, costs] of Object.entries(FALLBACK_PRICING)) {
    if (canonical === key || canonical.startsWith(key + "-")) return costs;
  }
  for (const [key, costs] of pricingCache ?? /* @__PURE__ */ new Map()) {
    if (canonical.startsWith(key)) return costs;
  }
  for (const [key, costs] of Object.entries(FALLBACK_PRICING)) {
    if (canonical.startsWith(key)) return costs;
  }
  return null;
}
function calculateCost(model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, webSearchRequests, speed = "standard") {
  const costs = getModelCosts(model);
  if (!costs) return 0;
  const multiplier = speed === "fast" ? costs.fastMultiplier : 1;
  return multiplier * (inputTokens * costs.inputCostPerToken + outputTokens * costs.outputCostPerToken + cacheCreationTokens * costs.cacheWriteCostPerToken + cacheReadTokens * costs.cacheReadCostPerToken + webSearchRequests * costs.webSearchCostPerRequest);
}
function getShortModelName(model) {
  const canonical = resolveAlias(getCanonicalName(model));
  const shortNames2 = {
    "claude-opus-4-7": "Opus 4.7",
    "claude-opus-4-6": "Opus 4.6",
    "claude-opus-4-5": "Opus 4.5",
    "claude-opus-4-1": "Opus 4.1",
    "claude-opus-4": "Opus 4",
    "claude-sonnet-4-6": "Sonnet 4.6",
    "claude-sonnet-4-5": "Sonnet 4.5",
    "claude-sonnet-4": "Sonnet 4",
    "claude-3-7-sonnet": "Sonnet 3.7",
    "claude-3-5-sonnet": "Sonnet 3.5",
    "claude-haiku-4-5": "Haiku 4.5",
    "claude-3-5-haiku": "Haiku 3.5",
    "gpt-4o-mini": "GPT-4o Mini",
    "gpt-4o": "GPT-4o",
    "gpt-4.1-nano": "GPT-4.1 Nano",
    "gpt-4.1-mini": "GPT-4.1 Mini",
    "gpt-4.1": "GPT-4.1",
    "codex-auto-review": "Codex Auto Review",
    "gpt-5.4-mini": "GPT-5.4 Mini",
    "gpt-5.4": "GPT-5.4",
    "gpt-5.3-codex": "GPT-5.3 Codex",
    "gpt-5.2-low": "GPT-5.2 Low",
    "gpt-5.2": "GPT-5.2",
    "gpt-5-mini": "GPT-5 Mini",
    "gpt-5": "GPT-5",
    "gemini-2.5-pro": "Gemini 2.5 Pro",
    "o4-mini": "o4-mini",
    "o3": "o3",
    "MiniMax-M2.7-highspeed": "MiniMax M2.7 Highspeed",
    "MiniMax-M2.7": "MiniMax M2.7"
  };
  for (const [key, name] of Object.entries(shortNames2)) {
    if (canonical.startsWith(key)) return name;
  }
  return canonical;
}
var LITELLM_URL, CACHE_TTL_MS2, WEB_SEARCH_COST, FALLBACK_PRICING, pricingCache, BUILTIN_ALIASES, userAliases;
var init_models = __esm({
  "src/models.ts"() {
    "use strict";
    LITELLM_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
    CACHE_TTL_MS2 = 24 * 60 * 60 * 1e3;
    WEB_SEARCH_COST = 0.01;
    FALLBACK_PRICING = {
      "claude-opus-4-7": { inputCostPerToken: 5e-6, outputCostPerToken: 25e-6, cacheWriteCostPerToken: 625e-8, cacheReadCostPerToken: 5e-7, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 6 },
      "claude-opus-4-6": { inputCostPerToken: 5e-6, outputCostPerToken: 25e-6, cacheWriteCostPerToken: 625e-8, cacheReadCostPerToken: 5e-7, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 6 },
      "claude-opus-4-5": { inputCostPerToken: 5e-6, outputCostPerToken: 25e-6, cacheWriteCostPerToken: 625e-8, cacheReadCostPerToken: 5e-7, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "claude-opus-4-1": { inputCostPerToken: 15e-6, outputCostPerToken: 75e-6, cacheWriteCostPerToken: 1875e-8, cacheReadCostPerToken: 15e-7, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "claude-opus-4": { inputCostPerToken: 15e-6, outputCostPerToken: 75e-6, cacheWriteCostPerToken: 1875e-8, cacheReadCostPerToken: 15e-7, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "claude-sonnet-4-6": { inputCostPerToken: 3e-6, outputCostPerToken: 15e-6, cacheWriteCostPerToken: 375e-8, cacheReadCostPerToken: 3e-7, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "claude-sonnet-4-5": { inputCostPerToken: 3e-6, outputCostPerToken: 15e-6, cacheWriteCostPerToken: 375e-8, cacheReadCostPerToken: 3e-7, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "claude-sonnet-4": { inputCostPerToken: 3e-6, outputCostPerToken: 15e-6, cacheWriteCostPerToken: 375e-8, cacheReadCostPerToken: 3e-7, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "claude-3-7-sonnet": { inputCostPerToken: 3e-6, outputCostPerToken: 15e-6, cacheWriteCostPerToken: 375e-8, cacheReadCostPerToken: 3e-7, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "claude-3-5-sonnet": { inputCostPerToken: 3e-6, outputCostPerToken: 15e-6, cacheWriteCostPerToken: 375e-8, cacheReadCostPerToken: 3e-7, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "claude-haiku-4-5": { inputCostPerToken: 1e-6, outputCostPerToken: 5e-6, cacheWriteCostPerToken: 125e-8, cacheReadCostPerToken: 1e-7, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "claude-3-5-haiku": { inputCostPerToken: 8e-7, outputCostPerToken: 4e-6, cacheWriteCostPerToken: 1e-6, cacheReadCostPerToken: 8e-8, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "gpt-4o": { inputCostPerToken: 25e-7, outputCostPerToken: 1e-5, cacheWriteCostPerToken: 25e-7, cacheReadCostPerToken: 125e-8, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "gpt-4o-mini": { inputCostPerToken: 15e-8, outputCostPerToken: 6e-7, cacheWriteCostPerToken: 15e-8, cacheReadCostPerToken: 75e-9, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "gemini-2.5-pro": { inputCostPerToken: 125e-8, outputCostPerToken: 1e-5, cacheWriteCostPerToken: 125e-8, cacheReadCostPerToken: 315e-9, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "gpt-5.3-codex": { inputCostPerToken: 25e-7, outputCostPerToken: 1e-5, cacheWriteCostPerToken: 25e-7, cacheReadCostPerToken: 125e-8, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "gpt-5.4": { inputCostPerToken: 25e-7, outputCostPerToken: 1e-5, cacheWriteCostPerToken: 25e-7, cacheReadCostPerToken: 125e-8, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "gpt-5.4-mini": { inputCostPerToken: 4e-7, outputCostPerToken: 16e-7, cacheWriteCostPerToken: 4e-7, cacheReadCostPerToken: 2e-7, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "gpt-5": { inputCostPerToken: 25e-7, outputCostPerToken: 1e-5, cacheWriteCostPerToken: 25e-7, cacheReadCostPerToken: 125e-8, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "gpt-5-mini": { inputCostPerToken: 4e-7, outputCostPerToken: 16e-7, cacheWriteCostPerToken: 4e-7, cacheReadCostPerToken: 2e-7, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "gpt-4.1": { inputCostPerToken: 2e-6, outputCostPerToken: 8e-6, cacheWriteCostPerToken: 2e-6, cacheReadCostPerToken: 5e-7, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "gpt-4.1-mini": { inputCostPerToken: 4e-7, outputCostPerToken: 16e-7, cacheWriteCostPerToken: 4e-7, cacheReadCostPerToken: 1e-7, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "gpt-4.1-nano": { inputCostPerToken: 1e-7, outputCostPerToken: 4e-7, cacheWriteCostPerToken: 1e-7, cacheReadCostPerToken: 25e-9, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "o3": { inputCostPerToken: 1e-5, outputCostPerToken: 4e-5, cacheWriteCostPerToken: 1e-5, cacheReadCostPerToken: 25e-7, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "o4-mini": { inputCostPerToken: 11e-7, outputCostPerToken: 44e-7, cacheWriteCostPerToken: 11e-7, cacheReadCostPerToken: 275e-9, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "MiniMax-M2.7-highspeed": { inputCostPerToken: 6e-7, outputCostPerToken: 24e-7, cacheWriteCostPerToken: 375e-9, cacheReadCostPerToken: 6e-8, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 },
      "MiniMax-M2.7": { inputCostPerToken: 3e-7, outputCostPerToken: 12e-7, cacheWriteCostPerToken: 375e-9, cacheReadCostPerToken: 6e-8, webSearchCostPerRequest: WEB_SEARCH_COST, fastMultiplier: 1 }
    };
    pricingCache = null;
    BUILTIN_ALIASES = {
      "anthropic--claude-4.6-opus": "claude-opus-4-6",
      "anthropic--claude-4.6-sonnet": "claude-sonnet-4-6",
      "anthropic--claude-4.5-opus": "claude-opus-4-5",
      "anthropic--claude-4.5-sonnet": "claude-sonnet-4-5",
      "anthropic--claude-4.5-haiku": "claude-haiku-4-5"
    };
    userAliases = {};
  }
});

// src/providers/codex.ts
import { readdir as readdir3, stat as stat5 } from "fs/promises";
import { basename as basename2, join as join7 } from "path";
import { homedir as homedir6 } from "os";
function getCodexDir(override) {
  return override ?? process.env["CODEX_HOME"] ?? join7(homedir6(), ".codex");
}
function sanitizeProject(cwd) {
  return cwd.replace(/^\//, "").replace(/\//g, "-");
}
async function readFirstLine(filePath) {
  const content = await readSessionFile(filePath);
  if (content === null) return null;
  const line = content.split("\n")[0];
  if (!line?.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
async function isValidCodexSession(filePath) {
  const entry = await readFirstLine(filePath);
  if (!entry) return { valid: false };
  const valid = entry.type === "session_meta" && typeof entry.payload?.originator === "string" && entry.payload.originator.toLowerCase().startsWith("codex");
  return { valid, meta: valid ? entry : void 0 };
}
async function discoverSessionsInDir(codexDir) {
  const sessionsDir = join7(codexDir, "sessions");
  const sources = [];
  let years;
  try {
    years = await readdir3(sessionsDir);
  } catch {
    return sources;
  }
  for (const year of years) {
    if (!/^\d{4}$/.test(year)) continue;
    const yearDir = join7(sessionsDir, year);
    const months = await readdir3(yearDir).catch(() => []);
    for (const month of months) {
      if (!/^\d{2}$/.test(month)) continue;
      const monthDir = join7(yearDir, month);
      const days = await readdir3(monthDir).catch(() => []);
      for (const day of days) {
        if (!/^\d{2}$/.test(day)) continue;
        const dayDir = join7(monthDir, day);
        const files = await readdir3(dayDir).catch(() => []);
        for (const file of files) {
          if (!file.startsWith("rollout-") || !file.endsWith(".jsonl")) continue;
          const filePath = join7(dayDir, file);
          const s = await stat5(filePath).catch(() => null);
          if (!s?.isFile()) continue;
          const { valid, meta } = await isValidCodexSession(filePath);
          if (!valid || !meta) continue;
          const cwd = meta.payload?.cwd ?? "unknown";
          sources.push({ path: filePath, project: sanitizeProject(cwd), provider: "codex" });
        }
      }
    }
  }
  return sources;
}
function resolveModel(info, sessionModel) {
  return info?.model ?? info?.info?.model ?? info?.info?.model_name ?? sessionModel ?? "gpt-5";
}
function createParser(source, seenKeys) {
  return {
    async *parse() {
      const content = await readSessionFile(source.path);
      if (content === null) return;
      const lines = content.split("\n").filter((l) => l.trim());
      let sessionModel;
      let sessionId = "";
      let prevCumulativeTotal = 0;
      let prevInput = 0;
      let prevCached = 0;
      let prevOutput = 0;
      let prevReasoning = 0;
      let pendingTools = [];
      let pendingUserMessage = "";
      for (const line of lines) {
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (entry.type === "session_meta") {
          sessionId = entry.payload?.session_id ?? basename2(source.path, ".jsonl");
          sessionModel = entry.payload?.model ?? sessionModel;
          continue;
        }
        if (entry.type === "turn_context" && entry.payload?.model) {
          sessionModel = entry.payload.model;
          continue;
        }
        if (entry.type === "response_item" && entry.payload?.type === "function_call") {
          const rawName = entry.payload.name ?? "";
          pendingTools.push(toolNameMap[rawName] ?? rawName);
          continue;
        }
        if (entry.type === "event_msg" && entry.payload?.type === "patch_apply_end") {
          pendingTools.push("Edit");
          continue;
        }
        if (entry.type === "response_item" && entry.payload?.type === "message" && entry.payload?.role === "user") {
          const texts = (entry.payload.content ?? []).filter((c) => c.type === "input_text").map((c) => c.text ?? "").filter(Boolean);
          if (texts.length > 0) pendingUserMessage = texts.join(" ");
          continue;
        }
        if (entry.type === "event_msg" && entry.payload?.type === "token_count") {
          const info = entry.payload.info;
          if (!info) continue;
          const cumulativeTotal = info.total_token_usage?.total_tokens ?? 0;
          if (cumulativeTotal > 0 && cumulativeTotal === prevCumulativeTotal) continue;
          prevCumulativeTotal = cumulativeTotal;
          const last = info.last_token_usage;
          let inputTokens = 0;
          let cachedInputTokens = 0;
          let outputTokens = 0;
          let reasoningTokens = 0;
          if (last) {
            inputTokens = last.input_tokens ?? 0;
            cachedInputTokens = last.cached_input_tokens ?? 0;
            outputTokens = last.output_tokens ?? 0;
            reasoningTokens = last.reasoning_output_tokens ?? 0;
          } else if (cumulativeTotal > 0) {
            const total = info.total_token_usage;
            if (!total) continue;
            inputTokens = (total.input_tokens ?? 0) - prevInput;
            cachedInputTokens = (total.cached_input_tokens ?? 0) - prevCached;
            outputTokens = (total.output_tokens ?? 0) - prevOutput;
            reasoningTokens = (total.reasoning_output_tokens ?? 0) - prevReasoning;
          }
          if (!last) {
            const total = info.total_token_usage;
            if (total) {
              prevInput = total.input_tokens ?? 0;
              prevCached = total.cached_input_tokens ?? 0;
              prevOutput = total.output_tokens ?? 0;
              prevReasoning = total.reasoning_output_tokens ?? 0;
            }
          }
          const totalTokens = inputTokens + cachedInputTokens + outputTokens + reasoningTokens;
          if (totalTokens === 0) continue;
          const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
          const model = resolveModel(entry.payload, sessionModel);
          const timestamp = entry.timestamp ?? "";
          const dedupKey = `codex:${source.path}:${timestamp}:${cumulativeTotal}`;
          if (seenKeys.has(dedupKey)) continue;
          seenKeys.add(dedupKey);
          const costUSD = calculateCost(
            model,
            uncachedInputTokens,
            outputTokens + reasoningTokens,
            0,
            cachedInputTokens,
            0
          );
          yield {
            provider: "codex",
            model,
            inputTokens: uncachedInputTokens,
            outputTokens,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: cachedInputTokens,
            cachedInputTokens,
            reasoningTokens,
            webSearchRequests: 0,
            costUSD,
            tools: pendingTools,
            bashCommands: [],
            timestamp,
            speed: "standard",
            deduplicationKey: dedupKey,
            userMessage: pendingUserMessage,
            sessionId
          };
          pendingTools = [];
          pendingUserMessage = "";
        }
      }
    }
  };
}
function createCodexProvider(codexDir) {
  const dir = getCodexDir(codexDir);
  return {
    name: "codex",
    displayName: "Codex",
    modelDisplayName(model) {
      for (const [key, name] of Object.entries(modelDisplayNames)) {
        if (model.startsWith(key)) return name;
      }
      return model;
    },
    toolDisplayName(rawTool) {
      return toolNameMap[rawTool] ?? rawTool;
    },
    async discoverSessions() {
      return discoverSessionsInDir(dir);
    },
    createSessionParser(source, seenKeys) {
      return createParser(source, seenKeys);
    }
  };
}
var modelDisplayNames, toolNameMap, codex;
var init_codex = __esm({
  "src/providers/codex.ts"() {
    "use strict";
    init_fs_utils();
    init_models();
    modelDisplayNames = {
      "codex-auto-review": "Codex Auto Review",
      "gpt-5.4-mini": "GPT-5.4 Mini",
      "gpt-5.4": "GPT-5.4",
      "gpt-5.3-codex": "GPT-5.3 Codex",
      "gpt-5.2-low": "GPT-5.2 Low",
      "gpt-5.2": "GPT-5.2",
      "gpt-5": "GPT-5",
      "gpt-4o-mini": "GPT-4o Mini",
      "gpt-4o": "GPT-4o"
    };
    toolNameMap = {
      exec_command: "Bash",
      read_file: "Read",
      write_file: "Edit",
      apply_diff: "Edit",
      apply_patch: "Edit",
      spawn_agent: "Agent",
      close_agent: "Agent",
      wait_agent: "Agent",
      read_dir: "Glob"
    };
    codex = createCodexProvider();
  }
});

// src/providers/copilot.ts
import { readdir as readdir4, stat as stat6 } from "fs/promises";
import { basename as basename3, dirname as dirname2, join as join8 } from "path";
import { homedir as homedir7 } from "os";
function getCopilotSessionStateDir(override) {
  return override ?? join8(homedir7(), ".copilot", "session-state");
}
function parseCwd(yaml) {
  const match = yaml.match(/^cwd:\s*(.+)$/m);
  if (!match?.[1]) return null;
  const raw = match[1].replace(/\s*#.*$/, "").replace(/^['"]|['"]$/g, "").trim();
  return raw || null;
}
function createParser2(source, seenKeys) {
  return {
    async *parse() {
      const content = await readSessionFile(source.path);
      if (content === null) return;
      const sessionId = basename3(dirname2(source.path));
      const lines = content.split("\n").filter((l) => l.trim());
      let currentModel = "";
      let pendingUserMessage = "";
      for (const line of lines) {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === "session.model_change") {
          currentModel = event.data.newModel ?? currentModel;
          continue;
        }
        if (event.type === "user.message") {
          pendingUserMessage = event.data.content ?? "";
          continue;
        }
        if (event.type === "assistant.message") {
          const { messageId, outputTokens, toolRequests = [] } = event.data;
          if (outputTokens === 0) continue;
          if (!currentModel) continue;
          const dedupKey = `copilot:${sessionId}:${messageId}`;
          if (seenKeys.has(dedupKey)) continue;
          seenKeys.add(dedupKey);
          const tools = toolRequests.map((t) => t.name ?? "").filter(Boolean).map((n) => toolNameMap2[n] ?? n);
          const costUSD = calculateCost(currentModel, 0, outputTokens, 0, 0, 0);
          yield {
            provider: "copilot",
            model: currentModel,
            inputTokens: 0,
            outputTokens,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            cachedInputTokens: 0,
            reasoningTokens: 0,
            webSearchRequests: 0,
            costUSD,
            tools,
            bashCommands: [],
            timestamp: event.timestamp ?? "",
            speed: "standard",
            deduplicationKey: dedupKey,
            userMessage: pendingUserMessage,
            sessionId
          };
          pendingUserMessage = "";
        }
      }
    }
  };
}
async function discoverSessionsInDir2(sessionStateDir) {
  const sources = [];
  let sessionDirs;
  try {
    sessionDirs = await readdir4(sessionStateDir);
  } catch {
    return sources;
  }
  for (const sessionId of sessionDirs) {
    const eventsPath = join8(sessionStateDir, sessionId, "events.jsonl");
    const s = await stat6(eventsPath).catch(() => null);
    if (!s?.isFile()) continue;
    let project = sessionId;
    const yaml = await readSessionFile(join8(sessionStateDir, sessionId, "workspace.yaml"));
    if (yaml !== null) {
      const cwd = parseCwd(yaml);
      if (cwd) project = basename3(cwd);
    }
    sources.push({ path: eventsPath, project, provider: "copilot" });
  }
  return sources;
}
function createCopilotProvider(sessionStateDir) {
  const dir = getCopilotSessionStateDir(sessionStateDir);
  return {
    name: "copilot",
    displayName: "Copilot",
    modelDisplayName(model) {
      for (const [key, name] of modelDisplayEntries) {
        if (model === key || model.startsWith(key + "-")) return name;
      }
      return model;
    },
    toolDisplayName(rawTool) {
      return toolNameMap2[rawTool] ?? rawTool;
    },
    async discoverSessions() {
      return discoverSessionsInDir2(dir);
    },
    createSessionParser(source, seenKeys) {
      return createParser2(source, seenKeys);
    }
  };
}
var modelDisplayNames2, toolNameMap2, modelDisplayEntries, copilot;
var init_copilot = __esm({
  "src/providers/copilot.ts"() {
    "use strict";
    init_fs_utils();
    init_models();
    modelDisplayNames2 = {
      "gpt-4.1-nano": "GPT-4.1 Nano",
      "gpt-4.1-mini": "GPT-4.1 Mini",
      "gpt-4.1": "GPT-4.1",
      "gpt-4o-mini": "GPT-4o Mini",
      "gpt-4o": "GPT-4o",
      "gpt-5-mini": "GPT-5 Mini",
      "gpt-5": "GPT-5",
      "claude-sonnet-4-5": "Sonnet 4.5",
      "claude-sonnet-4": "Sonnet 4",
      "claude-3-7-sonnet": "Sonnet 3.7",
      "claude-3-5-sonnet": "Sonnet 3.5",
      "o4-mini": "o4-mini",
      "o3": "o3"
    };
    toolNameMap2 = {
      bash: "Bash",
      read_file: "Read",
      write_file: "Edit",
      edit_file: "Edit",
      create_file: "Write",
      delete_file: "Delete",
      search_files: "Grep",
      find_files: "Glob",
      list_directory: "LS",
      web_search: "WebSearch",
      fetch_webpage: "WebFetch",
      github_repo: "GitHub"
    };
    modelDisplayEntries = Object.entries(modelDisplayNames2).sort((a, b) => b[0].length - a[0].length);
    copilot = createCopilotProvider();
  }
});

// src/bash-utils.ts
import { basename as basename4 } from "path";
function stripQuotedStrings(command) {
  return command.replace(/"[^"]*"|'[^']*'/g, (match) => " ".repeat(match.length));
}
function extractBashCommands(command) {
  if (!command || !command.trim()) return [];
  const stripped = stripQuotedStrings(command);
  const separatorRegex = /\s*(?:&&|;|\|)\s*/g;
  const separators = [];
  let match;
  while ((match = separatorRegex.exec(stripped)) !== null) {
    separators.push({ start: match.index, end: match.index + match[0].length });
  }
  const ranges = [];
  let cursor2 = 0;
  for (const sep of separators) {
    ranges.push([cursor2, sep.start]);
    cursor2 = sep.end;
  }
  ranges.push([cursor2, command.length]);
  const commands = [];
  for (const [start, end] of ranges) {
    const segment = command.slice(start, end).trim();
    if (!segment) continue;
    const tokens = segment.split(/\s+/);
    let i = 0;
    while (i < tokens.length && /^\w+=/.test(tokens[i])) i++;
    const base = i < tokens.length ? basename4(tokens[i]) : "";
    if (base && base !== "cd" && base !== "true" && base !== "false") {
      commands.push(base);
    }
  }
  return commands;
}
var init_bash_utils = __esm({
  "src/bash-utils.ts"() {
    "use strict";
  }
});

// src/providers/pi.ts
import { readdir as readdir5, stat as stat7 } from "fs/promises";
import { basename as basename5, join as join9 } from "path";
import { homedir as homedir8 } from "os";
function getPiSessionsDir(override) {
  return override ?? join9(homedir8(), ".pi", "agent", "sessions");
}
function getOmpSessionsDir(override) {
  return override ?? join9(homedir8(), ".omp", "agent", "sessions");
}
async function readFirstEntry(filePath) {
  const content = await readSessionFile(filePath);
  if (content === null) return null;
  const line = content.split("\n")[0];
  if (!line?.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
async function discoverSessionsInDir3(sessionsDir, providerName) {
  const sources = [];
  let projectDirs;
  try {
    projectDirs = await readdir5(sessionsDir);
  } catch {
    return sources;
  }
  for (const dirName of projectDirs) {
    const dirPath = join9(sessionsDir, dirName);
    const dirStat = await stat7(dirPath).catch(() => null);
    if (!dirStat?.isDirectory()) continue;
    let files;
    try {
      files = await readdir5(dirPath);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = join9(dirPath, file);
      const fileStat = await stat7(filePath).catch(() => null);
      if (!fileStat?.isFile()) continue;
      const first = await readFirstEntry(filePath);
      if (!first || first.type !== "session") continue;
      const cwd = first.cwd ?? dirName;
      sources.push({ path: filePath, project: basename5(cwd), provider: providerName });
    }
  }
  return sources;
}
function createParser3(source, seenKeys) {
  return {
    async *parse() {
      const content = await readSessionFile(source.path);
      if (content === null) return;
      const lines = content.split("\n").filter((l) => l.trim());
      let sessionId = basename5(source.path, ".jsonl");
      let pendingUserMessage = "";
      for (const [lineIdx, line] of lines.entries()) {
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (entry.type === "session") {
          sessionId = entry.id ?? sessionId;
          continue;
        }
        if (entry.type !== "message") continue;
        const msg = entry.message;
        if (!msg) continue;
        if (msg.role === "user") {
          const texts = (msg.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").filter(Boolean);
          if (texts.length > 0) pendingUserMessage = texts.join(" ");
          continue;
        }
        if (msg.role !== "assistant" || !msg.usage) continue;
        const { input, output, cacheRead, cacheWrite } = msg.usage;
        if (input === 0 && output === 0) continue;
        const model = msg.model ?? "gpt-5";
        const responseId = msg.responseId ?? "";
        const dedupKey = `${source.provider}:${source.path}:${responseId || entry.id || entry.timestamp || String(lineIdx)}`;
        if (seenKeys.has(dedupKey)) continue;
        seenKeys.add(dedupKey);
        const toolCalls = (msg.content ?? []).filter((c) => c.type === "toolCall" && c.name);
        const tools = toolCalls.map((c) => toolNameMap3[c.name] ?? c.name);
        const bashCommands = toolCalls.filter((c) => c.name === "bash").flatMap((c) => {
          const cmd = c.arguments?.["command"];
          return typeof cmd === "string" ? extractBashCommands(cmd) : [];
        });
        const costUSD = calculateCost(model, input, output, cacheWrite, cacheRead, 0);
        const timestamp = entry.timestamp ?? "";
        yield {
          provider: source.provider,
          model,
          inputTokens: input,
          outputTokens: output,
          cacheCreationInputTokens: cacheWrite,
          cacheReadInputTokens: cacheRead,
          cachedInputTokens: cacheRead,
          reasoningTokens: 0,
          webSearchRequests: 0,
          costUSD,
          tools,
          bashCommands,
          timestamp,
          speed: "standard",
          deduplicationKey: dedupKey,
          userMessage: pendingUserMessage,
          sessionId
        };
        pendingUserMessage = "";
      }
    }
  };
}
function createPiProvider(sessionsDir) {
  const dir = getPiSessionsDir(sessionsDir);
  return {
    name: "pi",
    displayName: "Pi",
    modelDisplayName(model) {
      for (const [key, name] of modelDisplayEntries2) {
        if (model.startsWith(key)) return name;
      }
      return model;
    },
    toolDisplayName(rawTool) {
      return toolNameMap3[rawTool] ?? rawTool;
    },
    async discoverSessions() {
      return discoverSessionsInDir3(dir, "pi");
    },
    createSessionParser(source, seenKeys) {
      return createParser3(source, seenKeys);
    }
  };
}
function createOmpProvider(sessionsDir) {
  const dir = getOmpSessionsDir(sessionsDir);
  return {
    name: "omp",
    displayName: "OMP",
    modelDisplayName(model) {
      for (const [key, name] of modelDisplayEntries2) {
        if (model.startsWith(key)) return name;
      }
      return model;
    },
    toolDisplayName(rawTool) {
      return toolNameMap3[rawTool] ?? rawTool;
    },
    async discoverSessions() {
      return discoverSessionsInDir3(dir, "omp");
    },
    createSessionParser(source, seenKeys) {
      return createParser3(source, seenKeys);
    }
  };
}
var modelDisplayNames3, toolNameMap3, modelDisplayEntries2, pi, omp;
var init_pi = __esm({
  "src/providers/pi.ts"() {
    "use strict";
    init_fs_utils();
    init_models();
    init_bash_utils();
    modelDisplayNames3 = {
      "gpt-5.4": "GPT-5.4",
      "gpt-5.4-mini": "GPT-5.4 Mini",
      "gpt-5": "GPT-5",
      "gpt-4o": "GPT-4o",
      "gpt-4o-mini": "GPT-4o Mini"
    };
    toolNameMap3 = {
      bash: "Bash",
      read: "Read",
      edit: "Edit",
      write: "Write",
      glob: "Glob",
      grep: "Grep",
      task: "Agent",
      dispatch_agent: "Agent",
      fetch: "WebFetch",
      search: "WebSearch",
      todo: "TodoWrite",
      patch: "Patch"
    };
    modelDisplayEntries2 = Object.entries(modelDisplayNames3).sort((a, b) => b[0].length - a[0].length);
    pi = createPiProvider();
    omp = createOmpProvider();
  }
});

// src/cursor-cache.ts
import { readFile as readFile5, writeFile as writeFile5, mkdir as mkdir6, stat as stat8 } from "fs/promises";
import { join as join10 } from "path";
import { homedir as homedir9 } from "os";
function getCacheDir3() {
  return join10(homedir9(), ".cache", "codeburn");
}
function getCachePath2() {
  return join10(getCacheDir3(), CACHE_FILE);
}
async function getDbFingerprint(dbPath) {
  try {
    const s = await stat8(dbPath);
    return { mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    return null;
  }
}
async function readCachedResults(dbPath) {
  try {
    const fp = await getDbFingerprint(dbPath);
    if (!fp) return null;
    const raw = await readFile5(getCachePath2(), "utf-8");
    const cache = JSON.parse(raw);
    if (cache.dbMtimeMs === fp.mtimeMs && cache.dbSizeBytes === fp.size) {
      return cache.calls;
    }
    return null;
  } catch {
    return null;
  }
}
async function writeCachedResults(dbPath, calls) {
  try {
    const fp = await getDbFingerprint(dbPath);
    if (!fp) return;
    const dir = getCacheDir3();
    await mkdir6(dir, { recursive: true });
    const cache = {
      dbMtimeMs: fp.mtimeMs,
      dbSizeBytes: fp.size,
      calls
    };
    await writeFile5(getCachePath2(), JSON.stringify(cache), "utf-8");
  } catch {
  }
}
var CACHE_FILE;
var init_cursor_cache = __esm({
  "src/cursor-cache.ts"() {
    "use strict";
    CACHE_FILE = "cursor-results.json";
  }
});

// src/sqlite.ts
import { createRequire } from "module";
function loadDriver() {
  if (loadAttempted) return DatabaseSync !== null;
  loadAttempted = true;
  const origEmit = process.emit.bind(process);
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    process.emit = origEmit;
  };
  process.emit = function patchedEmit(event, ...args) {
    if (event === "warning") {
      const warning = args[0];
      if (warning?.name === "ExperimentalWarning" && typeof warning.message === "string" && /SQLite/i.test(warning.message)) {
        return false;
      }
    }
    return origEmit.call(this, event, ...args);
  };
  try {
    const mod = requireForSqlite("node:sqlite");
    DatabaseSync = mod.DatabaseSync;
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    loadError = `SQLite-based providers (Cursor, OpenCode) need Node 22+ with the node:sqlite module.
Current Node: ${process.version}.
Upgrade Node (https://nodejs.org) and run codeburn again.
(underlying error: ${message})`;
    return false;
  } finally {
    restore();
  }
}
function isSqliteAvailable() {
  return loadDriver();
}
function getSqliteLoadError() {
  return loadError ?? "SQLite driver not available";
}
function openDatabase(path) {
  if (!loadDriver() || DatabaseSync === null) {
    throw new Error(getSqliteLoadError());
  }
  const db = new DatabaseSync(path, { readOnly: true });
  return {
    query(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    close() {
      db.close();
    }
  };
}
var requireForSqlite, DatabaseSync, loadAttempted, loadError;
var init_sqlite = __esm({
  "src/sqlite.ts"() {
    "use strict";
    requireForSqlite = createRequire(import.meta.url);
    DatabaseSync = null;
    loadAttempted = false;
    loadError = null;
  }
});

// src/providers/cursor.ts
var cursor_exports = {};
__export(cursor_exports, {
  createCursorProvider: () => createCursorProvider,
  cursor: () => cursor
});
import { existsSync } from "fs";
import { join as join11 } from "path";
import { homedir as homedir10 } from "os";
function getCursorDbPath() {
  if (process.platform === "darwin") {
    return join11(homedir10(), "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
  }
  if (process.platform === "win32") {
    return join11(homedir10(), "AppData", "Roaming", "Cursor", "User", "globalStorage", "state.vscdb");
  }
  return join11(homedir10(), ".config", "Cursor", "User", "globalStorage", "state.vscdb");
}
function extractLanguages(codeBlocksJson) {
  if (!codeBlocksJson) return [];
  try {
    const blocks = JSON.parse(codeBlocksJson);
    if (!Array.isArray(blocks)) return [];
    const langs = /* @__PURE__ */ new Set();
    for (const block of blocks) {
      if (block.languageId && block.languageId !== "plaintext") {
        langs.add(block.languageId);
      }
    }
    return [...langs];
  } catch {
    return [];
  }
}
function resolveModel2(raw) {
  if (!raw || raw === "default") return CURSOR_DEFAULT_MODEL;
  return raw;
}
function modelForDisplay(raw) {
  if (!raw || raw === "default") return "default";
  return raw;
}
function validateSchema(db) {
  try {
    const rows = db.query(
      "SELECT COUNT(*) as cnt FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' LIMIT 1"
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}
function buildUserMessageMap(db, timeFloor) {
  const map = /* @__PURE__ */ new Map();
  try {
    const rows = db.query(USER_MESSAGES_QUERY, [timeFloor]);
    for (const row of rows) {
      if (!row.conversation_id || !row.text) continue;
      const existing = map.get(row.conversation_id) ?? [];
      existing.push(row.text);
      map.set(row.conversation_id, existing);
    }
  } catch {
  }
  return map;
}
function parseBubbles(db, seenKeys) {
  const results = [];
  let skipped = 0;
  const DEFAULT_LOOKBACK_DAYS = 35;
  const timeFloor = new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1e3).toISOString();
  const userMessages = buildUserMessageMap(db, timeFloor);
  let rows;
  try {
    rows = db.query(BUBBLE_QUERY_SINCE, [timeFloor]);
  } catch {
    return { calls: results };
  }
  for (const row of rows) {
    try {
      const inputTokens = row.input_tokens ?? 0;
      const outputTokens = row.output_tokens ?? 0;
      if (inputTokens === 0 && outputTokens === 0) continue;
      const createdAt = row.created_at ?? "";
      const conversationId = row.conversation_id ?? "unknown";
      const dedupKey = `cursor:${conversationId}:${createdAt}:${inputTokens}:${outputTokens}`;
      if (seenKeys.has(dedupKey)) continue;
      seenKeys.add(dedupKey);
      const pricingModel = resolveModel2(row.model);
      const displayModel = modelForDisplay(row.model);
      const costUSD = calculateCost(pricingModel, inputTokens, outputTokens, 0, 0, 0);
      const timestamp = createdAt || "";
      const convMessages = userMessages.get(conversationId) ?? [];
      const userQuestion = convMessages.length > 0 ? convMessages.shift() : "";
      const assistantText = row.user_text ?? "";
      const userText = (userQuestion + " " + assistantText).trim();
      const languages = extractLanguages(row.code_blocks);
      const hasCode = languages.length > 0;
      const cursorTools = hasCode ? ["cursor:edit", ...languages.map((l) => `lang:${l}`)] : [];
      results.push({
        provider: "cursor",
        model: displayModel,
        inputTokens,
        outputTokens,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        webSearchRequests: 0,
        costUSD,
        tools: cursorTools,
        bashCommands: [],
        timestamp,
        speed: "standard",
        deduplicationKey: dedupKey,
        userMessage: userText,
        sessionId: conversationId
      });
    } catch {
      skipped++;
    }
  }
  if (skipped > 0) {
    process.stderr.write(`codeburn: skipped ${skipped} unreadable Cursor entries
`);
  }
  return { calls: results };
}
function extractModelFromContent(content) {
  for (const c of content) {
    if (c.providerOptions?.cursor?.modelName) {
      return c.providerOptions.cursor.modelName;
    }
  }
  return null;
}
function extractTextLength(content) {
  let total = 0;
  for (const c of content) {
    if (c.text) total += c.text.length;
  }
  return total;
}
function parseAgentKv(db, seenKeys) {
  const results = [];
  let rows;
  try {
    rows = db.query(AGENTKV_QUERY);
  } catch {
    return { calls: results };
  }
  const sessions = /* @__PURE__ */ new Map();
  let currentRequestId = "unknown";
  let turnIndex = 0;
  for (const row of rows) {
    if (!row.role || !row.content) continue;
    let content;
    try {
      content = JSON.parse(row.content);
      if (!Array.isArray(content)) continue;
    } catch {
      continue;
    }
    const requestId = row.request_id ?? currentRequestId;
    if (requestId !== currentRequestId) {
      currentRequestId = requestId;
      turnIndex = 0;
    }
    const textLength = extractTextLength(content);
    const model = extractModelFromContent(content);
    if (row.role === "user") {
      const existing = sessions.get(requestId) ?? { inputChars: 0, outputChars: 0, model: null, userText: "" };
      existing.inputChars += textLength;
      if (!existing.userText && content[0]?.text) {
        const text = content[0].text;
        const queryMatch = text.match(/<user_query>([\s\S]*?)<\/user_query>/);
        existing.userText = queryMatch ? queryMatch[1].trim().slice(0, 500) : text.slice(0, 500);
      }
      sessions.set(requestId, existing);
    } else if (row.role === "assistant") {
      const existing = sessions.get(requestId) ?? { inputChars: 0, outputChars: 0, model: null, userText: "" };
      existing.outputChars += textLength;
      if (model) existing.model = model;
      sessions.set(requestId, existing);
    } else if (row.role === "tool" || row.role === "system") {
      const existing = sessions.get(requestId) ?? { inputChars: 0, outputChars: 0, model: null, userText: "" };
      existing.inputChars += textLength;
      sessions.set(requestId, existing);
    }
  }
  for (const [requestId, session] of sessions) {
    if (session.inputChars === 0 && session.outputChars === 0) continue;
    const inputTokens = Math.ceil(session.inputChars / CHARS_PER_TOKEN);
    const outputTokens = Math.ceil(session.outputChars / CHARS_PER_TOKEN);
    const dedupKey = `cursor:agentKv:${requestId}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);
    const pricingModel = resolveModel2(session.model);
    const displayModel = modelForDisplay(session.model);
    const costUSD = calculateCost(pricingModel, inputTokens, outputTokens, 0, 0, 0);
    results.push({
      provider: "cursor",
      model: displayModel,
      inputTokens,
      outputTokens,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      webSearchRequests: 0,
      costUSD,
      tools: [],
      bashCommands: [],
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      speed: "standard",
      deduplicationKey: dedupKey,
      userMessage: session.userText,
      sessionId: requestId
    });
  }
  return { calls: results };
}
function createParser4(source, seenKeys) {
  return {
    async *parse() {
      if (!isSqliteAvailable()) {
        process.stderr.write(getSqliteLoadError() + "\n");
        return;
      }
      const cached = await readCachedResults(source.path);
      if (cached) {
        for (const call of cached) {
          if (seenKeys.has(call.deduplicationKey)) continue;
          seenKeys.add(call.deduplicationKey);
          yield call;
        }
        return;
      }
      let db;
      try {
        db = openDatabase(source.path);
      } catch (err) {
        process.stderr.write(`codeburn: cannot open Cursor database: ${err instanceof Error ? err.message : err}
`);
        return;
      }
      try {
        if (!validateSchema(db)) {
          process.stderr.write("codeburn: Cursor storage format not recognized. You may need to update CodeBurn.\n");
          return;
        }
        let { calls } = parseBubbles(db, seenKeys);
        if (calls.length === 0) {
          const agentKvResult = parseAgentKv(db, seenKeys);
          calls = agentKvResult.calls;
        }
        await writeCachedResults(source.path, calls);
        for (const call of calls) {
          yield call;
        }
      } finally {
        db.close();
      }
    }
  };
}
function createCursorProvider(dbPathOverride) {
  return {
    name: "cursor",
    displayName: "Cursor",
    modelDisplayName(model) {
      return modelDisplayNames4[model] ?? model;
    },
    toolDisplayName(rawTool) {
      return rawTool;
    },
    async discoverSessions() {
      if (!isSqliteAvailable()) return [];
      const dbPath = dbPathOverride ?? getCursorDbPath();
      if (!existsSync(dbPath)) return [];
      return [{ path: dbPath, project: "cursor", provider: "cursor" }];
    },
    createSessionParser(source, seenKeys) {
      return createParser4(source, seenKeys);
    }
  };
}
var CURSOR_DEFAULT_MODEL, modelDisplayNames4, CHARS_PER_TOKEN, BUBBLE_QUERY_BASE, AGENTKV_QUERY, USER_MESSAGES_QUERY, BUBBLE_QUERY_SINCE, cursor;
var init_cursor = __esm({
  "src/providers/cursor.ts"() {
    "use strict";
    init_models();
    init_cursor_cache();
    init_sqlite();
    CURSOR_DEFAULT_MODEL = "claude-sonnet-4-5";
    modelDisplayNames4 = {
      "claude-4.5-opus-high-thinking": "Opus 4.5 (Thinking)",
      "claude-4-opus": "Opus 4",
      "claude-4-sonnet-thinking": "Sonnet 4 (Thinking)",
      "claude-4.5-sonnet-thinking": "Sonnet 4.5 (Thinking)",
      "claude-4.6-sonnet": "Sonnet 4.6",
      "composer-1": "Composer 1",
      "grok-code-fast-1": "Grok Code Fast",
      "gemini-3-pro": "Gemini 3 Pro",
      "gpt-5.2-low": "GPT-5.2 Low",
      "gpt-5.2": "GPT-5.2",
      "gpt-5.1-codex-high": "GPT-5.1 Codex",
      "gpt-5": "GPT-5",
      "gpt-4.1": "GPT-4.1",
      "default": "Auto (Sonnet est.)"
    };
    CHARS_PER_TOKEN = 4;
    BUBBLE_QUERY_BASE = `
  SELECT
    json_extract(value, '$.tokenCount.inputTokens') as input_tokens,
    json_extract(value, '$.tokenCount.outputTokens') as output_tokens,
    json_extract(value, '$.modelInfo.modelName') as model,
    json_extract(value, '$.createdAt') as created_at,
    json_extract(value, '$.conversationId') as conversation_id,
    substr(json_extract(value, '$.text'), 1, 500) as user_text,
    json_extract(value, '$.codeBlocks') as code_blocks
  FROM cursorDiskKV
  WHERE key LIKE 'bubbleId:%'
    AND json_extract(value, '$.tokenCount.inputTokens') > 0
`;
    AGENTKV_QUERY = `
  SELECT
    key,
    json_extract(value, '$.role') as role,
    json_extract(value, '$.content') as content,
    json_extract(value, '$.providerOptions.cursor.requestId') as request_id,
    length(value) as content_length
  FROM cursorDiskKV
  WHERE key LIKE 'agentKv:blob:%'
    AND hex(substr(value, 1, 1)) = '7B'
  ORDER BY ROWID ASC
`;
    USER_MESSAGES_QUERY = `
  SELECT
    json_extract(value, '$.conversationId') as conversation_id,
    json_extract(value, '$.createdAt') as created_at,
    substr(json_extract(value, '$.text'), 1, 500) as text
  FROM cursorDiskKV
  WHERE key LIKE 'bubbleId:%'
    AND json_extract(value, '$.type') = 1
    AND json_extract(value, '$.createdAt') > ?
  ORDER BY json_extract(value, '$.createdAt') ASC
`;
    BUBBLE_QUERY_SINCE = BUBBLE_QUERY_BASE + `
    AND json_extract(value, '$.createdAt') > ?
  ORDER BY json_extract(value, '$.createdAt') ASC
`;
    cursor = createCursorProvider();
  }
});

// src/providers/opencode.ts
var opencode_exports = {};
__export(opencode_exports, {
  createOpenCodeProvider: () => createOpenCodeProvider,
  opencode: () => opencode
});
import { readdir as readdir6 } from "fs/promises";
import { join as join12 } from "path";
import { homedir as homedir11 } from "os";
function sanitize(dir) {
  return dir.replace(/^\//, "").replace(/\//g, "-");
}
function getDataDir(dataDir) {
  const base = dataDir ?? process.env["XDG_DATA_HOME"] ?? join12(homedir11(), ".local", "share");
  return join12(base, "opencode");
}
async function findDbFiles(dir) {
  try {
    const entries = await readdir6(dir);
    return entries.filter((f) => f.startsWith("opencode") && f.endsWith(".db")).map((f) => join12(dir, f));
  } catch {
    return [];
  }
}
function parseTimestamp(raw) {
  const ms = raw < 1e12 ? raw * 1e3 : raw;
  return new Date(ms).toISOString();
}
function validateSchema2(db) {
  try {
    db.query(
      "SELECT COUNT(*) as cnt FROM session LIMIT 1"
    );
    db.query(
      "SELECT COUNT(*) as cnt FROM message LIMIT 1"
    );
    return true;
  } catch {
    return false;
  }
}
function createParser5(source, seenKeys) {
  return {
    async *parse() {
      if (!isSqliteAvailable()) {
        process.stderr.write(getSqliteLoadError() + "\n");
        return;
      }
      const segments = source.path.split(":");
      const sessionId = segments[segments.length - 1];
      const dbPath = segments.slice(0, -1).join(":");
      let db;
      try {
        db = openDatabase(dbPath);
      } catch (err) {
        process.stderr.write(`codeburn: cannot open OpenCode database: ${err instanceof Error ? err.message : err}
`);
        return;
      }
      try {
        if (!validateSchema2(db)) {
          process.stderr.write("codeburn: OpenCode storage format not recognized. You may need to update CodeBurn.\n");
          return;
        }
        const messages = db.query(
          "SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created ASC",
          [sessionId]
        );
        const parts = db.query(
          "SELECT message_id, data FROM part WHERE session_id = ? ORDER BY message_id, id",
          [sessionId]
        );
        const partsByMsg = /* @__PURE__ */ new Map();
        for (const part of parts) {
          try {
            const parsed = JSON.parse(part.data);
            const list = partsByMsg.get(part.message_id) ?? [];
            list.push(parsed);
            partsByMsg.set(part.message_id, list);
          } catch {
          }
        }
        let currentUserMessage = "";
        for (const msg of messages) {
          let data;
          try {
            data = JSON.parse(msg.data);
          } catch {
            continue;
          }
          if (data.role === "user") {
            const textParts = (partsByMsg.get(msg.id) ?? []).filter((p) => p.type === "text").map((p) => p.text ?? "").filter(Boolean);
            if (textParts.length > 0) {
              currentUserMessage = textParts.join(" ");
            }
            continue;
          }
          if (data.role !== "assistant") continue;
          const tokens = {
            input: data.tokens?.input ?? 0,
            output: data.tokens?.output ?? 0,
            reasoning: data.tokens?.reasoning ?? 0,
            cacheRead: data.tokens?.cache?.read ?? 0,
            cacheWrite: data.tokens?.cache?.write ?? 0
          };
          const allZero = tokens.input === 0 && tokens.output === 0 && tokens.reasoning === 0 && tokens.cacheRead === 0 && tokens.cacheWrite === 0;
          if (allZero && (data.cost ?? 0) === 0) continue;
          const msgParts = partsByMsg.get(msg.id) ?? [];
          const toolParts = msgParts.filter((p) => p.type === "tool");
          const tools = toolParts.map((p) => toolNameMap4[p.tool ?? ""] ?? p.tool ?? "").filter(Boolean);
          const bashCommands = toolParts.filter((p) => p.tool === "bash" && typeof p.state?.input?.command === "string").flatMap((p) => extractBashCommands(p.state.input.command));
          const dedupKey = `opencode:${sessionId}:${msg.id}`;
          if (seenKeys.has(dedupKey)) continue;
          seenKeys.add(dedupKey);
          const model = data.modelID ?? "unknown";
          let costUSD = calculateCost(
            model,
            tokens.input,
            tokens.output + tokens.reasoning,
            tokens.cacheWrite,
            tokens.cacheRead,
            0
          );
          if (costUSD === 0 && typeof data.cost === "number" && data.cost > 0) {
            costUSD = data.cost;
          }
          yield {
            provider: "opencode",
            model,
            inputTokens: tokens.input,
            outputTokens: tokens.output,
            cacheCreationInputTokens: tokens.cacheWrite,
            cacheReadInputTokens: tokens.cacheRead,
            cachedInputTokens: tokens.cacheRead,
            reasoningTokens: tokens.reasoning,
            webSearchRequests: 0,
            costUSD,
            tools,
            bashCommands,
            timestamp: parseTimestamp(msg.time_created),
            speed: "standard",
            deduplicationKey: dedupKey,
            userMessage: currentUserMessage,
            sessionId
          };
        }
      } finally {
        db.close();
      }
    }
  };
}
async function discoverFromDb(dbPath) {
  let db;
  try {
    db = openDatabase(dbPath);
  } catch {
    return [];
  }
  try {
    const rows = db.query(
      "SELECT id, directory, title, time_created FROM session WHERE time_archived IS NULL AND parent_id IS NULL ORDER BY time_created DESC"
    );
    return rows.map((row) => ({
      path: `${dbPath}:${row.id}`,
      project: row.directory ? sanitize(row.directory) : sanitize(row.title),
      provider: "opencode"
    }));
  } catch {
    return [];
  } finally {
    db.close();
  }
}
function createOpenCodeProvider(dataDir) {
  const dir = getDataDir(dataDir);
  return {
    name: "opencode",
    displayName: "OpenCode",
    modelDisplayName(model) {
      const stripped = model.replace(/^[^/]+\//, "");
      return getShortModelName(stripped);
    },
    toolDisplayName(rawTool) {
      return toolNameMap4[rawTool] ?? rawTool;
    },
    async discoverSessions() {
      if (!isSqliteAvailable()) return [];
      const dbPaths = await findDbFiles(dir);
      if (dbPaths.length === 0) return [];
      const sessions = [];
      for (const dbPath of dbPaths) {
        sessions.push(...await discoverFromDb(dbPath));
      }
      return sessions;
    },
    createSessionParser(source, seenKeys) {
      return createParser5(source, seenKeys);
    }
  };
}
var toolNameMap4, opencode;
var init_opencode = __esm({
  "src/providers/opencode.ts"() {
    "use strict";
    init_models();
    init_bash_utils();
    init_sqlite();
    toolNameMap4 = {
      bash: "Bash",
      read: "Read",
      edit: "Edit",
      write: "Write",
      glob: "Glob",
      grep: "Grep",
      task: "Agent",
      fetch: "WebFetch",
      search: "WebSearch",
      todo: "TodoWrite",
      skill: "Skill",
      patch: "Patch"
    };
    opencode = createOpenCodeProvider();
  }
});

// src/providers/cursor-agent.ts
var cursor_agent_exports = {};
__export(cursor_agent_exports, {
  createCursorAgentProvider: () => createCursorAgentProvider,
  cursor_agent: () => cursor_agent
});
import { createHash } from "crypto";
import { existsSync as existsSync2 } from "fs";
import { readdir as readdir7, readFile as readFile6, stat as stat9 } from "fs/promises";
import { join as join13, basename as basename6 } from "path";
import { homedir as homedir12 } from "os";
function getCursorAgentBaseDir(baseDirOverride) {
  if (baseDirOverride) return baseDirOverride;
  return join13(homedir12(), ".cursor");
}
function getProjectsDir2(baseDir) {
  return join13(baseDir, "projects");
}
function getAttributionDbPath(baseDir) {
  return join13(baseDir, "ai-tracking", "ai-code-tracking.db");
}
function estimateTokens(charCount) {
  if (charCount <= 0) return 0;
  return Math.ceil(charCount / CHARS_PER_TOKEN2);
}
function parseToolName(raw) {
  const clean = raw.trim();
  if (clean.length === 0) return "unknown";
  return clean.toLowerCase().replace(/\s+/g, "-");
}
function normalizeTimestamp(raw) {
  if (raw === null || raw === void 0) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    if (DIGITS_ONLY.test(trimmed)) {
      const num = Number(trimmed);
      if (!Number.isNaN(num)) {
        const ms2 = num < 1e12 ? num * 1e3 : num;
        return new Date(ms2).toISOString();
      }
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    return null;
  }
  const ms = raw < 1e12 ? raw * 1e3 : raw;
  return new Date(ms).toISOString();
}
function prettifyProjectId(raw) {
  if (!raw) return raw;
  if (DIGITS_ONLY.test(raw)) {
    const num = Number(raw);
    if (!Number.isNaN(num) && raw.length >= 13) {
      const iso = new Date(num).toISOString();
      return `cursor-agent:${iso}`;
    }
  }
  const withoutPrefix = raw.replace(/^-Users-/, "");
  const parts = withoutPrefix.split("-").filter(Boolean);
  if (parts.length > 0) return parts[parts.length - 1];
  return raw;
}
function resolveModel3(raw) {
  if (!raw || raw === "default") return CURSOR_AGENT_DEFAULT_MODEL;
  return raw;
}
function toConversationId(transcriptPath) {
  const filename = basename6(transcriptPath, ".txt");
  if (filename.length === 36 && UUID_LIKE.test(filename)) return filename;
  return createHash("sha1").update(transcriptPath).digest("hex").slice(0, 16);
}
function extractUserQuery(userBlock) {
  const chunks = [];
  let cursor2 = 0;
  while (cursor2 < userBlock.length) {
    const openIndex = userBlock.indexOf(USER_QUERY_OPEN, cursor2);
    if (openIndex === -1) break;
    const start = openIndex + USER_QUERY_OPEN.length;
    const closeIndex = userBlock.indexOf(USER_QUERY_CLOSE, start);
    if (closeIndex === -1) {
      chunks.push(userBlock.slice(start).trim());
      break;
    }
    chunks.push(userBlock.slice(start, closeIndex).trim());
    cursor2 = closeIndex + USER_QUERY_CLOSE.length;
  }
  const combined = chunks.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return combined.slice(0, MAX_USER_TEXT_LENGTH);
}
function parseJsonlTranscript(raw) {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { turns: [], recognized: false };
  const turns = [];
  let currentUserMessage = "";
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.role === "user") {
      const texts = (entry.message?.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "");
      const combined = texts.join(" ");
      currentUserMessage = extractUserQuery(combined) || combined.slice(0, MAX_USER_TEXT_LENGTH);
      continue;
    }
    if (entry.role === "assistant" && currentUserMessage) {
      const content = entry.message?.content ?? [];
      const bodyParts = [];
      const tools = [];
      for (const block of content) {
        if (block.type === "text" && block.text) {
          bodyParts.push(block.text);
        } else if (block.type === "tool_use" && block.name) {
          tools.push(`cursor:${block.name.toLowerCase()}`);
        }
      }
      turns.push({
        userMessage: currentUserMessage,
        assistant: {
          body: bodyParts.join("\n").trim(),
          reasoning: "",
          tools
        }
      });
      currentUserMessage = "";
    }
  }
  return { turns, recognized: turns.length > 0 };
}
function parseTranscript(raw) {
  const lines = raw.split(/\r?\n/);
  let recognized = false;
  const pendingUsers = [];
  const turns = [];
  let active2 = "none";
  let userLines = [];
  let assistantLines = [];
  const flushUser = () => {
    if (userLines.length === 0) return;
    const userQuery = extractUserQuery(userLines.join("\n"));
    if (userQuery.length > 0) pendingUsers.push(userQuery);
    userLines = [];
  };
  const flushAssistant = () => {
    if (assistantLines.length === 0) return;
    let output = "";
    let reasoning = "";
    const toolsByTurn = /* @__PURE__ */ Object.create(null);
    for (const line of assistantLines) {
      if (TOOL_RESULT_MARKER.test(line)) continue;
      const thinkingMatch = line.match(THINKING_MARKER);
      if (thinkingMatch) {
        const body = line.replace(THINKING_MARKER, "").trim();
        if (body.length > 0) reasoning += `${body}
`;
        continue;
      }
      const toolMatch = line.match(TOOL_CALL_MARKER);
      if (toolMatch) {
        const parsedTool = parseToolName(toolMatch[1] ?? "");
        const toolKey = `cursor:${parsedTool}`;
        toolsByTurn[toolKey] = true;
        continue;
      }
      output += `${line}
`;
    }
    if (pendingUsers.length > 0) {
      const userMessage = pendingUsers.shift();
      const tools = Object.keys(toolsByTurn);
      turns.push({
        userMessage,
        assistant: {
          body: output.trim(),
          reasoning: reasoning.trim(),
          tools
        }
      });
    }
    assistantLines = [];
  };
  for (const line of lines) {
    if (USER_MARKER.test(line)) {
      recognized = true;
      if (active2 === "user") flushUser();
      if (active2 === "assistant") flushAssistant();
      active2 = "user";
      userLines = [line.replace(USER_MARKER, "")];
      continue;
    }
    if (ASSISTANT_MARKER.test(line)) {
      recognized = true;
      if (active2 === "user") flushUser();
      if (active2 === "assistant") flushAssistant();
      active2 = "assistant";
      assistantLines = [line.replace(ASSISTANT_MARKER, "")];
      continue;
    }
    if (active2 === "user") {
      userLines.push(line);
      continue;
    }
    if (active2 === "assistant") {
      assistantLines.push(line);
    }
  }
  if (active2 === "user") flushUser();
  if (active2 === "assistant") flushAssistant();
  return { turns, recognized };
}
function createParser6(source, seenKeys, dbPath, summariesByConversationId) {
  return {
    async *parse() {
      const conversationId = toConversationId(source.path);
      let summary = summariesByConversationId[conversationId];
      let db = null;
      try {
        if (!summary) {
          if (existsSync2(dbPath)) {
            try {
              db = openDatabase(dbPath);
              const rows = db.query(CONVERSATION_SUMMARY_QUERY, [conversationId]);
              if (rows.length > 0) {
                const row = rows[0];
                summary = {
                  conversationId: row.conversationId,
                  model: row.model,
                  title: row.title,
                  updatedAt: normalizeTimestamp(row.updatedAt)
                };
                summariesByConversationId[conversationId] = summary;
              }
            } catch {
              summary = void 0;
            }
          }
        }
        const transcript = await readFile6(source.path, "utf-8");
        const isJsonl = source.path.endsWith(".jsonl");
        const parsed = isJsonl ? parseJsonlTranscript(transcript) : parseTranscript(transcript);
        if (!parsed.recognized) {
          process.stderr.write(`codeburn: skipped ${basename6(source.path)}: unrecognized cursor-agent transcript format
`);
          return;
        }
        let timestamp = summary?.updatedAt ?? null;
        if (!timestamp) {
          const fileStat = await stat9(source.path);
          timestamp = fileStat.mtime.toISOString();
        }
        const model = resolveModel3(summary?.model ?? null);
        for (let turnIndex = 0; turnIndex < parsed.turns.length; turnIndex++) {
          const turn = parsed.turns[turnIndex];
          const inputTokens = estimateTokens(turn.userMessage.length);
          const outputTokens = estimateTokens(turn.assistant.body.length);
          const reasoningTokens = estimateTokens(turn.assistant.reasoning.length);
          const deduplicationKey = `cursor-agent:${conversationId}:${turnIndex}`;
          if (seenKeys.has(deduplicationKey)) continue;
          seenKeys.add(deduplicationKey);
          const costUSD = calculateCost(
            model,
            inputTokens,
            outputTokens + reasoningTokens,
            0,
            0,
            0
          );
          yield {
            provider: "cursor-agent",
            model,
            inputTokens,
            outputTokens,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            cachedInputTokens: 0,
            reasoningTokens,
            webSearchRequests: 0,
            costUSD,
            tools: turn.assistant.tools,
            bashCommands: [],
            timestamp,
            speed: "standard",
            deduplicationKey,
            userMessage: turn.userMessage,
            sessionId: conversationId
          };
        }
      } finally {
        db?.close();
      }
    }
  };
}
function createCursorAgentProvider(baseDirOverride) {
  const baseDir = getCursorAgentBaseDir(baseDirOverride);
  const projectsDir = getProjectsDir2(baseDir);
  const dbPath = getAttributionDbPath(baseDir);
  const summariesByConversationId = /* @__PURE__ */ Object.create(null);
  return {
    name: "cursor-agent",
    displayName: "Cursor Agent",
    modelDisplayName(model) {
      if (model === "default") return modelDisplayNames5.default;
      const label = modelDisplayNames5[model] ?? model;
      return `${label} (est.)`;
    },
    toolDisplayName(rawTool) {
      return rawTool;
    },
    async discoverSessions() {
      if (!existsSync2(projectsDir)) return [];
      const projectEntries = await readdir7(projectsDir, { withFileTypes: true });
      const sources = [];
      for (const entry of projectEntries) {
        if (!entry.isDirectory()) continue;
        const projectId = prettifyProjectId(entry.name);
        const transcriptDir = join13(projectsDir, entry.name, "agent-transcripts");
        if (!existsSync2(transcriptDir)) continue;
        const transcriptEntries = await readdir7(transcriptDir, { withFileTypes: true });
        for (const transcript of transcriptEntries) {
          if (transcript.isFile() && transcript.name.endsWith(".txt")) {
            const transcriptPath = join13(transcriptDir, transcript.name);
            sources.push({
              path: transcriptPath,
              project: projectId,
              provider: "cursor-agent"
            });
            continue;
          }
          if (transcript.isDirectory() && UUID_LIKE.test(transcript.name)) {
            const subdir = join13(transcriptDir, transcript.name);
            const subEntries = await readdir7(subdir, { withFileTypes: true }).catch(() => []);
            for (const sub of subEntries) {
              if (!sub.isFile()) continue;
              if (!sub.name.endsWith(".jsonl") && !sub.name.endsWith(".txt")) continue;
              const filePath = join13(subdir, sub.name);
              sources.push({
                path: filePath,
                project: projectId,
                provider: "cursor-agent"
              });
            }
          }
        }
      }
      return sources;
    },
    createSessionParser(source, seenKeys) {
      return createParser6(source, seenKeys, dbPath, summariesByConversationId);
    }
  };
}
var CURSOR_AGENT_DEFAULT_MODEL, CHARS_PER_TOKEN2, MAX_USER_TEXT_LENGTH, DIGITS_ONLY, UUID_LIKE, USER_MARKER, ASSISTANT_MARKER, THINKING_MARKER, TOOL_CALL_MARKER, TOOL_RESULT_MARKER, USER_QUERY_OPEN, USER_QUERY_CLOSE, CONVERSATION_SUMMARY_QUERY, modelDisplayNames5, cursor_agent;
var init_cursor_agent = __esm({
  "src/providers/cursor-agent.ts"() {
    "use strict";
    init_models();
    init_sqlite();
    CURSOR_AGENT_DEFAULT_MODEL = "claude-sonnet-4-5";
    CHARS_PER_TOKEN2 = 4;
    MAX_USER_TEXT_LENGTH = 500;
    DIGITS_ONLY = /^\d+$/;
    UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    USER_MARKER = /^\s*user:\s*/i;
    ASSISTANT_MARKER = /^\s*A:\s*/;
    THINKING_MARKER = /^\s*\[Thinking\]\s*/;
    TOOL_CALL_MARKER = /^\s*\[Tool call\]\s*(.+?)\s*$/i;
    TOOL_RESULT_MARKER = /^\s*\[Tool result\]\b/i;
    USER_QUERY_OPEN = "<user_query>";
    USER_QUERY_CLOSE = "</user_query>";
    CONVERSATION_SUMMARY_QUERY = `
  SELECT conversationId, model, title, updatedAt
  FROM conversation_summaries
  WHERE conversationId = ?
`;
    modelDisplayNames5 = {
      "claude-4.5-opus-high-thinking": "Opus 4.5 (Thinking)",
      "claude-4-opus": "Opus 4",
      "claude-4-sonnet-thinking": "Sonnet 4 (Thinking)",
      "claude-4.5-sonnet-thinking": "Sonnet 4.5 (Thinking)",
      "claude-4.6-sonnet": "Sonnet 4.6",
      "composer-1": "Composer 1",
      "grok-code-fast-1": "Grok Code Fast",
      "gemini-3-pro": "Gemini 3 Pro",
      "gpt-5.1-codex-high": "GPT-5.1 Codex",
      "gpt-5": "GPT-5",
      "gpt-4.1": "GPT-4.1",
      default: "Auto (Sonnet est.)"
    };
    cursor_agent = createCursorAgentProvider();
  }
});

// src/providers/index.ts
async function loadCursor() {
  if (cursorLoadAttempted) return cursorProvider;
  cursorLoadAttempted = true;
  try {
    const { cursor: cursor2 } = await Promise.resolve().then(() => (init_cursor(), cursor_exports));
    cursorProvider = cursor2;
    return cursor2;
  } catch {
    return null;
  }
}
async function loadOpenCode() {
  if (opencodeLoadAttempted) return opencodeProvider;
  opencodeLoadAttempted = true;
  try {
    const { opencode: opencode2 } = await Promise.resolve().then(() => (init_opencode(), opencode_exports));
    opencodeProvider = opencode2;
    return opencode2;
  } catch {
    return null;
  }
}
async function loadCursorAgent() {
  if (cursorAgentLoadAttempted) return cursorAgentProvider;
  cursorAgentLoadAttempted = true;
  try {
    const { cursor_agent: cursor_agent2 } = await Promise.resolve().then(() => (init_cursor_agent(), cursor_agent_exports));
    cursorAgentProvider = cursor_agent2;
    return cursor_agent2;
  } catch {
    return null;
  }
}
async function getAllProviders() {
  const [cursor2, opencode2, cursorAgent] = await Promise.all([loadCursor(), loadOpenCode(), loadCursorAgent()]);
  const all = [...coreProviders];
  if (cursor2) all.push(cursor2);
  if (opencode2) all.push(opencode2);
  if (cursorAgent) all.push(cursorAgent);
  return all;
}
async function discoverAllSessions(providerFilter) {
  const allProviders = await getAllProviders();
  const filtered = providerFilter && providerFilter !== "all" ? allProviders.filter((p) => p.name === providerFilter) : allProviders;
  const all = [];
  for (const provider of filtered) {
    const sessions = await provider.discoverSessions();
    all.push(...sessions);
  }
  return all;
}
async function getProvider(name) {
  if (name === "cursor") {
    const cursor2 = await loadCursor();
    return cursor2 ?? void 0;
  }
  if (name === "opencode") {
    const oc = await loadOpenCode();
    return oc ?? void 0;
  }
  if (name === "cursor-agent") {
    const ca = await loadCursorAgent();
    return ca ?? void 0;
  }
  return coreProviders.find((p) => p.name === name);
}
var cursorProvider, cursorLoadAttempted, opencodeProvider, opencodeLoadAttempted, cursorAgentProvider, cursorAgentLoadAttempted, coreProviders;
var init_providers = __esm({
  "src/providers/index.ts"() {
    "use strict";
    init_claude();
    init_codex();
    init_copilot();
    init_pi();
    cursorProvider = null;
    cursorLoadAttempted = false;
    opencodeProvider = null;
    opencodeLoadAttempted = false;
    cursorAgentProvider = null;
    cursorAgentLoadAttempted = false;
    coreProviders = [claude, codex, copilot, pi, omp];
  }
});

// src/tool-result-classifier.ts
function isToolResultBlock(b) {
  return !!b && typeof b === "object" && b.type === "tool_result";
}
function toolResultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter(
      (b) => !!b && typeof b === "object" && b.type === "text" && typeof b.text === "string"
    ).map((b) => b.text).join("\n");
  }
  return "";
}
function classifyToolResult(block) {
  const text = toolResultText(block.content);
  if (DENIAL_RE.test(text)) return { category: "denial", text };
  if (!block.is_error) return null;
  if (SIBLING_CASCADE_RE.test(text)) return { category: "sibling-cascade", text };
  return { category: "error", text };
}
function firstNonEmptyLine(s, maxLen = 200) {
  for (const raw of s.split("\n")) {
    const t = raw.trim();
    if (t) return t.length > maxLen ? t.slice(0, maxLen) + "\u2026" : t;
  }
  return "";
}
function errorSignature(tool, firstLine) {
  const norm = firstLine.replace(/(?:[\w.@~-]+)?\/(?:[^\s/'":]+\/)*[^\s/'":]+/g, "<path>").replace(/\b\d+\b/g, "N").slice(0, 120);
  return `${tool} | ${norm}`;
}
function truncateCorrectionText(text, max = MAX_CORRECTION_TEXT_LEN) {
  return text.length > max ? text.slice(0, max) + "\u2026" : text;
}
var SIBLING_CASCADE_RE, DENIAL_RE, MAX_CORRECTION_TEXT_LEN;
var init_tool_result_classifier = __esm({
  "src/tool-result-classifier.ts"() {
    "use strict";
    SIBLING_CASCADE_RE = /sibling tool call errored/i;
    DENIAL_RE = /(permission denied|doesn['’]t want to proceed|is not allowed by user|tool use was rejected|user rejected the tool call|user (?:has )?denied|tool denied)/i;
    MAX_CORRECTION_TEXT_LEN = 4e3;
  }
});

// src/classifier.ts
function hasEditTools(tools) {
  return tools.some((t) => EDIT_TOOLS.has(t));
}
function hasReadTools(tools) {
  return tools.some((t) => READ_TOOLS.has(t));
}
function hasBashTool(tools) {
  return tools.some((t) => BASH_TOOLS.has(t));
}
function hasTaskTools(tools) {
  return tools.some((t) => TASK_TOOLS.has(t));
}
function hasSearchTools(tools) {
  return tools.some((t) => SEARCH_TOOLS.has(t));
}
function hasMcpTools(tools) {
  return tools.some((t) => t.startsWith("mcp__"));
}
function hasSkillTool(tools) {
  return tools.some((t) => t === "Skill");
}
function getAllTools(turn) {
  return turn.assistantCalls.flatMap((c) => c.tools);
}
function classifyByToolPattern(turn) {
  const tools = getAllTools(turn);
  if (tools.length === 0) return null;
  if (turn.assistantCalls.some((c) => c.hasPlanMode)) return "planning";
  if (turn.assistantCalls.some((c) => c.hasAgentSpawn)) return "delegation";
  const hasEdits = hasEditTools(tools);
  const hasReads = hasReadTools(tools);
  const hasBash = hasBashTool(tools);
  const hasTasks = hasTaskTools(tools);
  const hasSearch = hasSearchTools(tools);
  const hasMcp = hasMcpTools(tools);
  const hasSkill = hasSkillTool(tools);
  if (hasBash && !hasEdits) {
    const userMsg = turn.userMessage;
    if (TEST_PATTERNS.test(userMsg)) return "testing";
    if (GIT_PATTERNS.test(userMsg)) return "git";
    if (BUILD_PATTERNS.test(userMsg)) return "build/deploy";
    if (INSTALL_PATTERNS.test(userMsg)) return "build/deploy";
  }
  if (hasEdits) return "coding";
  if (hasBash && hasReads) return "exploration";
  if (hasBash) return "coding";
  if (hasSearch || hasMcp) return "exploration";
  if (hasReads && !hasEdits) return "exploration";
  if (hasTasks && !hasEdits) return "planning";
  if (hasSkill) return "general";
  return null;
}
function refineByKeywords(category, userMessage) {
  if (category === "coding") {
    if (DEBUG_KEYWORDS.test(userMessage)) return "debugging";
    if (REFACTOR_KEYWORDS.test(userMessage)) return "refactoring";
    if (FEATURE_KEYWORDS.test(userMessage)) return "feature";
    return "coding";
  }
  if (category === "exploration") {
    if (RESEARCH_KEYWORDS.test(userMessage)) return "exploration";
    if (DEBUG_KEYWORDS.test(userMessage)) return "debugging";
    return "exploration";
  }
  return category;
}
function classifyConversation(userMessage) {
  if (BRAINSTORM_KEYWORDS.test(userMessage)) return "brainstorming";
  if (RESEARCH_KEYWORDS.test(userMessage)) return "exploration";
  if (DEBUG_KEYWORDS.test(userMessage)) return "debugging";
  if (FEATURE_KEYWORDS.test(userMessage)) return "feature";
  if (FILE_PATTERNS.test(userMessage)) return "coding";
  if (SCRIPT_PATTERNS.test(userMessage)) return "coding";
  if (URL_PATTERN.test(userMessage)) return "exploration";
  return "conversation";
}
function countRetries(turn) {
  let sawEditBeforeBash = false;
  let sawBashAfterEdit = false;
  let retries = 0;
  for (const call of turn.assistantCalls) {
    const hasEdit = call.tools.some((t) => EDIT_TOOLS.has(t));
    const hasBash = call.tools.some((t) => BASH_TOOLS.has(t));
    if (hasEdit) {
      if (sawBashAfterEdit) retries++;
      sawEditBeforeBash = true;
      sawBashAfterEdit = false;
    }
    if (hasBash && sawEditBeforeBash) {
      sawBashAfterEdit = true;
    }
  }
  return retries;
}
function turnHasEdits(turn) {
  return turn.assistantCalls.some((c) => c.tools.some((t) => EDIT_TOOLS.has(t)));
}
function classifyTurn(turn) {
  const tools = getAllTools(turn);
  let category;
  if (tools.length === 0) {
    category = classifyConversation(turn.userMessage);
  } else {
    const toolCategory = classifyByToolPattern(turn);
    if (toolCategory) {
      category = refineByKeywords(toolCategory, turn.userMessage);
    } else {
      category = classifyConversation(turn.userMessage);
    }
  }
  return { ...turn, category, retries: countRetries(turn), hasEdits: turnHasEdits(turn) };
}
var TEST_PATTERNS, GIT_PATTERNS, BUILD_PATTERNS, INSTALL_PATTERNS, DEBUG_KEYWORDS, FEATURE_KEYWORDS, REFACTOR_KEYWORDS, BRAINSTORM_KEYWORDS, RESEARCH_KEYWORDS, FILE_PATTERNS, SCRIPT_PATTERNS, URL_PATTERN, EDIT_TOOLS, READ_TOOLS, BASH_TOOLS, TASK_TOOLS, SEARCH_TOOLS;
var init_classifier = __esm({
  "src/classifier.ts"() {
    "use strict";
    TEST_PATTERNS = /\b(test|pytest|vitest|jest|mocha|spec|coverage|npm\s+test|npx\s+vitest|npx\s+jest)\b/i;
    GIT_PATTERNS = /\bgit\s+(push|pull|commit|merge|rebase|checkout|branch|stash|log|diff|status|add|reset|cherry-pick|tag)\b/i;
    BUILD_PATTERNS = /\b(npm\s+run\s+build|npm\s+publish|pip\s+install|docker|deploy|make\s+build|npm\s+run\s+dev|npm\s+start|pm2|systemctl|brew|cargo\s+build)\b/i;
    INSTALL_PATTERNS = /\b(npm\s+install|pip\s+install|brew\s+install|apt\s+install|cargo\s+add)\b/i;
    DEBUG_KEYWORDS = /\b(fix|bug|error|broken|failing|crash|issue|debug|traceback|exception|stack\s*trace|not\s+working|wrong|unexpected|status\s+code|404|500|401|403)\b/i;
    FEATURE_KEYWORDS = /\b(add|create|implement|new|build|feature|introduce|set\s*up|scaffold|generate|make\s+(?:a|me|the)|write\s+(?:a|me|the))\b/i;
    REFACTOR_KEYWORDS = /\b(refactor|clean\s*up|rename|reorganize|simplify|extract|restructure|move|migrate|split)\b/i;
    BRAINSTORM_KEYWORDS = /\b(brainstorm|idea|what\s+if|explore|think\s+about|approach|strategy|design|consider|how\s+should|what\s+would|opinion|suggest|recommend)\b/i;
    RESEARCH_KEYWORDS = /\b(research|investigate|look\s+into|find\s+out|check|search|analyze|review|understand|explain|how\s+does|what\s+is|show\s+me|list|compare)\b/i;
    FILE_PATTERNS = /\.(py|js|ts|tsx|jsx|json|yaml|yml|toml|sql|sh|go|rs|java|rb|php|css|html|md|csv|xml)\b/i;
    SCRIPT_PATTERNS = /\b(run\s+\S+\.\w+|execute|scrip?t|curl|api\s+\S+|endpoint|request\s+url|fetch\s+\S+|query|database|db\s+\S+)\b/i;
    URL_PATTERN = /https?:\/\/\S+/i;
    EDIT_TOOLS = /* @__PURE__ */ new Set(["Edit", "Write", "FileEditTool", "FileWriteTool", "NotebookEdit", "cursor:edit"]);
    READ_TOOLS = /* @__PURE__ */ new Set(["Read", "Grep", "Glob", "FileReadTool", "GrepTool", "GlobTool"]);
    BASH_TOOLS = /* @__PURE__ */ new Set(["Bash", "BashTool", "PowerShellTool"]);
    TASK_TOOLS = /* @__PURE__ */ new Set(["TaskCreate", "TaskUpdate", "TaskGet", "TaskList", "TaskOutput", "TaskStop", "TodoWrite"]);
    SEARCH_TOOLS = /* @__PURE__ */ new Set(["WebSearch", "WebFetch", "ToolSearch"]);
  }
});

// src/parser.ts
import { readdir as readdir9, stat as stat11 } from "fs/promises";
import { basename as basename8, join as join15 } from "path";
function unsanitizePath2(dirName) {
  return dirName.replace(/-/g, "/");
}
function parseJsonlLine2(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
function extractToolNames(content) {
  return content.filter((b) => b.type === "tool_use").map((b) => b.name);
}
function extractMcpTools(tools) {
  return tools.filter((t) => t.startsWith("mcp__"));
}
function extractCoreTools(tools) {
  return tools.filter((t) => !t.startsWith("mcp__"));
}
function extractBashCommandsFromContent(content) {
  return content.filter((b) => b.type === "tool_use" && BASH_TOOLS.has(b.name)).flatMap((b) => {
    const command = b.input?.command;
    return typeof command === "string" ? extractBashCommands(command) : [];
  });
}
function getUserMessageText(entry) {
  if (!entry.message || entry.message.role !== "user") return "";
  const content = entry.message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
  }
  return "";
}
function getMessageId(entry) {
  if (entry.type !== "assistant") return null;
  const msg = entry.message;
  return msg?.id ?? null;
}
function emptyToolErrorAggregates() {
  return { perTool: /* @__PURE__ */ Object.create(null), patterns: /* @__PURE__ */ new Map() };
}
function tallyToolEvent(agg, tool, event) {
  const stats = agg.perTool[tool] ?? { errors: 0, denials: 0, siblingCascadeErrors: 0 };
  if (event.category === "denial") stats.denials++;
  else if (event.category === "sibling-cascade") stats.siblingCascadeErrors++;
  else stats.errors++;
  agg.perTool[tool] = stats;
  if (event.category === "denial") return;
  const firstLine = firstNonEmptyLine(event.text);
  if (!firstLine) return;
  const sig = errorSignature(tool, firstLine);
  const existing = agg.patterns.get(sig);
  if (existing) existing.count++;
  else agg.patterns.set(sig, { tool, signature: sig, count: 1, example: firstLine });
}
function extractToolErrors(entries) {
  const agg = emptyToolErrorAggregates();
  const toolNameById = /* @__PURE__ */ new Map();
  const seenResultIds = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    if (entry.type === "assistant") {
      const msg = entry.message;
      for (const b of msg?.content ?? []) {
        if (b.type === "tool_use") {
          const tu = b;
          if (tu.id && tu.name) toolNameById.set(tu.id, tu.name);
        }
      }
      continue;
    }
    if (entry.type !== "user" || !entry.message) continue;
    const content = entry.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!isToolResultBlock(b)) continue;
      const id = b.tool_use_id;
      if (!id || seenResultIds.has(id)) continue;
      seenResultIds.add(id);
      const event = classifyToolResult(b);
      if (!event) continue;
      const tool = toolNameById.get(id) ?? "unknown";
      tallyToolEvent(agg, tool, event);
    }
  }
  return agg;
}
function parseApiCall(entry) {
  if (entry.type !== "assistant") return null;
  const msg = entry.message;
  if (!msg?.usage || !msg?.model) return null;
  const usage = msg.usage;
  const tokens = {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    webSearchRequests: usage.server_tool_use?.web_search_requests ?? 0
  };
  const tools = extractToolNames(msg.content ?? []);
  const costUSD = calculateCost(
    msg.model,
    tokens.inputTokens,
    tokens.outputTokens,
    tokens.cacheCreationInputTokens,
    tokens.cacheReadInputTokens,
    tokens.webSearchRequests,
    usage.speed ?? "standard"
  );
  const bashCmds = extractBashCommandsFromContent(msg.content ?? []);
  return {
    provider: "claude",
    model: msg.model,
    usage: tokens,
    costUSD,
    tools,
    mcpTools: extractMcpTools(tools),
    hasAgentSpawn: tools.includes("Agent"),
    hasPlanMode: tools.includes("EnterPlanMode"),
    speed: usage.speed ?? "standard",
    timestamp: entry.timestamp ?? "",
    bashCommands: bashCmds,
    deduplicationKey: msg.id ?? `claude:${entry.timestamp}`
  };
}
function groupIntoTurns(entries, seenMsgIds) {
  const turns = [];
  let currentUserMessage = "";
  let currentCalls = [];
  let currentTimestamp = "";
  let currentSessionId = "";
  for (const entry of entries) {
    if (entry.type === "user") {
      const text = getUserMessageText(entry);
      if (text.trim()) {
        if (currentCalls.length > 0) {
          turns.push({
            userMessage: currentUserMessage,
            assistantCalls: currentCalls,
            timestamp: currentTimestamp,
            sessionId: currentSessionId
          });
        }
        currentUserMessage = text;
        currentCalls = [];
        currentTimestamp = entry.timestamp ?? "";
        currentSessionId = entry.sessionId ?? "";
      }
    } else if (entry.type === "assistant") {
      const msgId = getMessageId(entry);
      if (msgId && seenMsgIds.has(msgId)) continue;
      if (msgId) seenMsgIds.add(msgId);
      const call = parseApiCall(entry);
      if (call) currentCalls.push(call);
    }
  }
  if (currentCalls.length > 0) {
    turns.push({
      userMessage: currentUserMessage,
      assistantCalls: currentCalls,
      timestamp: currentTimestamp,
      sessionId: currentSessionId
    });
  }
  return turns;
}
function buildSessionSummary(sessionId, project, turns, toolErrors, gitBranch) {
  const modelBreakdown = /* @__PURE__ */ Object.create(null);
  const toolBreakdown = /* @__PURE__ */ Object.create(null);
  const mcpBreakdown = /* @__PURE__ */ Object.create(null);
  const bashBreakdown = /* @__PURE__ */ Object.create(null);
  const categoryBreakdown = /* @__PURE__ */ Object.create(null);
  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let apiCalls = 0;
  let firstTs = "";
  let lastTs = "";
  for (const turn of turns) {
    const turnCost = turn.assistantCalls.reduce((s, c) => s + c.costUSD, 0);
    if (!categoryBreakdown[turn.category]) {
      categoryBreakdown[turn.category] = { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 };
    }
    categoryBreakdown[turn.category].turns++;
    categoryBreakdown[turn.category].costUSD += turnCost;
    if (turn.hasEdits) {
      categoryBreakdown[turn.category].editTurns++;
      categoryBreakdown[turn.category].retries += turn.retries;
      if (turn.retries === 0) categoryBreakdown[turn.category].oneShotTurns++;
    }
    for (const call of turn.assistantCalls) {
      totalCost += call.costUSD;
      totalInput += call.usage.inputTokens;
      totalOutput += call.usage.outputTokens;
      totalCacheRead += call.usage.cacheReadInputTokens;
      totalCacheWrite += call.usage.cacheCreationInputTokens;
      apiCalls++;
      const modelKey = getShortModelName(call.model);
      if (!modelBreakdown[modelKey]) {
        modelBreakdown[modelKey] = {
          calls: 0,
          costUSD: 0,
          tokens: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, webSearchRequests: 0 }
        };
      }
      modelBreakdown[modelKey].calls++;
      modelBreakdown[modelKey].costUSD += call.costUSD;
      modelBreakdown[modelKey].tokens.inputTokens += call.usage.inputTokens;
      modelBreakdown[modelKey].tokens.outputTokens += call.usage.outputTokens;
      modelBreakdown[modelKey].tokens.cacheReadInputTokens += call.usage.cacheReadInputTokens;
      modelBreakdown[modelKey].tokens.cacheCreationInputTokens += call.usage.cacheCreationInputTokens;
      for (const tool of extractCoreTools(call.tools)) {
        toolBreakdown[tool] = toolBreakdown[tool] ?? { calls: 0 };
        toolBreakdown[tool].calls++;
      }
      for (const mcp of call.mcpTools) {
        const server = mcp.split("__")[1] ?? mcp;
        mcpBreakdown[server] = mcpBreakdown[server] ?? { calls: 0 };
        mcpBreakdown[server].calls++;
      }
      for (const cmd of call.bashCommands) {
        bashBreakdown[cmd] = bashBreakdown[cmd] ?? { calls: 0 };
        bashBreakdown[cmd].calls++;
      }
      if (!firstTs || call.timestamp < firstTs) firstTs = call.timestamp;
      if (!lastTs || call.timestamp > lastTs) lastTs = call.timestamp;
    }
  }
  if (toolErrors) {
    for (const [tool, stats] of Object.entries(toolErrors.perTool)) {
      const entry = toolBreakdown[tool] ?? { calls: 0 };
      entry.errors = (entry.errors ?? 0) + stats.errors;
      entry.denials = (entry.denials ?? 0) + stats.denials;
      entry.siblingCascadeErrors = (entry.siblingCascadeErrors ?? 0) + stats.siblingCascadeErrors;
      toolBreakdown[tool] = entry;
    }
  }
  const errorPatterns = toolErrors ? [...toolErrors.patterns.values()].sort((a, b) => b.count - a.count).slice(0, MAX_ERROR_PATTERNS_PER_SESSION) : void 0;
  return {
    sessionId,
    project,
    firstTimestamp: firstTs || turns[0]?.timestamp || "",
    lastTimestamp: lastTs || turns[turns.length - 1]?.timestamp || "",
    totalCostUSD: totalCost,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCacheReadTokens: totalCacheRead,
    totalCacheWriteTokens: totalCacheWrite,
    apiCalls,
    turns,
    modelBreakdown,
    toolBreakdown,
    mcpBreakdown,
    bashBreakdown,
    categoryBreakdown,
    errorPatterns,
    gitBranch
  };
}
async function parseSessionFile(filePath, project, seenMsgIds, dateRange) {
  if (dateRange) {
    try {
      const s = await stat11(filePath);
      if (s.mtimeMs < dateRange.start.getTime()) return null;
    } catch {
    }
  }
  const entries = [];
  let hasLines = false;
  for await (const line of readSessionLines(filePath)) {
    hasLines = true;
    const entry = parseJsonlLine2(line);
    if (entry) entries.push(entry);
  }
  if (!hasLines) return null;
  if (entries.length === 0) return null;
  const sessionId = basename8(filePath, ".jsonl");
  const toolErrors = extractToolErrors(entries);
  const gitBranch = entries.reduce((acc, e) => e.gitBranch || acc, void 0);
  let turns = groupIntoTurns(entries, seenMsgIds);
  if (dateRange) {
    turns = turns.filter((turn) => {
      if (turn.assistantCalls.length === 0) return false;
      const firstCallTs = turn.assistantCalls[0].timestamp;
      if (!firstCallTs) return false;
      const ts = new Date(firstCallTs);
      return ts >= dateRange.start && ts <= dateRange.end;
    });
    if (turns.length === 0) return null;
  }
  const classified = turns.map(classifyTurn);
  return buildSessionSummary(sessionId, project, classified, toolErrors, gitBranch);
}
async function collectJsonlFiles2(dirPath) {
  const files = await readdir9(dirPath).catch(() => []);
  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl")).map((f) => join15(dirPath, f));
  for (const entry of files) {
    if (entry.endsWith(".jsonl")) continue;
    const subagentsPath = join15(dirPath, entry, "subagents");
    const subFiles = await readdir9(subagentsPath).catch(() => []);
    for (const sf of subFiles) {
      if (sf.endsWith(".jsonl")) jsonlFiles.push(join15(subagentsPath, sf));
    }
  }
  return jsonlFiles;
}
async function scanProjectDirs(dirs, seenMsgIds, dateRange) {
  const projectMap = /* @__PURE__ */ new Map();
  for (const { path: dirPath, name: dirName } of dirs) {
    const jsonlFiles = await collectJsonlFiles2(dirPath);
    for (const filePath of jsonlFiles) {
      const session = await parseSessionFile(filePath, dirName, seenMsgIds, dateRange);
      if (session && session.apiCalls > 0) {
        const existing = projectMap.get(dirName) ?? [];
        existing.push(session);
        projectMap.set(dirName, existing);
      }
    }
  }
  const projects = [];
  for (const [dirName, sessions] of projectMap) {
    projects.push({
      project: dirName,
      projectPath: unsanitizePath2(dirName),
      sessions,
      totalCostUSD: sessions.reduce((s, sess) => s + sess.totalCostUSD, 0),
      totalApiCalls: sessions.reduce((s, sess) => s + sess.apiCalls, 0)
    });
  }
  return projects;
}
function providerCallToTurn(call) {
  const tools = call.tools;
  const usage = {
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    cacheCreationInputTokens: call.cacheCreationInputTokens,
    cacheReadInputTokens: call.cacheReadInputTokens,
    cachedInputTokens: call.cachedInputTokens,
    reasoningTokens: call.reasoningTokens,
    webSearchRequests: call.webSearchRequests
  };
  const apiCall = {
    provider: call.provider,
    model: call.model,
    usage,
    costUSD: call.costUSD,
    tools,
    mcpTools: extractMcpTools(tools),
    hasAgentSpawn: tools.includes("Agent"),
    hasPlanMode: tools.includes("EnterPlanMode"),
    speed: call.speed,
    timestamp: call.timestamp,
    bashCommands: call.bashCommands,
    deduplicationKey: call.deduplicationKey
  };
  return {
    userMessage: call.userMessage,
    assistantCalls: [apiCall],
    timestamp: call.timestamp,
    sessionId: call.sessionId
  };
}
async function parseProviderSources(providerName, sources, seenKeys, dateRange) {
  const provider = await getProvider(providerName);
  if (!provider) return [];
  const sessionMap = /* @__PURE__ */ new Map();
  for (const source of sources) {
    if (dateRange) {
      try {
        const s = await stat11(source.path);
        if (s.mtimeMs < dateRange.start.getTime()) continue;
      } catch {
      }
    }
    const parser = provider.createSessionParser(
      { path: source.path, project: source.project, provider: providerName },
      seenKeys
    );
    for await (const call of parser.parse()) {
      if (dateRange) {
        if (!call.timestamp) continue;
        const ts = new Date(call.timestamp);
        if (ts < dateRange.start || ts > dateRange.end) continue;
      }
      const turn = providerCallToTurn(call);
      const classified = classifyTurn(turn);
      const key = `${providerName}:${call.sessionId}:${source.project}`;
      const existing = sessionMap.get(key);
      if (existing) {
        existing.turns.push(classified);
      } else {
        sessionMap.set(key, { project: source.project, turns: [classified] });
      }
    }
  }
  const projectMap = /* @__PURE__ */ new Map();
  for (const [key, { project, turns }] of sessionMap) {
    const sessionId = key.split(":")[1] ?? key;
    const session = buildSessionSummary(sessionId, project, turns);
    if (session.apiCalls > 0) {
      const existing = projectMap.get(project) ?? [];
      existing.push(session);
      projectMap.set(project, existing);
    }
  }
  const projects = [];
  for (const [dirName, sessions] of projectMap) {
    projects.push({
      project: dirName,
      projectPath: unsanitizePath2(dirName),
      sessions,
      totalCostUSD: sessions.reduce((s, sess) => s + sess.totalCostUSD, 0),
      totalApiCalls: sessions.reduce((s, sess) => s + sess.apiCalls, 0)
    });
  }
  return projects;
}
function cacheKey(dateRange, providerFilter) {
  const s = dateRange ? `${dateRange.start.getTime()}:${dateRange.end.getTime()}` : "none";
  return `${s}:${providerFilter ?? "all"}`;
}
function cachePut(key, data) {
  const now = Date.now();
  for (const [k, v] of sessionCache) {
    if (now - v.ts > CACHE_TTL_MS3) sessionCache.delete(k);
  }
  if (sessionCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = [...sessionCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) sessionCache.delete(oldest[0]);
  }
  sessionCache.set(key, { data, ts: now });
}
function filterProjectsByName(projects, include, exclude) {
  let result = projects;
  if (include && include.length > 0) {
    const patterns = include.map((s) => s.toLowerCase());
    result = result.filter((p) => {
      const name = p.project.toLowerCase();
      const path = p.projectPath.toLowerCase();
      return patterns.some((pat) => name.includes(pat) || path.includes(pat));
    });
  }
  if (exclude && exclude.length > 0) {
    const patterns = exclude.map((s) => s.toLowerCase());
    result = result.filter((p) => {
      const name = p.project.toLowerCase();
      const path = p.projectPath.toLowerCase();
      return !patterns.some((pat) => name.includes(pat) || path.includes(pat));
    });
  }
  return result;
}
async function parseAllSessions(dateRange, providerFilter) {
  const key = cacheKey(dateRange, providerFilter);
  const cached = sessionCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS3) return cached.data;
  const seenMsgIds = /* @__PURE__ */ new Set();
  const seenKeys = /* @__PURE__ */ new Set();
  const allSources = await discoverAllSessions(providerFilter);
  const claudeSources = allSources.filter((s) => s.provider === "claude");
  const nonClaudeSources = allSources.filter((s) => s.provider !== "claude");
  const claudeDirs = claudeSources.map((s) => ({ path: s.path, name: s.project }));
  const claudeProjects = await scanProjectDirs(claudeDirs, seenMsgIds, dateRange);
  const providerGroups = /* @__PURE__ */ new Map();
  for (const source of nonClaudeSources) {
    const existing = providerGroups.get(source.provider) ?? [];
    existing.push({ path: source.path, project: source.project });
    providerGroups.set(source.provider, existing);
  }
  const otherProjects = [];
  for (const [providerName, sources] of providerGroups) {
    const projects = await parseProviderSources(providerName, sources, seenKeys, dateRange);
    otherProjects.push(...projects);
  }
  const mergedMap = /* @__PURE__ */ new Map();
  for (const p of [...claudeProjects, ...otherProjects]) {
    const existing = mergedMap.get(p.project);
    if (existing) {
      existing.sessions.push(...p.sessions);
      existing.totalCostUSD += p.totalCostUSD;
      existing.totalApiCalls += p.totalApiCalls;
    } else {
      mergedMap.set(p.project, { ...p });
    }
  }
  const result = Array.from(mergedMap.values()).sort((a, b) => b.totalCostUSD - a.totalCostUSD);
  cachePut(key, result);
  return result;
}
var MAX_ERROR_PATTERNS_PER_SESSION, CACHE_TTL_MS3, MAX_CACHE_ENTRIES, sessionCache;
var init_parser = __esm({
  "src/parser.ts"() {
    "use strict";
    init_fs_utils();
    init_models();
    init_providers();
    init_classifier();
    init_bash_utils();
    init_tool_result_classifier();
    MAX_ERROR_PATTERNS_PER_SESSION = 20;
    CACHE_TTL_MS3 = 6e4;
    MAX_CACHE_ENTRIES = 10;
    sessionCache = /* @__PURE__ */ new Map();
  }
});

// src/yield.ts
var yield_exports = {};
__export(yield_exports, {
  computeYield: () => computeYield,
  formatYieldSummary: () => formatYieldSummary
});
import { execSync } from "child_process";
function runGit(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}
function isGitRepo(dir) {
  return runGit("git rev-parse --is-inside-work-tree", dir) === "true";
}
function getMainBranch(cwd) {
  const result = runGit("git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null", cwd);
  if (result) {
    return result.replace("refs/remotes/origin/", "");
  }
  const branches = runGit("git branch -a", cwd) ?? "";
  if (branches.includes("main")) return "main";
  if (branches.includes("master")) return "master";
  return "main";
}
function getCommitsInRange(cwd, since, until, mainBranch) {
  const sinceStr = since.toISOString();
  const untilStr = until.toISOString();
  const log = runGit(
    `git log --all --since="${sinceStr}" --until="${untilStr}" --format="%H|%aI|%s"`,
    cwd
  );
  if (!log) return [];
  const mainCommits = new Set(
    (runGit(`git log ${mainBranch} --format="%H"`, cwd) ?? "").split("\n").filter(Boolean)
  );
  return log.split("\n").filter(Boolean).map((line) => {
    const [sha, timestamp, subject] = line.split("|");
    return {
      sha,
      timestamp: new Date(timestamp),
      isRevert: subject.toLowerCase().includes("revert"),
      inMain: mainCommits.has(sha)
    };
  });
}
function categorizeSession(session, commits) {
  if (!session.firstTimestamp) {
    return { category: "abandoned", commitCount: 0 };
  }
  const sessionStart = new Date(session.firstTimestamp);
  const lastTs = session.lastTimestamp ?? session.firstTimestamp;
  const sessionEnd = new Date(new Date(lastTs).getTime() + 60 * 60 * 1e3);
  const relevantCommits = commits.filter(
    (c) => c.timestamp >= sessionStart && c.timestamp <= sessionEnd
  );
  if (relevantCommits.length === 0) {
    return { category: "abandoned", commitCount: 0 };
  }
  const inMainCount = relevantCommits.filter((c) => c.inMain).length;
  const revertedCount = relevantCommits.filter((c) => c.isRevert && c.inMain).length;
  if (revertedCount > 0 && revertedCount >= inMainCount / 2) {
    return { category: "reverted", commitCount: relevantCommits.length };
  }
  if (inMainCount > 0) {
    return { category: "productive", commitCount: inMainCount };
  }
  return { category: "abandoned", commitCount: relevantCommits.length };
}
async function computeYield(range, cwd) {
  const projects = await parseAllSessions(range, "all");
  const summary = {
    productive: { cost: 0, sessions: 0 },
    reverted: { cost: 0, sessions: 0 },
    abandoned: { cost: 0, sessions: 0 },
    total: { cost: 0, sessions: 0 },
    details: []
  };
  const commits = isGitRepo(cwd) ? getCommitsInRange(cwd, range.start, range.end, getMainBranch(cwd)) : [];
  for (const project of projects) {
    const projectCwd = project.projectPath && isGitRepo(project.projectPath) ? project.projectPath : cwd;
    const projectCommits = projectCwd !== cwd && isGitRepo(projectCwd) ? getCommitsInRange(projectCwd, range.start, range.end, getMainBranch(projectCwd)) : commits;
    for (const session of project.sessions) {
      const { category, commitCount } = categorizeSession(session, projectCommits);
      summary[category].cost += session.totalCostUSD;
      summary[category].sessions += 1;
      summary.total.cost += session.totalCostUSD;
      summary.total.sessions += 1;
      summary.details.push({
        sessionId: session.sessionId,
        project: project.project,
        cost: session.totalCostUSD,
        category,
        commitCount
      });
    }
  }
  return summary;
}
function formatYieldSummary(summary) {
  const { productive, reverted, abandoned, total } = summary;
  const pct2 = (n) => total.cost > 0 ? Math.round(n / total.cost * 100) : 0;
  const fmt = (n) => `$${n.toFixed(2)}`;
  const lines = [
    "",
    `Productive:  ${fmt(productive.cost).padStart(8)} (${pct2(productive.cost)}%) - ${productive.sessions} sessions shipped to main`,
    `Reverted:    ${fmt(reverted.cost).padStart(8)} (${pct2(reverted.cost)}%) - ${reverted.sessions} sessions were reverted`,
    `Abandoned:   ${fmt(abandoned.cost).padStart(8)} (${pct2(abandoned.cost)}%) - ${abandoned.sessions} sessions never committed`,
    "",
    `Total:       ${fmt(total.cost).padStart(8)}     - ${total.sessions} sessions`,
    ""
  ];
  return lines.join("\n");
}
var init_yield = __esm({
  "src/yield.ts"() {
    "use strict";
    init_parser();
  }
});

// src/cli.ts
import { Command } from "commander";

// src/menubar-installer.ts
import { spawn } from "child_process";
import { createWriteStream } from "fs";
import { mkdir, mkdtemp, rename, rm, stat } from "fs/promises";
import { homedir, platform, tmpdir } from "os";
import { join } from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
var RELEASE_API = "https://api.github.com/repos/getagentseal/codeburn/releases/latest";
var APP_BUNDLE_NAME = "CodeBurnMenubar.app";
var ASSET_PATTERN = /^CodeBurnMenubar-.*\.zip$/;
var APP_PROCESS_NAME = "CodeBurnMenubar";
var SUPPORTED_OS = "darwin";
var MIN_MACOS_MAJOR = 14;
function userApplicationsDir() {
  return join(homedir(), "Applications");
}
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
async function ensureSupportedPlatform() {
  if (platform() !== SUPPORTED_OS) {
    throw new Error(`The menubar app is macOS only (detected: ${platform()}).`);
  }
  const major = Number((process.env.CODEBURN_FORCE_MACOS_MAJOR ?? "") || (await sysProductVersion()).split(".")[0]);
  if (!Number.isFinite(major) || major < MIN_MACOS_MAJOR) {
    throw new Error(`macOS ${MIN_MACOS_MAJOR}+ required (detected ${major}).`);
  }
}
async function sysProductVersion() {
  return new Promise((resolve3, reject) => {
    const proc = spawn("/usr/bin/sw_vers", ["-productVersion"]);
    let out = "";
    proc.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`sw_vers exited with ${code}`));
      else resolve3(out.trim());
    });
  });
}
async function fetchLatestReleaseAsset() {
  const response = await fetch(RELEASE_API, {
    headers: {
      // Identify the installer so GitHub's abuse heuristics treat us as a known client.
      "User-Agent": "codeburn-menubar-installer",
      Accept: "application/vnd.github+json"
    }
  });
  if (!response.ok) {
    throw new Error(`GitHub release lookup failed: HTTP ${response.status}`);
  }
  const body = await response.json();
  const asset = body.assets.find((a) => ASSET_PATTERN.test(a.name));
  if (!asset) {
    throw new Error(
      `No ${APP_BUNDLE_NAME} zip found in release ${body.tag_name}. Check https://github.com/getagentseal/codeburn/releases.`
    );
  }
  return asset;
}
async function downloadToFile(url, destPath) {
  const response = await fetch(url, {
    headers: { "User-Agent": "codeburn-menubar-installer" },
    redirect: "follow"
  });
  if (!response.ok || response.body === null) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  const nodeStream = Readable.fromWeb(response.body);
  await pipeline(nodeStream, createWriteStream(destPath));
}
async function runCommand(command, args) {
  return new Promise((resolve3, reject) => {
    const proc = spawn(command, args, { stdio: "inherit" });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve3();
      else reject(new Error(`${command} exited with status ${code}`));
    });
  });
}
async function isAppRunning() {
  return new Promise((resolve3) => {
    const proc = spawn("/usr/bin/pgrep", ["-f", APP_PROCESS_NAME]);
    proc.on("close", (code) => resolve3(code === 0));
    proc.on("error", () => resolve3(false));
  });
}
async function killRunningApp() {
  await new Promise((resolve3) => {
    const proc = spawn("/usr/bin/pkill", ["-f", APP_PROCESS_NAME]);
    proc.on("close", () => resolve3());
    proc.on("error", () => resolve3());
  });
}
async function installMenubarApp(options = {}) {
  await ensureSupportedPlatform();
  const appsDir = userApplicationsDir();
  const targetPath = join(appsDir, APP_BUNDLE_NAME);
  const alreadyInstalled = await exists(targetPath);
  if (alreadyInstalled && !options.force) {
    if (!await isAppRunning()) {
      await runCommand("/usr/bin/open", [targetPath]);
    }
    return { installedPath: targetPath, launched: true };
  }
  console.log("Looking up the latest CodeBurn Menubar release...");
  const asset = await fetchLatestReleaseAsset();
  const stagingDir = await mkdtemp(join(tmpdir(), "codeburn-menubar-"));
  try {
    const archivePath = join(stagingDir, asset.name);
    console.log(`Downloading ${asset.name}...`);
    await downloadToFile(asset.browser_download_url, archivePath);
    console.log("Unpacking...");
    await runCommand("/usr/bin/unzip", ["-q", archivePath, "-d", stagingDir]);
    const unpackedApp = join(stagingDir, APP_BUNDLE_NAME);
    if (!await exists(unpackedApp)) {
      throw new Error(`Archive did not contain ${APP_BUNDLE_NAME}.`);
    }
    await runCommand("/usr/bin/xattr", ["-dr", "com.apple.quarantine", unpackedApp]).catch(() => {
    });
    await mkdir(appsDir, { recursive: true });
    if (alreadyInstalled) {
      await killRunningApp();
      await rm(targetPath, { recursive: true, force: true });
    }
    await rename(unpackedApp, targetPath);
    console.log("Launching CodeBurn Menubar...");
    await runCommand("/usr/bin/open", [targetPath]);
    return { installedPath: targetPath, launched: true };
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

// src/export.ts
import { writeFile as writeFile3, mkdir as mkdir4, readdir, stat as stat2, rm as rm2 } from "fs/promises";
import { dirname, join as join4, resolve } from "path";

// src/types.ts
var CATEGORY_LABELS = {
  coding: "Coding",
  debugging: "Debugging",
  feature: "Feature Dev",
  refactoring: "Refactoring",
  testing: "Testing",
  exploration: "Exploration",
  planning: "Planning",
  delegation: "Delegation",
  git: "Git Ops",
  "build/deploy": "Build/Deploy",
  conversation: "Conversation",
  brainstorming: "Brainstorming",
  general: "General"
};

// src/currency.ts
import { readFile as readFile2, writeFile as writeFile2, mkdir as mkdir3 } from "fs/promises";
import { join as join3 } from "path";
import { homedir as homedir3 } from "os";

// src/config.ts
import { readFile, writeFile, mkdir as mkdir2, rename as rename2 } from "fs/promises";
import { join as join2 } from "path";
import { homedir as homedir2 } from "os";
var DEFAULT_BRANCH_LABELS = {
  "ci/": "CI",
  "docs/adr": "ADR",
  "feat/": "Feature",
  "feature/": "Feature",
  "fix/": "Fix",
  "bugfix/": "Fix",
  "docs/": "Docs",
  "test/": "Tests",
  "tests/": "Tests",
  "refactor/": "Refactor",
  "chore/": "Chore",
  "release/": "Release"
};
function resolveBranchLabels(config) {
  return config?.branchLabels ?? DEFAULT_BRANCH_LABELS;
}
function getBranchLabel(branch, labels) {
  if (!branch) return void 0;
  const sorted = Object.keys(labels).sort((a, b) => b.length - a.length);
  for (const pattern of sorted) {
    if (branch.startsWith(pattern) || branch === pattern.replace(/\/$/, "")) {
      return labels[pattern];
    }
  }
  return void 0;
}
function getConfigDir() {
  return join2(homedir2(), ".config", "codeburn");
}
function getConfigPath() {
  return join2(getConfigDir(), "config.json");
}
async function readConfig() {
  try {
    const raw = await readFile(getConfigPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
async function saveConfig(config) {
  await mkdir2(getConfigDir(), { recursive: true });
  const configPath = getConfigPath();
  const tmpPath = `${configPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  await rename2(tmpPath, configPath);
}
async function readPlan() {
  const config = await readConfig();
  return config.plan;
}
async function savePlan(plan) {
  const config = await readConfig();
  config.plan = plan;
  await saveConfig(config);
}
async function clearPlan() {
  const config = await readConfig();
  delete config.plan;
  await saveConfig(config);
}
function getConfigFilePath() {
  return getConfigPath();
}

// src/currency.ts
var CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
var FRANKFURTER_URL = "https://api.frankfurter.app/latest?from=USD&to=";
var MIN_VALID_FX_RATE = 1e-4;
var MAX_VALID_FX_RATE = 1e6;
function isValidRate(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= MIN_VALID_FX_RATE && value <= MAX_VALID_FX_RATE;
}
var active = { code: "USD", rate: 1, symbol: "$" };
function isValidCurrencyCode(code) {
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}
function resolveSymbol(code) {
  const parts = new Intl.NumberFormat("en", {
    style: "currency",
    currency: code,
    currencyDisplay: "symbol"
  }).formatToParts(0);
  return parts.find((p) => p.type === "currency")?.value ?? code;
}
function getFractionDigits(code) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: code
  }).resolvedOptions().maximumFractionDigits ?? 2;
}
function getCacheDir() {
  return join3(homedir3(), ".cache", "codeburn");
}
function getRateCachePath() {
  return join3(getCacheDir(), "exchange-rate.json");
}
async function fetchRate(code) {
  const response = await fetch(`${FRANKFURTER_URL}${code}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const rate = data.rates?.[code];
  if (!isValidRate(rate)) throw new Error(`Invalid rate returned for ${code}`);
  return rate;
}
async function loadCachedRate(code) {
  try {
    const raw = await readFile2(getRateCachePath(), "utf-8");
    const cached = JSON.parse(raw);
    if (typeof cached.code !== "string" || cached.code !== code) return null;
    if (typeof cached.timestamp !== "number" || !Number.isFinite(cached.timestamp)) return null;
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) return null;
    if (!isValidRate(cached.rate)) return null;
    return cached.rate;
  } catch {
    return null;
  }
}
async function cacheRate(code, rate) {
  await mkdir3(getCacheDir(), { recursive: true });
  await writeFile2(getRateCachePath(), JSON.stringify({ timestamp: Date.now(), code, rate }));
}
async function getExchangeRate(code) {
  if (code === "USD") return 1;
  const cached = await loadCachedRate(code);
  if (cached) return cached;
  try {
    const rate = await fetchRate(code);
    await cacheRate(code, rate);
    return rate;
  } catch {
    return 1;
  }
}
async function loadCurrency() {
  const config = await readConfig();
  if (!config.currency) return;
  const code = config.currency.code.toUpperCase();
  const rate = await getExchangeRate(code);
  const symbol = config.currency.symbol ?? resolveSymbol(code);
  active = { code, rate, symbol };
}
function getCurrency() {
  return active;
}
function convertCost(costUSD) {
  const digits = getFractionDigits(active.code);
  const factor = 10 ** digits;
  return Math.round(costUSD * active.rate * factor) / factor;
}
function formatCost(costUSD) {
  const { rate, symbol, code } = active;
  const cost = costUSD * rate;
  const digits = getFractionDigits(code);
  if (digits === 0) return `${symbol}${Math.round(cost)}`;
  if (cost >= 1) return `${symbol}${cost.toFixed(2)}`;
  if (cost >= 0.01) return `${symbol}${cost.toFixed(3)}`;
  return `${symbol}${cost.toFixed(4)}`;
}

// src/day-aggregator.ts
function emptyEntry(date) {
  return {
    date,
    cost: 0,
    calls: 0,
    sessions: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    editTurns: 0,
    oneShotTurns: 0,
    models: {},
    categories: {},
    providers: {}
  };
}
function dateKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function aggregateProjectsIntoDays(projects) {
  const byDate = /* @__PURE__ */ new Map();
  const ensure = (date) => {
    let d = byDate.get(date);
    if (!d) {
      d = emptyEntry(date);
      byDate.set(date, d);
    }
    return d;
  };
  for (const project of projects) {
    for (const session of project.sessions) {
      const sessionDate = dateKey(session.firstTimestamp);
      ensure(sessionDate).sessions += 1;
      for (const turn of session.turns) {
        if (turn.assistantCalls.length === 0) continue;
        const turnDate = dateKey(turn.assistantCalls[0].timestamp);
        const turnDay = ensure(turnDate);
        const editTurns = turn.hasEdits ? 1 : 0;
        const oneShotTurns = turn.hasEdits && turn.retries === 0 ? 1 : 0;
        const turnCost = turn.assistantCalls.reduce((s, c) => s + c.costUSD, 0);
        turnDay.editTurns += editTurns;
        turnDay.oneShotTurns += oneShotTurns;
        const cat = turnDay.categories[turn.category] ?? { turns: 0, cost: 0, editTurns: 0, oneShotTurns: 0 };
        cat.turns += 1;
        cat.cost += turnCost;
        cat.editTurns += editTurns;
        cat.oneShotTurns += oneShotTurns;
        turnDay.categories[turn.category] = cat;
        for (const call of turn.assistantCalls) {
          const callDate = dateKey(call.timestamp);
          const callDay = ensure(callDate);
          callDay.cost += call.costUSD;
          callDay.calls += 1;
          callDay.inputTokens += call.usage.inputTokens;
          callDay.outputTokens += call.usage.outputTokens;
          callDay.cacheReadTokens += call.usage.cacheReadInputTokens;
          callDay.cacheWriteTokens += call.usage.cacheCreationInputTokens;
          const model = callDay.models[call.model] ?? {
            calls: 0,
            cost: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0
          };
          model.calls += 1;
          model.cost += call.costUSD;
          model.inputTokens += call.usage.inputTokens;
          model.outputTokens += call.usage.outputTokens;
          model.cacheReadTokens += call.usage.cacheReadInputTokens;
          model.cacheWriteTokens += call.usage.cacheCreationInputTokens;
          callDay.models[call.model] = model;
          const provider = callDay.providers[call.provider] ?? { calls: 0, cost: 0 };
          provider.calls += 1;
          provider.cost += call.costUSD;
          callDay.providers[call.provider] = provider;
        }
      }
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
function buildPeriodDataFromDays(days, label) {
  let cost = 0, calls = 0, sessions = 0;
  let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0;
  const catTotals = {};
  const modelTotals = {};
  for (const d of days) {
    cost += d.cost;
    calls += d.calls;
    sessions += d.sessions;
    inputTokens += d.inputTokens;
    outputTokens += d.outputTokens;
    cacheReadTokens += d.cacheReadTokens;
    cacheWriteTokens += d.cacheWriteTokens;
    for (const [name, m] of Object.entries(d.models)) {
      const acc = modelTotals[name] ?? { calls: 0, cost: 0 };
      acc.calls += m.calls;
      acc.cost += m.cost;
      modelTotals[name] = acc;
    }
    for (const [cat, c] of Object.entries(d.categories)) {
      const acc = catTotals[cat] ?? { turns: 0, cost: 0, editTurns: 0, oneShotTurns: 0 };
      acc.turns += c.turns;
      acc.cost += c.cost;
      acc.editTurns += c.editTurns;
      acc.oneShotTurns += c.oneShotTurns;
      catTotals[cat] = acc;
    }
  }
  return {
    label,
    cost,
    calls,
    sessions,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    categories: Object.entries(catTotals).sort(([, a], [, b]) => b.cost - a.cost).map(([cat, d]) => ({ name: CATEGORY_LABELS[cat] ?? cat, ...d })),
    models: Object.entries(modelTotals).sort(([, a], [, b]) => b.cost - a.cost).map(([name, d]) => ({ name, ...d }))
  };
}

// src/export.ts
function escCsv(s) {
  const sanitized = /^[\t\r=+\-@]/.test(s) ? `'${s}` : s;
  if (sanitized.includes(",") || sanitized.includes('"') || sanitized.includes("\n")) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}
function rowsToCsv(rows) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(escCsv).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escCsv(String(row[h] ?? ""))).join(","));
  }
  return lines.join("\n") + "\n";
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function pct(n, total) {
  return total > 0 ? round2(n / total * 100) : 0;
}
function buildDailyRows(projects, period) {
  const daily = {};
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const turn of session.turns) {
        if (!turn.timestamp) continue;
        const day = dateKey(turn.timestamp);
        if (!daily[day]) {
          daily[day] = { cost: 0, calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, sessions: /* @__PURE__ */ new Set() };
        }
        daily[day].sessions.add(session.sessionId);
        for (const call of turn.assistantCalls) {
          daily[day].cost += call.costUSD;
          daily[day].calls++;
          daily[day].input += call.usage.inputTokens;
          daily[day].output += call.usage.outputTokens;
          daily[day].cacheRead += call.usage.cacheReadInputTokens;
          daily[day].cacheWrite += call.usage.cacheCreationInputTokens;
        }
      }
    }
  }
  const { code } = getCurrency();
  return Object.entries(daily).sort().map(([date, d]) => ({
    Period: period,
    Date: date,
    [`Cost (${code})`]: round2(convertCost(d.cost)),
    "API Calls": d.calls,
    Sessions: d.sessions.size,
    "Input Tokens": d.input,
    "Output Tokens": d.output,
    "Cache Read Tokens": d.cacheRead,
    "Cache Write Tokens": d.cacheWrite
  }));
}
function buildActivityRows(projects, period) {
  const catTotals = {};
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const [cat, d] of Object.entries(session.categoryBreakdown)) {
        if (!catTotals[cat]) catTotals[cat] = { turns: 0, cost: 0 };
        catTotals[cat].turns += d.turns;
        catTotals[cat].cost += d.costUSD;
      }
    }
  }
  const totalCost = Object.values(catTotals).reduce((s, d) => s + d.cost, 0);
  const { code } = getCurrency();
  return Object.entries(catTotals).sort(([, a], [, b]) => b.cost - a.cost).map(([cat, d]) => ({
    Period: period,
    Activity: CATEGORY_LABELS[cat] ?? cat,
    [`Cost (${code})`]: round2(convertCost(d.cost)),
    "Share (%)": pct(d.cost, totalCost),
    Turns: d.turns
  }));
}
function buildModelRows(projects, period) {
  const modelTotals = {};
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const [model, d] of Object.entries(session.modelBreakdown)) {
        if (!modelTotals[model]) modelTotals[model] = { calls: 0, cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        modelTotals[model].calls += d.calls;
        modelTotals[model].cost += d.costUSD;
        modelTotals[model].input += d.tokens.inputTokens;
        modelTotals[model].output += d.tokens.outputTokens;
        modelTotals[model].cacheRead += d.tokens.cacheReadInputTokens ?? 0;
        modelTotals[model].cacheWrite += d.tokens.cacheCreationInputTokens ?? 0;
      }
    }
  }
  const totalCost = Object.values(modelTotals).reduce((s, d) => s + d.cost, 0);
  const { code } = getCurrency();
  return Object.entries(modelTotals).filter(([name]) => name !== "<synthetic>").sort(([, a], [, b]) => b.cost - a.cost).map(([model, d]) => ({
    Period: period,
    Model: model,
    [`Cost (${code})`]: round2(convertCost(d.cost)),
    "Share (%)": pct(d.cost, totalCost),
    "API Calls": d.calls,
    "Input Tokens": d.input,
    "Output Tokens": d.output,
    "Cache Read Tokens": d.cacheRead,
    "Cache Write Tokens": d.cacheWrite
  }));
}
function buildToolRows(projects) {
  const toolTotals = {};
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const [tool, d] of Object.entries(session.toolBreakdown)) {
        const agg = toolTotals[tool] ?? { calls: 0, errors: 0, denials: 0, siblingCascade: 0 };
        agg.calls += d.calls;
        agg.errors += d.errors ?? 0;
        agg.denials += d.denials ?? 0;
        agg.siblingCascade += d.siblingCascadeErrors ?? 0;
        toolTotals[tool] = agg;
      }
    }
  }
  const total = Object.values(toolTotals).reduce((s, d) => s + d.calls, 0);
  return Object.entries(toolTotals).sort(([, a], [, b]) => b.calls - a.calls).map(([tool, d]) => ({
    Tool: tool,
    Calls: d.calls,
    "Share (%)": pct(d.calls, total),
    Errors: d.errors,
    "Error Rate (%)": pct(d.errors, d.calls),
    Denials: d.denials,
    "Sibling Cascade Errors": d.siblingCascade
  }));
}
function buildErrorPatternRows(projects) {
  const patterns = /* @__PURE__ */ new Map();
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const p of session.errorPatterns ?? []) {
        const existing = patterns.get(p.signature);
        if (existing) existing.count += p.count;
        else patterns.set(p.signature, { ...p });
      }
    }
  }
  return [...patterns.values()].sort((a, b) => b.count - a.count).map((p) => ({
    Tool: p.tool,
    Count: p.count,
    Signature: p.signature,
    Example: p.example
  }));
}
function buildBashRows(projects) {
  const bashTotals = {};
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const [cmd, d] of Object.entries(session.bashBreakdown)) {
        bashTotals[cmd] = (bashTotals[cmd] ?? 0) + d.calls;
      }
    }
  }
  const total = Object.values(bashTotals).reduce((s, n) => s + n, 0);
  return Object.entries(bashTotals).sort(([, a], [, b]) => b - a).map(([cmd, calls]) => ({
    Command: cmd,
    Calls: calls,
    "Share (%)": pct(calls, total)
  }));
}
function buildProjectRows(projects) {
  const { code } = getCurrency();
  const total = projects.reduce((s, p) => s + p.totalCostUSD, 0);
  return projects.slice().sort((a, b) => b.totalCostUSD - a.totalCostUSD).map((p) => ({
    Project: p.projectPath,
    [`Cost (${code})`]: round2(convertCost(p.totalCostUSD)),
    [`Avg/Session (${code})`]: p.sessions.length > 0 ? round2(convertCost(p.totalCostUSD / p.sessions.length)) : "",
    "Share (%)": pct(p.totalCostUSD, total),
    "API Calls": p.totalApiCalls,
    Sessions: p.sessions.length
  }));
}
function buildSessionRows(projects, branchLabels) {
  const { code } = getCurrency();
  const rows = [];
  for (const p of projects) {
    for (const s of p.sessions) {
      rows.push({
        Project: p.projectPath,
        "Session ID": s.sessionId,
        "Started At": s.firstTimestamp ?? "",
        Branch: s.gitBranch ?? "",
        "Branch Label": getBranchLabel(s.gitBranch, branchLabels) ?? "",
        [`Cost (${code})`]: round2(convertCost(s.totalCostUSD)),
        "API Calls": s.apiCalls,
        Turns: s.turns.length
      });
    }
  }
  return rows.sort((a, b) => b[`Cost (${code})`] - a[`Cost (${code})`]);
}
function buildBranchActivityRows(projects, branchLabels) {
  const totals = {};
  for (const p of projects) {
    for (const s of p.sessions) {
      if (!s.gitBranch) continue;
      const label = getBranchLabel(s.gitBranch, branchLabels) ?? "Other";
      const agg = totals[label] ?? { cost: 0, sessions: 0, calls: 0 };
      agg.cost += s.totalCostUSD;
      agg.sessions++;
      agg.calls += s.apiCalls;
      totals[label] = agg;
    }
  }
  const totalCost = Object.values(totals).reduce((s, d) => s + d.cost, 0);
  const { code } = getCurrency();
  return Object.entries(totals).sort(([, a], [, b]) => b.cost - a.cost).map(([label, d]) => ({
    "Branch Label": label,
    [`Cost (${code})`]: round2(convertCost(d.cost)),
    "Share (%)": pct(d.cost, totalCost),
    Sessions: d.sessions,
    "API Calls": d.calls
  }));
}
function buildSummaryRows(periods) {
  const { code } = getCurrency();
  return periods.map((p) => {
    const cost = p.projects.reduce((s, proj) => s + proj.totalCostUSD, 0);
    const calls = p.projects.reduce((s, proj) => s + proj.totalApiCalls, 0);
    const sessions = p.projects.reduce((s, proj) => s + proj.sessions.length, 0);
    const projectCount = p.projects.filter((proj) => proj.totalCostUSD > 0).length;
    return {
      Period: p.label,
      [`Cost (${code})`]: round2(convertCost(cost)),
      "API Calls": calls,
      Sessions: sessions,
      Projects: projectCount
    };
  });
}
function buildReadme(periods) {
  const { code } = getCurrency();
  const generated = (/* @__PURE__ */ new Date()).toISOString();
  const lines = [
    "CodeBurn Usage Export",
    "====================",
    "",
    `Generated: ${generated}`,
    `Currency:  ${code}`,
    `Periods:   ${periods.map((p) => p.label).join(", ")}`,
    "",
    "Files",
    "-----",
    "  summary.csv           One row per period. Headline totals.",
    "  daily.csv             Day-by-day breakdown, Period column distinguishes the window.",
    "  activity.csv          Time spent per task category (Coding, Debugging, Exploration, etc.).",
    "  models.csv            Spend per model with token totals and cache usage.",
    "  projects.csv          Spend per project folder (30-day window).",
    "  sessions.csv          One row per session (30-day window) with session IDs and costs.",
    "  tools.csv             Tool invocations, error rate, denials (30-day window).",
    "  errors.csv            Top tool error patterns with example messages (30-day window).",
    "  branch-activity.csv   Spend grouped by git branch label (CI / Feature / Fix / etc.).",
    "  shell-commands.csv    Shell commands executed via Bash tool (30-day window).",
    "",
    "Notes",
    "-----",
    "  Every cost column is already converted to the active currency. Tokens are raw integer",
    "  counts from provider telemetry. Share (%) is relative to the period/table total.",
    ""
  ];
  return lines.join("\n");
}
var EXPORT_MARKER_FILE = ".codeburn-export";
async function isCodeburnExportFolder(path) {
  const markerStat = await stat2(join4(path, EXPORT_MARKER_FILE)).catch(() => null);
  return markerStat?.isFile() ?? false;
}
async function clearCodeburnExportFolder(path) {
  const entries = await readdir(path);
  for (const entry of entries) {
    await rm2(join4(path, entry), { recursive: true, force: true });
  }
}
async function exportCsv(periods, outputPath, opts = {}) {
  const thirtyDays = periods.find((p) => p.label === "30 Days");
  const thirtyDayProjects = thirtyDays?.projects ?? periods[periods.length - 1]?.projects ?? [];
  const branchLabels = resolveBranchLabels(opts.config);
  let folder = resolve(outputPath);
  if (folder.toLowerCase().endsWith(".csv")) {
    folder = folder.slice(0, -4);
  }
  const existingStat = await stat2(folder).catch(() => null);
  if (existingStat?.isFile()) {
    throw new Error(`Refusing to overwrite existing file at ${folder}. Pass a directory path instead.`);
  }
  if (existingStat?.isDirectory()) {
    if (!await isCodeburnExportFolder(folder)) {
      throw new Error(
        `Refusing to reuse non-empty directory ${folder}: no ${EXPORT_MARKER_FILE} marker. Delete it manually or pick a different -o path.`
      );
    }
    await clearCodeburnExportFolder(folder);
  }
  await mkdir4(folder, { recursive: true });
  await writeFile3(join4(folder, EXPORT_MARKER_FILE), "", "utf-8");
  const dailyRows = periods.flatMap((p) => buildDailyRows(p.projects, p.label));
  const activityRows = periods.flatMap((p) => buildActivityRows(p.projects, p.label));
  const modelRows = periods.flatMap((p) => buildModelRows(p.projects, p.label));
  await writeFile3(join4(folder, "README.txt"), buildReadme(periods), "utf-8");
  await writeFile3(join4(folder, "summary.csv"), rowsToCsv(buildSummaryRows(periods)), "utf-8");
  await writeFile3(join4(folder, "daily.csv"), rowsToCsv(dailyRows), "utf-8");
  await writeFile3(join4(folder, "activity.csv"), rowsToCsv(activityRows), "utf-8");
  await writeFile3(join4(folder, "models.csv"), rowsToCsv(modelRows), "utf-8");
  await writeFile3(join4(folder, "projects.csv"), rowsToCsv(buildProjectRows(thirtyDayProjects)), "utf-8");
  await writeFile3(join4(folder, "sessions.csv"), rowsToCsv(buildSessionRows(thirtyDayProjects, branchLabels)), "utf-8");
  await writeFile3(join4(folder, "tools.csv"), rowsToCsv(buildToolRows(thirtyDayProjects)), "utf-8");
  await writeFile3(join4(folder, "errors.csv"), rowsToCsv(buildErrorPatternRows(thirtyDayProjects)), "utf-8");
  await writeFile3(join4(folder, "branch-activity.csv"), rowsToCsv(buildBranchActivityRows(thirtyDayProjects, branchLabels)), "utf-8");
  await writeFile3(join4(folder, "shell-commands.csv"), rowsToCsv(buildBashRows(thirtyDayProjects)), "utf-8");
  return folder;
}
async function exportJson(periods, outputPath, opts = {}) {
  const thirtyDays = periods.find((p) => p.label === "30 Days");
  const thirtyDayProjects = thirtyDays?.projects ?? periods[periods.length - 1]?.projects ?? [];
  const { code, rate, symbol } = getCurrency();
  const branchLabels = resolveBranchLabels(opts.config);
  const data = {
    schema: "codeburn.export.v2",
    generated: (/* @__PURE__ */ new Date()).toISOString(),
    currency: { code, rate, symbol },
    summary: buildSummaryRows(periods),
    periods: periods.map((p) => ({
      label: p.label,
      daily: buildDailyRows(p.projects, p.label),
      activity: buildActivityRows(p.projects, p.label),
      models: buildModelRows(p.projects, p.label)
    })),
    projects: buildProjectRows(thirtyDayProjects),
    sessions: buildSessionRows(thirtyDayProjects, branchLabels),
    tools: buildToolRows(thirtyDayProjects),
    errors: buildErrorPatternRows(thirtyDayProjects),
    branchActivity: buildBranchActivityRows(thirtyDayProjects, branchLabels),
    shellCommands: buildBashRows(thirtyDayProjects)
  };
  const target = resolve(outputPath.toLowerCase().endsWith(".json") ? outputPath : `${outputPath}.json`);
  await mkdir4(dirname(target), { recursive: true });
  await writeFile3(target, JSON.stringify(data, null, 2), "utf-8");
  return target;
}

// src/event-export.ts
init_fs_utils();
init_providers();
init_tool_result_classifier();
import { createWriteStream as createWriteStream2 } from "fs";
import { mkdir as mkdir7, readdir as readdir8, stat as stat10 } from "fs/promises";
import { basename as basename7, dirname as dirname3, join as join14, resolve as resolve2 } from "path";
function userMessageText(entry) {
  if (!entry.message || entry.message.role !== "user") return "";
  const content = entry.message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(
    (b) => !!b && typeof b === "object" && b.type === "text" && typeof b.text === "string"
  ).map((b) => b.text).join(" ");
}
function parseJsonlLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
async function collectJsonlFiles(dirPath) {
  const files = await readdir8(dirPath).catch(() => []);
  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl")).map((f) => join14(dirPath, f));
  for (const entry of files) {
    if (entry.endsWith(".jsonl")) continue;
    const subagentsPath = join14(dirPath, entry, "subagents");
    const subFiles = await readdir8(subagentsPath).catch(() => []);
    for (const sf of subFiles) {
      if (sf.endsWith(".jsonl")) jsonlFiles.push(join14(subagentsPath, sf));
    }
  }
  return jsonlFiles;
}
function inDateRange(ts, range) {
  if (!range) return true;
  if (!ts) return false;
  const t = new Date(ts);
  return t >= range.start && t <= range.end;
}
function projectMatches(project, projectPath, include, exclude) {
  const name = project.toLowerCase();
  const path = projectPath.toLowerCase();
  if (include && include.length > 0) {
    const ok = include.some((pat) => {
      const p = pat.toLowerCase();
      return name.includes(p) || path.includes(p);
    });
    if (!ok) return false;
  }
  if (exclude && exclude.length > 0) {
    const blocked = exclude.some((pat) => {
      const p = pat.toLowerCase();
      return name.includes(p) || path.includes(p);
    });
    if (blocked) return false;
  }
  return true;
}
function unsanitizePath(dirName) {
  return dirName.replace(/-/g, "/");
}
async function exportEvents(opts) {
  const target = resolve2(opts.outputPath.toLowerCase().endsWith(".jsonl") ? opts.outputPath : `${opts.outputPath}.jsonl`);
  await mkdir7(dirname3(target), { recursive: true });
  const stream = createWriteStream2(target, { encoding: "utf-8" });
  let eventCount = 0;
  const seenSessions = /* @__PURE__ */ new Set();
  const writeRecord = async (rec) => {
    eventCount++;
    if (!seenSessions.has(rec.session_id)) seenSessions.add(rec.session_id);
    if (!stream.write(JSON.stringify(rec) + "\n")) {
      await new Promise((res) => stream.once("drain", () => res()));
    }
  };
  const sources = await discoverAllSessions("claude");
  for (const source of sources) {
    if (!projectMatches(source.project, unsanitizePath(source.project), opts.projectFilter, opts.excludeFilter)) continue;
    const files = await collectJsonlFiles(source.path);
    for (const filePath of files) {
      if (opts.dateRange) {
        const s = await stat10(filePath).catch(() => null);
        if (s && s.mtimeMs < opts.dateRange.start.getTime()) continue;
      }
      const sessionId = basename7(filePath, ".jsonl");
      const toolNameById = /* @__PURE__ */ new Map();
      const sameToolStreak = { tool: null, index: 0 };
      let pendingDenial = null;
      for await (const line of readSessionLines(filePath)) {
        const entry = parseJsonlLine(line);
        if (!entry) continue;
        const ts = entry.timestamp ?? "";
        if (!inDateRange(ts, opts.dateRange)) continue;
        const gitBranch = entry.gitBranch;
        const project = source.project;
        if (entry.type === "assistant") {
          const msg = entry.message;
          if (!msg) continue;
          for (const b of msg.content ?? []) {
            if (b.type !== "tool_use") continue;
            const tu = b;
            if (tu.name !== sameToolStreak.tool) {
              sameToolStreak.tool = tu.name;
              sameToolStreak.index = 0;
            } else {
              sameToolStreak.index++;
            }
            if (tu.id && tu.name) toolNameById.set(tu.id, tu.name);
            await writeRecord({
              session_id: sessionId,
              timestamp: ts,
              project,
              git_branch: gitBranch,
              model: msg.model,
              event_type: "tool_call",
              tool_use_id: tu.id,
              tool_name: tu.name,
              tool_input: tu.input ?? {},
              retry_index: sameToolStreak.index
            });
          }
          continue;
        }
        if (entry.type !== "user" || !entry.message) continue;
        const content = entry.message.content;
        if (Array.isArray(content)) {
          for (const b of content) {
            if (!isToolResultBlock(b)) continue;
            const text2 = toolResultText(b.content);
            const toolName = b.tool_use_id ? toolNameById.get(b.tool_use_id) : void 0;
            if (DENIAL_RE.test(text2)) {
              await writeRecord({
                session_id: sessionId,
                timestamp: ts,
                project,
                git_branch: gitBranch,
                event_type: "denial",
                tool_use_id: b.tool_use_id,
                tool_name: toolName,
                denial_reason: text2
              });
              pendingDenial = { sessionId, project, gitBranch, timestamp: ts, tool: toolName, reason: text2 };
              continue;
            }
            const isError = !!b.is_error;
            const category = isError ? SIBLING_CASCADE_RE.test(text2) ? "sibling-cascade" : "error" : void 0;
            await writeRecord({
              session_id: sessionId,
              timestamp: ts,
              project,
              git_branch: gitBranch,
              event_type: "tool_result",
              tool_use_id: b.tool_use_id,
              tool_name: toolName,
              is_error: isError,
              error_category: category,
              error_message: isError ? text2 : void 0
            });
          }
          continue;
        }
        const text = userMessageText(entry);
        if (text.trim() && pendingDenial && pendingDenial.sessionId === sessionId) {
          await writeRecord({
            session_id: sessionId,
            timestamp: ts,
            project,
            git_branch: gitBranch,
            event_type: "correction",
            tool_name: pendingDenial.tool,
            denial_reason: pendingDenial.reason,
            correction_text: truncateCorrectionText(text)
          });
          pendingDenial = null;
        }
      }
    }
  }
  await new Promise((res, rej) => {
    stream.once("finish", () => res());
    stream.once("error", rej);
    stream.end();
  });
  return { path: target, eventCount, sessionCount: seenSessions.size };
}

// src/cli.ts
init_models();
init_parser();

// src/format.ts
import chalk from "chalk";
function formatTokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toString();
}
function localDateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function renderStatusBar(projects) {
  const now = /* @__PURE__ */ new Date();
  const today = localDateString(now);
  const monthStart = `${today.slice(0, 7)}-01`;
  let todayCost = 0, todayCalls = 0, monthCost = 0, monthCalls = 0;
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const turn of session.turns) {
        if (turn.assistantCalls.length === 0) continue;
        const bucketTs = turn.assistantCalls[0].timestamp;
        if (!bucketTs) continue;
        const day = localDateString(new Date(bucketTs));
        const turnCost = turn.assistantCalls.reduce((s, c) => s + c.costUSD, 0);
        const turnCalls = turn.assistantCalls.length;
        if (day === today) {
          todayCost += turnCost;
          todayCalls += turnCalls;
        }
        if (day >= monthStart) {
          monthCost += turnCost;
          monthCalls += turnCalls;
        }
      }
    }
  }
  const lines = [""];
  lines.push(`  ${chalk.bold("Today")}  ${chalk.yellowBright(formatCost(todayCost))}  ${chalk.dim(`${todayCalls} calls`)}    ${chalk.bold("Month")}  ${chalk.yellowBright(formatCost(monthCost))}  ${chalk.dim(`${monthCalls} calls`)}`);
  lines.push("");
  return lines.join("\n");
}

// src/menubar-json.ts
var TOP_ACTIVITIES_LIMIT = 20;
var TOP_MODELS_LIMIT = 20;
var TOP_FINDINGS_LIMIT = 10;
var HISTORY_DAYS_LIMIT = 365;
var SYNTHETIC_MODEL_NAME = "<synthetic>";
function oneShotRateFor(editTurns, oneShotTurns) {
  if (editTurns === 0) return null;
  return oneShotTurns / editTurns;
}
function aggregateOneShotRate(categories) {
  let edits = 0;
  let oneShots = 0;
  for (const cat of categories) {
    edits += cat.editTurns;
    oneShots += cat.oneShotTurns;
  }
  if (edits === 0) return null;
  return oneShots / edits;
}
function cacheHitPercent(inputTokens, cacheReadTokens) {
  const denom = inputTokens + cacheReadTokens;
  if (denom === 0) return 0;
  return cacheReadTokens / denom * 100;
}
function buildTopActivities(categories) {
  return categories.slice(0, TOP_ACTIVITIES_LIMIT).map((cat) => ({
    name: cat.name,
    cost: cat.cost,
    turns: cat.turns,
    oneShotRate: oneShotRateFor(cat.editTurns, cat.oneShotTurns)
  }));
}
function buildTopModels(models) {
  return models.filter((m) => m.name !== SYNTHETIC_MODEL_NAME).slice(0, TOP_MODELS_LIMIT).map((m) => ({ name: m.name, cost: m.cost, calls: m.calls }));
}
function buildOptimize(optimize) {
  if (!optimize || optimize.findings.length === 0) {
    return { findingCount: 0, savingsUSD: 0, topFindings: [] };
  }
  const { findings, costRate } = optimize;
  const totalSavingsUSD = findings.reduce((s, f) => s + f.tokensSaved * costRate, 0);
  const topFindings = findings.slice(0, TOP_FINDINGS_LIMIT).map((f) => ({
    title: f.title,
    impact: f.impact,
    savingsUSD: f.tokensSaved * costRate
  }));
  return {
    findingCount: findings.length,
    savingsUSD: totalSavingsUSD,
    topFindings
  };
}
function buildProviders(providers) {
  const map = {};
  for (const p of providers) {
    if (p.cost < 0) continue;
    map[p.name.toLowerCase()] = p.cost;
  }
  return map;
}
function buildHistory(daily) {
  if (!daily || daily.length === 0) return { daily: [] };
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const trimmed = sorted.slice(-HISTORY_DAYS_LIMIT);
  return { daily: trimmed };
}
function buildMenubarPayload(current, providers, optimize, dailyHistory) {
  return {
    generated: (/* @__PURE__ */ new Date()).toISOString(),
    current: {
      label: current.label,
      cost: current.cost,
      calls: current.calls,
      sessions: current.sessions,
      oneShotRate: aggregateOneShotRate(current.categories),
      inputTokens: current.inputTokens,
      outputTokens: current.outputTokens,
      cacheHitPercent: cacheHitPercent(current.inputTokens, current.cacheReadTokens),
      topActivities: buildTopActivities(current.categories),
      topModels: buildTopModels(current.models),
      providers: buildProviders(providers)
    },
    optimize: buildOptimize(optimize),
    history: buildHistory(dailyHistory)
  };
}

// src/daily-cache.ts
import { randomBytes } from "crypto";
import { existsSync as existsSync3 } from "fs";
import { mkdir as mkdir8, open, readFile as readFile7, rename as rename3, unlink } from "fs/promises";
import { homedir as homedir13 } from "os";
import { join as join16 } from "path";
var DAILY_CACHE_VERSION = 3;
var DAILY_CACHE_FILENAME = "daily-cache.json";
function getCacheDir4() {
  return process.env["CODEBURN_CACHE_DIR"] ?? join16(homedir13(), ".cache", "codeburn");
}
function getCachePath3() {
  return join16(getCacheDir4(), DAILY_CACHE_FILENAME);
}
function emptyCache() {
  return { version: DAILY_CACHE_VERSION, lastComputedDate: null, days: [] };
}
function isValidCache(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  const c = parsed;
  if (c.version !== DAILY_CACHE_VERSION) return false;
  if (!Array.isArray(c.days)) return false;
  return true;
}
async function loadDailyCache() {
  const path = getCachePath3();
  if (!existsSync3(path)) return emptyCache();
  try {
    const raw = await readFile7(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (!isValidCache(parsed)) return emptyCache();
    return parsed;
  } catch {
    return emptyCache();
  }
}
async function saveDailyCache(cache) {
  const dir = getCacheDir4();
  if (!existsSync3(dir)) await mkdir8(dir, { recursive: true });
  const finalPath = getCachePath3();
  const tempPath = `${finalPath}.${randomBytes(8).toString("hex")}.tmp`;
  const payload = JSON.stringify(cache);
  const handle = await open(tempPath, "w", 384);
  try {
    await handle.writeFile(payload, { encoding: "utf-8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename3(tempPath, finalPath);
  } catch (err) {
    try {
      await unlink(tempPath);
    } catch {
    }
    throw err;
  }
}
function addNewDays(cache, incoming, newestDate) {
  const byDate = new Map(cache.days.map((d) => [d.date, d]));
  for (const day of incoming) {
    byDate.set(day.date, day);
  }
  const merged = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  const nextLast = cache.lastComputedDate && cache.lastComputedDate > newestDate ? cache.lastComputedDate : newestDate;
  return { version: DAILY_CACHE_VERSION, lastComputedDate: nextLast, days: merged };
}
function getDaysInRange(cache, start, end) {
  return cache.days.filter((d) => d.date >= start && d.date <= end);
}
var lockChain = Promise.resolve();
function withDailyCacheLock(fn) {
  const next = lockChain.then(() => fn());
  lockChain = next.catch(() => void 0);
  return next;
}

// src/dashboard.tsx
import { homedir as homedir16 } from "os";
import { useState as useState2, useCallback, useEffect as useEffect2, useRef as useRef2 } from "react";
import { render as render2, Box as Box2, Text as Text2, useInput as useInput2, useApp as useApp2, useWindowSize } from "ink";
init_parser();
init_models();
init_providers();

// src/optimize.ts
init_fs_utils();
init_providers();
import chalk2 from "chalk";
import { readdir as readdir10, stat as stat12 } from "fs/promises";
import { existsSync as existsSync4, statSync as statSync2 } from "fs";
import { basename as basename9, join as join17 } from "path";
import { homedir as homedir14 } from "os";
var ORANGE = "#FF8C42";
var DIM = "#666666";
var GOLD = "#FFD700";
var CYAN = "#5BF5E0";
var GREEN = "#5BF5A0";
var RED = "#F55B5B";
var AVG_TOKENS_PER_READ = 600;
var TOKENS_PER_MCP_TOOL = 400;
var TOOLS_PER_MCP_SERVER = 5;
var TOKENS_PER_AGENT_DEF = 80;
var TOKENS_PER_SKILL_DEF = 80;
var TOKENS_PER_COMMAND_DEF = 60;
var CLAUDEMD_TOKENS_PER_LINE = 13;
var BASH_TOKENS_PER_CHAR = 0.25;
var CLAUDEMD_HEALTHY_LINES = 200;
var CLAUDEMD_HIGH_THRESHOLD_LINES = 400;
var MIN_JUNK_READS_TO_FLAG = 3;
var JUNK_READS_HIGH_THRESHOLD = 20;
var JUNK_READS_MEDIUM_THRESHOLD = 5;
var MIN_DUPLICATE_READS_TO_FLAG = 5;
var DUPLICATE_READS_HIGH_THRESHOLD = 30;
var DUPLICATE_READS_MEDIUM_THRESHOLD = 10;
var MIN_EDITS_FOR_RATIO = 10;
var HEALTHY_READ_EDIT_RATIO = 4;
var LOW_RATIO_HIGH_THRESHOLD = 2;
var LOW_RATIO_MEDIUM_THRESHOLD = 3;
var MIN_API_CALLS_FOR_CACHE = 10;
var CACHE_EXCESS_HIGH_THRESHOLD = 15e3;
var UNUSED_MCP_HIGH_THRESHOLD = 3;
var GHOST_AGENTS_HIGH_THRESHOLD = 5;
var GHOST_AGENTS_MEDIUM_THRESHOLD = 2;
var GHOST_SKILLS_HIGH_THRESHOLD = 10;
var GHOST_SKILLS_MEDIUM_THRESHOLD = 5;
var GHOST_COMMANDS_MEDIUM_THRESHOLD = 10;
var MCP_NEW_CONFIG_GRACE_MS = 24 * 60 * 60 * 1e3;
var BASH_DEFAULT_LIMIT = 3e4;
var BASH_RECOMMENDED_LIMIT = 15e3;
var HEALTH_WEIGHT_HIGH = 15;
var HEALTH_WEIGHT_MEDIUM = 7;
var HEALTH_WEIGHT_LOW = 3;
var HEALTH_MAX_PENALTY = 80;
var GRADE_A_MIN = 90;
var GRADE_B_MIN = 75;
var GRADE_C_MIN = 55;
var GRADE_D_MIN = 30;
var URGENCY_IMPACT_WEIGHT = 0.7;
var URGENCY_TOKEN_WEIGHT = 0.3;
var URGENCY_TOKEN_NORMALIZE = 5e5;
var MAX_IMPORT_DEPTH = 5;
var IMPORT_PATTERN = /^@(\.\.?\/[^\s]+|\/[^\s]+)/gm;
var COMMAND_PATTERN = /<command-name>([^<]+)<\/command-name>|(?:^|\s)\/([a-zA-Z][\w-]*)/gm;
var JUNK_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  ".cache",
  ".tsbuildinfo",
  ".venv",
  "venv",
  ".svn",
  ".hg"
];
var JUNK_PATTERN = new RegExp(`/(?:${JUNK_DIRS.join("|")})/`);
var SHELL_PROFILES = [".zshrc", ".bashrc", ".bash_profile", ".profile"];
var TOP_ITEMS_PREVIEW = 3;
var GHOST_NAMES_PREVIEW = 5;
var GHOST_CLEANUP_COMMANDS_LIMIT = 10;
var FILE_READ_CONCURRENCY = 16;
var RESULT_CACHE_TTL_MS = 6e4;
var RECENT_WINDOW_HOURS = 48;
var RECENT_WINDOW_MS = RECENT_WINDOW_HOURS * 60 * 60 * 1e3;
var DEFAULT_TREND_PERIOD_DAYS = 30;
var DEFAULT_TREND_PERIOD_MS = DEFAULT_TREND_PERIOD_DAYS * 24 * 60 * 60 * 1e3;
var IMPROVING_THRESHOLD = 0.5;
async function collectJsonlFiles3(dirPath) {
  const files = await readdir10(dirPath).catch(() => []);
  const result = files.filter((f) => f.endsWith(".jsonl")).map((f) => join17(dirPath, f));
  for (const entry of files) {
    if (entry.endsWith(".jsonl")) continue;
    const subPath = join17(dirPath, entry, "subagents");
    const subFiles = await readdir10(subPath).catch(() => []);
    for (const sf of subFiles) {
      if (sf.endsWith(".jsonl")) result.push(join17(subPath, sf));
    }
  }
  return result;
}
async function isFileStaleForRange(filePath, range) {
  if (!range) return false;
  try {
    const s = await stat12(filePath);
    return s.mtimeMs < range.start.getTime();
  } catch {
    return false;
  }
}
async function runWithConcurrency(items, limit, worker) {
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const current = idx++;
      await worker(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
}
function inRange(timestamp, range) {
  if (!range) return true;
  if (!timestamp) return false;
  const ts = new Date(timestamp);
  return ts >= range.start && ts <= range.end;
}
function isRecent(timestamp, cutoff) {
  if (!timestamp) return false;
  return new Date(timestamp).getTime() >= cutoff;
}
async function scanJsonlFile(filePath, project, dateRange, recentCutoffMs = Date.now() - RECENT_WINDOW_MS) {
  const calls = [];
  const cwds = [];
  const apiCalls = [];
  const userMessages = [];
  const sessionId = basename9(filePath, ".jsonl");
  let lastVersion = "";
  for await (const line of readSessionLines(filePath)) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.version && typeof entry.version === "string") lastVersion = entry.version;
    const ts = typeof entry.timestamp === "string" ? entry.timestamp : void 0;
    const withinRange = inRange(ts, dateRange);
    const recent = isRecent(ts, recentCutoffMs);
    if (entry.cwd && typeof entry.cwd === "string" && withinRange) cwds.push(entry.cwd);
    if (entry.type === "user") {
      if (!withinRange) continue;
      const msg2 = entry.message;
      const msgContent = msg2?.content;
      if (typeof msgContent === "string") {
        userMessages.push(msgContent);
      } else if (Array.isArray(msgContent)) {
        for (const block of msgContent) {
          if (block && typeof block === "object" && block.type === "text" && typeof block.text === "string") {
            userMessages.push(block.text);
          }
        }
      }
      continue;
    }
    if (entry.type !== "assistant") continue;
    if (!withinRange) continue;
    const msg = entry.message;
    const usage = msg?.usage;
    if (usage) {
      const cacheCreate = usage.cache_creation_input_tokens ?? 0;
      if (cacheCreate > 0) apiCalls.push({ cacheCreationTokens: cacheCreate, version: lastVersion, recent });
    }
    const blocks = msg?.content;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (block.type !== "tool_use") continue;
      calls.push({
        name: block.name,
        input: block.input ?? {},
        sessionId,
        project,
        recent
      });
    }
  }
  return { calls, cwds, apiCalls, userMessages };
}
async function scanSessions(dateRange) {
  const sources = await discoverAllSessions("claude");
  const allCalls = [];
  const allCwds = /* @__PURE__ */ new Set();
  const allApiCalls = [];
  const allUserMessages = [];
  const tasks = [];
  for (const source of sources) {
    const files = await collectJsonlFiles3(source.path);
    for (const file of files) {
      if (await isFileStaleForRange(file, dateRange)) continue;
      tasks.push({ file, project: source.project });
    }
  }
  await runWithConcurrency(tasks, FILE_READ_CONCURRENCY, async ({ file, project }) => {
    const { calls, cwds, apiCalls, userMessages } = await scanJsonlFile(file, project, dateRange);
    allCalls.push(...calls);
    for (const cwd of cwds) allCwds.add(cwd);
    allApiCalls.push(...apiCalls);
    allUserMessages.push(...userMessages);
  });
  return { toolCalls: allCalls, projectCwds: allCwds, apiCalls: allApiCalls, userMessages: allUserMessages };
}
function readJsonFile(path) {
  const raw = readSessionFileSync(path);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function shortHomePath(absPath) {
  const home = homedir14();
  return absPath.startsWith(home) ? "~" + absPath.slice(home.length) : absPath;
}
function isReadTool(name) {
  return name === "Read" || name === "FileReadTool";
}
function loadMcpConfigs(projectCwds) {
  const servers = /* @__PURE__ */ new Map();
  const configPaths = [
    join17(homedir14(), ".claude", "settings.json"),
    join17(homedir14(), ".claude", "settings.local.json")
  ];
  for (const cwd of projectCwds) {
    configPaths.push(join17(cwd, ".mcp.json"));
    configPaths.push(join17(cwd, ".claude", "settings.json"));
    configPaths.push(join17(cwd, ".claude", "settings.local.json"));
  }
  for (const p of configPaths) {
    if (!existsSync4(p)) continue;
    const config = readJsonFile(p);
    if (!config) continue;
    let mtime = 0;
    try {
      mtime = statSync2(p).mtimeMs;
    } catch {
    }
    const serversObj = config.mcpServers ?? {};
    for (const name of Object.keys(serversObj)) {
      const normalized = name.replace(/:/g, "_");
      const existing = servers.get(normalized);
      if (!existing || existing.mtime < mtime) {
        servers.set(normalized, { normalized, original: name, mtime });
      }
    }
  }
  return servers;
}
function detectJunkReads(calls, dateRange) {
  const dirCounts = /* @__PURE__ */ new Map();
  let totalJunkReads = 0;
  let recentJunkReads = 0;
  for (const call of calls) {
    if (!isReadTool(call.name)) continue;
    const filePath = call.input.file_path;
    if (!filePath || !JUNK_PATTERN.test(filePath)) continue;
    totalJunkReads++;
    if (call.recent) recentJunkReads++;
    for (const dir of JUNK_DIRS) {
      if (filePath.includes(`/${dir}/`)) {
        dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
        break;
      }
    }
  }
  if (totalJunkReads < MIN_JUNK_READS_TO_FLAG) return null;
  const hasRecentActivity = calls.some((c) => c.recent);
  const trend = sessionTrend(recentJunkReads, totalJunkReads, dateRange, hasRecentActivity);
  if (trend === "resolved") return null;
  const sorted = [...dirCounts.entries()].sort((a, b) => b[1] - a[1]);
  const dirList = sorted.slice(0, TOP_ITEMS_PREVIEW).map(([d, n]) => `${d}/ (${n}x)`).join(", ");
  const tokensSaved = totalJunkReads * AVG_TOKENS_PER_READ;
  const detected = sorted.map(([d]) => d);
  const commonDefaults = ["node_modules", ".git", "dist", "__pycache__"];
  const extras = commonDefaults.filter((d) => !dirCounts.has(d)).slice(0, Math.max(0, 6 - detected.length));
  const dirsToAvoid = [...detected, ...extras].join(", ");
  return {
    title: "Claude is reading build/dependency folders",
    explanation: `Claude read into ${dirList} (${totalJunkReads} reads). These are generated or dependency directories, not your code. Tell Claude in CLAUDE.md to avoid them.`,
    impact: totalJunkReads > JUNK_READS_HIGH_THRESHOLD ? "high" : totalJunkReads > JUNK_READS_MEDIUM_THRESHOLD ? "medium" : "low",
    tokensSaved,
    fix: {
      type: "paste",
      label: "Append to your project CLAUDE.md:",
      text: `Do not read or search files under these directories unless I explicitly ask: ${dirsToAvoid}.`
    },
    trend
  };
}
function detectDuplicateReads(calls, dateRange) {
  const sessionFiles = /* @__PURE__ */ new Map();
  for (const call of calls) {
    if (!isReadTool(call.name)) continue;
    const filePath = call.input.file_path;
    if (!filePath || JUNK_PATTERN.test(filePath)) continue;
    const key = `${call.project}:${call.sessionId}`;
    if (!sessionFiles.has(key)) sessionFiles.set(key, /* @__PURE__ */ new Map());
    const fm = sessionFiles.get(key);
    const entry = fm.get(filePath) ?? { count: 0, recent: 0 };
    entry.count++;
    if (call.recent) entry.recent++;
    fm.set(filePath, entry);
  }
  let totalDuplicates = 0;
  let recentDuplicates = 0;
  const fileDupes = /* @__PURE__ */ new Map();
  for (const fm of sessionFiles.values()) {
    for (const [file, entry] of fm) {
      if (entry.count <= 1) continue;
      const extra = entry.count - 1;
      totalDuplicates += extra;
      if (entry.recent > 1) recentDuplicates += entry.recent - 1;
      const name = basename9(file);
      fileDupes.set(name, (fileDupes.get(name) ?? 0) + extra);
    }
  }
  if (totalDuplicates < MIN_DUPLICATE_READS_TO_FLAG) return null;
  const hasRecentActivity = calls.some((c) => c.recent);
  const trend = sessionTrend(recentDuplicates, totalDuplicates, dateRange, hasRecentActivity);
  if (trend === "resolved") return null;
  const worst = [...fileDupes.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_ITEMS_PREVIEW).map(([name, n]) => `${name} (${n + 1}x)`).join(", ");
  const tokensSaved = totalDuplicates * AVG_TOKENS_PER_READ;
  return {
    title: "Claude is re-reading the same files",
    explanation: `${totalDuplicates} redundant re-reads across sessions. Top repeats: ${worst}. Each re-read loads the same content into context again.`,
    impact: totalDuplicates > DUPLICATE_READS_HIGH_THRESHOLD ? "high" : totalDuplicates > DUPLICATE_READS_MEDIUM_THRESHOLD ? "medium" : "low",
    tokensSaved,
    fix: {
      type: "paste",
      label: "Point Claude at exact locations in your prompt, for example:",
      text: "In <file> lines <start>-<end>, look at the <function> function."
    },
    trend
  };
}
function detectUnusedMcp(calls, projects, projectCwds) {
  const configured = loadMcpConfigs(projectCwds);
  if (configured.size === 0) return null;
  const calledServers = /* @__PURE__ */ new Set();
  for (const call of calls) {
    if (!call.name.startsWith("mcp__")) continue;
    const seg = call.name.split("__")[1];
    if (seg) calledServers.add(seg);
  }
  for (const p of projects) {
    for (const s of p.sessions) {
      for (const server of Object.keys(s.mcpBreakdown)) calledServers.add(server);
    }
  }
  const now = Date.now();
  const unused = [];
  for (const entry of configured.values()) {
    if (calledServers.has(entry.normalized)) continue;
    if (entry.mtime > 0 && now - entry.mtime < MCP_NEW_CONFIG_GRACE_MS) continue;
    unused.push(entry.original);
  }
  if (unused.length === 0) return null;
  const totalSessions = projects.reduce((s, p) => s + p.sessions.length, 0);
  const schemaTokensPerSession = unused.length * TOOLS_PER_MCP_SERVER * TOKENS_PER_MCP_TOOL;
  const tokensSaved = schemaTokensPerSession * Math.max(totalSessions, 1);
  return {
    title: `${unused.length} MCP server${unused.length > 1 ? "s" : ""} configured but never used`,
    explanation: `Never called in this period: ${unused.join(", ")}. Each server loads ~${TOOLS_PER_MCP_SERVER * TOKENS_PER_MCP_TOOL} tokens of tool schema into every session.`,
    impact: unused.length >= UNUSED_MCP_HIGH_THRESHOLD ? "high" : "medium",
    tokensSaved,
    fix: {
      type: "command",
      label: `Remove unused server${unused.length > 1 ? "s" : ""}:`,
      text: unused.map((s) => `claude mcp remove ${s}`).join("\n")
    }
  };
}
function expandImports(filePath, seen, depth) {
  if (depth > MAX_IMPORT_DEPTH || seen.has(filePath)) return { totalLines: 0, importedFiles: 0 };
  seen.add(filePath);
  const content = readSessionFileSync(filePath);
  if (content === null) return { totalLines: 0, importedFiles: 0 };
  let totalLines = content.split("\n").length;
  let importedFiles = 0;
  const dir = join17(filePath, "..");
  IMPORT_PATTERN.lastIndex = 0;
  for (const match of content.matchAll(IMPORT_PATTERN)) {
    const rawPath = match[1];
    if (!rawPath) continue;
    const resolved = rawPath.startsWith("/") ? rawPath : join17(dir, rawPath);
    if (!existsSync4(resolved)) continue;
    const nested = expandImports(resolved, seen, depth + 1);
    totalLines += nested.totalLines;
    importedFiles += 1 + nested.importedFiles;
  }
  return { totalLines, importedFiles };
}
function detectBloatedClaudeMd(projectCwds) {
  const bloated = [];
  for (const cwd of projectCwds) {
    for (const name of ["CLAUDE.md", ".claude/CLAUDE.md"]) {
      const fullPath = join17(cwd, name);
      if (!existsSync4(fullPath)) continue;
      const { totalLines, importedFiles } = expandImports(fullPath, /* @__PURE__ */ new Set(), 0);
      if (totalLines > CLAUDEMD_HEALTHY_LINES) {
        bloated.push({ path: `${shortHomePath(cwd)}/${name}`, expandedLines: totalLines, imports: importedFiles });
      }
    }
  }
  if (bloated.length === 0) return null;
  const sorted = bloated.sort((a, b) => b.expandedLines - a.expandedLines);
  const worst = sorted[0];
  const totalExtraLines = sorted.reduce((s, b) => s + (b.expandedLines - CLAUDEMD_HEALTHY_LINES), 0);
  const tokensSaved = totalExtraLines * CLAUDEMD_TOKENS_PER_LINE;
  const list = sorted.slice(0, TOP_ITEMS_PREVIEW).map((b) => {
    const importNote = b.imports > 0 ? ` with ${b.imports} @-import${b.imports > 1 ? "s" : ""}` : "";
    return `${b.path} (${b.expandedLines} lines${importNote})`;
  }).join(", ");
  return {
    title: `Your CLAUDE.md is too long`,
    explanation: `${list}. CLAUDE.md plus all @-imported files load into every API call. Trimming below ${CLAUDEMD_HEALTHY_LINES} lines saves ~${formatTokens(tokensSaved)} tokens per call.`,
    impact: worst.expandedLines > CLAUDEMD_HIGH_THRESHOLD_LINES ? "high" : "medium",
    tokensSaved,
    fix: {
      type: "paste",
      label: "Ask Claude to trim it:",
      text: `Review CLAUDE.md and all @-imported files. Cut total expanded content to under ${CLAUDEMD_HEALTHY_LINES} lines. Remove anything Claude can figure out from the code itself. Keep only rules, gotchas, and non-obvious conventions.`
    }
  };
}
var READ_TOOL_NAMES = /* @__PURE__ */ new Set(["Read", "Grep", "Glob", "FileReadTool", "GrepTool", "GlobTool"]);
var EDIT_TOOL_NAMES = /* @__PURE__ */ new Set(["Edit", "Write", "FileEditTool", "FileWriteTool", "NotebookEdit"]);
function detectLowReadEditRatio(calls) {
  let reads = 0;
  let edits = 0;
  let recentEdits = 0;
  let recentReads = 0;
  for (const call of calls) {
    if (READ_TOOL_NAMES.has(call.name)) {
      reads++;
      if (call.recent) recentReads++;
    } else if (EDIT_TOOL_NAMES.has(call.name)) {
      edits++;
      if (call.recent) recentEdits++;
    }
  }
  if (edits < MIN_EDITS_FOR_RATIO) return null;
  const ratio = reads / edits;
  if (ratio >= HEALTHY_READ_EDIT_RATIO) return null;
  const impact = ratio < LOW_RATIO_HIGH_THRESHOLD ? "high" : ratio < LOW_RATIO_MEDIUM_THRESHOLD ? "medium" : "low";
  const extraReadsNeeded = Math.max(Math.round(edits * HEALTHY_READ_EDIT_RATIO) - reads, 0);
  const tokensSaved = extraReadsNeeded * AVG_TOKENS_PER_READ;
  let trend = "active";
  if (recentEdits >= MIN_EDITS_FOR_RATIO) {
    const recentRatio = recentReads / recentEdits;
    if (recentRatio >= HEALTHY_READ_EDIT_RATIO) trend = "resolved";
    else if (recentRatio > ratio * (1 / IMPROVING_THRESHOLD)) trend = "improving";
  }
  if (trend === "resolved") return null;
  return {
    title: "Claude edits more than it reads",
    explanation: `Claude made ${reads} reads and ${edits} edits (ratio ${ratio.toFixed(1)}:1). A healthy ratio is ${HEALTHY_READ_EDIT_RATIO}+ reads per edit. Editing without reading leads to retries and wasted tokens.`,
    impact,
    tokensSaved,
    fix: {
      type: "paste",
      label: "Add to your CLAUDE.md:",
      text: "Before editing any file, read it first. Before modifying a function, grep for all callers. Research before you edit."
    },
    trend
  };
}
var DEFAULT_CACHE_BASELINE_TOKENS = 5e4;
var CACHE_BASELINE_QUANTILE = 0.25;
var CACHE_BLOAT_MULTIPLIER = 1.4;
var CACHE_VERSION_MIN_SAMPLES = 5;
var CACHE_VERSION_DIFF_THRESHOLD = 1e4;
function computeBudgetAwareCacheBaseline(projects) {
  const sessions = projects.flatMap((p) => p.sessions);
  if (sessions.length === 0) return DEFAULT_CACHE_BASELINE_TOKENS;
  const cacheWrites = sessions.map((s) => s.totalCacheWriteTokens).filter((n) => n > 0);
  if (cacheWrites.length < MIN_API_CALLS_FOR_CACHE) return DEFAULT_CACHE_BASELINE_TOKENS;
  const sorted = cacheWrites.sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * CACHE_BASELINE_QUANTILE)] || DEFAULT_CACHE_BASELINE_TOKENS;
}
function detectCacheBloat(apiCalls, projects, dateRange) {
  if (apiCalls.length < MIN_API_CALLS_FOR_CACHE) return null;
  const sorted = apiCalls.map((c) => c.cacheCreationTokens).sort((a, b) => a - b);
  const median2 = sorted[Math.floor(sorted.length / 2)];
  const baseline = computeBudgetAwareCacheBaseline(projects);
  const bloatThreshold = baseline * CACHE_BLOAT_MULTIPLIER;
  if (median2 < bloatThreshold) return null;
  const recentCalls = apiCalls.filter((c) => c.recent);
  const totalBloated = apiCalls.filter((c) => c.cacheCreationTokens > bloatThreshold).length;
  const recentBloated = recentCalls.filter((c) => c.cacheCreationTokens > bloatThreshold).length;
  const trend = sessionTrend(recentBloated, totalBloated, dateRange, recentCalls.length > 0);
  if (trend === "resolved") return null;
  const versionCounts = /* @__PURE__ */ new Map();
  for (const call of apiCalls) {
    if (!call.version) continue;
    const entry = versionCounts.get(call.version) ?? { total: 0, count: 0 };
    entry.total += call.cacheCreationTokens;
    entry.count++;
    versionCounts.set(call.version, entry);
  }
  const versionAvgs = [...versionCounts.entries()].filter(([, d]) => d.count >= CACHE_VERSION_MIN_SAMPLES).map(([v, d]) => ({ version: v, avg: Math.round(d.total / d.count) })).sort((a, b) => b.avg - a.avg);
  const excess = median2 - baseline;
  const tokensSaved = excess * apiCalls.length;
  let versionNote = "";
  if (versionAvgs.length >= 2) {
    const [high, ...rest] = versionAvgs;
    const low = rest[rest.length - 1];
    if (high.avg - low.avg > CACHE_VERSION_DIFF_THRESHOLD) {
      versionNote = ` Version ${high.version} averages ${formatTokens(high.avg)} vs ${low.version} at ${formatTokens(low.avg)}.`;
    }
  }
  return {
    title: "Session warmup is unusually large",
    explanation: `Median cache_creation per call is ${formatTokens(median2)} tokens, about ${formatTokens(excess)} above your baseline of ${formatTokens(baseline)}.${versionNote}`,
    impact: excess > CACHE_EXCESS_HIGH_THRESHOLD ? "high" : "medium",
    tokensSaved,
    fix: {
      type: "paste",
      label: "Check for recent Claude Code updates or heavy MCP/skill additions. As a workaround (not officially supported):",
      text: "export ANTHROPIC_CUSTOM_HEADERS='User-Agent: claude-cli/2.1.98 (external, sdk-cli)'"
    },
    trend
  };
}
async function listMarkdownFiles(dir) {
  if (!existsSync4(dir)) return [];
  try {
    const entries = await readdir10(dir);
    return entries.filter((e) => e.endsWith(".md")).map((e) => e.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}
async function listSkillDirs(dir) {
  if (!existsSync4(dir)) return [];
  try {
    const entries = await readdir10(dir);
    const names = [];
    for (const entry of entries) {
      if (existsSync4(join17(dir, entry, "SKILL.md"))) names.push(entry);
    }
    return names;
  } catch {
    return [];
  }
}
async function detectGhostAgents(calls) {
  const defined = await listMarkdownFiles(join17(homedir14(), ".claude", "agents"));
  if (defined.length === 0) return null;
  const invoked = /* @__PURE__ */ new Set();
  for (const call of calls) {
    if (call.name !== "Agent" && call.name !== "Task") continue;
    const subType = call.input.subagent_type;
    if (subType) invoked.add(subType);
  }
  const ghosts = defined.filter((name) => !invoked.has(name));
  if (ghosts.length === 0) return null;
  const tokensSaved = ghosts.length * TOKENS_PER_AGENT_DEF;
  const list = ghosts.slice(0, GHOST_NAMES_PREVIEW).join(", ") + (ghosts.length > GHOST_NAMES_PREVIEW ? `, +${ghosts.length - GHOST_NAMES_PREVIEW} more` : "");
  return {
    title: `${ghosts.length} custom agent${ghosts.length > 1 ? "s" : ""} you never use`,
    explanation: `Defined in ~/.claude/agents/ but never invoked in this period: ${list}. Each adds ~${TOKENS_PER_AGENT_DEF} tokens to the Task tool schema on every session.`,
    impact: ghosts.length >= GHOST_AGENTS_HIGH_THRESHOLD ? "high" : ghosts.length >= GHOST_AGENTS_MEDIUM_THRESHOLD ? "medium" : "low",
    tokensSaved,
    fix: {
      type: "command",
      label: `Archive unused agent${ghosts.length > 1 ? "s" : ""}:`,
      text: ghosts.slice(0, GHOST_CLEANUP_COMMANDS_LIMIT).map((name) => `mv ~/.claude/agents/${name}.md ~/.claude/agents/.archived/`).join("\n")
    }
  };
}
async function detectGhostSkills(calls) {
  const defined = await listSkillDirs(join17(homedir14(), ".claude", "skills"));
  if (defined.length === 0) return null;
  const invoked = /* @__PURE__ */ new Set();
  for (const call of calls) {
    if (call.name !== "Skill") continue;
    const skillName = call.input.skill || call.input.name;
    if (skillName) invoked.add(skillName);
  }
  const ghosts = defined.filter((name) => !invoked.has(name));
  if (ghosts.length === 0) return null;
  const tokensSaved = ghosts.length * TOKENS_PER_SKILL_DEF;
  const list = ghosts.slice(0, GHOST_NAMES_PREVIEW).join(", ") + (ghosts.length > GHOST_NAMES_PREVIEW ? `, +${ghosts.length - GHOST_NAMES_PREVIEW} more` : "");
  return {
    title: `${ghosts.length} skill${ghosts.length > 1 ? "s" : ""} you never use`,
    explanation: `In ~/.claude/skills/ but not invoked this period: ${list}. Each adds ~${TOKENS_PER_SKILL_DEF} tokens of metadata to every session.`,
    impact: ghosts.length >= GHOST_SKILLS_HIGH_THRESHOLD ? "high" : ghosts.length >= GHOST_SKILLS_MEDIUM_THRESHOLD ? "medium" : "low",
    tokensSaved,
    fix: {
      type: "command",
      label: `Archive unused skill${ghosts.length > 1 ? "s" : ""}:`,
      text: ghosts.slice(0, GHOST_CLEANUP_COMMANDS_LIMIT).map((name) => `mv ~/.claude/skills/${name} ~/.claude/skills/.archived/`).join("\n")
    }
  };
}
async function detectGhostCommands(userMessages) {
  const defined = await listMarkdownFiles(join17(homedir14(), ".claude", "commands"));
  if (defined.length === 0) return null;
  const invoked = /* @__PURE__ */ new Set();
  for (const msg of userMessages) {
    COMMAND_PATTERN.lastIndex = 0;
    for (const m of msg.matchAll(COMMAND_PATTERN)) {
      const name = (m[1] || m[2] || "").trim();
      if (name) invoked.add(name);
    }
  }
  const ghosts = defined.filter((name) => !invoked.has(name));
  if (ghosts.length === 0) return null;
  const tokensSaved = ghosts.length * TOKENS_PER_COMMAND_DEF;
  const list = ghosts.slice(0, GHOST_NAMES_PREVIEW).join(", ") + (ghosts.length > GHOST_NAMES_PREVIEW ? `, +${ghosts.length - GHOST_NAMES_PREVIEW} more` : "");
  return {
    title: `${ghosts.length} slash command${ghosts.length > 1 ? "s" : ""} you never use`,
    explanation: `In ~/.claude/commands/ but not referenced this period: ${list}. Each adds ~${TOKENS_PER_COMMAND_DEF} tokens of definition per session.`,
    impact: ghosts.length >= GHOST_COMMANDS_MEDIUM_THRESHOLD ? "medium" : "low",
    tokensSaved,
    fix: {
      type: "command",
      label: `Archive unused command${ghosts.length > 1 ? "s" : ""}:`,
      text: ghosts.slice(0, GHOST_CLEANUP_COMMANDS_LIMIT).map((name) => `mv ~/.claude/commands/${name}.md ~/.claude/commands/.archived/`).join("\n")
    }
  };
}
function readShellProfileLimit() {
  for (const profile of SHELL_PROFILES) {
    const path = join17(homedir14(), profile);
    if (!existsSync4(path)) continue;
    const content = readSessionFileSync(path);
    if (content === null) continue;
    const match = content.match(/^\s*export\s+BASH_MAX_OUTPUT_LENGTH\s*=\s*['"]?(\d+)['"]?/m);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}
function detectBashBloat() {
  const profileLimit = readShellProfileLimit();
  const envLimit = process.env["BASH_MAX_OUTPUT_LENGTH"];
  const configured = profileLimit ?? (envLimit ? parseInt(envLimit, 10) : null);
  if (configured !== null && configured <= BASH_RECOMMENDED_LIMIT) return null;
  const limit = configured ?? BASH_DEFAULT_LIMIT;
  const extraChars = limit - BASH_RECOMMENDED_LIMIT;
  const tokensSaved = Math.round(extraChars * BASH_TOKENS_PER_CHAR);
  return {
    title: "Shrink bash output limit",
    explanation: `Your bash output cap is ${(limit / 1e3).toFixed(0)}K chars (${configured ? "configured" : "default"}). Most output fits in ${(BASH_RECOMMENDED_LIMIT / 1e3).toFixed(0)}K. The extra ~${formatTokens(tokensSaved)} tokens per bash call is trailing noise.`,
    impact: "medium",
    tokensSaved,
    fix: {
      type: "paste",
      label: "Add to ~/.zshrc or ~/.bashrc:",
      text: `export BASH_MAX_OUTPUT_LENGTH=${BASH_RECOMMENDED_LIMIT}`
    }
  };
}
var HEALTH_WEIGHTS = {
  high: HEALTH_WEIGHT_HIGH,
  medium: HEALTH_WEIGHT_MEDIUM,
  low: HEALTH_WEIGHT_LOW
};
function computeHealth(findings) {
  if (findings.length === 0) return { score: 100, grade: "A" };
  let penalty = 0;
  for (const f of findings) penalty += HEALTH_WEIGHTS[f.impact] ?? 0;
  const score = Math.max(0, 100 - Math.min(HEALTH_MAX_PENALTY, penalty));
  const grade = score >= GRADE_A_MIN ? "A" : score >= GRADE_B_MIN ? "B" : score >= GRADE_C_MIN ? "C" : score >= GRADE_D_MIN ? "D" : "F";
  return { score, grade };
}
var URGENCY_WEIGHTS = { high: 1, medium: 0.5, low: 0.2 };
function urgencyScore(f) {
  const normalizedTokens = Math.min(1, f.tokensSaved / URGENCY_TOKEN_NORMALIZE);
  return URGENCY_WEIGHTS[f.impact] * URGENCY_IMPACT_WEIGHT + normalizedTokens * URGENCY_TOKEN_WEIGHT;
}
function computeTrend(inputs) {
  const { recentCount, recentWindowMs, baselineCount, baselineWindowMs, hasRecentActivity } = inputs;
  if (baselineCount === 0) return "active";
  if (recentCount === 0 && hasRecentActivity) return "resolved";
  if (!hasRecentActivity) return "active";
  const baselineRate = baselineCount / baselineWindowMs;
  const recentRate = recentCount / Math.max(recentWindowMs, 1);
  if (recentRate < baselineRate * IMPROVING_THRESHOLD) return "improving";
  return "active";
}
function sessionTrend(recentItemCount, totalItemCount, dateRange, hasRecentActivity) {
  const now = Date.now();
  const baselineCount = totalItemCount - recentItemCount;
  const periodStart = dateRange ? dateRange.start.getTime() : now - DEFAULT_TREND_PERIOD_MS;
  const recentStart = now - RECENT_WINDOW_MS;
  const baselineWindowMs = Math.max(recentStart - periodStart, 1);
  return computeTrend({
    recentCount: recentItemCount,
    recentWindowMs: RECENT_WINDOW_MS,
    baselineCount,
    baselineWindowMs,
    hasRecentActivity
  });
}
var INPUT_COST_RATIO = 0.7;
var DEFAULT_COST_PER_TOKEN = 0;
function computeInputCostRate(projects) {
  const sessions = projects.flatMap((p) => p.sessions);
  const totalCost = sessions.reduce((s, sess) => s + sess.totalCostUSD, 0);
  const totalTokens = sessions.reduce((s, sess) => s + sess.totalInputTokens + sess.totalCacheReadTokens + sess.totalCacheWriteTokens, 0);
  if (totalTokens === 0 || totalCost === 0) return DEFAULT_COST_PER_TOKEN;
  return totalCost * INPUT_COST_RATIO / totalTokens;
}
var resultCache = /* @__PURE__ */ new Map();
function cacheKey2(projects, dateRange) {
  const dr = dateRange ? `${dateRange.start.getTime()}-${dateRange.end.getTime()}` : "all";
  const fingerprint = projects.length + ":" + projects.reduce((s, p) => s + p.totalApiCalls, 0);
  return `${dr}:${fingerprint}`;
}
async function scanAndDetect(projects, dateRange) {
  if (projects.length === 0) {
    return { findings: [], costRate: 0, healthScore: 100, healthGrade: "A" };
  }
  const key = cacheKey2(projects, dateRange);
  const cached = resultCache.get(key);
  if (cached && Date.now() - cached.ts < RESULT_CACHE_TTL_MS) return cached.data;
  const costRate = computeInputCostRate(projects);
  const { toolCalls, projectCwds, apiCalls, userMessages } = await scanSessions(dateRange);
  const findings = [];
  const syncDetectors = [
    () => detectCacheBloat(apiCalls, projects, dateRange),
    () => detectLowReadEditRatio(toolCalls),
    () => detectJunkReads(toolCalls, dateRange),
    () => detectDuplicateReads(toolCalls, dateRange),
    () => detectUnusedMcp(toolCalls, projects, projectCwds),
    () => detectBloatedClaudeMd(projectCwds),
    () => detectBashBloat()
  ];
  for (const detect of syncDetectors) {
    const finding = detect();
    if (finding) findings.push(finding);
  }
  const ghostResults = await Promise.all([
    detectGhostAgents(toolCalls),
    detectGhostSkills(toolCalls),
    detectGhostCommands(userMessages)
  ]);
  for (const f of ghostResults) if (f) findings.push(f);
  findings.sort((a, b) => urgencyScore(b) - urgencyScore(a));
  const { score, grade } = computeHealth(findings);
  const result = { findings, costRate, healthScore: score, healthGrade: grade };
  resultCache.set(key, { data: result, ts: Date.now() });
  return result;
}
var PANEL_WIDTH = 62;
var SEP = "\u2500";
var IMPACT_COLORS = { high: RED, medium: ORANGE, low: DIM };
var GRADE_COLORS = { A: GREEN, B: GREEN, C: GOLD, D: ORANGE, F: RED };
function wrap(text, width, indent) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    if (current && current.length + word.length + 1 > width) {
      lines.push(indent + current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current) lines.push(indent + current);
  return lines.join("\n");
}
function renderFinding(n, f, costRate) {
  const lines = [];
  const costSaved = f.tokensSaved * costRate;
  const impactLabel = f.impact.charAt(0).toUpperCase() + f.impact.slice(1);
  const trendBadge = f.trend === "improving" ? " improving \u2193 " : "";
  const savings = `~${formatTokens(f.tokensSaved)} tokens (~${formatCost(costSaved)})`;
  const titlePad = PANEL_WIDTH - f.title.length - impactLabel.length - trendBadge.length - 8;
  const pad = titlePad > 0 ? " " + SEP.repeat(titlePad) + " " : "  ";
  lines.push(chalk2.hex(DIM)(`  ${SEP}${SEP}${SEP} `) + chalk2.bold(`${n}. ${f.title}`) + chalk2.hex(DIM)(pad) + chalk2.hex(IMPACT_COLORS[f.impact])(impactLabel) + (trendBadge ? chalk2.hex(GREEN)(trendBadge) : "") + chalk2.hex(DIM)(` ${SEP}${SEP}${SEP}`));
  lines.push("");
  lines.push(wrap(f.explanation, PANEL_WIDTH - 4, "  "));
  lines.push("");
  lines.push(chalk2.hex(GOLD)(`  Potential savings: ${savings}`));
  lines.push("");
  const a = f.fix;
  if (a.type === "file-content") {
    lines.push(chalk2.hex(DIM)(`  ${a.label}`));
    for (const line of a.content.split("\n")) lines.push(chalk2.hex(CYAN)(`    ${line}`));
  } else if (a.type === "command") {
    lines.push(chalk2.hex(DIM)(`  ${a.label}`));
    for (const line of a.text.split("\n")) lines.push(chalk2.hex(CYAN)(`    ${line}`));
  } else {
    lines.push(chalk2.hex(DIM)(`  ${a.label}`));
    lines.push(chalk2.hex(CYAN)(`    ${a.text}`));
  }
  lines.push("");
  return lines;
}
function renderOptimize(findings, costRate, periodLabel, periodCost, sessionCount, callCount, healthScore, healthGrade) {
  const lines = [];
  lines.push("");
  lines.push(`  ${chalk2.bold.hex(ORANGE)("CodeBurn config health")}${chalk2.dim("  " + periodLabel)}`);
  lines.push(chalk2.hex(DIM)("  " + SEP.repeat(PANEL_WIDTH)));
  const issueSuffix = findings.length > 0 ? `, ${findings.length} issue${findings.length > 1 ? "s" : ""}` : "";
  lines.push("  " + [
    `${sessionCount} sessions`,
    `${callCount.toLocaleString()} calls`,
    chalk2.hex(GOLD)(formatCost(periodCost)),
    `Health: ${chalk2.bold.hex(GRADE_COLORS[healthGrade])(healthGrade)}${chalk2.dim(` (${healthScore}/100${issueSuffix})`)}`
  ].join(chalk2.hex(DIM)("   ")));
  lines.push("");
  if (findings.length === 0) {
    lines.push(chalk2.hex(GREEN)("  Nothing to fix. Your setup is lean."));
    lines.push("");
    lines.push(chalk2.dim("  CodeBurn optimize scans your Claude Code sessions and config for"));
    lines.push(chalk2.dim("  token waste: junk directory reads, duplicate file reads, unused"));
    lines.push(chalk2.dim("  agents/skills/MCP servers, bloated CLAUDE.md, and more."));
    lines.push("");
    return lines.join("\n");
  }
  const totalTokens = findings.reduce((s, f) => s + f.tokensSaved, 0);
  const totalCost = totalTokens * costRate;
  const pctRaw = periodCost > 0 ? totalCost / periodCost * 100 : 0;
  const pct2 = pctRaw >= 1 ? pctRaw.toFixed(0) : pctRaw.toFixed(1);
  const costText = costRate > 0 ? ` (~${formatCost(totalCost)}, ~${pct2}% of spend)` : "";
  lines.push(chalk2.hex(GREEN)(`  Potential savings: ~${formatTokens(totalTokens)} tokens${costText}`));
  lines.push("");
  for (let i = 0; i < findings.length; i++) {
    lines.push(...renderFinding(i + 1, findings[i], costRate));
  }
  lines.push(chalk2.hex(DIM)("  " + SEP.repeat(PANEL_WIDTH)));
  lines.push(chalk2.dim("  Estimates only."));
  lines.push("");
  return lines.join("\n");
}
async function runOptimize(projects, periodLabel, dateRange) {
  if (projects.length === 0) {
    console.log(chalk2.dim("\n  No usage data found for this period.\n"));
    return;
  }
  process.stderr.write(chalk2.dim("  Analyzing your sessions...\n"));
  const { findings, costRate, healthScore, healthGrade } = await scanAndDetect(projects, dateRange);
  const sessions = projects.flatMap((p) => p.sessions);
  const periodCost = projects.reduce((s, p) => s + p.totalCostUSD, 0);
  const callCount = projects.reduce((s, p) => s + p.totalApiCalls, 0);
  const output = renderOptimize(findings, costRate, periodLabel, periodCost, sessions.length, callCount, healthScore, healthGrade);
  console.log(output);
}

// src/context-budget.ts
init_fs_utils();
import { readdir as readdir11 } from "fs/promises";
import { existsSync as existsSync5 } from "fs";
import { join as join18 } from "path";
import { homedir as homedir15 } from "os";
var CHARS_PER_TOKEN3 = 4;
var SYSTEM_BASE_TOKENS = 10400;
var TOOL_TOKENS_OVERHEAD = 400;
var SKILL_FRONTMATTER_TOKENS = 80;
function estimateTokens2(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN3);
}
async function readConfigFile(path) {
  if (!existsSync5(path)) return null;
  const raw = await readSessionFile(path);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function countMcpTools(projectPath) {
  const home = homedir15();
  const configPaths = [
    join18(home, ".claude", "settings.json"),
    join18(home, ".claude", "settings.local.json")
  ];
  if (projectPath) {
    configPaths.push(join18(projectPath, ".mcp.json"));
    configPaths.push(join18(projectPath, ".claude", "settings.json"));
    configPaths.push(join18(projectPath, ".claude", "settings.local.json"));
  }
  const servers = /* @__PURE__ */ new Set();
  let toolCount = 0;
  for (const p of configPaths) {
    const config = await readConfigFile(p);
    if (!config) continue;
    const mcpServers = config.mcpServers ?? {};
    for (const name of Object.keys(mcpServers)) {
      if (servers.has(name)) continue;
      servers.add(name);
      toolCount += 5;
    }
  }
  return toolCount;
}
async function countSkills(projectPath) {
  const dirs = [join18(homedir15(), ".claude", "skills")];
  if (projectPath) dirs.push(join18(projectPath, ".claude", "skills"));
  let count = 0;
  for (const dir of dirs) {
    if (!existsSync5(dir)) continue;
    try {
      const entries = await readdir11(dir);
      for (const entry of entries) {
        const skillFile = join18(dir, entry, "SKILL.md");
        if (existsSync5(skillFile)) count++;
      }
    } catch {
      continue;
    }
  }
  return count;
}
async function scanMemoryFiles(projectPath) {
  const home = homedir15();
  const files = [];
  const paths = [
    { path: join18(home, ".claude", "CLAUDE.md"), name: "~/.claude/CLAUDE.md" }
  ];
  if (projectPath) {
    paths.push({ path: join18(projectPath, "CLAUDE.md"), name: "CLAUDE.md" });
    paths.push({ path: join18(projectPath, ".claude", "CLAUDE.md"), name: ".claude/CLAUDE.md" });
    paths.push({ path: join18(projectPath, "CLAUDE.local.md"), name: "CLAUDE.local.md" });
  }
  for (const { path, name } of paths) {
    if (!existsSync5(path)) continue;
    const content = await readSessionFile(path);
    if (content === null) continue;
    files.push({ name, tokens: estimateTokens2(content) });
  }
  return files;
}
async function estimateContextBudget(projectPath, modelContext = 1e6) {
  const mcpToolCount = await countMcpTools(projectPath);
  const skillCount = await countSkills(projectPath);
  const memoryFiles = await scanMemoryFiles(projectPath);
  const mcpTokens = mcpToolCount * TOOL_TOKENS_OVERHEAD;
  const skillTokens = skillCount * SKILL_FRONTMATTER_TOKENS;
  const memoryTokens = memoryFiles.reduce((s, f) => s + f.tokens, 0);
  const total = SYSTEM_BASE_TOKENS + mcpTokens + skillTokens + memoryTokens;
  return {
    systemBase: SYSTEM_BASE_TOKENS,
    mcpTools: { count: mcpToolCount, tokens: mcpTokens },
    skills: { count: skillCount, tokens: skillTokens },
    memory: { count: memoryFiles.length, tokens: memoryTokens, files: memoryFiles },
    total,
    modelContext
  };
}
async function discoverProjectCwd(sessionDir) {
  let files;
  try {
    files = (await readdir11(sessionDir)).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  const content = await readSessionFile(join18(sessionDir, files[0]));
  if (content === null) return null;
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.cwd && typeof entry.cwd === "string") return entry.cwd;
    } catch {
      continue;
    }
  }
  return null;
}

// src/compare.tsx
import React, { useState, useEffect, useRef } from "react";
import { render, Box, Text, useInput, useApp, useStdout } from "ink";

// src/compare-stats.ts
import { readdir as readdir12, readFile as readFile8 } from "fs/promises";
import { join as join19 } from "path";
var PLANNING_TOOLS = /* @__PURE__ */ new Set(["TaskCreate", "TaskUpdate", "TodoWrite", "EnterPlanMode", "ExitPlanMode"]);
function aggregateModelStats(projects) {
  const byModel = /* @__PURE__ */ new Map();
  const ensure = (model) => {
    let s = byModel.get(model);
    if (!s) {
      s = { model, calls: 0, cost: 0, outputTokens: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTurns: 0, editTurns: 0, oneShotTurns: 0, retries: 0, selfCorrections: 0, editCost: 0, firstSeen: "", lastSeen: "" };
      byModel.set(model, s);
    }
    return s;
  };
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const turn of session.turns) {
        if (turn.assistantCalls.length === 0) continue;
        const primaryModel = turn.assistantCalls[0].model;
        if (primaryModel === "<synthetic>") continue;
        const ms = ensure(primaryModel);
        ms.totalTurns++;
        if (turn.hasEdits) {
          ms.editTurns++;
          if (turn.retries === 0) ms.oneShotTurns++;
          for (const c of turn.assistantCalls) {
            if (c.model !== "<synthetic>") ms.editCost += c.costUSD;
          }
        }
        ms.retries += turn.retries;
        for (const call of turn.assistantCalls) {
          if (call.model === "<synthetic>") continue;
          const cs = call.model === primaryModel ? ms : ensure(call.model);
          cs.calls++;
          cs.cost += call.costUSD;
          cs.outputTokens += call.usage.outputTokens;
          cs.inputTokens += call.usage.inputTokens;
          cs.cacheReadTokens += call.usage.cacheReadInputTokens;
          cs.cacheWriteTokens += call.usage.cacheCreationInputTokens;
          if (!cs.firstSeen || call.timestamp < cs.firstSeen) cs.firstSeen = call.timestamp;
          if (!cs.lastSeen || call.timestamp > cs.lastSeen) cs.lastSeen = call.timestamp;
        }
      }
    }
  }
  return [...byModel.values()].sort((a, b) => b.cost - a.cost);
}
var METRICS = [
  {
    section: "Performance",
    label: "One-shot rate",
    formatFn: "percent",
    higherIsBetter: true,
    compute: (s) => s.editTurns > 0 ? s.oneShotTurns / s.editTurns * 100 : null
  },
  {
    section: "Performance",
    label: "Retry rate",
    formatFn: "decimal",
    higherIsBetter: false,
    compute: (s) => s.editTurns > 0 ? s.retries / s.editTurns : null
  },
  {
    section: "Performance",
    label: "Self-correction",
    formatFn: "percent",
    higherIsBetter: false,
    compute: (s) => s.totalTurns > 0 ? s.selfCorrections / s.totalTurns * 100 : null
  },
  {
    section: "Efficiency",
    label: "Cost / call",
    formatFn: "cost",
    higherIsBetter: false,
    compute: (s) => s.calls > 0 ? s.cost / s.calls : null
  },
  {
    section: "Efficiency",
    label: "Cost / edit",
    formatFn: "cost",
    higherIsBetter: false,
    compute: (s) => s.editTurns > 0 ? s.editCost / s.editTurns : null
  },
  {
    section: "Efficiency",
    label: "Output tok / call",
    formatFn: "number",
    higherIsBetter: false,
    compute: (s) => s.calls > 0 ? Math.round(s.outputTokens / s.calls) : null
  },
  {
    section: "Efficiency",
    label: "Cache hit rate",
    formatFn: "percent",
    higherIsBetter: true,
    compute: (s) => {
      const total = s.inputTokens + s.cacheReadTokens + s.cacheWriteTokens;
      return total > 0 ? s.cacheReadTokens / total * 100 : null;
    }
  }
];
function pickWinner(valueA, valueB, higherIsBetter) {
  if (valueA === null || valueB === null) return "none";
  if (valueA === valueB) return "tie";
  if (higherIsBetter) return valueA > valueB ? "a" : "b";
  return valueA < valueB ? "a" : "b";
}
function computeComparison(a, b) {
  return METRICS.map((m) => {
    const valueA = m.compute(a);
    const valueB = m.compute(b);
    return {
      section: m.section,
      label: m.label,
      valueA,
      valueB,
      formatFn: m.formatFn,
      winner: pickWinner(valueA, valueB, m.higherIsBetter)
    };
  });
}
function computeCategoryComparison(projects, modelA, modelB) {
  const mapA = /* @__PURE__ */ new Map();
  const mapB = /* @__PURE__ */ new Map();
  const ensure = (map, cat) => {
    let a = map.get(cat);
    if (!a) {
      a = { turns: 0, editTurns: 0, oneShotTurns: 0 };
      map.set(cat, a);
    }
    return a;
  };
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const turn of session.turns) {
        if (turn.assistantCalls.length === 0) continue;
        const primary = turn.assistantCalls[0].model;
        if (primary !== modelA && primary !== modelB) continue;
        const acc = ensure(primary === modelA ? mapA : mapB, turn.category);
        acc.turns++;
        if (turn.hasEdits) {
          acc.editTurns++;
          if (turn.retries === 0) acc.oneShotTurns++;
        }
      }
    }
  }
  const allCats = /* @__PURE__ */ new Set([...mapA.keys(), ...mapB.keys()]);
  const result = [];
  for (const category of allCats) {
    const a = mapA.get(category);
    const b = mapB.get(category);
    if ((!a || a.editTurns === 0) && (!b || b.editTurns === 0)) continue;
    const rateA = a && a.editTurns > 0 ? a.oneShotTurns / a.editTurns * 100 : null;
    const rateB = b && b.editTurns > 0 ? b.oneShotTurns / b.editTurns * 100 : null;
    result.push({
      category,
      turnsA: a?.turns ?? 0,
      editTurnsA: a?.editTurns ?? 0,
      oneShotRateA: rateA,
      turnsB: b?.turns ?? 0,
      editTurnsB: b?.editTurns ?? 0,
      oneShotRateB: rateB,
      winner: pickWinner(rateA, rateB, true)
    });
  }
  return result.sort((a, b) => b.turnsA + b.turnsB - (a.turnsA + a.turnsB));
}
function computeWorkingStyle(projects, modelA, modelB) {
  const sA = { totalTurns: 0, agentSpawns: 0, planModeUses: 0, totalToolCalls: 0, fastModeCalls: 0 };
  const sB = { totalTurns: 0, agentSpawns: 0, planModeUses: 0, totalToolCalls: 0, fastModeCalls: 0 };
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const turn of session.turns) {
        if (turn.assistantCalls.length === 0) continue;
        const primary = turn.assistantCalls[0].model;
        if (primary !== modelA && primary !== modelB) continue;
        const s = primary === modelA ? sA : sB;
        s.totalTurns++;
        const turnTools = turn.assistantCalls.flatMap((c) => c.tools);
        if (turnTools.some((t) => PLANNING_TOOLS.has(t)) || turn.assistantCalls.some((c) => c.hasPlanMode)) {
          s.planModeUses++;
        }
        for (const call of turn.assistantCalls) {
          s.totalToolCalls += call.tools.length;
          if (call.hasAgentSpawn) s.agentSpawns++;
          if (call.speed === "fast") s.fastModeCalls++;
        }
      }
    }
  }
  const pct2 = (num, den) => den > 0 ? num / den * 100 : null;
  const avg = (num, den) => den > 0 ? num / den : null;
  return [
    { label: "Delegation rate", valueA: pct2(sA.agentSpawns, sA.totalTurns), valueB: pct2(sB.agentSpawns, sB.totalTurns), formatFn: "percent" },
    { label: "Planning rate", valueA: pct2(sA.planModeUses, sA.totalTurns), valueB: pct2(sB.planModeUses, sB.totalTurns), formatFn: "percent" },
    { label: "Avg tools / turn", valueA: avg(sA.totalToolCalls, sA.totalTurns), valueB: avg(sB.totalToolCalls, sB.totalTurns), formatFn: "decimal" },
    { label: "Fast mode usage", valueA: pct2(sA.fastModeCalls, sA.totalTurns), valueB: pct2(sB.fastModeCalls, sB.totalTurns), formatFn: "percent" }
  ];
}
var SELF_CORRECTION_PATTERNS = [
  /\bmy mistake\b/i,
  /\bmy bad\b/i,
  /\bmy apolog/i,
  /\bI apologize\b/i,
  /\bI was wrong\b/i,
  /\bI was incorrect\b/i,
  /\bI made (a |an )?(error|mistake)\b/i,
  /\bI incorrectly\b/i,
  /\bI mistakenly\b/i,
  /\bthat was (incorrect|wrong|an error)\b/i,
  /\blet me correct that\b/i,
  /\bI need to correct\b/i,
  /\byou're right[.,]? I/i,
  /\bsorry about that\b/i
];
function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b !== null && typeof b === "object" && b.type === "text" && typeof b.text === "string").map((b) => b.text).join(" ");
}
function isCompactFile(name) {
  return name.includes("compact");
}
async function collectJsonlFiles4(sessionDir) {
  const entries = await readdir12(sessionDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".jsonl") && !isCompactFile(entry.name)) {
      files.push(join19(sessionDir, entry.name));
    } else if (entry.isDirectory() && entry.name === "subagents") {
      const subEntries = await readdir12(join19(sessionDir, entry.name), { withFileTypes: true });
      for (const sub of subEntries) {
        if (sub.isFile() && sub.name.endsWith(".jsonl") && !isCompactFile(sub.name)) {
          files.push(join19(sessionDir, entry.name, sub.name));
        }
      }
    }
  }
  return files;
}
async function scanSelfCorrections(projectDirs) {
  const counts = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Set();
  for (const dir of projectDirs) {
    let entries;
    try {
      entries = await readdir12(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const allFiles = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".jsonl") && !isCompactFile(entry.name)) {
        allFiles.push(join19(dir, entry.name));
      } else if (entry.isDirectory()) {
        try {
          const sessionFiles = await collectJsonlFiles4(join19(dir, entry.name));
          allFiles.push(...sessionFiles);
        } catch {
          continue;
        }
      }
    }
    for (const file of allFiles) {
      let raw;
      try {
        raw = await readFile8(file, "utf8");
      } catch {
        continue;
      }
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }
        const rec = parsed;
        if (!rec || typeof rec !== "object" || rec["type"] !== "assistant") continue;
        const ts = rec["timestamp"];
        const msg = rec["message"];
        if (msg === null || typeof msg !== "object") continue;
        const msgRec = msg;
        const model = msgRec["model"];
        if (typeof model !== "string" || model === "<synthetic>") continue;
        const dedupeKey = `${model}:${ts}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        const text = extractText(msgRec["content"]);
        if (SELF_CORRECTION_PATTERNS.some((p) => p.test(text))) {
          counts.set(model, (counts.get(model) ?? 0) + 1);
        }
      }
    }
  }
  return counts;
}

// src/compare.tsx
init_parser();
init_providers();
import { jsx, jsxs } from "react/jsx-runtime";
var ORANGE2 = "#FF8C42";
var GREEN2 = "#5BF5A0";
var DIM2 = "#888888";
var GOLD2 = "#FFD700";
var BAR_A = "#6495ED";
var BAR_B = "#5BF5A0";
var LOW_DATA_THRESHOLD = 20;
var LABEL_WIDTH = 20;
var VALUE_WIDTH = 14;
var MODEL_NAME_COL = 24;
var BAR_MAX_WIDTH = 30;
var MIN_WIDE = 90;
var MS_PER_DAY = 24 * 60 * 60 * 1e3;
var FULL_BLOCK = "\u2588";
function formatValue(value, fmt) {
  if (value === null) return "-";
  switch (fmt) {
    case "cost":
      return formatCost(value);
    case "number":
      return Math.round(value).toLocaleString();
    case "percent":
      return `${value.toFixed(1)}%`;
    case "decimal":
      return value.toFixed(2);
  }
}
function shortName(model) {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}
function daysOfData(first, last) {
  if (!first || !last) return 0;
  const ms = new Date(last).getTime() - new Date(first).getTime();
  return Math.max(1, Math.ceil(ms / MS_PER_DAY));
}
function barWidth(rate) {
  return Math.round(rate / 100 * BAR_MAX_WIDTH);
}
function ModelSelector({ models, onSelect, onBack }) {
  const { exit } = useApp();
  const [cursor2, setCursor] = useState(0);
  const [selected, setSelected] = useState(/* @__PURE__ */ new Set());
  useInput((input, key) => {
    if (input === "q") {
      exit();
      return;
    }
    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) {
      setCursor((c) => (c - 1 + models.length) % models.length);
      return;
    }
    if (key.downArrow) {
      setCursor((c) => (c + 1) % models.length);
      return;
    }
    if (input === " ") {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(cursor2)) {
          next.delete(cursor2);
        } else if (next.size < 2) {
          next.add(cursor2);
        }
        return next;
      });
      return;
    }
    if (key.return && selected.size === 2) {
      const indices = [...selected].sort((a, b) => a - b);
      onSelect(models[indices[0]], models[indices[1]]);
    }
  });
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [
    /* @__PURE__ */ jsxs(Box, { flexDirection: "column", borderStyle: "round", borderColor: ORANGE2, paddingX: 1, children: [
      /* @__PURE__ */ jsx(Text, { bold: true, color: ORANGE2, children: "Model Comparison" }),
      /* @__PURE__ */ jsx(Text, { children: " " }),
      /* @__PURE__ */ jsx(Text, { color: DIM2, children: "Select two models to compare:" }),
      /* @__PURE__ */ jsx(Text, { children: " " }),
      models.map((m, i) => {
        const isCursor = i === cursor2;
        const isSelected = selected.has(i);
        const lowData = m.calls < LOW_DATA_THRESHOLD;
        const prefix = isCursor ? "> " : "  ";
        return /* @__PURE__ */ jsxs(Text, { children: [
          /* @__PURE__ */ jsx(Text, { color: isCursor ? ORANGE2 : void 0, children: prefix }),
          /* @__PURE__ */ jsx(Text, { bold: isSelected, color: isSelected ? GREEN2 : void 0, children: shortName(m.model).padEnd(MODEL_NAME_COL) }),
          /* @__PURE__ */ jsxs(Text, { children: [
            m.calls.toLocaleString().padStart(8),
            " calls"
          ] }),
          /* @__PURE__ */ jsx(Text, { color: GOLD2, children: formatCost(m.cost).padStart(10) }),
          isSelected && /* @__PURE__ */ jsx(Text, { color: GREEN2, children: "   [selected]" }),
          lowData && /* @__PURE__ */ jsx(Text, { color: DIM2, children: "   low data" })
        ] }, m.model);
      })
    ] }),
    /* @__PURE__ */ jsx(Text, { children: " " }),
    /* @__PURE__ */ jsxs(Text, { children: [
      /* @__PURE__ */ jsx(Text, { color: ORANGE2, bold: true, children: "[space]" }),
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: " select  " }),
      /* @__PURE__ */ jsx(Text, { color: ORANGE2, bold: true, children: "[enter]" }),
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: " compare  " }),
      /* @__PURE__ */ jsx(Text, { color: ORANGE2, bold: true, children: "<>" }),
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: " switch period  " }),
      /* @__PURE__ */ jsx(Text, { color: ORANGE2, bold: true, children: "[esc]" }),
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: " back  " }),
      /* @__PURE__ */ jsx(Text, { color: ORANGE2, bold: true, children: "[q]" }),
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: " quit" })
    ] })
  ] });
}
function MetricPanel({ title, rows, nameA, nameB, pw }) {
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", borderStyle: "round", borderColor: ORANGE2, paddingX: 1, width: pw, children: [
    /* @__PURE__ */ jsx(Text, { bold: true, color: ORANGE2, children: title }),
    /* @__PURE__ */ jsxs(Text, { children: [
      /* @__PURE__ */ jsx(Text, { children: "".padEnd(LABEL_WIDTH) }),
      /* @__PURE__ */ jsx(Text, { bold: true, children: nameA.padStart(VALUE_WIDTH) }),
      /* @__PURE__ */ jsx(Text, { bold: true, children: nameB.padStart(VALUE_WIDTH) })
    ] }),
    rows.map((row) => {
      const fmtA = formatValue(row.valueA, row.formatFn);
      const fmtB = formatValue(row.valueB, row.formatFn);
      return /* @__PURE__ */ jsxs(Text, { children: [
        /* @__PURE__ */ jsx(Text, { color: DIM2, children: row.label.padEnd(LABEL_WIDTH) }),
        /* @__PURE__ */ jsx(Text, { color: row.winner === "a" ? GREEN2 : void 0, children: fmtA.padStart(VALUE_WIDTH) }),
        /* @__PURE__ */ jsx(Text, { color: row.winner === "b" ? GREEN2 : void 0, children: fmtB.padStart(VALUE_WIDTH) })
      ] }, row.label);
    })
  ] });
}
function ContextPanel({ title, rows, nameA, nameB, pw, lowDataWarning }) {
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", borderStyle: "round", borderColor: ORANGE2, paddingX: 1, width: pw, children: [
    /* @__PURE__ */ jsx(Text, { bold: true, color: ORANGE2, children: title }),
    /* @__PURE__ */ jsxs(Text, { children: [
      /* @__PURE__ */ jsx(Text, { children: "".padEnd(LABEL_WIDTH) }),
      /* @__PURE__ */ jsx(Text, { bold: true, children: nameA.padStart(VALUE_WIDTH) }),
      /* @__PURE__ */ jsx(Text, { bold: true, children: nameB.padStart(VALUE_WIDTH) })
    ] }),
    rows.map((row) => /* @__PURE__ */ jsxs(Text, { children: [
      /* @__PURE__ */ jsx(Text, { color: DIM2, children: row.label.padEnd(LABEL_WIDTH) }),
      /* @__PURE__ */ jsx(Text, { color: DIM2, children: row.valueA.padStart(VALUE_WIDTH) }),
      /* @__PURE__ */ jsx(Text, { color: DIM2, children: row.valueB.padStart(VALUE_WIDTH) })
    ] }, row.label)),
    lowDataWarning && /* @__PURE__ */ jsx(Text, { color: GOLD2, children: lowDataWarning })
  ] });
}
function ComparisonResults({ modelA, modelB, rows, categories, workingStyle, onBack }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termWidth = stdout?.columns || 80;
  const dashWidth = Math.min(160, termWidth);
  const wide = dashWidth >= MIN_WIDE;
  const halfWidth = wide ? Math.floor(dashWidth / 2) : dashWidth;
  const nameA = shortName(modelA.model);
  const nameB = shortName(modelB.model);
  const lowDataA = modelA.calls < LOW_DATA_THRESHOLD;
  const lowDataB = modelB.calls < LOW_DATA_THRESHOLD;
  useInput((input, key) => {
    if (input === "q") {
      exit();
      return;
    }
    if (key.escape) {
      onBack();
      return;
    }
  });
  const sectionOrder = [];
  const sectionRows = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (!sectionRows.has(row.section)) {
      sectionOrder.push(row.section);
      sectionRows.set(row.section, []);
    }
    sectionRows.get(row.section).push(row);
  }
  const fmtTokens = (n) => {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return String(n);
  };
  const contextRows = [
    { label: "Calls", valueA: modelA.calls.toLocaleString(), valueB: modelB.calls.toLocaleString() },
    { label: "Total cost", valueA: formatCost(modelA.cost), valueB: formatCost(modelB.cost) },
    { label: "Input tokens", valueA: fmtTokens(modelA.inputTokens), valueB: fmtTokens(modelB.inputTokens) },
    { label: "Output tokens", valueA: fmtTokens(modelA.outputTokens), valueB: fmtTokens(modelB.outputTokens) },
    { label: "Days of data", valueA: String(daysOfData(modelA.firstSeen, modelA.lastSeen)), valueB: String(daysOfData(modelB.firstSeen, modelB.lastSeen)) },
    { label: "Edit turns", valueA: modelA.editTurns.toLocaleString(), valueB: modelB.editTurns.toLocaleString() },
    { label: "Self-corrections", valueA: modelA.selfCorrections.toLocaleString(), valueB: modelB.selfCorrections.toLocaleString() }
  ];
  const lowDataWarning = lowDataA || lowDataB ? `Note: ${[lowDataA && shortName(modelA.model), lowDataB && shortName(modelB.model)].filter(Boolean).join(" and ")} ha${lowDataA && lowDataB ? "ve" : "s"} fewer than ${LOW_DATA_THRESHOLD} calls` : void 0;
  const pw = wide ? halfWidth : dashWidth;
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [
    /* @__PURE__ */ jsx(Box, { flexDirection: "column", borderStyle: "round", borderColor: ORANGE2, paddingX: 1, width: dashWidth, children: /* @__PURE__ */ jsxs(Text, { children: [
      /* @__PURE__ */ jsx(Text, { bold: true, color: ORANGE2, children: nameA }),
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: "  vs  " }),
      /* @__PURE__ */ jsx(Text, { bold: true, color: ORANGE2, children: nameB })
    ] }) }),
    /* @__PURE__ */ jsxs(Box, { width: dashWidth, children: [
      /* @__PURE__ */ jsx(MetricPanel, { title: sectionOrder[0] ?? "Performance", rows: sectionRows.get(sectionOrder[0] ?? "") ?? [], nameA, nameB, pw }),
      /* @__PURE__ */ jsx(MetricPanel, { title: sectionOrder[1] ?? "Efficiency", rows: sectionRows.get(sectionOrder[1] ?? "") ?? [], nameA, nameB, pw })
    ] }),
    categories.length > 0 && /* @__PURE__ */ jsxs(Box, { flexDirection: "column", borderStyle: "round", borderColor: ORANGE2, paddingX: 1, width: dashWidth, children: [
      /* @__PURE__ */ jsx(Text, { bold: true, color: ORANGE2, children: "Category Head-to-Head" }),
      /* @__PURE__ */ jsx(Text, { color: DIM2, children: "one-shot rate per category" }),
      /* @__PURE__ */ jsxs(Text, { children: [
        /* @__PURE__ */ jsx(Text, { children: "  " }),
        /* @__PURE__ */ jsx(Text, { color: BAR_A, children: FULL_BLOCK + FULL_BLOCK }),
        /* @__PURE__ */ jsxs(Text, { children: [
          " ",
          nameA,
          "    "
        ] }),
        /* @__PURE__ */ jsx(Text, { color: BAR_B, children: FULL_BLOCK + FULL_BLOCK }),
        /* @__PURE__ */ jsxs(Text, { children: [
          " ",
          nameB
        ] })
      ] }),
      categories.map((cat) => {
        const bwA = cat.oneShotRateA !== null ? barWidth(cat.oneShotRateA) : 0;
        const bwB = cat.oneShotRateB !== null ? barWidth(cat.oneShotRateB) : 0;
        const rateA = cat.oneShotRateA !== null ? `${cat.oneShotRateA.toFixed(1)}%` : "-";
        const rateB = cat.oneShotRateB !== null ? `${cat.oneShotRateB.toFixed(1)}%` : "-";
        const turnsA = cat.editTurnsA > 0 ? `(${cat.editTurnsA})` : "";
        const turnsB = cat.editTurnsB > 0 ? `(${cat.editTurnsB})` : "";
        return /* @__PURE__ */ jsxs(React.Fragment, { children: [
          /* @__PURE__ */ jsx(Text, { children: " " }),
          /* @__PURE__ */ jsxs(Text, { color: DIM2, children: [
            "  ",
            cat.category
          ] }),
          /* @__PURE__ */ jsxs(Text, { children: [
            /* @__PURE__ */ jsx(Text, { children: "  " }),
            /* @__PURE__ */ jsx(Text, { color: BAR_A, children: FULL_BLOCK.repeat(Math.max(bwA, 1)) }),
            /* @__PURE__ */ jsxs(Text, { children: [
              " ".repeat(Math.max(0, BAR_MAX_WIDTH - bwA)),
              " "
            ] }),
            /* @__PURE__ */ jsx(Text, { color: cat.winner === "a" ? GREEN2 : void 0, children: rateA.padStart(6) }),
            /* @__PURE__ */ jsxs(Text, { color: DIM2, children: [
              " ",
              turnsA
            ] })
          ] }),
          /* @__PURE__ */ jsxs(Text, { children: [
            /* @__PURE__ */ jsx(Text, { children: "  " }),
            /* @__PURE__ */ jsx(Text, { color: BAR_B, children: FULL_BLOCK.repeat(Math.max(bwB, 1)) }),
            /* @__PURE__ */ jsxs(Text, { children: [
              " ".repeat(Math.max(0, BAR_MAX_WIDTH - bwB)),
              " "
            ] }),
            /* @__PURE__ */ jsx(Text, { color: cat.winner === "b" ? GREEN2 : void 0, children: rateB.padStart(6) }),
            /* @__PURE__ */ jsxs(Text, { color: DIM2, children: [
              " ",
              turnsB
            ] })
          ] })
        ] }, cat.category);
      })
    ] }),
    /* @__PURE__ */ jsxs(Box, { width: dashWidth, children: [
      workingStyle.length > 0 && /* @__PURE__ */ jsx(ContextPanel, { title: "Working Style", rows: workingStyle.map((r) => ({ label: r.label, valueA: formatValue(r.valueA, r.formatFn), valueB: formatValue(r.valueB, r.formatFn) })), nameA, nameB, pw }),
      /* @__PURE__ */ jsx(ContextPanel, { title: "Context", rows: contextRows, nameA, nameB, pw, lowDataWarning })
    ] }),
    /* @__PURE__ */ jsxs(Text, { children: [
      /* @__PURE__ */ jsx(Text, { color: ORANGE2, bold: true, children: "<>" }),
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: " switch period  " }),
      /* @__PURE__ */ jsx(Text, { color: ORANGE2, bold: true, children: "[esc]" }),
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: " back  " }),
      /* @__PURE__ */ jsx(Text, { color: ORANGE2, bold: true, children: "[q]" }),
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: " quit" })
    ] })
  ] });
}
function CompareView({ projects, onBack }) {
  const { exit } = useApp();
  const [phase, setPhase] = useState("select");
  const [models, setModels] = useState(() => aggregateModelStats(projects));
  const [pickedNames, setPickedNames] = useState(null);
  const [selectedA, setSelectedA] = useState(null);
  const [selectedB, setSelectedB] = useState(null);
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [style, setStyle] = useState([]);
  const [loadTrigger, setLoadTrigger] = useState(0);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  useEffect(() => {
    const newModels = aggregateModelStats(projects);
    setModels(newModels);
    if (pickedNames) {
      const hasA = newModels.some((m) => m.model === pickedNames[0]);
      const hasB = newModels.some((m) => m.model === pickedNames[1]);
      if (hasA && hasB) {
        setLoadTrigger((t) => t + 1);
      } else {
        setPickedNames(null);
        setPhase("select");
      }
    }
  }, [projects]);
  useEffect(() => {
    if (loadTrigger === 0 || !pickedNames) return;
    let cancelled = false;
    setPhase("loading");
    const currentModels = aggregateModelStats(projectsRef.current);
    const a = currentModels.find((m) => m.model === pickedNames[0]);
    const b = currentModels.find((m) => m.model === pickedNames[1]);
    if (!a || !b) {
      setPhase("select");
      return;
    }
    async function run() {
      const providers = await getAllProviders();
      const dirs = [];
      for (const p of providers) {
        const sessions = await p.discoverSessions();
        for (const s of sessions) dirs.push(s.path);
      }
      const corrections = await scanSelfCorrections(dirs);
      if (cancelled) return;
      const currentProjects = projectsRef.current;
      const aCopy = { ...a, selfCorrections: corrections.get(a.model) ?? 0 };
      const bCopy = { ...b, selfCorrections: corrections.get(b.model) ?? 0 };
      setSelectedA(aCopy);
      setSelectedB(bCopy);
      setRows(computeComparison(aCopy, bCopy));
      setCategories(computeCategoryComparison(currentProjects, a.model, b.model));
      setStyle(computeWorkingStyle(currentProjects, a.model, b.model));
      setPhase("results");
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [loadTrigger]);
  useInput((input, key) => {
    if (phase !== "select") return;
    if (models.length < 2) {
      if (input === "q") {
        exit();
        return;
      }
      if (key.escape) {
        onBack();
        return;
      }
    }
  });
  if (models.length < 2) {
    return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [
      /* @__PURE__ */ jsxs(Box, { flexDirection: "column", borderStyle: "round", borderColor: ORANGE2, paddingX: 1, children: [
        /* @__PURE__ */ jsx(Text, { bold: true, color: ORANGE2, children: "Model Comparison" }),
        /* @__PURE__ */ jsx(Text, { children: " " }),
        /* @__PURE__ */ jsxs(Text, { color: DIM2, children: [
          "Need at least 2 models to compare. Found ",
          models.length,
          "."
        ] })
      ] }),
      /* @__PURE__ */ jsx(Text, { children: " " }),
      /* @__PURE__ */ jsxs(Text, { children: [
        /* @__PURE__ */ jsx(Text, { color: ORANGE2, bold: true, children: "[esc]" }),
        /* @__PURE__ */ jsx(Text, { dimColor: true, children: " back  " }),
        /* @__PURE__ */ jsx(Text, { color: ORANGE2, bold: true, children: "[q]" }),
        /* @__PURE__ */ jsx(Text, { dimColor: true, children: " quit" })
      ] })
    ] });
  }
  const handleSelect = (a, b) => {
    setPickedNames([a.model, b.model]);
    setLoadTrigger((t) => t + 1);
  };
  if (phase === "loading") {
    return /* @__PURE__ */ jsx(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: /* @__PURE__ */ jsxs(Box, { flexDirection: "column", borderStyle: "round", borderColor: ORANGE2, paddingX: 1, children: [
      /* @__PURE__ */ jsx(Text, { bold: true, color: ORANGE2, children: "Model Comparison" }),
      /* @__PURE__ */ jsx(Text, { children: " " }),
      /* @__PURE__ */ jsx(Text, { color: DIM2, children: "Scanning self-corrections..." })
    ] }) });
  }
  if (phase === "results" && selectedA && selectedB) {
    return /* @__PURE__ */ jsx(
      ComparisonResults,
      {
        modelA: selectedA,
        modelB: selectedB,
        rows,
        categories,
        workingStyle: style,
        onBack: () => setPhase("select")
      }
    );
  }
  return /* @__PURE__ */ jsx(
    ModelSelector,
    {
      models,
      onSelect: handleSelect,
      onBack
    }
  );
}
async function renderCompare(range, provider) {
  const isTTY = process.stdin.isTTY && process.stdout.isTTY;
  if (!isTTY) {
    process.stdout.write("Model comparison requires an interactive terminal.\n");
    return;
  }
  const projects = await parseAllSessions(range, provider);
  const { waitUntilExit } = render(
    /* @__PURE__ */ jsx(CompareView, { projects, onBack: () => process.exit(0) })
  );
  await waitUntilExit();
}

// src/plan-usage.ts
init_parser();
var MS_PER_DAY2 = 24 * 60 * 60 * 1e3;
var PLAN_NEAR_THRESHOLD_PCT = 80;
function clampResetDay(resetDay) {
  if (!Number.isInteger(resetDay)) return 1;
  return Math.min(28, Math.max(1, resetDay ?? 1));
}
function computePeriodFromResetDay(resetDay, today) {
  const day = clampResetDay(resetDay);
  const year = today.getFullYear();
  const month = today.getMonth();
  if (today.getDate() >= day) {
    return {
      periodStart: new Date(year, month, day, 0, 0, 0, 0),
      periodEnd: new Date(year, month + 1, day, 0, 0, 0, 0)
    };
  }
  return {
    periodStart: new Date(year, month - 1, day, 0, 0, 0, 0),
    periodEnd: new Date(year, month, day, 0, 0, 0, 0)
  };
}
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}
function toLocalDateKey(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function toDayIndex(d) {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY2);
}
function diffCalendarDays(from, to) {
  return toDayIndex(to) - toDayIndex(from);
}
function projectMonthEnd(projects, periodStart, periodEnd, today, spent) {
  const dayCosts = /* @__PURE__ */ new Map();
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const turn of session.turns) {
        if (!turn.timestamp) continue;
        const ts = new Date(turn.timestamp);
        if (Number.isNaN(ts.getTime())) continue;
        if (ts < periodStart || ts > today) continue;
        const dayKey = toLocalDateKey(ts);
        const turnCost = turn.assistantCalls.reduce((sum, call) => sum + call.costUSD, 0);
        dayCosts.set(dayKey, (dayCosts.get(dayKey) ?? 0) + turnCost);
      }
    }
  }
  const elapsedDays = Math.max(1, diffCalendarDays(periodStart, today) + 1);
  const elapsedDailyCosts = [];
  for (let i = 0; i < elapsedDays; i++) {
    const date = new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate() + i);
    elapsedDailyCosts.push(dayCosts.get(toLocalDateKey(date)) ?? 0);
  }
  const trailingWindow = elapsedDailyCosts.slice(-7);
  const medianDailyCost = median(trailingWindow);
  const daysRemaining = Math.max(0, diffCalendarDays(today, periodEnd) - 1);
  return spent + medianDailyCost * daysRemaining;
}
function getPlanUsageFromProjects(plan, projects, today = /* @__PURE__ */ new Date()) {
  const { periodStart, periodEnd } = computePeriodFromResetDay(plan.resetDay, today);
  const spent = projects.reduce((sum, p) => sum + p.totalCostUSD, 0);
  const budgetUsd = plan.monthlyUsd;
  const percentUsed = budgetUsd > 0 ? spent / budgetUsd * 100 : 0;
  const status = percentUsed > 100 ? "over" : percentUsed >= PLAN_NEAR_THRESHOLD_PCT ? "near" : "under";
  const projectedMonthUsd = projectMonthEnd(projects, periodStart, periodEnd, today, spent);
  const daysUntilReset = Math.max(0, diffCalendarDays(today, periodEnd));
  return {
    plan,
    periodStart,
    periodEnd,
    spentApiEquivalentUsd: spent,
    budgetUsd,
    percentUsed,
    status,
    projectedMonthUsd,
    daysUntilReset
  };
}
async function getPlanUsage(plan, today = /* @__PURE__ */ new Date()) {
  const { periodStart } = computePeriodFromResetDay(plan.resetDay, today);
  const range = {
    start: periodStart,
    end: today
  };
  const provider = plan.provider === "all" ? "all" : plan.provider;
  const projects = await parseAllSessions(range, provider);
  return getPlanUsageFromProjects(plan, projects, today);
}
async function getPlanUsageOrNull(today = /* @__PURE__ */ new Date()) {
  const plan = await readPlan();
  if (!isActivePlan(plan)) return null;
  return getPlanUsage(plan, today);
}
function isActivePlan(plan) {
  return plan !== void 0 && plan.id !== "none" && Number.isFinite(plan.monthlyUsd) && plan.monthlyUsd > 0;
}

// src/plans.ts
var PLAN_PROVIDERS = ["all", "claude", "codex", "cursor"];
var PLAN_IDS = ["claude-pro", "claude-max", "claude-max-5x", "cursor-pro", "custom", "none"];
var PRESET_PLANS = {
  "claude-pro": {
    id: "claude-pro",
    monthlyUsd: 20,
    provider: "claude",
    resetDay: 1
  },
  "claude-max": {
    id: "claude-max",
    monthlyUsd: 200,
    provider: "claude",
    resetDay: 1
  },
  "claude-max-5x": {
    id: "claude-max-5x",
    monthlyUsd: 100,
    provider: "claude",
    resetDay: 1
  },
  "cursor-pro": {
    id: "cursor-pro",
    monthlyUsd: 20,
    provider: "cursor",
    resetDay: 1
  }
};
function isPlanProvider(value) {
  return PLAN_PROVIDERS.includes(value);
}
function isPlanId(value) {
  return PLAN_IDS.includes(value);
}
function getPresetPlan(id) {
  if (id in PRESET_PLANS) {
    return PRESET_PLANS[id];
  }
  return null;
}
function planDisplayName(id) {
  switch (id) {
    case "claude-pro":
      return "Claude Pro";
    case "claude-max":
      return "Claude Max 20x";
    case "claude-max-5x":
      return "Claude Max 5x";
    case "cursor-pro":
      return "Cursor Pro";
    case "custom":
      return "Custom";
    case "none":
      return "None";
  }
}

// src/dashboard.tsx
import { join as join20 } from "path";
import { Fragment, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var PERIODS = ["today", "week", "30days", "month", "all"];
var PERIOD_LABELS = {
  today: "Today",
  week: "7 Days",
  "30days": "30 Days",
  month: "This Month",
  all: "All Time"
};
var MIN_WIDE2 = 90;
var ORANGE3 = "#FF8C42";
var DIM3 = "#555555";
var GOLD3 = "#FFD700";
var PLAN_BAR_WIDTH = 10;
var LANG_DISPLAY_NAMES = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  python: "Python",
  rust: "Rust",
  go: "Go",
  java: "Java",
  cpp: "C++",
  c: "C",
  csharp: "C#",
  ruby: "Ruby",
  php: "PHP",
  swift: "Swift",
  kotlin: "Kotlin",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  json: "JSON",
  yaml: "YAML",
  sql: "SQL",
  shell: "Shell",
  shellscript: "Shell Script",
  bash: "Bash",
  typescriptreact: "TSX",
  javascriptreact: "JSX",
  markdown: "Markdown",
  dockerfile: "Dockerfile",
  toml: "TOML"
};
var PANEL_COLORS = {
  overview: "#FF8C42",
  daily: "#5B9EF5",
  project: "#5BF5A0",
  sessions: "#FF6B6B",
  model: "#E05BF5",
  activity: "#F5C85B",
  tools: "#5BF5E0",
  mcp: "#F55BE0",
  bash: "#F5A05B",
  errors: "#F55B5B"
};
var PROVIDER_COLORS = {
  claude: "#FF8C42",
  codex: "#5BF5A0",
  cursor: "#00B4D8",
  opencode: "#A78BFA",
  pi: "#F472B6",
  all: "#FF8C42"
};
var CATEGORY_COLORS = {
  coding: "#5B9EF5",
  debugging: "#F55B5B",
  feature: "#5BF58C",
  refactoring: "#F5E05B",
  testing: "#E05BF5",
  exploration: "#5BF5E0",
  planning: "#7B9EF5",
  delegation: "#F5C85B",
  git: "#CCCCCC",
  "build/deploy": "#5BF5A0",
  conversation: "#888888",
  brainstorming: "#F55BE0",
  general: "#666666"
};
var IMPACT_PANEL_COLORS = { high: "#F55B5B", medium: ORANGE3, low: DIM3 };
function toHex(r, g, b) {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}
function lerp(a, b, t) {
  return a + t * (b - a);
}
function gradientColor(pct2) {
  if (pct2 <= 0.33) {
    const t2 = pct2 / 0.33;
    return toHex(lerp(91, 245, t2), lerp(158, 200, t2), lerp(245, 91, t2));
  }
  if (pct2 <= 0.66) {
    const t2 = (pct2 - 0.33) / 0.33;
    return toHex(lerp(245, 255, t2), lerp(200, 140, t2), lerp(91, 66, t2));
  }
  const t = (pct2 - 0.66) / 0.34;
  return toHex(lerp(255, 245, t), lerp(140, 91, t), lerp(66, 91, t));
}
function getDateRange(period) {
  const now = /* @__PURE__ */ new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  switch (period) {
    case "today":
      return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), end };
    case "week":
      return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7), end };
    case "30days":
      return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30), end };
    case "month":
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end };
    case "all":
      return { start: /* @__PURE__ */ new Date(0), end };
  }
}
function getLayout(columns) {
  const termWidth = columns || parseInt(process.env["COLUMNS"] ?? "") || 80;
  const dashWidth = Math.min(160, termWidth);
  const wide = dashWidth >= MIN_WIDE2;
  const halfWidth = wide ? Math.floor(dashWidth / 2) : dashWidth;
  const inner = halfWidth - 4;
  const barWidth2 = Math.max(6, Math.min(10, inner - 30));
  return { dashWidth, wide, halfWidth, barWidth: barWidth2 };
}
function HBar({ value, max, width }) {
  if (max === 0) return /* @__PURE__ */ jsx2(Text2, { color: DIM3, children: "\u2591".repeat(width) });
  const filled = Math.round(value / max * width);
  const fillChars = [];
  for (let i = 0; i < Math.min(filled, width); i++) {
    fillChars.push(/* @__PURE__ */ jsx2(Text2, { color: gradientColor(i / width), children: "\u2588" }, i));
  }
  return /* @__PURE__ */ jsxs2(Text2, { children: [
    fillChars,
    /* @__PURE__ */ jsx2(Text2, { color: "#333333", children: "\u2591".repeat(Math.max(width - filled, 0)) })
  ] });
}
var PANEL_CHROME = 4;
function Panel({ title, color, children, width }) {
  return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", borderStyle: "round", borderColor: color, paddingX: 1, width, overflowX: "hidden", children: [
    /* @__PURE__ */ jsx2(Text2, { bold: true, color, children: title }),
    children
  ] });
}
function fit(s, n) {
  return s.length > n ? s.slice(0, n) : s.padEnd(n);
}
function renderPlanBar(percentUsed, width) {
  if (percentUsed <= 100) {
    const capped = Math.max(0, percentUsed);
    const filled = Math.round(capped / 100 * width);
    return `${"\u2593".repeat(filled)}${"\u2591".repeat(Math.max(0, width - filled))}`;
  }
  const factor = percentUsed / 100;
  const chevrons = Math.min(4, Math.max(1, Math.floor(Math.log10(factor)) + 1));
  return `${"\u2593".repeat(width)}${"\u25B6".repeat(chevrons)}`;
}
function Overview({ projects, label, width, planUsage }) {
  const totalCost = projects.reduce((s, p) => s + p.totalCostUSD, 0);
  const totalCalls = projects.reduce((s, p) => s + p.totalApiCalls, 0);
  const totalSessions = projects.reduce((s, p) => s + p.sessions.length, 0);
  const allSessions = projects.flatMap((p) => p.sessions);
  const totalInput = allSessions.reduce((s, sess) => s + sess.totalInputTokens, 0);
  const totalOutput = allSessions.reduce((s, sess) => s + sess.totalOutputTokens, 0);
  const totalCacheRead = allSessions.reduce((s, sess) => s + sess.totalCacheReadTokens, 0);
  const totalCacheWrite = allSessions.reduce((s, sess) => s + sess.totalCacheWriteTokens, 0);
  const allInputTokens = totalInput + totalCacheRead + totalCacheWrite;
  const cacheHit = allInputTokens > 0 ? totalCacheRead / allInputTokens * 100 : 0;
  const planLabel = planUsage ? `${planDisplayName(planUsage.plan.id)}: ${formatCost(planUsage.spentApiEquivalentUsd)} API-equivalent vs ${formatCost(planUsage.budgetUsd)} plan` : "";
  const planPct = planUsage ? `${planUsage.percentUsed.toFixed(1)}%` : "";
  const planColor = planUsage ? planUsage.status === "over" ? "#F55B5B" : planUsage.status === "near" ? ORANGE3 : "#5BF58C" : DIM3;
  return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", borderStyle: "round", borderColor: PANEL_COLORS.overview, paddingX: 1, width, children: [
    /* @__PURE__ */ jsxs2(Text2, { wrap: "truncate-end", children: [
      /* @__PURE__ */ jsx2(Text2, { bold: true, color: ORANGE3, children: "CodeBurn" }),
      /* @__PURE__ */ jsxs2(Text2, { dimColor: true, children: [
        "  ",
        label
      ] })
    ] }),
    /* @__PURE__ */ jsxs2(Text2, { wrap: "truncate-end", children: [
      /* @__PURE__ */ jsx2(Text2, { bold: true, color: GOLD3, children: formatCost(totalCost) }),
      /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: " cost   " }),
      /* @__PURE__ */ jsx2(Text2, { bold: true, children: totalCalls.toLocaleString() }),
      /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: " calls   " }),
      /* @__PURE__ */ jsx2(Text2, { bold: true, children: String(totalSessions) }),
      /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: " sessions   " }),
      /* @__PURE__ */ jsxs2(Text2, { bold: true, children: [
        cacheHit.toFixed(1),
        "%"
      ] }),
      /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: " cache hit" })
    ] }),
    /* @__PURE__ */ jsxs2(Text2, { dimColor: true, wrap: "truncate-end", children: [
      formatTokens(totalInput),
      " in   ",
      formatTokens(totalOutput),
      " out   ",
      formatTokens(totalCacheRead),
      " cached   ",
      formatTokens(totalCacheWrite),
      " written"
    ] }),
    planUsage && /* @__PURE__ */ jsxs2(Fragment, { children: [
      /* @__PURE__ */ jsxs2(Text2, { wrap: "truncate-end", children: [
        /* @__PURE__ */ jsx2(Text2, { color: planColor, children: planLabel }),
        /* @__PURE__ */ jsx2(Text2, { children: "  " }),
        /* @__PURE__ */ jsx2(Text2, { color: planColor, children: renderPlanBar(planUsage.percentUsed, PLAN_BAR_WIDTH) }),
        /* @__PURE__ */ jsx2(Text2, { children: " " }),
        /* @__PURE__ */ jsx2(Text2, { bold: true, color: planColor, children: planPct })
      ] }),
      /* @__PURE__ */ jsx2(Text2, { dimColor: true, wrap: "truncate-end", children: planUsage.status === "under" ? `Well within plan. Projected month: ${formatCost(planUsage.projectedMonthUsd)} (reset in ${planUsage.daysUntilReset} days).` : planUsage.status === "near" ? `Approaching plan limit. Projected month: ${formatCost(planUsage.projectedMonthUsd)} (reset in ${planUsage.daysUntilReset} days).` : `${(planUsage.spentApiEquivalentUsd / Math.max(planUsage.budgetUsd, 1)).toFixed(1)}x your subscription value. Projected month: ${formatCost(planUsage.projectedMonthUsd)} (reset in ${planUsage.daysUntilReset} days).` })
    ] })
  ] });
}
function DailyActivity({ projects, days = 14, pw, bw }) {
  const dailyCosts = {};
  const dailyCalls = {};
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const turn of session.turns) {
        if (!turn.timestamp) continue;
        const day = dateKey(turn.timestamp);
        dailyCosts[day] = (dailyCosts[day] ?? 0) + turn.assistantCalls.reduce((s, c) => s + c.costUSD, 0);
        dailyCalls[day] = (dailyCalls[day] ?? 0) + turn.assistantCalls.length;
      }
    }
  }
  const sortedDays = days !== void 0 ? Object.keys(dailyCosts).sort().slice(-days) : Object.keys(dailyCosts).sort();
  const maxCost = Math.max(...sortedDays.map((d) => dailyCosts[d] ?? 0));
  return /* @__PURE__ */ jsxs2(Panel, { title: "Daily Activity", color: PANEL_COLORS.daily, width: pw, children: [
    /* @__PURE__ */ jsxs2(Text2, { dimColor: true, wrap: "truncate-end", children: [
      "".padEnd(6 + bw),
      "cost".padStart(8),
      "calls".padStart(6)
    ] }),
    sortedDays.map((day) => /* @__PURE__ */ jsxs2(Text2, { wrap: "truncate-end", children: [
      /* @__PURE__ */ jsxs2(Text2, { dimColor: true, children: [
        day.slice(5),
        " "
      ] }),
      /* @__PURE__ */ jsx2(HBar, { value: dailyCosts[day] ?? 0, max: maxCost, width: bw }),
      /* @__PURE__ */ jsx2(Text2, { color: GOLD3, children: formatCost(dailyCosts[day] ?? 0).padStart(8) }),
      /* @__PURE__ */ jsx2(Text2, { children: String(dailyCalls[day] ?? 0).padStart(6) })
    ] }, day))
  ] });
}
var _homeEncoded = homedir16().replace(/\//g, "-");
function shortProject(encoded) {
  let path = encoded.replace(/^-/, "");
  if (path.startsWith(_homeEncoded.replace(/^-/, ""))) {
    path = path.slice(_homeEncoded.replace(/^-/, "").length).replace(/^-/, "");
  }
  path = path.replace(/^private-tmp-[^-]+-[^-]+-/, "").replace(/^private-tmp-/, "").replace(/^tmp-/, "");
  if (!path) return "home";
  const parts = path.split("-").filter(Boolean);
  if (parts.length <= 3) return parts.join("/");
  return parts.slice(-3).join("/");
}
var PROJECT_COL_AVG = 7;
var PROJECT_COL_BASE_WIDTH = 30;
var PROJECT_COL_WITH_OVERHEAD_WIDTH = 40;
function ProjectBreakdown({ projects, pw, bw, budgets }) {
  const maxCost = Math.max(...projects.map((p) => p.totalCostUSD));
  const hasBudgets = budgets && budgets.size > 0;
  const nw = Math.max(8, pw - bw - (hasBudgets ? PROJECT_COL_WITH_OVERHEAD_WIDTH : PROJECT_COL_BASE_WIDTH));
  return /* @__PURE__ */ jsxs2(Panel, { title: "By Project", color: PANEL_COLORS.project, width: pw, children: [
    /* @__PURE__ */ jsxs2(Text2, { dimColor: true, wrap: "truncate-end", children: [
      "".padEnd(bw + 1 + nw),
      "cost".padStart(8),
      "avg/s".padStart(PROJECT_COL_AVG),
      "sess".padStart(6),
      hasBudgets ? "overhead".padStart(10) : ""
    ] }),
    projects.slice(0, 8).map((project, i) => {
      const budget = budgets?.get(project.project);
      const avgCost = project.sessions.length > 0 ? formatCost(project.totalCostUSD / project.sessions.length) : "-";
      return /* @__PURE__ */ jsxs2(Text2, { wrap: "truncate-end", children: [
        /* @__PURE__ */ jsx2(HBar, { value: project.totalCostUSD, max: maxCost, width: bw }),
        /* @__PURE__ */ jsxs2(Text2, { dimColor: true, children: [
          " ",
          fit(shortProject(project.project), nw)
        ] }),
        /* @__PURE__ */ jsx2(Text2, { color: GOLD3, children: formatCost(project.totalCostUSD).padStart(8) }),
        /* @__PURE__ */ jsx2(Text2, { color: GOLD3, children: avgCost.padStart(PROJECT_COL_AVG) }),
        /* @__PURE__ */ jsx2(Text2, { children: String(project.sessions.length).padStart(6) }),
        hasBudgets && /* @__PURE__ */ jsx2(Text2, { color: "#7B9EF5", children: (budget ? formatTokens(budget.total) : "-").padStart(10) })
      ] }, `${project.project}-${i}`);
    })
  ] });
}
var MODEL_COL_COST = 8;
var MODEL_COL_CACHE = 7;
var MODEL_COL_CALLS = 7;
var MODEL_NAME_WIDTH = 14;
function ModelBreakdown({ projects, pw, bw }) {
  const modelTotals = {};
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const [model, data] of Object.entries(session.modelBreakdown)) {
        if (!modelTotals[model]) modelTotals[model] = { calls: 0, costUSD: 0, freshInput: 0, cacheRead: 0, cacheWrite: 0 };
        modelTotals[model].calls += data.calls;
        modelTotals[model].costUSD += data.costUSD;
        modelTotals[model].freshInput += data.tokens.inputTokens;
        modelTotals[model].cacheRead += data.tokens.cacheReadInputTokens;
        modelTotals[model].cacheWrite += data.tokens.cacheCreationInputTokens;
      }
    }
  }
  const sorted = Object.entries(modelTotals).sort(([, a], [, b]) => b.costUSD - a.costUSD);
  const maxCost = sorted[0]?.[1]?.costUSD ?? 0;
  return /* @__PURE__ */ jsxs2(Panel, { title: "By Model", color: PANEL_COLORS.model, width: pw, children: [
    /* @__PURE__ */ jsxs2(Text2, { dimColor: true, wrap: "truncate-end", children: [
      "".padEnd(bw + 1 + MODEL_NAME_WIDTH),
      "cost".padStart(MODEL_COL_COST),
      "cache".padStart(MODEL_COL_CACHE),
      "calls".padStart(MODEL_COL_CALLS)
    ] }),
    sorted.map(([model, data], i) => {
      const totalInput = data.freshInput + data.cacheRead + data.cacheWrite;
      const cacheHit = totalInput > 0 ? data.cacheRead / totalInput * 100 : 0;
      const cacheLabel = totalInput > 0 ? `${cacheHit.toFixed(1)}%` : "-";
      return /* @__PURE__ */ jsxs2(Text2, { wrap: "truncate-end", children: [
        /* @__PURE__ */ jsx2(HBar, { value: data.costUSD, max: maxCost, width: bw }),
        /* @__PURE__ */ jsxs2(Text2, { children: [
          " ",
          fit(model, MODEL_NAME_WIDTH)
        ] }),
        /* @__PURE__ */ jsx2(Text2, { color: GOLD3, children: formatCost(data.costUSD).padStart(MODEL_COL_COST) }),
        /* @__PURE__ */ jsx2(Text2, { children: cacheLabel.padStart(MODEL_COL_CACHE) }),
        /* @__PURE__ */ jsx2(Text2, { children: String(data.calls).padStart(MODEL_COL_CALLS) })
      ] }, `${model}-${i}`);
    })
  ] });
}
function ActivityBreakdown({ projects, pw, bw }) {
  const categoryTotals = {};
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const [cat, data] of Object.entries(session.categoryBreakdown)) {
        if (!categoryTotals[cat]) categoryTotals[cat] = { turns: 0, costUSD: 0, editTurns: 0, oneShotTurns: 0 };
        categoryTotals[cat].turns += data.turns;
        categoryTotals[cat].costUSD += data.costUSD;
        categoryTotals[cat].editTurns += data.editTurns;
        categoryTotals[cat].oneShotTurns += data.oneShotTurns;
      }
    }
  }
  const sorted = Object.entries(categoryTotals).sort(([, a], [, b]) => b.costUSD - a.costUSD);
  const maxCost = sorted[0]?.[1]?.costUSD ?? 0;
  return /* @__PURE__ */ jsxs2(Panel, { title: "By Activity", color: PANEL_COLORS.activity, width: pw, children: [
    /* @__PURE__ */ jsxs2(Text2, { dimColor: true, wrap: "truncate-end", children: [
      "".padEnd(bw + 14),
      "cost".padStart(8),
      "turns".padStart(6),
      "1-shot".padStart(7)
    ] }),
    sorted.map(([cat, data]) => {
      const oneShotPct = data.editTurns > 0 ? Math.round(data.oneShotTurns / data.editTurns * 100) + "%" : "-";
      return /* @__PURE__ */ jsxs2(Text2, { wrap: "truncate-end", children: [
        /* @__PURE__ */ jsx2(HBar, { value: data.costUSD, max: maxCost, width: bw }),
        /* @__PURE__ */ jsxs2(Text2, { color: CATEGORY_COLORS[cat] ?? "#666666", children: [
          " ",
          fit(CATEGORY_LABELS[cat] ?? cat, 13)
        ] }),
        /* @__PURE__ */ jsx2(Text2, { color: GOLD3, children: formatCost(data.costUSD).padStart(8) }),
        /* @__PURE__ */ jsx2(Text2, { children: String(data.turns).padStart(6) }),
        /* @__PURE__ */ jsx2(Text2, { color: data.editTurns === 0 ? DIM3 : oneShotPct === "100%" ? "#5BF58C" : ORANGE3, children: String(oneShotPct).padStart(7) })
      ] }, cat);
    })
  ] });
}
function ToolBreakdown({ projects, pw, bw, title, filterPrefix }) {
  const toolTotals = {};
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const [tool, data] of Object.entries(session.toolBreakdown)) {
        if (filterPrefix) {
          if (!tool.startsWith(filterPrefix)) continue;
        } else {
          if (tool.startsWith("lang:")) continue;
        }
        const agg = toolTotals[tool] ?? { calls: 0, errors: 0, denials: 0 };
        agg.calls += data.calls;
        agg.errors += data.errors ?? 0;
        agg.denials += data.denials ?? 0;
        toolTotals[tool] = agg;
      }
    }
  }
  const sorted = Object.entries(toolTotals).sort(([, a], [, b]) => b.calls - a.calls);
  const maxCalls = sorted[0]?.[1].calls ?? 0;
  const showErrors = !filterPrefix && sorted.some(([, a]) => a.errors > 0 || a.denials > 0);
  const callsCol = 7;
  const errCol = showErrors ? 6 : 0;
  const errPctCol = showErrors ? 6 : 0;
  const nw = Math.max(6, pw - bw - 1 - callsCol - errCol - errPctCol - PANEL_CHROME);
  return /* @__PURE__ */ jsxs2(Panel, { title: title ?? "Core Tools", color: PANEL_COLORS.tools, width: pw, children: [
    /* @__PURE__ */ jsxs2(Text2, { dimColor: true, wrap: "truncate-end", children: [
      "".padEnd(bw + 1 + nw),
      "calls".padStart(callsCol),
      showErrors ? "errs".padStart(errCol) : "",
      showErrors ? "err%".padStart(errPctCol) : ""
    ] }),
    sorted.slice(0, 10).map(([tool, agg]) => {
      const raw = filterPrefix ? tool.slice(filterPrefix.length) : tool;
      const display = filterPrefix ? LANG_DISPLAY_NAMES[raw] ?? raw : raw;
      const errPct = agg.calls > 0 ? Math.round(agg.errors / agg.calls * 100) : 0;
      const errColor = errPct >= 25 ? "#F55B5B" : errPct >= 10 ? ORANGE3 : DIM3;
      return /* @__PURE__ */ jsxs2(Text2, { wrap: "truncate-end", children: [
        /* @__PURE__ */ jsx2(HBar, { value: agg.calls, max: maxCalls, width: bw }),
        /* @__PURE__ */ jsxs2(Text2, { children: [
          " ",
          fit(display, nw)
        ] }),
        /* @__PURE__ */ jsx2(Text2, { children: String(agg.calls).padStart(callsCol) }),
        showErrors && /* @__PURE__ */ jsx2(Text2, { color: errColor, children: String(agg.errors).padStart(errCol) }),
        showErrors && /* @__PURE__ */ jsx2(Text2, { color: errColor, children: (agg.errors > 0 ? `${errPct}%` : "-").padStart(errPctCol) })
      ] }, tool);
    })
  ] });
}
function ErrorBreakdown({ projects, pw, bw }) {
  const patterns = /* @__PURE__ */ new Map();
  const projectDenials = [];
  let totalCalls = 0;
  let totalErrors = 0;
  let totalDenials = 0;
  let totalSiblingCascade = 0;
  for (const project of projects) {
    let projDenials = 0;
    let projCalls = 0;
    for (const session of project.sessions) {
      for (const data of Object.values(session.toolBreakdown)) {
        totalCalls += data.calls;
        totalErrors += data.errors ?? 0;
        totalDenials += data.denials ?? 0;
        totalSiblingCascade += data.siblingCascadeErrors ?? 0;
        projCalls += data.calls;
        projDenials += data.denials ?? 0;
      }
      for (const p of session.errorPatterns ?? []) {
        const existing = patterns.get(p.signature);
        if (existing) existing.count += p.count;
        else patterns.set(p.signature, { ...p });
      }
    }
    if (projDenials > 0) projectDenials.push({ project: project.project, denials: projDenials, calls: projCalls });
  }
  if (totalErrors === 0 && totalDenials === 0) return null;
  const sorted = [...patterns.values()].sort((a, b) => b.count - a.count).slice(0, 8);
  const maxCount = sorted[0]?.count ?? 0;
  const cascadeShare = totalErrors > 0 ? Math.round(totalSiblingCascade / totalErrors * 100) : 0;
  const errRate = totalCalls > 0 ? (totalErrors / totalCalls * 100).toFixed(1) : "0.0";
  const countCol = 6;
  const nw = Math.max(8, pw - bw - 1 - countCol - PANEL_CHROME);
  const denialProjects = projectDenials.sort((a, b) => b.denials - a.denials).slice(0, 5);
  const maxProjDenials = denialProjects[0]?.denials ?? 0;
  return /* @__PURE__ */ jsxs2(Panel, { title: "Tool Errors", color: PANEL_COLORS.errors, width: pw, children: [
    /* @__PURE__ */ jsx2(Text2, { dimColor: true, wrap: "truncate-end", children: `${totalErrors} errors (${errRate}%)  ${totalDenials} denials  ${totalSiblingCascade} sibling-cascade (${cascadeShare}% wasted)` }),
    sorted.length > 0 && /* @__PURE__ */ jsxs2(Text2, { dimColor: true, wrap: "truncate-end", children: [
      "".padEnd(bw + 1 + nw),
      "count".padStart(countCol)
    ] }),
    sorted.map((p) => /* @__PURE__ */ jsxs2(Text2, { wrap: "truncate-end", children: [
      /* @__PURE__ */ jsx2(HBar, { value: p.count, max: maxCount, width: bw }),
      /* @__PURE__ */ jsxs2(Text2, { children: [
        " ",
        fit(`${p.tool}: ${p.example}`, nw)
      ] }),
      /* @__PURE__ */ jsx2(Text2, { color: p.count >= 50 ? "#F55B5B" : ORANGE3, children: String(p.count).padStart(countCol) })
    ] }, p.signature)),
    denialProjects.length > 0 && /* @__PURE__ */ jsxs2(Fragment, { children: [
      /* @__PURE__ */ jsx2(Text2, { dimColor: true, wrap: "truncate-end", children: `Denials by project${"".padEnd(Math.max(0, bw + 1 + nw - "Denials by project".length))}${"rate".padStart(countCol)}` }),
      denialProjects.map((p) => {
        const rate = p.calls > 0 ? (p.denials / p.calls * 100).toFixed(1) + "%" : "-";
        return /* @__PURE__ */ jsxs2(Text2, { wrap: "truncate-end", children: [
          /* @__PURE__ */ jsx2(HBar, { value: p.denials, max: maxProjDenials, width: bw }),
          /* @__PURE__ */ jsxs2(Text2, { children: [
            " ",
            fit(`${shortProject(p.project)} (${p.denials})`, nw)
          ] }),
          /* @__PURE__ */ jsx2(Text2, { color: ORANGE3, children: rate.padStart(countCol) })
        ] }, p.project);
      })
    ] })
  ] });
}
var TOP_SESSIONS_DATE_LEN = 10;
var TOP_SESSIONS_COST_COL = 8;
var TOP_SESSIONS_CALLS_COL = 6;
function TopSessions({ projects, pw, bw }) {
  const allSessions = projects.flatMap(
    (p) => p.sessions.map((s) => ({ ...s, projectName: p.project }))
  );
  const top = [...allSessions].sort((a, b) => b.totalCostUSD - a.totalCostUSD).slice(0, 5);
  if (top.length === 0) {
    return /* @__PURE__ */ jsx2(Panel, { title: "Top Sessions", color: PANEL_COLORS.sessions, width: pw, children: /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: "No sessions" }) });
  }
  const maxCost = top[0].totalCostUSD;
  const nw = Math.max(8, pw - bw - TOP_SESSIONS_COST_COL - TOP_SESSIONS_CALLS_COL - 1 - PANEL_CHROME);
  return /* @__PURE__ */ jsxs2(Panel, { title: "Top Sessions", color: PANEL_COLORS.sessions, width: pw, children: [
    /* @__PURE__ */ jsxs2(Text2, { dimColor: true, wrap: "truncate-end", children: [
      "".padEnd(bw + 1 + nw),
      "cost".padStart(TOP_SESSIONS_COST_COL),
      "calls".padStart(TOP_SESSIONS_CALLS_COL)
    ] }),
    top.map((session, i) => {
      const date = session.firstTimestamp ? session.firstTimestamp.slice(0, TOP_SESSIONS_DATE_LEN) : "----------";
      const branchSuffix = session.gitBranch ? ` \u2387 ${session.gitBranch}` : "";
      const label = `${date} ${shortProject(session.projectName)}${branchSuffix}`;
      return /* @__PURE__ */ jsxs2(Text2, { wrap: "truncate-end", children: [
        /* @__PURE__ */ jsx2(HBar, { value: session.totalCostUSD, max: maxCost, width: bw }),
        /* @__PURE__ */ jsxs2(Text2, { dimColor: true, children: [
          " ",
          fit(label, nw - 1)
        ] }),
        /* @__PURE__ */ jsx2(Text2, { color: GOLD3, children: formatCost(session.totalCostUSD).padStart(TOP_SESSIONS_COST_COL) }),
        /* @__PURE__ */ jsx2(Text2, { children: String(session.apiCalls).padStart(TOP_SESSIONS_CALLS_COL) })
      ] }, `${session.sessionId}-${i}`);
    })
  ] });
}
function BranchActivityBreakdown({ projects, pw, bw, branchLabels }) {
  const totals = {};
  let anyBranch = false;
  for (const project of projects) {
    for (const session of project.sessions) {
      if (!session.gitBranch) continue;
      anyBranch = true;
      const label = getBranchLabel(session.gitBranch, branchLabels) ?? "Other";
      totals[label] = totals[label] ?? { cost: 0, sessions: 0 };
      totals[label].cost += session.totalCostUSD;
      totals[label].sessions++;
    }
  }
  if (!anyBranch) return null;
  const sorted = Object.entries(totals).sort(([, a], [, b]) => b.cost - a.cost);
  const maxCost = sorted[0]?.[1].cost ?? 0;
  const costCol = 8;
  const sessCol = 6;
  const nw = Math.max(8, pw - bw - 1 - costCol - sessCol - PANEL_CHROME);
  return /* @__PURE__ */ jsxs2(Panel, { title: "By Branch", color: PANEL_COLORS.activity, width: pw, children: [
    /* @__PURE__ */ jsxs2(Text2, { dimColor: true, wrap: "truncate-end", children: [
      "".padEnd(bw + 1 + nw),
      "cost".padStart(costCol),
      "sess".padStart(sessCol)
    ] }),
    sorted.map(([label, agg]) => /* @__PURE__ */ jsxs2(Text2, { wrap: "truncate-end", children: [
      /* @__PURE__ */ jsx2(HBar, { value: agg.cost, max: maxCost, width: bw }),
      /* @__PURE__ */ jsxs2(Text2, { children: [
        " ",
        fit(label, nw)
      ] }),
      /* @__PURE__ */ jsx2(Text2, { color: GOLD3, children: formatCost(agg.cost).padStart(costCol) }),
      /* @__PURE__ */ jsx2(Text2, { children: String(agg.sessions).padStart(sessCol) })
    ] }, label))
  ] });
}
function McpBreakdown({ projects, pw, bw }) {
  const mcpTotals = {};
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const [server, data] of Object.entries(session.mcpBreakdown)) {
        mcpTotals[server] = (mcpTotals[server] ?? 0) + data.calls;
      }
    }
  }
  const sorted = Object.entries(mcpTotals).sort(([, a], [, b]) => b - a);
  if (sorted.length === 0) return /* @__PURE__ */ jsx2(Panel, { title: "MCP Servers", color: PANEL_COLORS.mcp, width: pw, children: /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: "No MCP usage" }) });
  const maxCalls = sorted[0]?.[1] ?? 0;
  const nw = Math.max(6, pw - bw - 15);
  return /* @__PURE__ */ jsxs2(Panel, { title: "MCP Servers", color: PANEL_COLORS.mcp, width: pw, children: [
    /* @__PURE__ */ jsxs2(Text2, { dimColor: true, wrap: "truncate-end", children: [
      "".padEnd(bw + 1 + nw),
      "calls".padStart(6)
    ] }),
    sorted.slice(0, 8).map(([server, calls]) => /* @__PURE__ */ jsxs2(Text2, { wrap: "truncate-end", children: [
      /* @__PURE__ */ jsx2(HBar, { value: calls, max: maxCalls, width: bw }),
      /* @__PURE__ */ jsxs2(Text2, { children: [
        " ",
        fit(server, nw)
      ] }),
      /* @__PURE__ */ jsx2(Text2, { children: String(calls).padStart(6) })
    ] }, server))
  ] });
}
function BashBreakdown({ projects, pw, bw }) {
  const bashTotals = {};
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const [cmd, data] of Object.entries(session.bashBreakdown)) {
        bashTotals[cmd] = (bashTotals[cmd] ?? 0) + data.calls;
      }
    }
  }
  const sorted = Object.entries(bashTotals).sort(([, a], [, b]) => b - a);
  if (sorted.length === 0) return /* @__PURE__ */ jsx2(Panel, { title: "Shell Commands", color: PANEL_COLORS.bash, width: pw, children: /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: "No shell commands" }) });
  const maxCalls = sorted[0]?.[1] ?? 0;
  const nw = Math.max(6, pw - bw - 15);
  return /* @__PURE__ */ jsxs2(Panel, { title: "Shell Commands", color: PANEL_COLORS.bash, width: pw, children: [
    /* @__PURE__ */ jsxs2(Text2, { dimColor: true, wrap: "truncate-end", children: [
      "".padEnd(bw + 1 + nw),
      "calls".padStart(7)
    ] }),
    sorted.slice(0, 10).map(([cmd, calls]) => /* @__PURE__ */ jsxs2(Text2, { wrap: "truncate-end", children: [
      /* @__PURE__ */ jsx2(HBar, { value: calls, max: maxCalls, width: bw }),
      /* @__PURE__ */ jsxs2(Text2, { children: [
        " ",
        fit(cmd, nw)
      ] }),
      /* @__PURE__ */ jsx2(Text2, { children: String(calls).padStart(7) })
    ] }, cmd))
  ] });
}
var PROVIDER_DISPLAY_NAMES = {
  all: "All",
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
  pi: "Pi"
};
function getProviderDisplayName(name) {
  return PROVIDER_DISPLAY_NAMES[name] ?? name;
}
function PeriodTabs({ active: active2, providerName, showProvider }) {
  return /* @__PURE__ */ jsxs2(Box2, { justifyContent: "space-between", paddingX: 1, children: [
    /* @__PURE__ */ jsx2(Box2, { gap: 1, children: PERIODS.map((p) => /* @__PURE__ */ jsx2(Text2, { bold: active2 === p, color: active2 === p ? ORANGE3 : DIM3, children: active2 === p ? `[ ${PERIOD_LABELS[p]} ]` : `  ${PERIOD_LABELS[p]}  ` }, p)) }),
    showProvider && providerName && /* @__PURE__ */ jsxs2(Box2, { children: [
      /* @__PURE__ */ jsx2(Text2, { color: DIM3, children: "|  " }),
      /* @__PURE__ */ jsx2(Text2, { color: ORANGE3, bold: true, children: "[p]" }),
      /* @__PURE__ */ jsxs2(Text2, { bold: true, color: PROVIDER_COLORS[providerName] ?? ORANGE3, children: [
        " ",
        getProviderDisplayName(providerName)
      ] })
    ] })
  ] });
}
function FindingAction({ action }) {
  const lines = action.type === "file-content" ? action.content.split("\n") : action.type === "command" ? action.text.split("\n") : [action.text];
  return /* @__PURE__ */ jsxs2(Fragment, { children: [
    /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: action.label }),
    lines.map((line, i) => /* @__PURE__ */ jsxs2(Text2, { color: "#5BF5E0", children: [
      "  ",
      line
    ] }, i))
  ] });
}
function FindingPanel({ index, finding, costRate, width }) {
  const costSaved = finding.tokensSaved * costRate;
  const color = IMPACT_PANEL_COLORS[finding.impact] ?? DIM3;
  const label = finding.impact.charAt(0).toUpperCase() + finding.impact.slice(1);
  const trendBadge = finding.trend === "improving" ? " improving \u2193" : "";
  return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", borderStyle: "round", borderColor: color, paddingX: 1, width, children: [
    /* @__PURE__ */ jsxs2(Text2, { wrap: "truncate-end", children: [
      /* @__PURE__ */ jsxs2(Text2, { bold: true, children: [
        index,
        ". ",
        finding.title
      ] }),
      /* @__PURE__ */ jsx2(Text2, { children: "  " }),
      /* @__PURE__ */ jsx2(Text2, { color, children: label }),
      trendBadge && /* @__PURE__ */ jsx2(Text2, { color: "#5BF5A0", children: trendBadge })
    ] }),
    /* @__PURE__ */ jsx2(Text2, { dimColor: true, wrap: "wrap", children: finding.explanation }),
    /* @__PURE__ */ jsxs2(Text2, { color: GOLD3, children: [
      "Savings: ~",
      formatTokens(finding.tokensSaved),
      " tokens (~",
      formatCost(costSaved),
      ")"
    ] }),
    /* @__PURE__ */ jsx2(Text2, { children: " " }),
    /* @__PURE__ */ jsx2(FindingAction, { action: finding.fix })
  ] });
}
var GRADE_COLORS2 = { A: "#5BF5A0", B: "#5BF5A0", C: GOLD3, D: ORANGE3, F: "#F55B5B" };
function OptimizeView({ findings, costRate, projects, label, width, healthScore, healthGrade }) {
  const periodCost = projects.reduce((s, p) => s + p.totalCostUSD, 0);
  const totalTokens = findings.reduce((s, f) => s + f.tokensSaved, 0);
  const totalCost = totalTokens * costRate;
  const pctRaw = periodCost > 0 ? totalCost / periodCost * 100 : 0;
  const pct2 = pctRaw >= 1 ? pctRaw.toFixed(0) : pctRaw.toFixed(1);
  const gradeColor = GRADE_COLORS2[healthGrade] ?? DIM3;
  return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", width, children: [
    /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", borderStyle: "round", borderColor: ORANGE3, paddingX: 1, width, children: [
      /* @__PURE__ */ jsxs2(Text2, { wrap: "truncate-end", children: [
        /* @__PURE__ */ jsx2(Text2, { bold: true, color: ORANGE3, children: "CodeBurn Optimize" }),
        /* @__PURE__ */ jsxs2(Text2, { dimColor: true, children: [
          "  ",
          label,
          "   Setup: "
        ] }),
        /* @__PURE__ */ jsx2(Text2, { bold: true, color: gradeColor, children: healthGrade }),
        /* @__PURE__ */ jsxs2(Text2, { dimColor: true, children: [
          " (",
          healthScore,
          "/100)"
        ] })
      ] }),
      /* @__PURE__ */ jsxs2(Text2, { color: "#5BF5A0", wrap: "truncate-end", children: [
        "Savings: ~",
        formatTokens(totalTokens),
        " tokens (~",
        formatCost(totalCost),
        ", ~",
        pct2,
        "% of spend)"
      ] })
    ] }),
    findings.map((f, i) => /* @__PURE__ */ jsx2(FindingPanel, { index: i + 1, finding: f, costRate, width }, i)),
    /* @__PURE__ */ jsx2(Box2, { paddingX: 1, width, children: /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: "Token estimates are approximate." }) })
  ] });
}
function StatusBar({ width, showProvider, view, findingCount, optimizeAvailable, compareAvailable }) {
  const isOptimize = view === "optimize";
  return /* @__PURE__ */ jsx2(Box2, { borderStyle: "round", borderColor: DIM3, width, justifyContent: "center", paddingX: 1, children: /* @__PURE__ */ jsxs2(Text2, { children: [
    isOptimize ? /* @__PURE__ */ jsxs2(Fragment, { children: [
      /* @__PURE__ */ jsx2(Text2, { color: ORANGE3, bold: true, children: "b" }),
      /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: " back   " })
    ] }) : /* @__PURE__ */ jsxs2(Fragment, { children: [
      /* @__PURE__ */ jsx2(Text2, { color: ORANGE3, bold: true, children: "<" }),
      /* @__PURE__ */ jsx2(Text2, { color: ORANGE3, children: ">" }),
      /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: " switch   " })
    ] }),
    /* @__PURE__ */ jsx2(Text2, { color: ORANGE3, bold: true, children: "q" }),
    /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: " quit   " }),
    /* @__PURE__ */ jsx2(Text2, { color: ORANGE3, bold: true, children: "1" }),
    /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: " today   " }),
    /* @__PURE__ */ jsx2(Text2, { color: ORANGE3, bold: true, children: "2" }),
    /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: " week   " }),
    /* @__PURE__ */ jsx2(Text2, { color: ORANGE3, bold: true, children: "3" }),
    /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: " 30 days   " }),
    /* @__PURE__ */ jsx2(Text2, { color: ORANGE3, bold: true, children: "4" }),
    /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: " month   " }),
    /* @__PURE__ */ jsx2(Text2, { color: ORANGE3, bold: true, children: "5" }),
    /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: " all time" }),
    !isOptimize && optimizeAvailable && findingCount != null && findingCount > 0 && /* @__PURE__ */ jsxs2(Fragment, { children: [
      /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: "   " }),
      /* @__PURE__ */ jsx2(Text2, { color: ORANGE3, bold: true, children: "o" }),
      /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: " optimize" }),
      /* @__PURE__ */ jsxs2(Text2, { color: "#F55B5B", children: [
        " (",
        findingCount,
        ")"
      ] })
    ] }),
    !isOptimize && compareAvailable && /* @__PURE__ */ jsxs2(Fragment, { children: [
      /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: "   " }),
      /* @__PURE__ */ jsx2(Text2, { color: ORANGE3, bold: true, children: "c" }),
      /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: " compare" })
    ] }),
    showProvider && /* @__PURE__ */ jsxs2(Fragment, { children: [
      /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: "   " }),
      /* @__PURE__ */ jsx2(Text2, { color: ORANGE3, bold: true, children: "p" }),
      /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: " provider" })
    ] })
  ] }) });
}
function Row({ wide, width, children }) {
  if (wide) return /* @__PURE__ */ jsx2(Box2, { width, children });
  return /* @__PURE__ */ jsx2(Fragment, { children });
}
function DashboardContent({ projects, period, columns, activeProvider, budgets, planUsage, branchLabels }) {
  const { dashWidth, wide, halfWidth, barWidth: barWidth2 } = getLayout(columns);
  const isCursor = activeProvider === "cursor";
  if (projects.length === 0) return /* @__PURE__ */ jsx2(Panel, { title: "CodeBurn", color: ORANGE3, width: dashWidth, children: /* @__PURE__ */ jsxs2(Text2, { dimColor: true, children: [
    "No usage data found for ",
    PERIOD_LABELS[period],
    "."
  ] }) });
  const pw = wide ? halfWidth : dashWidth;
  const days = period === "all" ? void 0 : period === "month" || period === "30days" ? 31 : 14;
  return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", width: dashWidth, children: [
    /* @__PURE__ */ jsx2(Overview, { projects, label: PERIOD_LABELS[period], width: dashWidth, planUsage }),
    /* @__PURE__ */ jsxs2(Row, { wide, width: dashWidth, children: [
      /* @__PURE__ */ jsx2(DailyActivity, { projects, days, pw, bw: barWidth2 }),
      /* @__PURE__ */ jsx2(ProjectBreakdown, { projects, pw, bw: barWidth2, budgets })
    ] }),
    /* @__PURE__ */ jsx2(TopSessions, { projects, pw: dashWidth, bw: barWidth2 }),
    /* @__PURE__ */ jsxs2(Row, { wide, width: dashWidth, children: [
      /* @__PURE__ */ jsx2(ActivityBreakdown, { projects, pw, bw: barWidth2 }),
      /* @__PURE__ */ jsx2(ModelBreakdown, { projects, pw, bw: barWidth2 })
    ] }),
    /* @__PURE__ */ jsx2(BranchActivityBreakdown, { projects, pw: dashWidth, bw: barWidth2, branchLabels: branchLabels ?? {} }),
    isCursor ? /* @__PURE__ */ jsx2(ToolBreakdown, { projects, pw: dashWidth, bw: barWidth2, title: "Languages", filterPrefix: "lang:" }) : /* @__PURE__ */ jsxs2(Fragment, { children: [
      /* @__PURE__ */ jsxs2(Row, { wide, width: dashWidth, children: [
        /* @__PURE__ */ jsx2(ToolBreakdown, { projects, pw, bw: barWidth2 }),
        /* @__PURE__ */ jsx2(BashBreakdown, { projects, pw, bw: barWidth2 })
      ] }),
      /* @__PURE__ */ jsx2(ErrorBreakdown, { projects, pw: dashWidth, bw: barWidth2 }),
      /* @__PURE__ */ jsx2(McpBreakdown, { projects, pw: dashWidth, bw: barWidth2 })
    ] })
  ] });
}
function InteractiveDashboard({ initialProjects, initialPeriod, initialProvider, initialPlanUsage, refreshSeconds, projectFilter, excludeFilter, branchLabels }) {
  const { exit } = useApp2();
  const [period, setPeriod] = useState2(initialPeriod);
  const [projects, setProjects] = useState2(initialProjects);
  const [loading, setLoading] = useState2(false);
  const [activeProvider, setActiveProvider] = useState2(initialProvider);
  const [detectedProviders, setDetectedProviders] = useState2([]);
  const [view, setView] = useState2("dashboard");
  const [optimizeResult, setOptimizeResult] = useState2(null);
  const [projectBudgets, setProjectBudgets] = useState2(/* @__PURE__ */ new Map());
  const [planUsage, setPlanUsage] = useState2(initialPlanUsage);
  const { columns } = useWindowSize();
  const { dashWidth } = getLayout(columns);
  const multipleProviders = detectedProviders.length > 1;
  const optimizeAvailable = activeProvider === "all" || activeProvider === "claude";
  const modelCount = new Set(
    projects.flatMap((p) => p.sessions.flatMap((s) => Object.keys(s.modelBreakdown)))
  ).size;
  const compareAvailable = modelCount >= 2;
  const debounceRef = useRef2(null);
  const reloadGenerationRef = useRef2(0);
  const findingCount = optimizeResult?.findings.length ?? 0;
  useEffect2(() => {
    let cancelled = false;
    async function detect() {
      const found = [];
      for (const p of await getAllProviders()) {
        const s = await p.discoverSessions();
        if (s.length > 0) found.push(p.name);
      }
      if (!cancelled) setDetectedProviders(found);
    }
    detect();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect2(() => {
    let cancelled = false;
    async function loadBudgets() {
      const claudeDir = join20(homedir16(), ".claude", "projects");
      const budgets = /* @__PURE__ */ new Map();
      for (const project of projects.slice(0, 8)) {
        if (cancelled) return;
        const cwd = await discoverProjectCwd(join20(claudeDir, project.project));
        if (!cwd) continue;
        budgets.set(project.project, await estimateContextBudget(cwd));
      }
      if (!cancelled) setProjectBudgets(budgets);
    }
    loadBudgets();
    return () => {
      cancelled = true;
    };
  }, [projects]);
  useEffect2(() => {
    if (!optimizeAvailable) {
      setOptimizeResult(null);
      return;
    }
    let cancelled = false;
    async function scan() {
      if (projects.length === 0) {
        setOptimizeResult(null);
        return;
      }
      const result = await scanAndDetect(projects, getDateRange(period));
      if (!cancelled) setOptimizeResult(result);
    }
    scan();
    return () => {
      cancelled = true;
    };
  }, [projects, period, optimizeAvailable]);
  const reloadData = useCallback(async (p, prov) => {
    const generation = ++reloadGenerationRef.current;
    setLoading(true);
    setOptimizeResult(null);
    try {
      const range = getDateRange(p);
      const data = await parseAllSessions(range, prov);
      if (reloadGenerationRef.current !== generation) return;
      const filteredProjects = filterProjectsByName(data, projectFilter, excludeFilter);
      if (reloadGenerationRef.current !== generation) return;
      setProjects(filteredProjects);
      const usage = await getPlanUsageOrNull();
      if (reloadGenerationRef.current !== generation) return;
      setPlanUsage(usage ?? void 0);
    } catch (error) {
      console.error(error);
    } finally {
      if (reloadGenerationRef.current === generation) {
        setLoading(false);
      }
    }
  }, [projectFilter, excludeFilter]);
  useEffect2(() => {
    if (!refreshSeconds || refreshSeconds <= 0) return;
    const id = setInterval(() => {
      reloadData(period, activeProvider);
    }, refreshSeconds * 1e3);
    return () => clearInterval(id);
  }, [refreshSeconds, period, activeProvider, reloadData]);
  const switchPeriod = useCallback((np) => {
    if (np === period) return;
    setPeriod(np);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      reloadData(np, activeProvider);
    }, 600);
  }, [period, activeProvider, reloadData]);
  const switchPeriodImmediate = useCallback(async (np) => {
    if (np === period) return;
    setPeriod(np);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    await reloadData(np, activeProvider);
  }, [period, activeProvider, reloadData]);
  useInput2((input, key) => {
    if (input === "q") {
      exit();
      return;
    }
    if (input === "o" && findingCount > 0 && view === "dashboard" && optimizeAvailable) {
      setView("optimize");
      return;
    }
    if ((input === "b" || key.escape) && view === "optimize") {
      setView("dashboard");
      return;
    }
    if (input === "c" && compareAvailable && view === "dashboard") {
      setView("compare");
      return;
    }
    if (input === "p" && multipleProviders && view !== "compare") {
      const opts = ["all", ...detectedProviders];
      const next = opts[(opts.indexOf(activeProvider) + 1) % opts.length];
      setActiveProvider(next);
      setView("dashboard");
      if (debounceRef.current) clearTimeout(debounceRef.current);
      reloadData(period, next);
      return;
    }
    const idx = PERIODS.indexOf(period);
    if (key.leftArrow) switchPeriod(PERIODS[(idx - 1 + PERIODS.length) % PERIODS.length]);
    else if (key.rightArrow || key.tab) switchPeriod(PERIODS[(idx + 1) % PERIODS.length]);
    else if (input === "1") switchPeriodImmediate("today");
    else if (input === "2") switchPeriodImmediate("week");
    else if (input === "3") switchPeriodImmediate("30days");
    else if (input === "4") switchPeriodImmediate("month");
    else if (input === "5") switchPeriodImmediate("all");
  });
  if (loading) {
    return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", width: dashWidth, children: [
      /* @__PURE__ */ jsx2(PeriodTabs, { active: period, providerName: activeProvider, showProvider: view !== "compare" && multipleProviders }),
      view === "compare" ? /* @__PURE__ */ jsx2(Box2, { flexDirection: "column", paddingX: 2, paddingY: 1, children: /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", borderStyle: "round", borderColor: ORANGE3, paddingX: 1, children: [
        /* @__PURE__ */ jsx2(Text2, { bold: true, color: ORANGE3, children: "Model Comparison" }),
        /* @__PURE__ */ jsx2(Text2, { children: " " }),
        /* @__PURE__ */ jsxs2(Text2, { dimColor: true, children: [
          "Loading ",
          PERIOD_LABELS[period],
          " model data..."
        ] })
      ] }) }) : /* @__PURE__ */ jsx2(Panel, { title: "CodeBurn", color: ORANGE3, width: dashWidth, children: /* @__PURE__ */ jsxs2(Text2, { dimColor: true, children: [
        "Loading ",
        PERIOD_LABELS[period],
        "..."
      ] }) }),
      view !== "compare" && /* @__PURE__ */ jsx2(StatusBar, { width: dashWidth, showProvider: multipleProviders, view, findingCount: 0, optimizeAvailable: false, compareAvailable: false })
    ] });
  }
  return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", width: dashWidth, children: [
    /* @__PURE__ */ jsx2(PeriodTabs, { active: period, providerName: activeProvider, showProvider: multipleProviders && view !== "compare" }),
    view === "compare" ? /* @__PURE__ */ jsx2(CompareView, { projects, onBack: () => setView("dashboard") }) : view === "optimize" && optimizeResult ? /* @__PURE__ */ jsx2(OptimizeView, { findings: optimizeResult.findings, costRate: optimizeResult.costRate, projects, label: PERIOD_LABELS[period], width: dashWidth, healthScore: optimizeResult.healthScore, healthGrade: optimizeResult.healthGrade }) : /* @__PURE__ */ jsx2(DashboardContent, { projects, period, columns, activeProvider, budgets: projectBudgets, planUsage, branchLabels }),
    view !== "compare" && /* @__PURE__ */ jsx2(StatusBar, { width: dashWidth, showProvider: multipleProviders, view, findingCount, optimizeAvailable, compareAvailable })
  ] });
}
function StaticDashboard({ projects, period, activeProvider, planUsage, branchLabels }) {
  const { columns } = useWindowSize();
  const { dashWidth } = getLayout(columns);
  return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", width: dashWidth, children: [
    /* @__PURE__ */ jsx2(PeriodTabs, { active: period }),
    /* @__PURE__ */ jsx2(DashboardContent, { projects, period, columns, activeProvider, planUsage, branchLabels })
  ] });
}
async function renderDashboard(period = "week", provider = "all", refreshSeconds, projectFilter, excludeFilter, customRange) {
  await loadPricing();
  const range = customRange ?? getDateRange(period);
  const filteredProjects = filterProjectsByName(await parseAllSessions(range, provider), projectFilter, excludeFilter);
  const planUsage = await getPlanUsageOrNull();
  const branchLabels = resolveBranchLabels(await readConfig());
  const isTTY = process.stdin.isTTY && process.stdout.isTTY;
  if (isTTY) {
    const { waitUntilExit } = render2(
      /* @__PURE__ */ jsx2(InteractiveDashboard, { initialProjects: filteredProjects, initialPeriod: period, initialProvider: provider, initialPlanUsage: planUsage ?? void 0, refreshSeconds, projectFilter, excludeFilter, branchLabels })
    );
    await waitUntilExit();
  } else {
    const { unmount } = render2(/* @__PURE__ */ jsx2(StaticDashboard, { projects: filteredProjects, period, activeProvider: provider, planUsage: planUsage ?? void 0, branchLabels }), { patchConsole: false });
    unmount();
  }
}

// src/cli-date.ts
var ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var END_OF_DAY_HOURS = 23;
var END_OF_DAY_MINUTES = 59;
var END_OF_DAY_SECONDS = 59;
var END_OF_DAY_MS = 999;
function parseLocalDate(s) {
  if (!ISO_DATE_RE.test(s)) {
    throw new Error(`Invalid date format "${s}": expected YYYY-MM-DD`);
  }
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function parseDateRangeFlags(from, to) {
  if (from === void 0 && to === void 0) return null;
  const now = /* @__PURE__ */ new Date();
  const start = from !== void 0 ? parseLocalDate(from) : /* @__PURE__ */ new Date(0);
  const endDate = to !== void 0 ? parseLocalDate(to) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate(),
    END_OF_DAY_HOURS,
    END_OF_DAY_MINUTES,
    END_OF_DAY_SECONDS,
    END_OF_DAY_MS
  );
  if (start > end) {
    throw new Error(`--from must not be after --to (got ${from} > ${to})`);
  }
  return { start, end };
}

// src/cli.ts
init_providers();
import { createRequire as createRequire2 } from "module";
var require2 = createRequire2(import.meta.url);
var { version } = require2("../package.json");
var MS_PER_DAY3 = 24 * 60 * 60 * 1e3;
var BACKFILL_DAYS = 365;
function toDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function getDateRange2(period) {
  const now = /* @__PURE__ */ new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  switch (period) {
    case "today": {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { range: { start, end }, label: `Today (${toDateString(start)})` };
    }
    case "yesterday": {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const yesterdayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
      return { range: { start, end: yesterdayEnd }, label: `Yesterday (${toDateString(start)})` };
    }
    case "week": {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      return { range: { start, end }, label: "Last 7 Days" };
    }
    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { range: { start, end }, label: `${now.toLocaleString("default", { month: "long" })} ${now.getFullYear()}` };
    }
    case "30days": {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
      return { range: { start, end }, label: "Last 30 Days" };
    }
    case "all": {
      const start = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
      return { range: { start, end }, label: "Last 6 months" };
    }
    default: {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      return { range: { start, end }, label: "Last 7 Days" };
    }
  }
}
function toPeriod(s) {
  if (s === "today") return "today";
  if (s === "month") return "month";
  if (s === "30days") return "30days";
  if (s === "all") return "all";
  return "week";
}
function collect(val, acc) {
  acc.push(val);
  return acc;
}
function parseSinceArg(value) {
  if (value === "all") return null;
  const dayMatch = /^(\d+)d$/.exec(value);
  if (dayMatch) {
    const days = Number(dayMatch[1]);
    const now = /* @__PURE__ */ new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - days),
      end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
    };
  }
  const named = { today: true, week: true, "30days": true, month: true };
  if (!named[value]) {
    throw new Error(`unknown --since value '${value}' (expected today, week, 30days, month, all, or e.g. 7d)`);
  }
  return getDateRange2(value).range;
}
function parseNumber(value) {
  return Number(value);
}
function parseInteger(value) {
  return parseInt(value, 10);
}
function toJsonPlanSummary(planUsage) {
  return {
    id: planUsage.plan.id,
    budget: convertCost(planUsage.budgetUsd),
    spent: convertCost(planUsage.spentApiEquivalentUsd),
    percentUsed: Math.round(planUsage.percentUsed * 10) / 10,
    status: planUsage.status,
    projectedMonthEnd: convertCost(planUsage.projectedMonthUsd),
    daysUntilReset: planUsage.daysUntilReset,
    periodStart: planUsage.periodStart.toISOString(),
    periodEnd: planUsage.periodEnd.toISOString()
  };
}
async function runJsonReport(period, provider, project, exclude) {
  await loadPricing();
  const { range, label } = getDateRange2(period);
  const projects = filterProjectsByName(await parseAllSessions(range, provider), project, exclude);
  const report = buildJsonReport(projects, label, period);
  const planUsage = await getPlanUsageOrNull();
  if (planUsage) {
    report.plan = toJsonPlanSummary(planUsage);
  }
  console.log(JSON.stringify(report, null, 2));
}
var program = new Command().name("codeburn").description("See where your AI coding tokens go - by task, tool, model, and project").version(version).option("--verbose", "print warnings to stderr on read failures and skipped files");
program.hook("preAction", async (thisCommand) => {
  const config = await readConfig();
  setModelAliases(config.modelAliases ?? {});
  if (thisCommand.opts().verbose) {
    process.env["CODEBURN_VERBOSE"] = "1";
  }
  await loadCurrency();
});
function buildJsonReport(projects, period, periodKey) {
  const sessions = projects.flatMap((p) => p.sessions);
  const { code } = getCurrency();
  const totalCostUSD = projects.reduce((s, p) => s + p.totalCostUSD, 0);
  const totalCalls = projects.reduce((s, p) => s + p.totalApiCalls, 0);
  const totalSessions = projects.reduce((s, p) => s + p.sessions.length, 0);
  const totalInput = sessions.reduce((s, sess) => s + sess.totalInputTokens, 0);
  const totalOutput = sessions.reduce((s, sess) => s + sess.totalOutputTokens, 0);
  const totalCacheRead = sessions.reduce((s, sess) => s + sess.totalCacheReadTokens, 0);
  const totalCacheWrite = sessions.reduce((s, sess) => s + sess.totalCacheWriteTokens, 0);
  const cacheHitDenom = totalInput + totalCacheRead;
  const cacheHitPercent2 = cacheHitDenom > 0 ? Math.round(totalCacheRead / cacheHitDenom * 1e3) / 10 : 0;
  const dailyMap = {};
  for (const sess of sessions) {
    for (const turn of sess.turns) {
      if (!turn.timestamp) {
        continue;
      }
      const day = dateKey(turn.timestamp);
      if (!dailyMap[day]) {
        dailyMap[day] = { cost: 0, calls: 0 };
      }
      for (const call of turn.assistantCalls) {
        dailyMap[day].cost += call.costUSD;
        dailyMap[day].calls += 1;
      }
    }
  }
  const daily = Object.entries(dailyMap).sort().map(([date, d]) => ({
    date,
    cost: convertCost(d.cost),
    calls: d.calls
  }));
  const projectList = projects.map((p) => ({
    name: p.project,
    path: p.projectPath,
    cost: convertCost(p.totalCostUSD),
    avgCostPerSession: p.sessions.length > 0 ? convertCost(p.totalCostUSD / p.sessions.length) : null,
    calls: p.totalApiCalls,
    sessions: p.sessions.length
  }));
  const modelMap = {};
  for (const sess of sessions) {
    for (const [model, d] of Object.entries(sess.modelBreakdown)) {
      if (!modelMap[model]) {
        modelMap[model] = { calls: 0, cost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      }
      modelMap[model].calls += d.calls;
      modelMap[model].cost += d.costUSD;
      modelMap[model].inputTokens += d.tokens.inputTokens;
      modelMap[model].outputTokens += d.tokens.outputTokens;
      modelMap[model].cacheReadTokens += d.tokens.cacheReadInputTokens;
      modelMap[model].cacheWriteTokens += d.tokens.cacheCreationInputTokens;
    }
  }
  const models = Object.entries(modelMap).sort(([, a], [, b]) => b.cost - a.cost).map(([name, { cost, ...rest }]) => ({ name, ...rest, cost: convertCost(cost) }));
  const catMap = {};
  for (const sess of sessions) {
    for (const [cat, d] of Object.entries(sess.categoryBreakdown)) {
      if (!catMap[cat]) {
        catMap[cat] = { turns: 0, cost: 0, editTurns: 0, oneShotTurns: 0 };
      }
      catMap[cat].turns += d.turns;
      catMap[cat].cost += d.costUSD;
      catMap[cat].editTurns += d.editTurns;
      catMap[cat].oneShotTurns += d.oneShotTurns;
    }
  }
  const activities = Object.entries(catMap).sort(([, a], [, b]) => b.cost - a.cost).map(([cat, d]) => ({
    category: CATEGORY_LABELS[cat] ?? cat,
    cost: convertCost(d.cost),
    turns: d.turns,
    editTurns: d.editTurns,
    oneShotTurns: d.oneShotTurns,
    oneShotRate: d.editTurns > 0 ? Math.round(d.oneShotTurns / d.editTurns * 1e3) / 10 : null
  }));
  const toolMap = {};
  const mcpMap = {};
  const bashMap = {};
  for (const sess of sessions) {
    for (const [tool, d] of Object.entries(sess.toolBreakdown)) {
      toolMap[tool] = (toolMap[tool] ?? 0) + d.calls;
    }
    for (const [server, d] of Object.entries(sess.mcpBreakdown)) {
      mcpMap[server] = (mcpMap[server] ?? 0) + d.calls;
    }
    for (const [cmd, d] of Object.entries(sess.bashBreakdown)) {
      bashMap[cmd] = (bashMap[cmd] ?? 0) + d.calls;
    }
  }
  const sortedMap = (m) => Object.entries(m).sort(([, a], [, b]) => b - a).map(([name, calls]) => ({ name, calls }));
  const topSessions = projects.flatMap((p) => p.sessions.map((s) => ({ project: p.project, sessionId: s.sessionId, date: s.firstTimestamp ? dateKey(s.firstTimestamp) : null, cost: convertCost(s.totalCostUSD), calls: s.apiCalls }))).sort((a, b) => b.cost - a.cost).slice(0, 5);
  return {
    generated: (/* @__PURE__ */ new Date()).toISOString(),
    currency: code,
    period,
    periodKey,
    overview: {
      cost: convertCost(totalCostUSD),
      calls: totalCalls,
      sessions: totalSessions,
      cacheHitPercent: cacheHitPercent2,
      tokens: {
        input: totalInput,
        output: totalOutput,
        cacheRead: totalCacheRead,
        cacheWrite: totalCacheWrite
      }
    },
    daily,
    projects: projectList,
    models,
    activities,
    tools: sortedMap(toolMap),
    mcpServers: sortedMap(mcpMap),
    shellCommands: sortedMap(bashMap),
    topSessions
  };
}
program.command("report", { isDefault: true }).description("Interactive usage dashboard").option("-p, --period <period>", "Starting period: today, week, 30days, month, all", "week").option("--from <date>", "Start date (YYYY-MM-DD). Overrides --period when set").option("--to <date>", "End date (YYYY-MM-DD). Overrides --period when set").option("--provider <provider>", "Filter by provider: all, claude, codex, cursor", "all").option("--format <format>", "Output format: tui, json", "tui").option("--project <name>", "Show only projects matching name (repeatable)", collect, []).option("--exclude <name>", "Exclude projects matching name (repeatable)", collect, []).option("--refresh <seconds>", "Auto-refresh interval in seconds (0 to disable)", parseInt, 30).action(async (opts) => {
  let customRange = null;
  try {
    customRange = parseDateRangeFlags(opts.from, opts.to);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`
  Error: ${message}
`);
    process.exit(1);
  }
  const period = toPeriod(opts.period);
  if (opts.format === "json") {
    await loadPricing();
    if (customRange) {
      const label = `${opts.from ?? "all"} to ${opts.to ?? "today"}`;
      const projects = filterProjectsByName(
        await parseAllSessions(customRange, opts.provider),
        opts.project,
        opts.exclude
      );
      console.log(JSON.stringify(buildJsonReport(projects, label, "custom"), null, 2));
    } else {
      await runJsonReport(period, opts.provider, opts.project, opts.exclude);
    }
    return;
  }
  await renderDashboard(period, opts.provider, opts.refresh, opts.project, opts.exclude, customRange);
});
function buildPeriodData(label, projects) {
  const sessions = projects.flatMap((p) => p.sessions);
  const catTotals = {};
  const modelTotals = {};
  let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0;
  for (const sess of sessions) {
    inputTokens += sess.totalInputTokens;
    outputTokens += sess.totalOutputTokens;
    cacheReadTokens += sess.totalCacheReadTokens;
    cacheWriteTokens += sess.totalCacheWriteTokens;
    for (const [cat, d] of Object.entries(sess.categoryBreakdown)) {
      if (!catTotals[cat]) catTotals[cat] = { turns: 0, cost: 0, editTurns: 0, oneShotTurns: 0 };
      catTotals[cat].turns += d.turns;
      catTotals[cat].cost += d.costUSD;
      catTotals[cat].editTurns += d.editTurns;
      catTotals[cat].oneShotTurns += d.oneShotTurns;
    }
    for (const [model, d] of Object.entries(sess.modelBreakdown)) {
      if (!modelTotals[model]) modelTotals[model] = { calls: 0, cost: 0 };
      modelTotals[model].calls += d.calls;
      modelTotals[model].cost += d.costUSD;
    }
  }
  return {
    label,
    cost: projects.reduce((s, p) => s + p.totalCostUSD, 0),
    calls: projects.reduce((s, p) => s + p.totalApiCalls, 0),
    sessions: projects.reduce((s, p) => s + p.sessions.length, 0),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    categories: Object.entries(catTotals).sort(([, a], [, b]) => b.cost - a.cost).map(([cat, d]) => ({ name: CATEGORY_LABELS[cat] ?? cat, ...d })),
    models: Object.entries(modelTotals).sort(([, a], [, b]) => b.cost - a.cost).map(([name, d]) => ({ name, ...d }))
  };
}
program.command("status").description("Compact status output (today + week + month)").option("--format <format>", "Output format: terminal, menubar-json, json", "terminal").option("--provider <provider>", "Filter by provider: all, claude, codex, cursor", "all").option("--project <name>", "Show only projects matching name (repeatable)", collect, []).option("--exclude <name>", "Exclude projects matching name (repeatable)", collect, []).option("--period <period>", "Primary period for menubar-json: today, week, 30days, month, all", "today").option("--no-optimize", "Skip optimize findings (menubar-json only, faster)").action(async (opts) => {
  await loadPricing();
  const pf = opts.provider;
  const fp = (p) => filterProjectsByName(p, opts.project, opts.exclude);
  if (opts.format === "menubar-json") {
    const periodInfo = getDateRange2(opts.period);
    const now = /* @__PURE__ */ new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayEnd = new Date(todayStart.getTime() - 1);
    const yesterdayStr = toDateString(new Date(todayStart.getTime() - MS_PER_DAY3));
    const isAllProviders = pf === "all";
    const cache = await withDailyCacheLock(async () => {
      let c = await loadDailyCache();
      const hadYesterday = c.days.some((d) => d.date >= yesterdayStr);
      if (hadYesterday) {
        const freshDays = c.days.filter((d) => d.date < yesterdayStr);
        const latestFresh = freshDays.length > 0 ? freshDays[freshDays.length - 1].date : null;
        c = { ...c, days: freshDays, lastComputedDate: latestFresh };
      }
      const gapStart = c.lastComputedDate ? new Date(
        parseInt(c.lastComputedDate.slice(0, 4)),
        parseInt(c.lastComputedDate.slice(5, 7)) - 1,
        parseInt(c.lastComputedDate.slice(8, 10)) + 1
      ) : new Date(todayStart.getTime() - BACKFILL_DAYS * MS_PER_DAY3);
      if (gapStart.getTime() <= yesterdayEnd.getTime()) {
        const gapRange = { start: gapStart, end: yesterdayEnd };
        const gapProjects = filterProjectsByName(await parseAllSessions(gapRange, "all"), opts.project, opts.exclude);
        const gapDays = aggregateProjectsIntoDays(gapProjects);
        c = addNewDays(c, gapDays, yesterdayStr);
        await saveDailyCache(c);
      }
      return c;
    });
    let currentData;
    let scanProjects;
    let scanRange;
    if (isAllProviders) {
      const todayRange = { start: todayStart, end: /* @__PURE__ */ new Date() };
      const todayProjects = fp(await parseAllSessions(todayRange, "all"));
      const todayDays = aggregateProjectsIntoDays(todayProjects);
      const rangeStartStr = toDateString(periodInfo.range.start);
      const rangeEndStr = toDateString(periodInfo.range.end);
      const historicalDays = getDaysInRange(cache, rangeStartStr, yesterdayStr);
      const todayInRange = todayDays.filter((d) => d.date >= rangeStartStr && d.date <= rangeEndStr);
      const allDays = [...historicalDays, ...todayInRange].sort((a, b) => a.date.localeCompare(b.date));
      currentData = buildPeriodDataFromDays(allDays, periodInfo.label);
      scanProjects = todayProjects;
      scanRange = periodInfo.range;
    } else {
      const projects = fp(await parseAllSessions(periodInfo.range, pf));
      currentData = buildPeriodData(periodInfo.label, projects);
      scanProjects = projects;
      scanRange = periodInfo.range;
    }
    const allProviders = await getAllProviders();
    const displayNameByName = new Map(allProviders.map((p) => [p.name, p.displayName]));
    const providers = [];
    if (isAllProviders) {
      const todayRangeForProviders = { start: todayStart, end: /* @__PURE__ */ new Date() };
      const todayDaysForProviders = aggregateProjectsIntoDays(fp(await parseAllSessions(todayRangeForProviders, "all")));
      const rangeStartStr = toDateString(periodInfo.range.start);
      const todayStr = toDateString(todayStart);
      const allDaysForProviders = [
        ...getDaysInRange(cache, rangeStartStr, yesterdayStr),
        ...todayDaysForProviders.filter((d) => d.date === todayStr)
      ];
      const providerTotals = {};
      for (const d of allDaysForProviders) {
        for (const [name, p] of Object.entries(d.providers)) {
          providerTotals[name] = (providerTotals[name] ?? 0) + p.cost;
        }
      }
      for (const [name, cost] of Object.entries(providerTotals)) {
        providers.push({ name: displayNameByName.get(name) ?? name, cost });
      }
      for (const p of allProviders) {
        if (providers.some((pc) => pc.name === p.displayName)) continue;
        const sources = await p.discoverSessions();
        if (sources.length > 0) providers.push({ name: p.displayName, cost: 0 });
      }
    } else {
      const display = displayNameByName.get(pf) ?? pf;
      providers.push({ name: display, cost: currentData.cost });
    }
    const historyStartStr = toDateString(new Date(todayStart.getTime() - BACKFILL_DAYS * MS_PER_DAY3));
    const allCacheDays = getDaysInRange(cache, historyStartStr, yesterdayStr);
    const todayRangeForHistory = { start: todayStart, end: /* @__PURE__ */ new Date() };
    const allTodayDaysForHistory = aggregateProjectsIntoDays(fp(await parseAllSessions(todayRangeForHistory, "all")));
    const todayStrForHistory = toDateString(todayStart);
    const fullHistory = [...allCacheDays, ...allTodayDaysForHistory.filter((d) => d.date === todayStrForHistory)];
    const dailyHistory = fullHistory.map((d) => {
      if (isAllProviders) {
        const topModels = Object.entries(d.models).filter(([name]) => name !== "<synthetic>").sort(([, a], [, b]) => b.cost - a.cost).slice(0, 5).map(([name, m]) => ({
          name,
          cost: m.cost,
          calls: m.calls,
          inputTokens: m.inputTokens,
          outputTokens: m.outputTokens
        }));
        return {
          date: d.date,
          cost: d.cost,
          calls: d.calls,
          inputTokens: d.inputTokens,
          outputTokens: d.outputTokens,
          cacheReadTokens: d.cacheReadTokens,
          cacheWriteTokens: d.cacheWriteTokens,
          topModels
        };
      }
      const prov = d.providers[pf] ?? { calls: 0, cost: 0 };
      return {
        date: d.date,
        cost: prov.cost,
        calls: prov.calls,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        topModels: []
      };
    });
    const optimize = opts.optimize === false ? null : await scanAndDetect(scanProjects, scanRange);
    console.log(JSON.stringify(buildMenubarPayload(currentData, providers, optimize, dailyHistory)));
    return;
  }
  if (opts.format === "json") {
    const todayData = buildPeriodData("today", fp(await parseAllSessions(getDateRange2("today").range, pf)));
    const monthData = buildPeriodData("month", fp(await parseAllSessions(getDateRange2("month").range, pf)));
    const { code, rate } = getCurrency();
    const payload = {
      currency: code,
      today: { cost: Math.round(todayData.cost * rate * 100) / 100, calls: todayData.calls },
      month: { cost: Math.round(monthData.cost * rate * 100) / 100, calls: monthData.calls }
    };
    const planUsage = await getPlanUsageOrNull();
    if (planUsage) {
      payload.plan = toJsonPlanSummary(planUsage);
    }
    console.log(JSON.stringify(payload));
    return;
  }
  const monthProjects = fp(await parseAllSessions(getDateRange2("month").range, pf));
  console.log(renderStatusBar(monthProjects));
});
program.command("today").description("Today's usage dashboard").option("--provider <provider>", "Filter by provider: all, claude, codex, cursor", "all").option("--format <format>", "Output format: tui, json", "tui").option("--project <name>", "Show only projects matching name (repeatable)", collect, []).option("--exclude <name>", "Exclude projects matching name (repeatable)", collect, []).option("--refresh <seconds>", "Auto-refresh interval in seconds (0 to disable)", parseInt, 30).action(async (opts) => {
  if (opts.format === "json") {
    await runJsonReport("today", opts.provider, opts.project, opts.exclude);
    return;
  }
  await renderDashboard("today", opts.provider, opts.refresh, opts.project, opts.exclude);
});
program.command("month").description("This month's usage dashboard").option("--provider <provider>", "Filter by provider: all, claude, codex, cursor", "all").option("--format <format>", "Output format: tui, json", "tui").option("--project <name>", "Show only projects matching name (repeatable)", collect, []).option("--exclude <name>", "Exclude projects matching name (repeatable)", collect, []).option("--refresh <seconds>", "Auto-refresh interval in seconds (0 to disable)", parseInt, 30).action(async (opts) => {
  if (opts.format === "json") {
    await runJsonReport("month", opts.provider, opts.project, opts.exclude);
    return;
  }
  await renderDashboard("month", opts.provider, opts.refresh, opts.project, opts.exclude);
});
program.command("export").description("Export usage data to CSV, JSON, or per-session tool-event JSONL").option("-f, --format <format>", "Export format: csv, json, jsonl", "csv").option("-o, --output <path>", "Output file path").option("--provider <provider>", "Filter by provider: all, claude, codex, cursor", "all").option("--project <name>", "Show only projects matching name (repeatable)", collect, []).option("--exclude <name>", "Exclude projects matching name (repeatable)", collect, []).option("--since <period>", "jsonl only: today, week, 30days, month, all, or Nd (default 30days)", "30days").action(async (opts) => {
  await loadPricing();
  const config = await readConfig();
  if (opts.format === "jsonl") {
    const range = parseSinceArg(opts.since);
    const defaultName2 = `codeburn-events-${toDateString(/* @__PURE__ */ new Date())}`;
    const outputPath2 = opts.output ?? `${defaultName2}.jsonl`;
    try {
      const result = await exportEvents({
        outputPath: outputPath2,
        dateRange: range ?? void 0,
        projectFilter: opts.project,
        excludeFilter: opts.exclude
      });
      console.log(`
  Exported ${result.eventCount} events from ${result.sessionCount} sessions to: ${result.path}
`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`
  Export failed: ${message}
`);
      process.exit(1);
    }
    return;
  }
  const pf = opts.provider;
  const fp = (p) => filterProjectsByName(p, opts.project, opts.exclude);
  const periods = [
    { label: "Today", projects: fp(await parseAllSessions(getDateRange2("today").range, pf)) },
    { label: "7 Days", projects: fp(await parseAllSessions(getDateRange2("week").range, pf)) },
    { label: "30 Days", projects: fp(await parseAllSessions(getDateRange2("30days").range, pf)) }
  ];
  if (periods.every((p) => p.projects.length === 0)) {
    console.log("\n  No usage data found.\n");
    return;
  }
  const defaultName = `codeburn-${toDateString(/* @__PURE__ */ new Date())}`;
  const outputPath = opts.output ?? `${defaultName}.${opts.format}`;
  let savedPath;
  try {
    if (opts.format === "json") {
      savedPath = await exportJson(periods, outputPath, { config });
    } else {
      savedPath = await exportCsv(periods, outputPath, { config });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`
  Export failed: ${message}
`);
    process.exit(1);
  }
  console.log(`
  Exported (Today + 7 Days + 30 Days) to: ${savedPath}
`);
});
program.command("menubar").description("Install and launch the macOS menubar app (one command, no clone)").option("--force", "Reinstall even if an older copy is already in ~/Applications").action(async (opts) => {
  try {
    const result = await installMenubarApp({ force: opts.force });
    console.log(`
  Ready. ${result.installedPath}
`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`
  Menubar install failed: ${message}
`);
    process.exit(1);
  }
});
program.command("currency [code]").description("Set display currency (e.g. codeburn currency GBP)").option("--symbol <symbol>", "Override the currency symbol").option("--reset", "Reset to USD (removes currency config)").action(async (code, opts) => {
  if (opts?.reset) {
    const config2 = await readConfig();
    delete config2.currency;
    await saveConfig(config2);
    console.log("\n  Currency reset to USD.\n");
    return;
  }
  if (!code) {
    const { code: activeCode, rate: rate2, symbol: symbol2 } = getCurrency();
    if (activeCode === "USD" && rate2 === 1) {
      console.log("\n  Currency: USD (default)");
      console.log(`  Config: ${getConfigFilePath()}
`);
    } else {
      console.log(`
  Currency: ${activeCode}`);
      console.log(`  Symbol: ${symbol2}`);
      console.log(`  Rate: 1 USD = ${rate2} ${activeCode}`);
      console.log(`  Config: ${getConfigFilePath()}
`);
    }
    return;
  }
  const upperCode = code.toUpperCase();
  if (!isValidCurrencyCode(upperCode)) {
    console.error(`
  "${code}" is not a valid ISO 4217 currency code.
`);
    process.exitCode = 1;
    return;
  }
  const config = await readConfig();
  config.currency = {
    code: upperCode,
    ...opts?.symbol ? { symbol: opts.symbol } : {}
  };
  await saveConfig(config);
  await loadCurrency();
  const { rate, symbol } = getCurrency();
  console.log(`
  Currency set to ${upperCode}.`);
  console.log(`  Symbol: ${symbol}`);
  console.log(`  Rate: 1 USD = ${rate} ${upperCode}`);
  console.log(`  Config saved to ${getConfigFilePath()}
`);
});
program.command("model-alias [from] [to]").description("Map a provider model name to a canonical one for pricing (e.g. codeburn model-alias my-model claude-opus-4-6)").option("--remove <from>", "Remove an alias").option("--list", "List configured aliases").action(async (from, to, opts) => {
  const config = await readConfig();
  const aliases = config.modelAliases ?? {};
  if (opts?.list || !from && !opts?.remove) {
    const entries = Object.entries(aliases);
    if (entries.length === 0) {
      console.log("\n  No model aliases configured.");
      console.log(`  Config: ${getConfigFilePath()}
`);
    } else {
      console.log("\n  Model aliases:");
      for (const [src, dst] of entries) {
        console.log(`    ${src} -> ${dst}`);
      }
      console.log(`  Config: ${getConfigFilePath()}
`);
    }
    return;
  }
  if (opts?.remove) {
    if (!(opts.remove in aliases)) {
      console.error(`
  Alias not found: ${opts.remove}
`);
      process.exitCode = 1;
      return;
    }
    delete aliases[opts.remove];
    config.modelAliases = Object.keys(aliases).length > 0 ? aliases : void 0;
    await saveConfig(config);
    console.log(`
  Removed alias: ${opts.remove}
`);
    return;
  }
  if (!from || !to) {
    console.error("\n  Usage: codeburn model-alias <from> <to>\n");
    process.exitCode = 1;
    return;
  }
  aliases[from] = to;
  config.modelAliases = aliases;
  await saveConfig(config);
  console.log(`
  Alias saved: ${from} -> ${to}`);
  console.log(`  Config: ${getConfigFilePath()}
`);
});
program.command("plan [action] [id]").description("Show or configure a subscription plan for overage tracking").option("--format <format>", "Output format: text or json", "text").option("--monthly-usd <n>", "Monthly plan price in USD (for custom)", parseNumber).option("--provider <name>", "Provider scope: all, claude, codex, cursor", "all").option("--reset-day <n>", "Day of month plan resets (1-28)", parseInteger, 1).action(async (action, id, opts) => {
  const mode = action ?? "show";
  if (mode === "show") {
    const plan = await readPlan();
    const displayPlan = !plan || plan.id === "none" ? { id: "none", monthlyUsd: 0, provider: "all", resetDay: 1, setAt: null } : {
      id: plan.id,
      monthlyUsd: plan.monthlyUsd,
      provider: plan.provider,
      resetDay: clampResetDay(plan.resetDay),
      setAt: plan.setAt
    };
    if (opts?.format === "json") {
      console.log(JSON.stringify(displayPlan));
      return;
    }
    if (!plan || plan.id === "none") {
      console.log("\n  Plan: none");
      console.log("  API-pricing view is active.");
      console.log(`  Config: ${getConfigFilePath()}
`);
      return;
    }
    console.log(`
  Plan: ${planDisplayName(plan.id)} (${plan.id})`);
    console.log(`  Budget: $${plan.monthlyUsd}/month`);
    console.log(`  Provider: ${plan.provider}`);
    console.log(`  Reset day: ${clampResetDay(plan.resetDay)}`);
    console.log(`  Set at: ${plan.setAt}`);
    console.log(`  Config: ${getConfigFilePath()}
`);
    return;
  }
  if (mode === "reset") {
    await clearPlan();
    console.log("\n  Plan reset. API-pricing view is active.\n");
    return;
  }
  if (mode !== "set") {
    console.error("\n  Usage: codeburn plan [set <id> | reset]\n");
    process.exitCode = 1;
    return;
  }
  if (!id || !isPlanId(id)) {
    console.error(`
  Plan id must be one of: claude-pro, claude-max, cursor-pro, custom, none; got "${id ?? ""}".
`);
    process.exitCode = 1;
    return;
  }
  const resetDay = opts?.resetDay ?? 1;
  if (!Number.isInteger(resetDay) || resetDay < 1 || resetDay > 28) {
    console.error(`
  --reset-day must be an integer from 1 to 28; got ${resetDay}.
`);
    process.exitCode = 1;
    return;
  }
  if (id === "none") {
    await clearPlan();
    console.log("\n  Plan reset. API-pricing view is active.\n");
    return;
  }
  if (id === "custom") {
    if (opts?.monthlyUsd === void 0) {
      console.error("\n  Custom plans require --monthly-usd <positive number>.\n");
      process.exitCode = 1;
      return;
    }
    const monthlyUsd = opts.monthlyUsd;
    if (!Number.isFinite(monthlyUsd) || monthlyUsd <= 0) {
      console.error(`
  --monthly-usd must be a positive number; got ${opts.monthlyUsd}.
`);
      process.exitCode = 1;
      return;
    }
    const provider = opts?.provider ?? "all";
    if (!isPlanProvider(provider)) {
      console.error(`
  --provider must be one of: all, claude, codex, cursor; got "${provider}".
`);
      process.exitCode = 1;
      return;
    }
    await savePlan({
      id: "custom",
      monthlyUsd,
      provider,
      resetDay,
      setAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    console.log(`
  Plan set to custom ($${monthlyUsd}/month, ${provider}, reset day ${resetDay}).`);
    console.log(`  Config saved to ${getConfigFilePath()}
`);
    return;
  }
  const preset = getPresetPlan(id);
  if (!preset) {
    console.error(`
  Unknown preset "${id}".
`);
    process.exitCode = 1;
    return;
  }
  await savePlan({
    ...preset,
    resetDay,
    setAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  console.log(`
  Plan set to ${planDisplayName(preset.id)} ($${preset.monthlyUsd}/month).`);
  console.log(`  Provider: ${preset.provider}`);
  console.log(`  Reset day: ${resetDay}`);
  console.log(`  Config saved to ${getConfigFilePath()}
`);
});
program.command("optimize").description("Find token waste and get exact fixes").option("-p, --period <period>", "Analysis period: today, week, 30days, month, all", "30days").option("--provider <provider>", "Filter by provider: all, claude, codex, cursor", "all").action(async (opts) => {
  await loadPricing();
  const { range, label } = getDateRange2(opts.period);
  const projects = await parseAllSessions(range, opts.provider);
  await runOptimize(projects, label, range);
});
program.command("compare").description("Compare two AI models side-by-side").option("-p, --period <period>", "Analysis period: today, week, 30days, month, all", "all").option("--provider <provider>", "Filter by provider: all, claude, codex, cursor", "all").action(async (opts) => {
  await loadPricing();
  const { range } = getDateRange2(opts.period);
  await renderCompare(range, opts.provider);
});
program.command("yield").description("Track which AI spend shipped to main vs reverted/abandoned (experimental)").option("-p, --period <period>", "Analysis period: today, week, 30days, month, all", "week").action(async (opts) => {
  const { computeYield: computeYield2, formatYieldSummary: formatYieldSummary2 } = await Promise.resolve().then(() => (init_yield(), yield_exports));
  await loadPricing();
  const { range, label } = getDateRange2(opts.period);
  console.log(`
  Analyzing yield for ${label}...
`);
  const summary = await computeYield2(range, process.cwd());
  console.log(formatYieldSummary2(summary));
});
program.parse();
//# sourceMappingURL=cli.js.map