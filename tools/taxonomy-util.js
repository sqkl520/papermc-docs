#!/usr/bin/env node
/**
 * tools/taxonomy-util.js
 * PaperMC 文档资料库分类体系（taxonomy）工具集。
 *
 * 子命令：
 *   extract [archive] ...   抽取每页的 front matter + 正文标题证据 -> 系统临时目录
 *   build <data.json>      以分类数据 + manifest 组装 data/taxonomy.json
 *   validate               校验 data/taxonomy.json 是否满足硬性契约 -> 控制台输出报告
 *   report                 以 taxonomy.json + manifest 生成分类页数统计表
 *
 * 用法示例（在仓库根目录下）：
 *   node tools/taxonomy-util.js extract paper velocity
 *   node tools/taxonomy-util.js build TMPDIR\papermc-tax-data.json
 *   node tools/taxonomy-util.js validate
 *   node tools/taxonomy-util.js report
 *
 * 分类数据（data.json）结构：
 *   {
 *     "generated_at": "可选，缺省取当前时间",
 *     "sections":     [{ "id","title","subtitle","archive" }],
 *     "categories":   [{ "id","title","section","order","description" }],
 *     "titleOverrides": { "<section>:<rel>": "覆盖后的显示标题" },
 *     "pages":        { "<section>:<rel>": { "category","order","tags":[],"summary" } }
 *   }
 * build 只从 data.json 取分类归属/标签/摘要/标题覆盖，url、description、rel 一律
 * 以 archives/<section>/manifest.json 与页面 front matter 为准；title 默认同样取
 * front matter，仅在 titleOverrides 命中时覆盖（用于消解同一 section 内的同名页面）。
 *
 * 说明：所有写文件均使用 fs.writeFileSync(..., 'utf8')，UTF-8 无 BOM。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARCHIVES = ['paper', 'velocity'];

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJSON(file, obj, pretty = true) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, pretty ? 2 : 0) + '\n', 'utf8');
}

function readManifest(section) {
  return readJSON(path.join(ROOT, 'archive', section, 'manifest.json'));
}

/** 极简 YAML front matter 解析（仅支持顶层 key: value 与单行字符串/布尔/数字） */
function parseFrontMatter(text) {
  const fm = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return { data: fm, body: text };
  const body = text.slice(m[0].length);
  for (const rawLine of m[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    fm[key] = val;
  }
  return { data: fm, body };
}

/** 抽出正文标题：返回 [{ level, text }]，忽略代码块内的 # 行 */
function extractHeadings(body, max = 14) {
  const out = [];
  let inFence = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,4})\s+(.*\S)\s*$/.exec(line);
    if (m) {
      // 去掉 Markdown 行内标记，便于阅读
      const text = m[2]
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[`*_]/g, '')
        .trim();
      out.push({ level: m[1].length, text });
      if (out.length >= max) break;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* extract：批量抽取页面证据                                            */
/* ------------------------------------------------------------------ */

function extractPage(section, page) {
  const mdPath = path.join(ROOT, 'archive', section, page.file);
  let text = '';
  try {
    text = fs.readFileSync(mdPath, 'utf8');
  } catch (e) {
    return {
      section,
      rel: page.rel,
      url: page.url,
      title: page.title,
      missing: true,
      error: String(e.message || e),
    };
  }
  const { data, body } = parseFrontMatter(text);
  const headings = extractHeadings(body, 14);
  // 正文首段（用于辅助判断页面性质）
  const firstParagraph = (body
    .split(/\r?\n\r?\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith('#') && !p.startsWith(':::') && !p.startsWith('```')) || ''
  ).slice(0, 220);
  return {
    section,
    rel: page.rel,
    url: page.url,
    title: (data.title || page.title || '').trim(),
    manifestTitle: page.title || '',
    description: (data.description || page.description || '').trim(),
    source: (data.source || page.url || '').trim(),
    markdownBytes: page.markdownBytes,
    codeBlocks: page.codeBlocks,
    links: page.links,
    headings,
    firstParagraph,
    isReference: /^reference\//.test(page.rel) || /\/(reference)\//.test(page.rel),
  };
}

