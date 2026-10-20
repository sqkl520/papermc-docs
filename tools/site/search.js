'use strict';
/**
 * search.js — builds the dependency-free client search index.
 *
 * Two identical payloads are emitted:
 *   library/search-index.json          (fetchable when served over http://)
 *   library/assets/search-index.js     (`window.__LIBRARY_SEARCH__ = {...}`, works over file://)
 *
 * Entry fields (short keys keep the file small):
 *   p  output path           id page id          t  title
 *   sid section id           s  section title    c  category title      ct category id
 *   cd category description  u  Chinese summary  kw taxonomy tags       h  h2-h4 headings
 *   lt latin tokens (title/tags/rel/category)    x  body text           n  heading count
 *   sn 源结构路径（source-nav.json 先序：Paper › Development › API › …，仅用于结果显示，不参与打分）
 *
 * 打分字段集合（t/u/kw/h/c/cd/x/lt/o）保持不变：源结构导航上线不改变任何检索排序。
 *
 * `aliases` maps a Chinese query term to Latin tokens that appear in page titles/tags, so
 * 「权限 → Permissions」「性能 → Tuning Velocity」rank the canonical page first.
 *
 * Body text is kept in full (the whole mirror is ~1 MiB of text); the byte budget below only
 * kicks in if the payload ever exceeds `totalCap`.
 */

const U = require('./util');

const BODY_CAP = 512 * 1024;   // effectively "keep the whole page"; the budget loop shrinks it
const BODY_FLOOR = 2048;
const TOTAL_CAP = 3 * 1024 * 1024;

/** Chinese query term -> Latin tokens found in titles / tags / slug */
const ALIASES = {
  '权限': ['permission', 'permissions'],
  '性能': ['performance', 'tuning'],
  '代理': ['proxy', 'proxies'],
  '插件': ['plugin', 'plugins'],
  '加载': ['load', 'loading'],
  '命令': ['command', 'commands'],
  '配置': ['config', 'configuration'],
  '启动': ['start', 'launch', 'boot'],
  '安装': ['install', 'installation'],
  '更新': ['update', 'upgrade'],
  '排错': ['troubleshoot', 'troubleshooting', 'debug'],
  '参考': ['reference'],
  '开发': ['develop', 'development', 'dev'],
  '事件': ['event', 'events'],
  '调度': ['scheduler', 'scheduling'],
  '世界': ['world'],
  '安全': ['security', 'secure'],
  '备份': ['backup'],
  '迁移': ['migration', 'migrate'],
  '数据库': ['database'],
  '消息': ['message', 'messaging'],
  '聊天': ['chat'],
  '文本': ['text', 'component'],
  '注入': ['inject', 'injection'],
  '参数': ['argument', 'arguments', 'parameter'],
  '构建': ['build', 'gradle', 'maven'],
  '监听': ['listen', 'listener', 'events'],
  '注册': ['register', 'registration'],
  '节点': ['node', 'nodes'],
  '依赖': ['depend', 'dependency', 'dependencies'],
  '服务端': ['server', 'paper'],
  '代理端': ['proxy', 'velocity'],
};

/**
 * Multi-word Chinese queries that should also match when the parts are not adjacent
 * ("插件加载" matches a summary saying "插件的加载机制"). Each part must be an ALIASES key;
 * a page matches the phrase when every part matches somewhere in it.
 */
const PHRASES = [
  { q: '插件加载', parts: ['插件', '加载'] },
  { q: '插件开发', parts: ['插件', '开发'] },
  { q: '命令注册', parts: ['命令', '注册'] },
  { q: '命令权限', parts: ['命令', '权限'] },
  { q: '权限节点', parts: ['权限', '节点'] },
  { q: '事件监听', parts: ['事件', '监听'] },
  { q: '启动脚本', parts: ['启动', '安装'] },
  { q: '启动参数', parts: ['启动', '参数'] },
  { q: '性能调优', parts: ['性能'] },
  { q: '配置文件', parts: ['配置'] },
  { q: '世界配置', parts: ['世界', '配置'] },
  { q: '版本更新', parts: ['更新'] },
  { q: '依赖管理', parts: ['依赖', '构建'] },
  { q: '代理端', parts: ['代理端'] },
  { q: '服务端', parts: ['服务端'] },
];

