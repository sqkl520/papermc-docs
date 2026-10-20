# Crawl report

| item | value |
| --- | --- |
| prefix | https://docs.papermc.io/folia/ |
| robots.txt | 1 rule(s), crawl-delay 0s |
| user-agent | `PapermcDocsArchiver/1.0 (offline documentation mirror; polite crawler)` |
| pacing | ≥700ms + 0–400ms jitter between request starts |
| concurrency | 2 |
| pages processed this run | 6 |
| pages re-fetched from the site | 6 |
| pages rebuilt from cached HTML | 0 |
| pages reused from cache untouched | 0 |
| http requests (this run) | 16 |
| bytes downloaded (this run) | 1045746 |
| assets | 0 available, 0 failed |
| doc links rewritten | 5 file(s) |
| merged full text | 30149 bytes |
| section corpus extract | 42233 bytes |
| elapsed | 14.1s |

## Notes

- `crawl.log` is append-only and keeps the timestamped history of every pass,
  including the first full pass that fetched all 6 pages + their upstream markdown.
- A pass with `--from-html` re-runs the converter from the cached `html/` snapshot and
  only touches the network for uncached assets, so the site load stays minimal.
- Nothing is fetched outside `https://docs.papermc.io/folia/` except the site's own
  `robots.txt`, `sitemap-index.xml`, `llms.txt`, `llms-full.txt` and image assets referenced by the pages.

## Failures

_none_

## Output layout

```
markdown/   rendered + resolved Markdown (front matter, H1, rewritten links)
source/     upstream index.md (site-generated original Markdown)
html/       raw HTML of each page (only with --html)
assets/     images referenced by the pages (only with --assets)
_corpus/    llms.txt, llms-full.txt, folia-corpus.md
INDEX.md    table of contents
folia-docs-all.md  all pages concatenated
manifest.json      per-page metadata + hashes
```
