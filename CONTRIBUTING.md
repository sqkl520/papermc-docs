# 贡献指南 / Contributing

感谢愿意帮忙。本仓库是 <https://docs.papermc.io> 的**非官方离线镜像 + 导航站点**，
由一组 Node.js 脚本从上游站点抓取、转换、生成并校验。因此**所有可再生成的东西
都不要手改** —— 改工具、重跑、再提交，是这个仓库唯一正确的工作方式。

---

## 1. 目录约定

```
<仓库根>/
├─ index.html / 404.html / .nojekyll   ← GitHub Pages 入口（.nojekyll 必须保留）
├─ README.md / LICENSE / THIRD-PARTY-NOTICES.md
├─ CONTRIBUTING.md / QUALITY.md
├─ package.json                        ← 脚本入口（npm run …）
├─ archive/                            ← 归档镜像（system of record）
│  ├─ paper/{markdown,source,html,assets,_corpus}/
│  ├─ velocity/{markdown,source,html,assets,_corpus}/
│  ├─ _common/                         ← 上游共用的机器可读文件
│  └─ <section>/{manifest.json,crawl-report.md,validation.json,INDEX.md}   ← 工具生成的元数据
├─ data/                               ← 工具生成的索引与元数据
│  ├─ source-nav.json                  上游侧栏结构（逐字对齐，不做自行归类）
│  ├─ taxonomy.json                    本站自建的分类与标签
│  ├─ crosslinks.json                  指向镜像区之外的链接清单
│  ├─ md-features.json                 归档里实际出现的 Markdown 构造普查
│  ├─ site-manifest.json               站点构建清单
│  └─ privacy-report.json              最近一次隐私扫描结果（只含相对路径与计数）
├─ tools/                              ← 工具链（可改）
│  └─ site/                            站点生成器的模块
├─ reports/                            ← 开发期报告（**不发布**，已被 .gitignore 忽略）
└─ assets/ paper/ velocity/ …           ← 站点产物（由构建脚本生成）
```

**三层分工**

| 层 | 谁写的 | 能不能手改 |
| --- | --- | --- |
| `archive/**` | 上游 + 抓取脚本 | ❌ 只能重爬覆盖；我们生成的 4 类元数据由脚本重写 |
| `data/**`、`assets/**`、站点 HTML | 生成脚本 | ❌ 改脚本，再重跑 |
| `tools/**`、治理文档 | 人 | ✅ 这就是贡献的地方 |

## 2. 环境

- Node.js **≥ 20**（开发环境为 v24）
- 仅 `tools/build-site.js` 及其 `tools/site/**` 依赖 `node_modules`（`cheerio` / `marked` /
  `turndown` / `highlight.js`）。抓取、转换、校验、隐私扫描等脚本只用 Node 内置模块。

```bash
npm install            # 只有要重建站点时才需要
```

## 3. 常见任务（命令都在**仓库根**执行）

### 3.1 重新抓取 / 增量续抓

抓取器会先读 `robots.txt` 并遵守其规则，全局限速、只发 GET、失败指数退避；
**磁盘缓存可续抓**，重复运行只会补齐缺失的页面。

```bash
# 首次抓取（建议 paper / velocity 分开跑，避免相互限速）
node tools/crawl.js --out archive/paper    --prefix https://docs.papermc.io/paper/    --delay 700 --jitter 400 --concurrency 2 --html --assets
node tools/crawl.js --out archive/velocity --prefix https://docs.papermc.io/velocity/ --delay 700 --jitter 400 --concurrency 2 --html --assets

# 已有 HTML 快照、只想重跑转换（不再访问网络）
node tools/crawl.js --out archive/paper    --prefix https://docs.papermc.io/paper/    --html --assets --from-html
node tools/crawl.js --out archive/velocity --prefix https://docs.papermc.io/velocity/ --html --assets --from-html
```

请**不要**自行调高 `--concurrency`（上限 4）或调低 `--delay`；上游是社区站点，
限速是镜像能长期存在的前提。

### 3.2 校验归档质量

```bash
node tools/validate.js archive/paper archive/velocity   # 转换缺陷 + 内部链接 + 源/渲染页数一致性
node tools/audit-render.js                              # HTML→Markdown 结构化元素保真（代码块/告警/表格/文件树/图片…）
node tools/audit-text.js                                # 正文覆盖率与编码审计
node tools/md-features.js                               # Markdown 构造普查（生成器要支持哪些语法）
node tools/crosslinks.js                                # 指向镜像区之外的链接清单
```

### 3.3 重建索引与站点

