#!/usr/bin/env node
'use strict';
/**
 * privacy-scan.js — 仓库感知的隐私 / 本机痕迹扫描器
 *
 * 只扫描「会被 git 跟踪的文件」，并把每一处命中分到四类：
 *
 *   ① must-fix     必须修复：我们自己写的代码 / 数据 / 产物里的本机痕迹
 *  ②a public-url   正当公网信息（仓库所有者自己的公开地址，如 github.io / github.com 上的仓库页）
 *  ②b loopback-ok  回环地址（localhost / 127.0.0.1 / 0.0.0.0）：任何机器上语义相同，
 *                   不含任何可识别本机的信息，属于开发服务器默认值与文档示例，不构成泄露
 *   ③ upstream     上游内容：archive/** 里的正文 / HTML / 快照 / markdown（含我们
 *                   镜像下来的上游 Markdown）。这些文件里的 localhost、C:\ 示例路径、
 *                   示例邮箱都是**文档正文**，禁止修改，只统计并说明。
 *                   例外：archive/<section>/{manifest.json,crawl-report.md,validation.json,INDEX.md}
 *                   是我们自己生成的元数据，不算上游内容，按普通文件判定。
 *
 * 用法
 *   node tools/privacy-scan.js                 # 人类可读报告；有 ① 类命中则退出码 1
 *   node tools/privacy-scan.js --json          # 机器可读（含片段，便于 CI 定位）
 *   node tools/privacy-scan.js --selftest      # 用临时目录里的构造样例自检 9 条规则
 *   node tools/privacy-scan.js --all           # 连 .gitignore 忽略的文件一起扫
 *   node tools/privacy-scan.js --git           # 改用 git ls-files 枚举文件（只读）
 *   node tools/privacy-scan.js --quiet         # 只打印汇总
 *
 * 每次运行都会把「最近一次扫描结果」写进 data/privacy-report.json。
 * 该文件**只含相对路径与计数，不含命中片段原文**，避免二次泄露；
 * 需要看片段原文时看终端输出或 --json。
 *
 * 文件枚举
 *   默认走内置的 .gitignore 匹配器（纯 Node、离线、确定性），
 *   --git 时走 `git ls-files --cached --others --exclude-standard`（只读命令）。
 *
 * 自豁免
 *   规则表本身必然包含要查的字面量（机器名片段、账号、回环主机名……），
 *   这段区间用注释标记豁免：`privacy-scan:ignore-start` … `privacy-scan:ignore-end`。
 *   单行豁免：在该行任意位置写 `privacy-scan:ignore-line`。
 *   被豁免的①类命中会计入报告的 suppressed 计数，不会被静默吞掉。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const REPORT_REL = 'data/privacy-report.json';
const REPORT_ABS = path.join(REPO_ROOT, REPORT_REL);

const SKIP_DIRS = new Set(['.git', 'node_modules', '.pnpm-store', '.npm']);
/**
 * 扫描器自己的输出：由本文件按固定 schema 写出，**只含相对路径与计数**
 * （写入路径见 SCRUBBED_FIELDS），因此不再纳入扫描，否则规则 id 之类的
 * 标签会把自己的产物算成命中。跳过数量会记进报告的 file_set.skipped_self_output。
 */
const SELF_OUTPUT = new Set(['data/privacy-report.json']);
const SCRUBBED_FIELDS = 'must_fix / files_with_hits / rules / history 均不含命中片段原文';
const TEXT_SCAN_MAX_BYTES = 16 * 1024 * 1024;
const SNIPPET_MAX = 120;
const HISTORY_MAX = 10;

const BUCKETS = ['must-fix', 'public-url', 'loopback-ok', 'upstream'];

/* privacy-scan:ignore-start
 * ↓↓↓ 规则表：正则里必然出现要查的字面量，整段豁免 ↓↓↓
 */
