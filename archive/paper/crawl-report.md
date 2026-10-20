# Crawl report

| item | value |
| --- | --- |
| prefix | https://docs.papermc.io/paper/ |
| robots.txt | 1 rule(s), crawl-delay 0s |
| user-agent | `PapermcDocsArchiver/1.0 (offline documentation mirror; polite crawler)` |
| pacing | ≥700ms + 0–400ms jitter between request starts |
| concurrency | 2 |
| pages processed this run | 103 |
| pages re-fetched from the site | 0 |
| pages rebuilt from cached HTML | 103 |
| pages reused from cache untouched | 0 |
| http requests (this run) | 4 |
| bytes downloaded (this run) | 34863 |
| assets | 78 available, 0 failed |
| doc links rewritten | 64 file(s) |
| merged full text | 665986 bytes |
| section corpus extract | 314185 bytes |
| elapsed | 12.7s |

## Notes

- `crawl.log` is append-only and keeps the timestamped history of every pass,
  including the first full pass that fetched all 103 pages + their upstream markdown.
- A pass with `--from-html` re-runs the converter from the cached `html/` snapshot and
  only touches the network for uncached assets, so the site load stays minimal.
- Nothing is fetched outside `https://docs.papermc.io/paper/` except the site's own
  `robots.txt`, `sitemap-index.xml`, `llms.txt`, `llms-full.txt` and image assets referenced by the pages.

## Failures

_none_

## Output layout

```
markdown/   rendered + resolved Markdown (front matter, H1, rewritten links)
source/     upstream index.md (site-generated original Markdown)
html/       raw HTML of each page (only with --html)
assets/     images referenced by the pages (only with --assets)
_corpus/    llms.txt, llms-full.txt, paper-corpus.md
INDEX.md    table of contents
paper-docs-all.md  all pages concatenated
manifest.json      per-page metadata + hashes
```