```bash
node tools/source-nav.js                                # 从 HTML 快照提取上游侧栏结构 -> data/source-nav.json
node tools/taxonomy-util.js extract paper velocity      # 抽取分类证据到临时目录
node tools/taxonomy-util.js build <tmp>/tax-data.json   # 组装 data/taxonomy.json
node tools/build-site.js                                # 生成站点（assets/**、paper/**、velocity/**、根 HTML）
```

### 3.4 验证就绪度

```bash
node tools/check-site.js        # 遍历站点产物，校验每个相对 href/src 在磁盘上真实存在
node tools/verify-site.js       # 独立复算：不信任生成器自报数字，从磁盘产物 + 归档真值重算全部指标
node tools/verify-nav.js        # 导航保真与发布就绪的独立验证（与 source-nav 交叉比对）
node tools/http-smoke.js        # 起本地服务器做端到端探测（首页/正文/分类/图片/索引/快照）
node tools/gh-pages-smoke.js    # 模拟 GitHub Pages「项目页子路径」部署，抓绝对路径导致的 404
node tools/live-smoke.js        # 对已发布的线上站点做端到端冒烟（需要联网）
```

### 3.5 隐私自检（**提交前必跑**）

```bash
node tools/privacy-scan.js              # 有①类「必须修复」命中则退出码 1
node tools/privacy-scan.js --json       # 机器可读（含命中片段，便于定位）
node tools/privacy-scan.js --selftest   # 用临时目录里的构造样例自检 9 条规则与分类
```

扫描器把命中分成四类：

| 分类 | 含义 | 处理 |
| --- | --- | --- |
| ① `must-fix` | 我们自己写的代码 / 数据 / 产物里的本机痕迹（绝对路径、临时目录、用户名…） | **必须清掉**，并重跑扫描至 0 |
| ② `public-url` | 仓库所有者自己的公开地址（`github.io` / `github.com` 上的本页） | 保留 |
| ② `loopback-ok` | `localhost` / `127.0.0.1` / `0.0.0.0` | 保留：任何机器上语义相同，不含可识别本机的信息 |
| ③ `upstream` | `archive/**` 里的上游正文与快照 | **禁止修改**，仅统计 |

每次运行都会写 `data/privacy-report.json`（**只含相对路径与计数**，不含命中片段原文）。

> `archive/**` 里的 `localhost`、`<drive>:\…` 示例路径、示例邮箱都是**文档正文**，
> 改了就是破坏镜像的保真度 —— 扫描器会把这些归入 ③ 类，不要"顺手修一下"。

## 4. 不要手改的东西

- ❌ `archive/**` 下的正文、HTML 快照、图片、`_corpus/**`：**逐字节是上游真值**。
- ❌ `data/**`、`assets/**`、根目录的站点 HTML/XML：全部由脚本生成。
- ❌ `reports/**`：开发期报告，不发布，也不要在新文档里引用它。
- ❌ `.nojekyll`：删了会让 GitHub Pages 的 Jekyll 构建吞掉 `_` 开头的目录。
- ✅ 需要修 `archive/**` 或站点产物时：改 `tools/**` 里的脚本，重跑上面第 3 节的命令。

例外：`archive/<section>/` 下的 `manifest.json`、`crawl-report.md`、`validation.json`、
`INDEX.md` 是本项目生成的元数据，由脚本重写，同样不要手改。

## 5. 提交规范

- **一次提交一件事**：重爬、重建、修工具、改文档不要混在一起，便于审阅 diff。
- **提交信息**用祈使句，首行 ≤ 72 字符，必要时空一行写正文：

  ```
  fix(site): 修正 Velocity 侧栏在窄屏下折叠层级错误

  source-nav 提取时把 lvl-4 条目错判为 lvl-3，导致 3 个分组多缩进一级。
  重跑 source-nav.js 后结构比对通过。
  ```
- 常用类型：`feat` / `fix` / `docs` / `tools` / `archive` / `build` / `chore`。
- **提交前检查清单**：

  ```bash
  node tools/privacy-scan.js        # 必须退出码 0
  node tools/validate.js archive/paper archive/velocity
  node tools/check-site.js
  ```
- 不要提交 `node_modules/`、`*.log`、`.tmp-*`、`reports/`（`.gitignore` 已覆盖）。
- 提交者信息用**你自己**的名字与邮箱；本仓库刻意不记录任何个人身份信息。

## 6. 报告问题

提 issue 时请给出：影响范围（Paper / Velocity / 站点外壳）、**可复现命令**、
期望与实际结果。若属上游文档本身的错误，请改到上游仓库
<https://github.com/PaperMC/docs> —— 本仓库只镜像，不修改正文。
