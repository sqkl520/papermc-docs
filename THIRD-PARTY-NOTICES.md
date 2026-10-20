# 第三方声明 / Third-Party Notices

本文件说明本仓库的**许可划分**、**上游文档版权**、以及**站点中保留的第三方外链资源**。

> 本站是 <https://docs.papermc.io> 的**非官方离线镜像**，与 PaperMC 项目无隶属或背书关系。
> 文档正文的措辞、版本与更新，一律以 <https://docs.papermc.io> 及其上游仓库为准。

---

## 1. 上游文档内容（`archive/**`）

`archive/**` 中镜像自 <https://docs.papermc.io> 的全部内容 —— 包括：

- `archive/<section>/markdown/**`（渲染后的 Markdown）
- `archive/<section>/source/**`（站点提供的原始 Markdown）
- `archive/<section>/html/**`（整页 HTML 快照）
- `archive/<section>/assets/**`（页面内嵌图片等静态资源）
- `archive/<section>/_corpus/**`、`archive/_common/**`（镜像时一并保存的上游机器可读文件，如 `llms.txt`）

**版权归 PaperMC 所有**，采用 **BSD 2-Clause** 许可发布。许可证全文如下：

```
BSD 2-Clause License

Copyright (c) PaperMC

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

上游仓库：<https://github.com/PaperMC/docs>

> 说明：`archive/<section>/manifest.json`、`crawl-report.md`、`validation.json`、`INDEX.md`
> 是本项目的爬取工具生成的**元数据**（不含上游正文），随上游内容一并放在 `archive/**` 下，
> 便于对照；它们不改变上述版权归属。

## 2. 本项目自行编写的部分

| 路径 | 内容 | 许可 |
| --- | --- | --- |
| `tools/**` | 爬取 / 转换 / 生成 / 校验 / 隐私扫描工具链 | MIT（见 `LICENSE`） |
| `data/**` | 工具生成的导航、分类与交叉链接等索引数据 | MIT（数据本身派生自上游文档，其表述仍以上游为准） |
| `assets/**`、根 HTML/XML | 站点外壳自行编写的 HTML / CSS / JS | MIT |
| `archive/**` | 上游文档正文、快照与图片 | BSD-2-Clause，© PaperMC |

## 3. 站点内保留的第三方外链资源

镜像**不代理、不缓存**下列外部资源；页面中的相应位置保留指向原站的链接或图片地址。
离线打开时它们不可用（属预期行为），联网访问时版权与使用条款归各自站点所有。

| 主机 | 用途 | 说明 |
| --- | --- | --- |
| <https://docs.papermc.io> | 本站镜像的源站 | 文档正文与图片的原始出处；站内多处保留"源地址"外链 |
| <https://jd.papermc.io> | Java 文档（Javadoc）跳转 | 文中出现约 1200 处，离线时不可达 |
| <https://minecraft.wiki> | Minecraft 机制与外链词条 | 文中出现约 680 处 |
| <https://xkcd.com>（`imgs.xkcd.com`） | 文档中引用的 xkcd 漫画图 | 图片**未镜像**，页面仅保留原图地址 |
| <https://repo.papermc.io> / <https://hangar.papermc.io> / <https://papermc.io> | 构建产物与插件仓库 | 文档正文引用的下载与坐标来源 |
| <https://github.com> / <https://gist.github.com> | 源码与代码片段 | 文档正文引用 |
| <https://docs.oracle.com> / <https://javadoc.io> / <https://docs.gradle.org> / <https://maven.apache.org> | 官方 API 文档 | 文档正文引用 |
| <https://modrinth.com> / <https://plugins.jetbrains.com> | 插件与工具 | 文档正文引用 |
| <https://discord.gg> | PaperMC 社区 | 文档正文引用 |
| 其他（`spark.lucko.me`、`mojira.dev`、`asm.ow2.io`、`logging.apache.org`、`en.wikipedia.org` 等） | 文档正文引用 | 均为链接形式，未镜像 |

站点内**已镜像**的第三方静态资源仅 `docs.papermc.io` 一种（存放于
`archive/<section>/assets/docs.papermc.io/_astro/**`），其版权同样归 PaperMC 所有。

## 4. 商标

"Minecraft"、"Paper"、"Velocity"、"PaperMC" 等名称与标识归其各自权利人所有。
本仓库为非官方镜像，不使用上述标识作为自身品牌。

## 5. 许可冲突的处理

若本仓库中某处内容与上游的许可条款不一致，**以上游为准**；
发现遗漏的第三方内容，请按 `CONTRIBUTING.md` 提交说明以便补充到本文件。