const RULES = [
  {
    id: 'win-abs-path',
    note: 'Windows 绝对路径（转义写法：盘符 + 双反斜杠，JSON / 源码字符串里常见）',
    re: /(?<![A-Za-z0-9_])[A-Za-z]:\\\\[^\s"'`,;)\]}]+/g,
  },
  {
    id: 'win-abs-path-raw',
    note: 'Windows 绝对路径（明文写法：盘符 + 单反斜杠）',
    re: /(?<![A-Za-z0-9_])[A-Za-z]:\\(?![\\/])[^\s"'`,;)\]}]+/g,
  },
  {
    id: 'temp-path',
    note: '临时目录引用',
    re: /<tmp>|%TMP%|AppData[\\/](?:Local|Roaming)|[\\/]Temp[\\/]|\/tmp\//g,
  },
  {
    id: 'user-name',
    note: '本机用户名',
    re: /\bAdministrator\b|\bADMINI~\d/g,
  },
  {
    id: 'owner-handle',
    note: '账号 / 仓库所有者标识（出现在公网地址里属正当信息）',
    re: /\bsqkl520\b/g,
  },
  {
    id: 'owner-email',
    note: '个人邮箱',
    re: /[A-Za-z0-9._%+-]+@(?:gmail|outlook|hotmail|qq|163|126|foxmail|icloud|protonmail)\.[A-Za-z]{2,}/g,
  },
  {
    id: 'localhost',
    note: '回环地址 / 本机服务地址',
    re: /(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?::\d+)?/g,
  },
  {
    id: 'server-path',
    note: '本机目录片段',
    re: /Server[\\/]MCServers|MCServers/g,
  },
  {
    id: 'project-abs',
    note: '本机项目绝对路径片段',
    re: /papermc-docs[\\/](?:tools|library|archive|archives|data|reports)/g,
  },
];
/* privacy-scan:ignore-end */

const RULE_IDS = RULES.map((r) => r.id);

/** archive/** 里由我们自己生成的 4 类元数据：不算上游内容，要按普通文件判定。 */
const ARCHIVE_META_RE = /^archive\/[^/]+\/(?:manifest\.json|crawl-report\.md|validation\.json|INDEX\.md)$/;

/** 命中点是否落在一个正在进行的 URL 里（前面同一 token 内出现过 scheme://）。 */
const URL_TAIL_RE = /(?:https?|ftp|wss?|file):\/\/[^\s"'<>`)\]},]*$/;

/* ------------------------------------------------------------------ *
 *  .gitignore 匹配器
 * ------------------------------------------------------------------ */

function globToRe(pat) {
  let out = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '*') {
      if (pat[i + 1] === '*') {
        i++;
        if (pat[i + 1] === '/') {
          i++;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp('^' + out + '$');
}

function loadGitignore(root) {
  const p = path.join(root, '.gitignore');
  if (!fs.existsSync(p)) return [];
  const rules = [];
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    let body = raw.trim();
    let neg = false;
    if (body.startsWith('!')) {
      neg = true;
      body = body.slice(1);
    }
    let pat = body.trim();
    if (!pat) continue;
    const dirOnly = pat.endsWith('/');
    if (dirOnly) pat = pat.replace(/\/+$/, '');
    const anchored = pat.includes('/');
    rules.push({ neg, dirOnly, anchored, re: globToRe(pat) });
  }
  return rules;
}

function ruleMatches(rule, rel, isDir) {
  const segs = rel.split('/');
  if (rule.dirOnly) {
    const upto = isDir ? segs.length : segs.length - 1;
    for (let i = 1; i <= upto; i++) {
      if (rule.anchored ? rule.re.test(segs.slice(0, i).join('/')) : rule.re.test(segs[i - 1])) return true;
    }
    return false;
  }
  if (rule.anchored) return rule.re.test(rel);
  return segs.some((s) => rule.re.test(s));
}

function isIgnored(rel, isDir, rules) {
  let ignored = false;
  for (const r of rules) if (ruleMatches(r, rel, isDir)) ignored = !r.neg;
  return ignored;
}

/* ------------------------------------------------------------------ *
 *  文件枚举
 * ------------------------------------------------------------------ */

function walkRepo(root, rules, includeIgnored) {
  const files = [];
  const stack = [''];
  let ignoredPaths = 0;
  while (stack.length) {
    const relDir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, relDir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) {
        ignoredPaths++;
        continue;
      }
      const rel = relDir ? relDir + '/' + e.name : e.name;
      if (!includeIgnored && isIgnored(rel, e.isDirectory(), rules)) {
        ignoredPaths++;
        continue;
      }
      if (e.isDirectory()) stack.push(rel);
      else if (e.isFile()) files.push(rel);
    }
  }
  files.sort();
  return { files, ignoredPaths };
}

function listGitFiles(root) {
  const buf = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    maxBuffer: 128 * 1024 * 1024,
  });
  return buf.toString('utf8').split('\0').filter(Boolean).sort();
}