function latinTokens(page) {
  const raw = [
    page.title, (page.tags || []).join(' '), page.rel,
    page.categoryTitle, page.category,
  ].join(' ').toLowerCase();
  return raw.replace(/[^a-z0-9._/-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
}

/**
 * @param {Array} pages page records
 * @returns {{payload:object,json:string,js:string,stats:object,aliases:object}}
 */
function buildSearchIndex(pages, opts = {}) {
  const totalCap = opts.totalCap || TOTAL_CAP;
  let cap = opts.bodyCap || BODY_CAP;
  let payload = null;
  let json = '';
  const attempts = [];
  for (let i = 0; i < 12; i++) {
    payload = {
      generated_at: opts.generatedAt || new Date().toISOString(),
      generator: 'tools/build-site.js',
      schema: {
        t: 'title', u: 'Chinese summary', kw: 'taxonomy tags',
        h: 'h2-h4 真实小节标题（不含任何派生/对账用数据）',
        c: 'category title', cd: 'category description', lt: 'latin tokens', x: 'body text',
        s: 'section title', p: 'output path', id: 'page id', o: 'taxonomy order（平局时按升序，确定性兜底）',
        sn: '源结构路径（source-nav.json，仅显示用，不参与打分）',
        kq: '预计算的命中查询词（由 site.js 里同一份排序代码在构建期算出）',
      },
      note: '正文保留整页（本镜像正文合计约 1 MiB）；仅当总体积超过 3 MiB 才逐步截断。'
        + '匹配权重：标题 60/30 · 标签 32+序位 · 摘要 18 · 小节 12 · 分类 8 · 正文 5；'
        + '英文别名胜负按字段分档：标题 26 > 小节 18 > 摘要/标签/分类 10 > 正文 2；'
        + '中文查询若无直接命中，依次退回「受控短语分解」（x0.6，如 插件加载 = 插件 + 加载）与「全部二字片段命中」（x0.45）。',
      bodyCapBytes: cap,
      aliases: ALIASES,
      phrases: PHRASES,
      pages: pages.map((p) => {
        const body = U.truncateBytes(p.text || '', cap);
        return {
          p: p.outputRel,
          id: p.id,
          t: p.title,
          o: Number.isFinite(p.order) ? p.order : undefined,
          sid: p.section,
          s: p.sectionTitle,
          c: p.categoryTitle,
          ct: p.category,
          cd: p.categoryDescription || '',
          sn: p.navPath || '',
          u: U.truncateBytes(p.summary || p.description || '', 400).text,
          kw: p.tags || [],
          lt: latinTokens(p),
          h: (p.tocText || []).slice(0, 80),
          x: body.text,
          n: (p.tocText || []).length,
        };
      }),
    };
    json = JSON.stringify(payload);
    const bytes = Buffer.byteLength(json, 'utf8');
    attempts.push({ cap, bytes });
    if (bytes <= totalCap || cap <= BODY_FLOOR) break;
    cap = Math.max(BODY_FLOOR, Math.floor(cap / 2));
  }
  const js = '/* generated by tools/build-site.js — offline search corpus, do not edit */\n'
    + 'window.__LIBRARY_SEARCH__ = ' + json + ';\n';
  const jsonBytes = Buffer.byteLength(json, 'utf8');
  return {
    payload,
    json,
    js,
    aliases: ALIASES,
    stats: {
      entries: payload.pages.length,
      bodyCapBytes: payload.bodyCapBytes,
      jsonBytes,
      jsBytes: Buffer.byteLength(js, 'utf8'),
      attempts,
      underCap: jsonBytes <= totalCap,
      truncatedPages: payload.pages.filter((p, i) => (pages[i].text || '').length > p.x.length).length,
      aliases: Object.keys(ALIASES).length,
    },
  };
}

/** re-serialise a (possibly enriched) payload into both output forms */
function serialize(payload) {
  const json = JSON.stringify(payload);
  return {
    json,
    js: '/* generated by tools/build-site.js — offline search corpus, do not edit */\n'
      + 'window.__LIBRARY_SEARCH__ = ' + json + ';\n',
  };
}

module.exports = { buildSearchIndex, serialize, ALIASES, PHRASES, BODY_CAP, TOTAL_CAP, latinTokens };