function cmdExtract(sections) {
  const list = sections.length ? sections : ARCHIVES;
  const all = [];
  for (const section of list) {
    const manifest = readManifest(section);
    for (const page of manifest.pages) all.push(extractPage(section, page));
  }
  // 中间证据文件写到系统临时目录，避免污染 library/ 与 tools/ 交付目录
  const out = path.join(require('os').tmpdir(), 'papermc-taxonomy-evidence.json');
  writeJSON(out, { generated_at: new Date().toISOString(), count: all.length, pages: all });
  console.log('evidence written: ' + out + '  pages=' + all.length);
  return all;
}

/* ------------------------------------------------------------------ */
/* build：以分类数据 + manifest 组装 taxonomy.json                      */
/* ------------------------------------------------------------------ */

function cmdBuild(dataFile, outFile) {
  if (!dataFile) {
    console.log('用法: node tools/taxonomy-util.js build <data.json> [out.json]');
    return 1;
  }
  const data = readJSON(dataFile);
  const out = outFile || path.join(ROOT, 'data', 'taxonomy.json');

  const taxonomy = {
    generated_at: data.generated_at || new Date().toISOString(),
    sections: [],
    categories: [],
    pages: [],
  };

  for (const s of data.sections || []) {
    const manifest = readManifest(s.id);
    taxonomy.sections.push({
      id: s.id,
      title: s.title,
      subtitle: s.subtitle,
      archive: s.archive || 'archive/' + s.id,
      pageCount: manifest.pages.length,
    });
  }

  for (const c of data.categories || []) {
    taxonomy.categories.push({
      id: c.id,
      title: c.title,
      section: c.section,
      order: c.order,
      description: c.description,
    });
  }

  for (const s of taxonomy.sections) {
    const manifest = readManifest(s.id);
    for (const mp of manifest.pages) {
      const id = s.id + ':' + mp.rel;
      const d = (data.pages || {})[id];
      if (!d) {
        console.log('data.json 缺少页面归属: ' + id);
        return 1;
      }
      const mdPath = path.join(ROOT, 'archive', s.id, mp.file);
      let fm = {};
      try {
        fm = parseFrontMatter(fs.readFileSync(mdPath, 'utf8')).data;
      } catch (e) {
        /* 页面文件缺失时退化为 manifest 字段 */
      }
      const override = (data.titleOverrides || {})[id];
      taxonomy.pages.push({
        id,
        section: s.id,
        rel: mp.rel,
        url: mp.url,
        title: (override || fm.title || mp.title || '').trim(),
        description: (fm.description || mp.description || '').trim(),
        category: d.category,
        order: d.order,
        tags: d.tags,
        summary: d.summary,
      });
    }
  }

  writeJSON(out, taxonomy);
  console.log('taxonomy written: ' + out);
  console.log('  sections=' + taxonomy.sections.length + ' categories=' + taxonomy.categories.length + ' pages=' + taxonomy.pages.length);
  return 0;
}

/* ------------------------------------------------------------------ */
/* validate：硬性契约校验                                               */
/* ------------------------------------------------------------------ */

const BANNED_FIRST = /[。，,；;]\s*$/;
const CJK = /[\u4e00-\u9fff]/;