function listFiles(root, opts) {
  if (opts.useGit) {
    try {
      return { files: listGitFiles(root), ignoredPaths: 0, mode: 'git-ls-files' };
    } catch {
      /* git 不可用或非仓库：退回内置匹配器 */
    }
  }
  const walked = walkRepo(root, loadGitignore(root), !!opts.includeIgnored);
  return { files: walked.files, ignoredPaths: walked.ignoredPaths, mode: 'gitignore-walker' };
}

/* ------------------------------------------------------------------ *
 *  扫描引擎
 * ------------------------------------------------------------------ */

/** 收集被 self-allow 标记豁免的行号（1 基）。 */
function ignoredLineSet(text) {
  const skip = new Set();
  const lines = text.split(/\r?\n/);
  let inRegion = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (inRegion) {
      skip.add(i + 1);
      if (l.includes('privacy-scan:ignore-end')) inRegion = false;
      continue;
    }
    if (l.includes('privacy-scan:ignore-start')) {
      inRegion = true;
      skip.add(i + 1);
      continue;
    }
    if (l.includes('privacy-scan:ignore-line')) skip.add(i + 1);
  }
  return skip;
}

/** 一处命中属于哪一类。 */
function bucketFor(rel, ruleId, line, idx) {
  if (rel.startsWith('archive/') && !ARCHIVE_META_RE.test(rel)) return 'upstream';
  if (ruleId === 'owner-handle' || ruleId === 'project-abs') {
    if (URL_TAIL_RE.test(line.slice(0, idx))) return 'public-url';
  }
  if (ruleId === 'localhost') return 'loopback-ok';
  return 'must-fix';
}

function scanText(rel, text) {
  const skip = ignoredLineSet(text);
  const lines = text.split(/\r?\n/);
  const hits = [];
  let suppressed = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const skipped = skip.has(i + 1);
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line)) !== null) {
        if (m[0].length === 0) {
          rule.re.lastIndex++;
          continue;
        }
        const bucket = bucketFor(rel, rule.id, line, m.index);
        if (skipped) {
          if (bucket === 'must-fix') suppressed++;
          continue;
        }
        hits.push({ file: rel, line: i + 1, rule: rule.id, bucket, snippet: m[0] });
      }
    }
  }
  return { hits, suppressed };
}

function isProbablyBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function scanRepo(root, opts = {}) {
  const listing = listFiles(root, opts);
  const perRule = new Map(RULE_IDS.map((id) => [id, { id, note: RULES.find((r) => r.id === id).note, counts: zeroBuckets(), total: 0 }]));
  const perFile = new Map();
  const mustFix = [];
  let suppressed = 0;
  let scanned = 0;
  let skippedBinary = 0;
  let skippedLarge = 0;
  let skippedSelfOutput = 0;

  for (const rel of listing.files) {
    if (SELF_OUTPUT.has(rel)) {
      skippedSelfOutput++;
      continue;
    }
    const abs = path.join(root, rel);
    let buf;
    try {
      const st = fs.statSync(abs);
      if (!st.isFile()) continue;
      if (st.size > TEXT_SCAN_MAX_BYTES) {
        skippedLarge++;
        continue;
      }
      buf = fs.readFileSync(abs);
    } catch {
      continue;
    }
    if (isProbablyBinary(buf)) {
      skippedBinary++;
      continue;
    }
    scanned++;
    const { hits, suppressed: sup } = scanText(rel, buf.toString('utf8'));
    suppressed += sup;
    for (const h of hits) {
      const e = perRule.get(h.rule);
      e.counts[h.bucket]++;
      e.total++;
      if (h.bucket === 'must-fix') mustFix.push(h);
      if (!perFile.has(h.file)) perFile.set(h.file, { file: h.file, counts: zeroBuckets(), total: 0, lines: new Set() });
      const pf = perFile.get(h.file);
      pf.counts[h.bucket]++;
      pf.total++;
      pf.lines.add(h.line);
    }
  }

  const summary = zeroBuckets();
  for (const e of perRule.values()) for (const b of BUCKETS) summary[b] += e.counts[b];

  return {
    listing,
    scanned,
    skippedBinary,
    skippedLarge,
    skippedSelfOutput,
    suppressed,
    summary,
    perRule: [...perRule.values()],
    perFile: [...perFile.values()].map((f) => ({
      file: f.file,
      total: f.total,
      counts: f.counts,
      lines: [...f.lines].sort((a, b) => a - b),
    })),
    mustFix,
  };
}

function zeroBuckets() {
  const o = {};
  for (const b of BUCKETS) o[b] = 0;
  return o;
}

/* ------------------------------------------------------------------ *
 *  报告
 * ------------------------------------------------------------------ */

function buildReport(result, opts) {
  const mustFixFiles = new Set(result.mustFix.map((h) => h.file));
  const report = {
    schema: 1,
    generated_at: new Date().toISOString(),
    scanner: 'tools/privacy-scan.js',
    root: '<repo>',
    file_set: {
      mode: result.listing.mode,
      include_ignored: !!opts.includeIgnored,
      files: result.listing.files.length,
      scanned_text_files: result.scanned,
      skipped_binary: result.skippedBinary,
      skipped_too_large: result.skippedLarge,
      skipped_self_output: result.skippedSelfOutput,
      self_output_note: 'data/privacy-report.json 是本扫描器的输出，' + SCRUBBED_FIELDS + '，故不纳入扫描',
      ignored_paths: result.listing.ignoredPaths,
    },
    summary: {
      must_fix: result.summary['must-fix'],
      public_url: result.summary['public-url'],
      loopback_ok: result.summary['loopback-ok'],
      upstream: result.summary.upstream,
      suppressed_must_fix: result.suppressed,
      must_fix_files: mustFixFiles.size,
      total_hits: result.summary['must-fix'] + result.summary['public-url'] + result.summary['loopback-ok'] + result.summary.upstream,
    },
    buckets: {
      'must-fix': '① 必须修复：我们自己写的代码 / 数据 / 产物里的本机痕迹',
      'public-url': '② 正当公网信息：仓库所有者自己的公开地址（github.io / github.com 上的仓库页）',
      'loopback-ok': '② 正当信息：回环地址（本机回环主机名与 127.0.0.0/8 地址）——任何机器上语义相同，不含可识别本机的信息',
      upstream: '③ 上游内容：archive/** 的上游正文 / HTML / 快照 / markdown，禁止修改，仅统计（archive/<section> 下 4 类自生成元数据除外）',
    },
    rules: result.perRule.map((r) => ({
      id: r.id,
      note: r.note,
      total: r.total,
      must_fix: r.counts['must-fix'],
      public_url: r.counts['public-url'],
      loopback_ok: r.counts['loopback-ok'],
      upstream: r.counts.upstream,
    })),
    must_fix: result.mustFix
      .map((h) => ({ file: h.file, line: h.line, rule: h.rule }))
      .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line)),
    files_with_hits: result.perFile
      .slice()
      .sort((a, b) => b.total - a.total || (a.file < b.file ? -1 : 1))
      .slice(0, 40)
      .map((f) => ({ file: f.file, total: f.total, must_fix: f.counts['must-fix'], public_url: f.counts['public-url'], loopback_ok: f.counts['loopback-ok'], upstream: f.counts.upstream })),
    verdict: {
      clean: result.summary['must-fix'] === 0,
      exit_code: result.summary['must-fix'] === 0 ? 0 : 1,
      statement:
        result.summary['must-fix'] === 0
          ? '通过：仓库中不存在必须修复的本机痕迹。'
          : '未通过：仍存在必须修复的本机痕迹，见 must_fix 列表。',
    },
  };
  return report;
}

