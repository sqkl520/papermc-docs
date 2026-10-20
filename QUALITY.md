# 质量说明 / Quality

这份文档回答三件事：**这个离线镜像做过哪些校验**、**你怎么自己复跑**、**已知的局限**。
所有结论都能用仓库里的脚本重现 —— 不需要相信文档里的任何数字。

---

## 1. 一句话结论

| 项目 | 结论 |
| --- | --- |
| 镜像完整性 | Paper 103 + Velocity 32 + Folia 6 = **141 页**，每页同时保留渲染 Markdown、站点原始 Markdown、整页 HTML 快照 |
| 归档正文质量 | 141 页全部具备 front matter 与 H1；代码围栏全部闭合；无 HTML 片段/实体残留（见第 3 节复跑命令） |
| 站内链接 | 站点产物的相对 `href`/`src` 全部指向磁盘上真实存在的文件 —— 由 `tools/check-site.js` 与 `tools/verify-site.js` 断言，**每次重建后必须复跑** |
| 隐私 | `node tools/privacy-scan.js` 退出码 0：仓库中**没有**必须修复的本机痕迹（绝对路径、临时目录、用户名、个人邮箱） |
| 离线可用性 | 页面链接全为相对路径，搜索索引同时以 `.js` 内联，因此 `file://` 直接打开也能搜索；仅"未本地化资源"与第三方外链需要联网 |

---

## 2. 做了哪些校验

校验分三层，**每层都由独立脚本从磁盘重算，不信任生成器自报的数字**。

### 第 1 层：归档正文（`archive/**`）

- **转换缺陷**：`tools/validate.js` 逐页检查短正文、markup/实体残留、HTML 片段残留、
  `undefined`/`NaN`、代码围栏是否闭合、front matter 与 H1 是否缺失，并核对
  "源 Markdown 页数 == 渲染 Markdown 页数"、内部链接能否解析。
- **结构化元素保真**：`tools/audit-render.js` 对比 HTML 快照与渲染 Markdown，逐类清点
  代码块（含语言与标题）、GitHub 告警、`<details>`、表格、文件树/Tab、图片。
- **正文覆盖率与编码**：`tools/audit-text.js` 统计正文覆盖率与编码问题。
- **语法面普查**：`tools/md-features.js` 统计归档里实际出现的 Markdown 构造，
  保证生成器支持了真正用到的语法（而不是凭想象支持）。
- **越界链接**：`tools/crosslinks.js` 列出指向镜像区之外的链接，让"哪些内容需要联网"可被枚举。

### 第 2 层：站点产物

- **产物自洽**：`tools/check-site.js` 遍历每个生成的 HTML，验证每个相对 `href`/`src`
  在磁盘上真实存在，并做代码块普查（能识别嵌套在引用/告警里的围栏块）。
- **独立复算**：`tools/verify-site.js` 用与生成器**无关**的代码路径重算站点的全部关键指标
  （页面数、资源引用、内链、体积、外链、图片、快照可达性…），并区分
  "浏览器会加载的资源引用"与"文档正文里的路径示例"，避免把正文误判成断链。
- **导航保真**：`tools/verify-nav.js` 把站点侧栏结构与上游结构（`data/source-nav.json`）
  以及渲染后 HTML 的 DOM 交叉比对，确认分组、顺序、嵌套层级与上游一致。

### 第 3 层：真实部署条件

- **子路径部署**：`tools/gh-pages-smoke.js` 起本地服务器，把站点故意跑在
  `/<repo>/` 这样的**项目页子路径**下，专抓"写死绝对路径"导致的 404 ——
  GitHub Pages 项目页不在域名根，这类错误在本地 `file://` 下看不出来。
- **端到端**：`tools/http-smoke.js` 起本地服务器请求首页/正文/分类/图片/索引/快照，
  检查状态码、体积与内容类型；`tools/live-smoke.js` 对已发布的线上地址做同样的事。
- **隐私**：`tools/privacy-scan.js` 扫描所有会被 git 跟踪的文件，把命中分为
  「必须修复 / 正当公网信息 / 回环地址 / 上游内容」四类，有①类命中即退出码 1。

---

## 3. 怎么自己复跑

命令都在**仓库根目录**执行。第一组不需要联网，第二组里的 `crawl` 与 `live-smoke` 需要联网。

```bash
npm install          # 仅重建站点需要（cheerio / marked / turndown / highlight.js）

# ── 归档正文 ──
node tools/validate.js archive/paper archive/velocity
node tools/audit-render.js
node tools/audit-text.js
node tools/md-features.js
node tools/crosslinks.js

# ── 站点产物 ──
node tools/check-site.js
node tools/verify-site.js
node tools/verify-nav.js
node tools/gh-pages-smoke.js
node tools/http-smoke.js

# ── 隐私 ──
node tools/privacy-scan.js              # 期望：退出码 0
node tools/privacy-scan.js --selftest   # 期望：9 条规则全部命中、分类与防误报通过

# ── 只想核对某一件小事 ──
node tools/verify-nav.js --check=3      # 只跑第 3 项指标，只打印不写文件
node tools/taxonomy-util.js report      # 打印分类页数统计表
```

想看"被扫描器放过了什么"：`node tools/privacy-scan.js --all` 会把 `reports/` 等
被 `.gitignore` 忽略的文件也纳入统计；`data/privacy-report.json` 里有完整的
按规则 × 分类矩阵与最近若干次扫描的计数历史（**只含相对路径与计数，不含片段原文**）。

---

## 4. 已知限制

**镜像本身的限制**

1. **只镜像两个区域**：Paper 与 Velocity。其他区域（Adventure、Folia 等）只保留外链，
   不镜像正文 —— 这是刻意的范围选择，不是遗漏。
2. **HTML 快照离线打开会丢样式**：快照保存的是抓取当时的整页，其 CSS/JS 指向线上
   `/_astro/...`。快照仅用于内容核对；正常阅读请用导航站点的页面。
3. **第三方外链不可离线**：`jd.papermc.io`（Javadoc 跳转）、`minecraft.wiki`、
   xkcd 漫画图等按设计只保留链接、不缓存内容。离线时这些位置不可达属预期行为。
4. **快照是时间点**：上游文档会继续更新；本镜像是某一时点的切片，
   内容以 <https://docs.papermc.io> 为准。`archive/<section>/manifest.json` 里记录了
   每页抓取当时的内容哈希，可用于核对"某页是否被上游改过"。

**校验能力的限制**

5. **无 GUI 浏览器**：主题切换、搜索弹窗、复制按钮、图片放大等**运行时交互**只做了静态
   DOM 断言，没有真实浏览器驱动的端到端点击测试。
6. **无网络时的可达性**：离线校验不做任何 HTTP 请求，因此"外链是否仍然有效"不在保证范围内；
   需要时请联网跑 `node tools/live-smoke.js`。
7. **正文里的路径示例**：文档正文会出现 `localhost`、`<drive>:\…` 这类**示例文本**。
   自动工具无法 100% 区分"示例"与"真实引用"，因此验证脚本按**位置**（资源引用位置
   vs 正文/代码块）分类统计，而不是一刀切判定。
8. **链接完整性依赖构建结果**：站内链接是否全部可解析，取决于最近一次构建产物。
   请以 `node tools/check-site.js` 的输出为准，不要以本文档的描述为准。

**许可与范围**

9. 本站是**非官方镜像**，与 PaperMC 无隶属关系；正文版权与许可见
   [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)，自行编写的代码与工具见
   [`LICENSE`](LICENSE)。
10. 发现正文有误请改上游 <https://github.com/PaperMC/docs>；本仓库只镜像，不修改正文。