function cmdValidate(taxonomyFile) {
  const taxFile = taxonomyFile || path.join(ROOT, 'data', 'taxonomy.json');
  const errors = [];
  const warnings = [];
  let tax;
  try {
    const raw = fs.readFileSync(taxFile, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) errors.push('taxonomy.json 含 BOM，必须为无 BOM UTF-8');
    tax = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (e) {
    console.log('FATAL: 无法解析 taxonomy.json -> ' + e.message);
    return 1;
  }

  const KNOWN_SECTIONS = ['paper', 'velocity'];
  const SECTION_TITLES = { paper: 'Paper', velocity: 'Velocity' };

  if (!tax.generated_at || !/^\d{4}-\d{2}-\d{2}T/.test(tax.generated_at)) {
    errors.push('generated_at 缺失或格式异常');
  }

  /* sections */
  const secById = new Map();
  if (!Array.isArray(tax.sections)) errors.push('sections 必须是数组');
  for (const s of tax.sections || []) {
    if (secById.has(s.id)) errors.push('sections 重复 id: ' + s.id);
    secById.set(s.id, s);
    for (const k of ['id', 'title', 'subtitle', 'archive', 'pageCount']) {
      if (!(k in s)) errors.push('section ' + s.id + ' 缺少字段 ' + k);
    }
    if (s.archive !== 'archive/' + s.id) {
      errors.push('section ' + s.id + ' archive 应为 archives/' + s.id + '，实际 ' + s.archive);
    }
  }
  const expectedCounts = {};
  for (const sec of KNOWN_SECTIONS) {
    const manifest = readManifest(sec);
    expectedCounts[sec] = manifest.pages.length;
    const s = secById.get(sec);
    if (!s) {
      errors.push('sections 缺少 section: ' + sec);
    } else if (s.pageCount !== manifest.pages.length) {
      errors.push(
        'section ' + sec + ' pageCount=' + s.pageCount + '，manifest 实际 ' + manifest.pages.length
      );
    }
  }
  for (const s of tax.sections || []) {
    if (!KNOWN_SECTIONS.includes(s.id)) errors.push('未知 section id: ' + s.id);
    if (s.subtitle && !CJK.test(s.subtitle)) warnings.push('section ' + s.id + ' subtitle 非中文');
    if (s.title !== SECTION_TITLES[s.id]) {
      warnings.push('section ' + s.id + ' title 与约定不一致: ' + s.title);
    }
  }

  /* categories */
  const catById = new Map();
  const catsBySection = {};
  if (!Array.isArray(tax.categories)) errors.push('categories 必须是数组');
  for (const c of tax.categories || []) {
    if (catById.has(c.id)) errors.push('categories 重复 id: ' + c.id);
    catById.set(c.id, c);
    for (const k of ['id', 'title', 'section', 'order', 'description']) {
      if (!(k in c)) errors.push('category ' + c.id + ' 缺少字段 ' + k);
    }
    if (!KNOWN_SECTIONS.includes(c.section)) errors.push('category ' + c.id + ' section 非法: ' + c.section);
    if (!CJK.test(c.title || '')) errors.push('category ' + c.id + ' title 必须为中文: ' + c.title);
    if (typeof c.order !== 'number') errors.push('category ' + c.id + ' order 必须为数字');
    if (!c.id.startsWith(c.section + '-')) {
      warnings.push('category ' + c.id + ' 未以 section 前缀开头（不强制）');
    }
    (catsBySection[c.section] = catsBySection[c.section] || []).push(c);
  }
  for (const sec of KNOWN_SECTIONS) {
    const n = (catsBySection[sec] || []).length;
    if (n < 5 || n > 9) {
      errors.push('section ' + sec + ' 分类数=' + n + '，要求 5-9 个');
    }
  }

  /* pages */
  const manifestPages = new Map(); // section -> Map(rel -> page)
  for (const sec of KNOWN_SECTIONS) {
    const manifest = readManifest(sec);
    const m = new Map();
    for (const p of manifest.pages) {
      if (m.has(p.rel)) errors.push('manifest 内部重复 rel: ' + sec + ':' + p.rel);
      m.set(p.rel, p);
    }
    manifestPages.set(sec, m);
  }

  const seen = new Map(); // "section:rel" -> page
  const ORDER_MIN_PER_CAT = 0;
  const tagsSeenNonEmpty = [];
  if (!Array.isArray(tax.pages)) errors.push('pages 必须是数组');
  for (const p of tax.pages || []) {
    const key = p.section + ':' + p.rel;
    if (seen.has(key)) errors.push('pages 重复条目: ' + key);
    seen.set(key, p);

    for (const k of ['id', 'section', 'rel', 'url', 'title', 'description', 'category', 'order', 'tags', 'summary']) {
      if (!(k in p)) errors.push('page ' + key + ' 缺少字段 ' + k);
    }
    if (p.id !== key) errors.push('page id 必须为 "section:rel"，实际 ' + p.id + ' ≠ ' + key);
    if (!KNOWN_SECTIONS.includes(p.section)) errors.push('page ' + key + ' section 非法');
    if (p.description !== '' && typeof p.description !== 'string') {
      errors.push('page ' + key + ' description 必须为字符串（可为空串）');
    }

    const mf = manifestPages.get(p.section);
    if (mf) {
      const mp = mf.get(p.rel);
      if (!mp) {
        errors.push('page ' + key + ' 在 manifest 中不存在（多余页）');
      } else {
        if (mp.url !== p.url) errors.push('page ' + key + ' url 与 manifest 不一致: ' + p.url + ' ≠ ' + mp.url);
      }
    }

    const cat = catById.get(p.category);
    if (!cat) {
      errors.push('page ' + key + ' category 未定义: ' + p.category);
    } else if (cat.section !== p.section) {
      errors.push('page ' + key + ' category ' + p.category + ' 属于 ' + cat.section + '，与页 section 不符');
    }

    if (typeof p.order !== 'number') errors.push('page ' + key + ' order 必须为数字');
    if (typeof p.order === 'number' && p.order < ORDER_MIN_PER_CAT) {
      errors.push('page ' + key + ' order 必须为正数');
    }

    if (!Array.isArray(p.tags)) {
      errors.push('page ' + key + ' tags 必须为数组');
    } else {
      if (p.tags.length < 2 || p.tags.length > 5) {
        errors.push('page ' + key + ' tags 数量=' + p.tags.length + '，要求 2-5');
      }
      if (new Set(p.tags).size !== p.tags.length) errors.push('page ' + key + ' tags 有重复');
      for (const t of p.tags) {
        if (typeof t !== 'string' || !t.trim()) errors.push('page ' + key + ' tags 含空值');
        else if (!CJK.test(t)) warnings.push('page ' + key + ' 标签非中文: ' + t);
        else tagsSeenNonEmpty.push(t);
      }
    }

    if (typeof p.summary !== 'string' || !p.summary.trim()) {
      errors.push('page ' + key + ' summary 缺失');
    } else if (!CJK.test(p.summary)) {
      errors.push('page ' + key + ' summary 非中文: ' + p.summary);
    } else {
      const len = p.summary.length;
      if (len < 30 || len > 60) {
        errors.push('page ' + key + ' summary 长度=' + len + '，要求 30-60 字');
      }
      if (BANNED_FIRST.test(p.summary)) {
        warnings.push('page ' + key + ' summary 以标点结尾');
      }
    }
  }

  /* 无遗漏 */
  let expectedTotal = 0;
  for (const sec of KNOWN_SECTIONS) {
    for (const p of manifestPages.get(sec).values()) {
      expectedTotal++;
      const key = sec + ':' + p.rel;
      if (!seen.has(key)) errors.push('pages 遗漏页面: ' + key);
    }
  }
  if ((tax.pages || []).length !== expectedTotal) {
    errors.push('pages 总数=' + (tax.pages || []).length + '，manifest 合计应为 ' + expectedTotal);
  }

  /* 分类页数统计 & 单页分类检查 */
  const countByCat = {};
  for (const p of tax.pages || []) countByCat[p.category] = (countByCat[p.category] || 0) + 1;
  for (const c of tax.categories || []) {
    const n = countByCat[c.id] || 0;
    if (n === 0) errors.push('category ' + c.id + ' 没有任何页面');
    else if (n === 1) warnings.push('category ' + c.id + ' 只有 1 页（需在 notes 中说明理由）');
  }

  /* 分类间 order 阅读顺序 */
  for (const sec of KNOWN_SECTIONS) {
    const orders = (catsBySection[sec] || []).map((c) => c.order);
    if (orders.some((o) => typeof o !== 'number')) continue;
    const sorted = [...orders].sort((a, b) => a - b);
    if (sorted.some((o, i) => i > 0 && sorted[i - 1] === o)) {
      warnings.push('section ' + sec + ' 分类 order 有重复值');
    }
  }

  /* 同 section 内同名页面（侧栏/检索会混） */
  const titleMap = {};
  for (const p of tax.pages || []) {
    const k = p.section + '|' + p.title;
    (titleMap[k] = titleMap[k] || []).push(p.id);
  }
  for (const k of Object.keys(titleMap)) {
    if (titleMap[k].length > 1) {
      warnings.push('同一 section 内同名页面未加后缀消歧: ' + k + ' → ' + titleMap[k].join(', '));
    }
  }

  console.log('=== taxonomy 校验报告 ===');
  console.log('文件            : ' + taxFile);
  console.log('sections        : ' + (tax.sections || []).length);
  console.log('categories      : ' + (tax.categories || []).length);
  console.log('pages           : ' + (tax.pages || []).length + ' / 期望 ' + expectedTotal);
  console.log('分类页数        : ' + Object.keys(countByCat).length + ' 个分类被使用');
  console.log('errors          : ' + errors.length);
  console.log('warnings        : ' + warnings.length);
  for (const e of errors) console.log('  [ERROR] ' + e);
  for (const w of warnings) console.log('  [WARN ] ' + w);
  console.log(errors.length === 0 ? 'RESULT: PASS（硬性规则全部满足）' : 'RESULT: FAIL');
  return errors.length === 0 ? 0 : 1;
}

/* ------------------------------------------------------------------ */
/* report：分类 -> 页数 -> 代表页 表                                     */
/* ------------------------------------------------------------------ */

function cmdReport(taxonomyFile) {
  const taxFile = taxonomyFile || path.join(ROOT, 'data', 'taxonomy.json');
  const tax = readJSON(taxFile);
  const countByCat = {};
  const sampleByCat = {};
  for (const p of tax.pages) {
    countByCat[p.category] = (countByCat[p.category] || 0) + 1;
    (sampleByCat[p.category] = sampleByCat[p.category] || []).push(p);
  }
  for (const s of tax.sections) {
    const cats = tax.categories
      .filter((c) => c.section === s.id)
      .sort((a, b) => a.order - b.order);
    console.log('## ' + s.title + '（' + s.subtitle + '，' + s.pageCount + ' 页）');
    console.log('| order | 分类 | id | 页数 | 代表页 |');
    console.log('| --- | --- | --- | --- | --- |');
    for (const c of cats) {
      const list = (sampleByCat[c.id] || []).slice().sort((a, b) => a.order - b.order);
      const reps = list.slice(0, 3).map((p) => p.title).join('、') || '-';
      console.log(
        '| ' + c.order + ' | ' + c.title + ' | ' + c.id + ' | ' + (countByCat[c.id] || 0) + ' | ' + reps + ' |'
      );
    }
    console.log('');
  }
}

/* ------------------------------------------------------------------ */

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'extract':
      cmdExtract(rest);
      break;
    case 'build':
      process.exitCode = cmdBuild(rest[0], rest[1]);
      break;
    case 'validate':
      process.exitCode = cmdValidate(rest[0]);
      break;
    case 'report':
      cmdReport(rest[0]);
      break;
    default:
      console.log(
        [
          '用法: node tools/taxonomy-util.js <extract|build|validate|report> [args]',
          '  extract [section...]   抽取页面证据 -> 系统临时目录',
          '  build   <data.json>    由分类数据 + manifest 生成 data/taxonomy.json',
          '  validate [file]        校验 data/taxonomy.json',
          '  report   [file]        输出分类统计表',
        ].join('\n')
      );
  }
}

if (require.main === module) main();

module.exports = { parseFrontMatter, extractHeadings, readManifest, readJSON, writeJSON };