function writeReport(report) {
  let history = [];
  try {
    const prev = JSON.parse(fs.readFileSync(REPORT_ABS, 'utf8'));
    if (Array.isArray(prev.history)) history = prev.history;
  } catch {
    /* 首次运行 */
  }
  const seen = new Set(history.map((h) => h.at));
  if (!seen.has(report.generated_at)) {
    history.push({
      at: report.generated_at,
      files: report.file_set.files,
      must_fix: report.summary.must_fix,
      public_url: report.summary.public_url,
      loopback_ok: report.summary.loopback_ok,
      upstream: report.summary.upstream,
      clean: report.verdict.clean,
    });
  }
  report.history = history.slice(-HISTORY_MAX);
  fs.mkdirSync(path.dirname(REPORT_ABS), { recursive: true });
  fs.writeFileSync(REPORT_ABS, JSON.stringify(report, null, 2) + '\n', 'utf8');
}

/* ------------------------------------------------------------------ *
 *  输出
 * ------------------------------------------------------------------ */

function printHuman(result, report, opts) {
  const pad = (n, w) => String(n).padStart(w);
  if (!opts.quiet) {
    console.log('privacy-scan — 仓库感知的隐私扫描');
    console.log('  文件枚举：' + report.file_set.mode + '（' + report.file_set.files + ' 个文件' +
      (report.file_set.ignored_paths ? '；另有 ' + report.file_set.ignored_paths + ' 条被 .gitignore 忽略的路径已跳过' : '') + '）');
    console.log('  实际读取文本：' + report.file_set.scanned_text_files + ' 个（二进制跳过 ' + report.file_set.skipped_binary + '，超大跳过 ' + report.file_set.skipped_too_large + '，自身产物跳过 ' + report.file_set.skipped_self_output + '）');
    console.log('');
    console.log('  分类统计');
    console.log('    ① must-fix    ' + pad(report.summary.must_fix, 6) + '   必须修复');
    console.log('    ② public-url  ' + pad(report.summary.public_url, 6) + '   正当公网信息（仓库自己的公开地址）');
    console.log('    ② loopback-ok ' + pad(report.summary.loopback_ok, 6) + '   回环地址，不含本机信息');
    console.log('    ③ upstream    ' + pad(report.summary.upstream, 6) + '   上游内容，禁止修改，仅统计');
    console.log('    self-allow 豁免的①类命中：' + report.summary.suppressed_must_fix);
    console.log('');
    console.log('  按规则（① 必须修复 / ②a 公网 / ②b 回环 / ③ 上游）');
    for (const r of report.rules) {
      console.log('    ' + r.id.padEnd(18) + pad(r.must_fix, 5) + pad(r.public_url, 6) + pad(r.loopback_ok, 6) + pad(r.upstream, 6) + '   ' + r.note);
    }
    console.log('');
  }
  if (result.mustFix.length) {
    console.log('  ── ① 必须修复（文件:行:片段）──');
    const list = result.mustFix.slice().sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
    for (const h of list) {
      const snip = h.snippet.length > SNIPPET_MAX ? h.snippet.slice(0, SNIPPET_MAX) + '…' : h.snippet;
      console.log('  ' + h.file + ':' + h.line + ': ' + snip + '   [' + h.rule + ']');
    }
    console.log('');
  }
  if (!opts.quiet && result.perFile.length) {
    console.log('  ── 命中最多的文件（前 15，全部计入对应分类）──');
    for (const f of report.files_with_hits.slice(0, 15)) {
      console.log('    ' + pad(f.total, 6) + '  ' + f.file +
        '   (① ' + f.must_fix + ' / ②a ' + f.public_url + ' / ②b ' + f.loopback_ok + ' / ③ ' + f.upstream + ')');
    }
    console.log('');
  }
  console.log(report.verdict.clean ? '  ✔ 通过：没有必须修复的本机痕迹。' : '  ✘ 未通过：仍有 ' + report.summary.must_fix + ' 处必须修复的本机痕迹。');
}

