# PaperMC Docs 离线资料库（Paper · Velocity）

> 这是一个**非官方**的 `docs.papermc.io` 离线镜像与静态文档站：把 Paper（服务端）与 Velocity（代理端）两个区域的
> 全部文档抓取到本地，重建成一套 **URL 与上游逐段一致**、可离线浏览、可全文检索的文档站。
>
> **在线浏览**：<https://sqkl520.github.io/papermc-docs/>
> 仓库：<https://github.com/sqkl520/papermc-docs>

| 入口 | 说明 |
| --- | --- |
| [站点首页](https://sqkl520.github.io/papermc-docs/) | 落地页：三个分区入口、搜索、统计 |
| [全部文章](https://sqkl520.github.io/papermc-docs/all-pages.html) | **141 篇**扁平清单（分区 / 源结构路径 / 标签 / 中文摘要），带页内过滤 |
| [Paper](https://sqkl520.github.io/papermc-docs/paper/) · [Velocity](https://sqkl520.github.io/papermc-docs/velocity/) · [Folia](https://sqkl520.github.io/papermc-docs/folia/) 三个分区 | 与上游一致的导航树 |
| [快照索引](https://sqkl520.github.io/papermc-docs/snapshots.html) | 每页的"渲染页 / 原始 HTML 快照 / 上游 Markdown / 线上原文"四类链接 |

- 镜像规模：**141 篇**（Paper 103 · Velocity 32 · Folia 6），逐页保留 渲染 Markdown、上游 Markdown、原始 HTML 快照、图片
- **URL 与上游逐段一致**：`docs.papermc.io/paper/dev/project-setup/` → `<站点>/paper/dev/project-setup/`
- **导航与上游侧栏逐字一致**：Paper 20 组 / Velocity 9 组 / Folia 2 组，最大嵌套 5 层，标签取自上游原文
- 中文全文检索、面包屑、上一页/下一页（源树先序）、本页目录、亮暗主题、键盘可达

---

## 1. 快速开始

**在线阅读**：直接打开上面的链接。

**本地运行**（推荐，搜索索引走 JSON 最完整）：

```bash
npm install
npm run serve          # → http://127.0.0.1:8787/
```

也可以直接双击根目录的 `index.html`——站点全部使用相对路径，`file://` 下同样可用。

---

## 2. 仓库结构

仓库**本身就是站点**（GitHub Pages 从 `main` 分支根目录发布），所以内容路径即 URL 路径：

```
/
├─ index.html            站点落地页
├─ 404.html              Pages 404 页
├─ robots.txt  sitemap.xml
├─ .nojekyll             关闭 Jekyll（否则 _common/、_corpus/、_astro/ 会被吞掉）
├─ README.md  CONTRIBUTING.md  QUALITY.md
├─ LICENSE               本项目代码许可（MIT）
├─ THIRD-PARTY-NOTICES.md 上游文档许可（BSD-2-Clause）+ 第三方资源
├─ paper/                103 篇，URL 与上游一致
│   ├─ index.html                    → /paper/
│   ├─ getting-started/index.html    → /paper/getting-started/
│   └─ dev/command-api/basics/introduction/index.html
├─ velocity/             32 篇，同上
├─ all-pages.html  snapshots.html
├─ sections/  categories/                分区总览页、中文主题分类页
├─ assets/               site.css · site.js · search-index.js
├─ search-index.json     全文检索索引
├─ data/                 source-nav.json · taxonomy.json · build-manifest.json
├─ archive/              只读镜像原始数据（不进导航）
│   ├─ paper/            markdown/ · source/ · html/ · assets/ · _corpus/ · manifest.json
│   ├─ velocity/         同上
│   └─ _common/          站点 llms.txt / llms-full.txt
└─ tools/                爬取 / 转换 / 构建 / 校验 脚本
```

站点页面对图片的引用是相对路径（如 `paper/dev/project-setup/index.html` → `../../archive/paper/assets/…`），
因此**必须整仓部署**；只发布部分目录会断图。

---

## 3. 内容与上游的关系（每页三份）

| 层 | 位置 | 用途 |
| --- | --- | --- |
| 渲染页 | `paper/**`、`velocity/**` | 组件已展开的可读 HTML（本项目的转换结果） |
| 上游 Markdown | `archive/<section>/source/**` | docs 站点提供的原始 `index.md`（作者原稿） |
| 原始 HTML 快照 | `archive/<section>/html/**` | 抓取当时的整页存档，用于内容核对 |

三层互为校验：例如配置参考页在上游 Markdown 里只有几百字节（正文由组件在构建期生成），
只有渲染后的 HTML 才含完整配置树；而原始 Markdown 保留了作者书写的组件与导入语句。

---

## 4. 更新镜像

```bash
# 1) 抓取（礼貌爬虫：遵守 robots.txt、全局限速、失败退避、断点续抓）
npm run crawl:paper
npm run crawl:velocity

# 2) 只用已缓存 HTML 重新生成 Markdown（零内容请求）
npm run rebuild:paper

# 3) 重建站点与导航结构
npm run source-nav      # 从归档 HTML 里重新提取上游侧栏结构
npm run build           # 生成 paper/ velocity/ assets/ sitemap.xml …
```

## 5. 校验

```bash
npm run checks   # 归档校验 → 构建 → 链接与代码块 → 站点 15 项 → URL 一致性 → 隐私扫描 → Pages 就绪
```

| 命令 | 检查内容 |
| --- | --- |
| `npm run validate` | 归档完整性（清单引用、断链、代码围栏配对、哈希与磁盘一致） |
| `npm run check` | 站点全部相对链接存在性 + 代码块数量与归档逐页比对 |
| `npm run verify` | 站点 15 项独立验证（覆盖率、锚点、图片、目录、清单自洽、离线可用性…） |
| `npm run url-parity` | **每页 URL 与上游路径逐段一致**（141/141）+ sitemap 覆盖 |
| `npm run privacy` | 隐私扫描：仓库内不得出现本机路径/用户名/个人邮箱 |
| `npm run pages-smoke` | 模拟 GitHub Pages 项目页子路径，验证相对链接与 `.nojekyll` |
| `npm run live` | 对已发布站点做端到端冒烟（`--local` 可打本地服务器） |

当前状态见 [QUALITY.md](QUALITY.md)。

## 6. 许可与致谢

- **文档内容**版权归 **PaperMC** 及其贡献者所有，来源 <https://docs.papermc.io>（上游仓库
  <https://github.com/PaperMC/docs>），采用 **BSD 2-Clause** 许可——许可证全文与第三方资源清单见
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
- **本项目的工具与站点代码**采用 MIT 许可，见 [LICENSE](LICENSE)。
- 本站是**非官方**镜像；内容可能滞后于上游，请以 <https://docs.papermc.io> 为准。
- 站内保留的第三方外链（jd.papermc.io、minecraft.wiki、GitHub、xkcd 等）版权归各自权利人。

## 7. 已知限制

- 指向未镜像区域的外链（`/adventure`、`/misc` 等 25 处）保持在线访问，站内已标注。
- 1 张第三方图片（xkcd 漫画）未镜像，站内标注"外链图片（需联网）"。
- 原始 HTML 快照自带上游绝对路径，离线打开**无样式**，仅供内容核对。
- 2 处上游本身就失效的锚点退化为"跳页顶 + 可见标记"。
- 页面 `<h1>` 使用分类体系中的消歧标题（如 `Introduction（命令 API）`）以便同名页面可区分；上游原名仍在
  页脚"查看原文"与 `archive/*/manifest.json` 中。