/* ------------------------------------------------------------------ *
 *  自检
 * ------------------------------------------------------------------ */

function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-scan-selftest-'));
  const B = '\\';
  /** 构造样例时把敏感字面量拆开，保证扫描器源码自身不被这些样例污染。 */
  const fixtures = [
    ['01-win-abs-path.json', '{"repo":"' + 'D:' + B + B + 'Server' + B + B + 'MC' + 'Servers"}', 'win-abs-path', 'must-fix'],
    ['02-win-abs-path-raw.md', '见 ' + 'D:' + B + 'Server' + B + 'MC' + 'Servers' + B + 'tools', 'win-abs-path-raw', 'must-fix'],
    ['03-temp-path.js', "const out = path.join('" + '%TEMP' + "%', 'x.json');", 'temp-path', 'must-fix'],
    ['04-user-name.txt', 'C:' + B + 'Users' + B + 'Administ' + 'rator' + B + 'proj', 'user-name', 'must-fix'],
    ['05-owner-handle.md', '见 https://github.com/' + 'sqkl' + '520' + '/papermc-docs', 'owner-handle', 'public-url'],
    ['06-owner-email.txt', 'mailto ' + 'some' + 'one' + '@' + 'gmail' + '.com', 'owner-email', 'must-fix'],
    ['07-localhost.js', 'const a="' + 'local' + 'host' + ':8787", b="127.0.0' + '.1:8787";', 'localhost', 'loopback-ok'],
    ['08-server-path.txt', 'build under ' + 'MC' + 'Servers' + '/site', 'server-path', 'must-fix'],
    ['09-project-abs.txt', 'cwd ' + 'papermc-docs' + '/' + 'tools' + '/x.js', 'project-abs', 'must-fix'],
  ];

  const results = [];
  let ok = true;
  for (const [name, body, wantRule, wantBucket] of fixtures) {
    const f = path.join(dir, name);
    fs.writeFileSync(f, body + '\n', 'utf8');
    const got = scanText(name, body + '\n');
    const ruleHit = got.hits.find((h) => h.rule === wantRule);
    const pass = !!ruleHit && ruleHit.bucket === wantBucket;
    if (!pass) ok = false;
    results.push({ name, wantRule, wantBucket, got: got.hits.map((h) => h.rule + ':' + h.bucket), pass });
  }

  // 10) 上游判定：archive/ 正文 → upstream，archive/<section>/manifest.json → 按普通文件判定
  const up1 = scanText('archive/paper/markdown/x.md', 'jdbc:mysql://' + 'local' + 'host' + ':3306\n');
  const up2 = scanText('archive/paper/manifest.json', 'jdbc:mysql://' + 'local' + 'host' + ':3306\n');
  const archivePass = up1.hits.every((h) => h.bucket === 'upstream') && up2.hits.every((h) => h.bucket === 'loopback-ok');
  if (!archivePass) ok = false;
  results.push({ name: '10-archive-bucketing', wantRule: 'localhost', wantBucket: 'upstream | loopback-ok', got: [up1.hits.map((h) => h.bucket).join(','), up2.hits.map((h) => h.bucket).join(',')], pass: archivePass });

  // 11) self-allow：ignore-region 内的①类命中要被抑制并计数
  const reg = ['// privacy-scan:ignore-start', 'const x = "' + 'D:' + B + 'Server' + B + 'MC' + 'Servers";', '// privacy-scan:ignore-end'].join('\n') + '\n';
  const regRes = scanText('sample.js', reg);
  const regionPass = regRes.hits.length === 0 && regRes.suppressed >= 1;
  if (!regionPass) ok = false;
  results.push({ name: '11-self-allow-region', wantRule: '(suppressed)', wantBucket: '0 hits / >=1 suppressed', got: [String(regRes.hits.length), String(regRes.suppressed)], pass: regionPass });

  // 12) 反例：正则里的伪路径不能被误判（https:\/\/ 、RESULT:\s* ）
  const fp = scanText('sample.js', 'const a = /https:\\/\\/docs\\.example\\//; const m = /RESULT:\\s*(PASS|FAIL)/.exec(x);\n');
  const fpPass = fp.hits.length === 0;
  if (!fpPass) ok = false;
  results.push({ name: '12-no-false-positive', wantRule: '(none)', wantBucket: '0 hits', got: [String(fp.hits.length) + ' hits: ' + fp.hits.map((h) => h.rule + ':' + h.snippet).join(' ')], pass: fpPass });

  console.log('privacy-scan --selftest — 9 条规则 + 3 项分类/防误报检查');
  for (const r of results) {
    console.log((r.pass ? '  ✔ ' : '  ✘ ') + r.name.padEnd(24) + ' 期望 ' + String(r.wantBucket).padEnd(22) + ' 实际 ' + r.got.join(' | '));
  }
  const missing = RULE_IDS.filter((id) => !results.some((r) => r.pass && r.wantRule === id));
  if (missing.length) {
    ok = false;
    console.log('  ✘ 未命中的规则：' + missing.join(', '));
  }
  console.log(ok ? '\n  ✔ 自检通过：9 条规则全部命中，分类与防误报符合预期。' : '\n  ✘ 自检失败。');

  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 临时目录清理失败不影响结论 */
  }
  return ok;
}

/* ------------------------------------------------------------------ *
 *  CLI
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    selftest: argv.includes('--selftest'),
    includeIgnored: argv.includes('--all'),
    useGit: argv.includes('--git'),
    quiet: argv.includes('--quiet'),
    noReport: argv.includes('--no-report'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function usage() {
  console.log([
    'privacy-scan.js — 仓库感知的隐私 / 本机痕迹扫描器',
    '',
    '  node tools/privacy-scan.js            扫描 git 会跟踪的文件，有①类命中则退出码 1',
    '  node tools/privacy-scan.js --json     机器可读输出（含命中片段）',
    '  node tools/privacy-scan.js --selftest 用临时目录里的构造样例自检 9 条规则',
    '  node tools/privacy-scan.js --all      连 .gitignore 忽略的文件一起扫（reports/ 等）',
    '  node tools/privacy-scan.js --git      改用 git ls-files 枚举（只读命令）',
    '  node tools/privacy-scan.js --quiet    只打印分类汇总与结论',
    '  node tools/privacy-scan.js --no-report 不写 data/privacy-report.json',
    '',
    '分类：① must-fix 必须修复 / ② public-url 正当公网信息 / ② loopback-ok 回环地址 /',
    '      ③ upstream 上游内容（archive/**，禁止修改，只统计）。',
    'data/privacy-report.json 只含相对路径与计数，不含片段原文。',
  ].join('\n'));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return usage(), 0;
  if (opts.selftest) return selftest() ? 0 : 2;

  const result = scanRepo(REPO_ROOT, opts);
  const report = buildReport(result, opts);
  if (!opts.noReport) writeReport(report);

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        Object.assign({}, report, {
          must_fix_details: result.mustFix
            .slice()
            .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line))
            .map((h) => ({ file: h.file, line: h.line, rule: h.rule, snippet: h.snippet })),
        }),
        null,
        2
      ) + '\n'
    );
  } else {
    printHuman(result, report, opts);
  }
  return report.verdict.exit_code;
}

if (require.main === module) process.exitCode = main();

module.exports = { scanRepo, scanText, bucketFor, loadGitignore, isIgnored, RULES, BUCKETS, REPO_ROOT, REPORT_REL };
