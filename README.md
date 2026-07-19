---
name: sps-lyric-api
description: 可搜索、投稿和审核的中英文经典歌词摘句 API 网站
tags: [api, lyrics, curation, moderation]
status: active
---

# sps-lyric-api

## 简介

一个“歌词摘句”策展型 API 和网站。每条公开记录包含歌词短摘录、歌曲、创作者、语言、主题、来源与版权依据；同一首歌可以收录多条经典摘句。

首批示例数据只使用公开领域作品。用户投稿默认进入待审队列，审核通过后才会出现在公开 API 中。

## 功能

- 中英文歌词摘句搜索、语言筛选和随机抽取
- 按歌曲聚合，一首歌可关联多条摘句
- 人工投稿、来源与版权依据声明
- 审核员查看待审记录、通过或驳回
- 审核台直接搜索 LRCLIB 真实中英文歌词，并把整首歌词下载到本地
- 可搜索并批量导入 Public Domain Lyrics 的 1,347 首公版歌曲，保留 Wikisource / Project Gutenberg 原始来源
- 审核员也可粘贴人工整理的整首歌词，保存到同一个本地候选库
- SQLite 保存完整源歌词、分词片段、候选评分和审核日志
- 使用 `Intl.Segmenter` 在本机进行中英文分词，自动折叠重复行并过滤段落标记
- 支持扫描 `chinese-lyrics` 的 10 万首离线中文歌，按歌手配额和文本质量选取后批量入库
- 支持解析旧 MySQL `sps_sps` / `sps_apply` 备份，输出 CSV 对比清单并把无冲突记录恢复为待审核候选
- 内置 `curate-lyric-lines` Skill，以硬性过滤、七维语义评分、同歌去重和抽样复核形成统一精选标准
- 本地候选逐条人工批准，批准后才生成公开 API 条目
- 可选接入 Jamendo，保留每首歌的 Creative Commons 许可
- JSON REST API、健康检查和 OpenAPI 描述
- SQLite 持久化，零第三方 npm 运行依赖

## 安装 / 依赖

需要 Node.js 22.5 或更高版本（使用 Node 内置的 `node:sqlite`）。

```bash
cd sps-lyric-api
npm run db:init
npm start
```

访问 <http://localhost:8787>。开发环境默认审核口令为 `demo-review-token`；部署时必须设置环境变量：

```bash
REVIEWER_TOKEN='replace-with-a-long-secret' npm start
```

LRCLIB 免费且免注册，当前本地下载流程可以直接使用。如果需要启用 Jamendo（适合获取带逐曲 CC 许可的独立音乐歌词），再到 [Jamendo Developer Portal](https://devportal.jamendo.com/) 免费创建开发者账户和应用，取得 `client_id`：

```bash
JAMENDO_CLIENT_ID='your-client-id' \
REVIEWER_TOKEN='replace-with-a-long-secret' \
npm start
```

## 使用

```bash
# 搜索公开摘句
curl 'http://localhost:8787/api/v1/entries?q=送别&language=zh-CN'

# 随机获取一条英文摘句
curl 'http://localhost:8787/api/v1/random?language=en'

# 提交候选摘句（不会直接公开）
curl -X POST 'http://localhost:8787/api/v1/submissions' \
  -H 'Content-Type: application/json' \
  -d '{
    "excerpt":"待审核的短摘录",
    "language":"zh-CN",
    "songTitle":"歌曲名",
    "creators":[{"name":"创作者","role":"词"}],
    "sourceUrl":"https://example.com/source",
    "rightsBasis":"permission",
    "rightsNote":"已取得词作者书面授权",
    "rightsConfirmed":true,
    "submitterName":"投稿人"
  }'
```

### 主要接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/entries` | 搜索公开摘句 |
| `GET` | `/api/v1/entries/:id` | 查看单条摘句 |
| `GET` | `/api/v1/songs` | 按歌曲聚合 |
| `GET` | `/api/v1/random` | 随机返回一条摘句 |
| `POST` | `/api/v1/submissions` | 提交候选摘句 |
| `GET` | `/api/v1/review/submissions` | 获取待审列表，需 Bearer Token |
| `PATCH` | `/api/v1/review/submissions/:id` | 通过或驳回，需 Bearer Token |
| `GET` | `/api/v1/review/sources/search` | 搜索 LRCLIB / Jamendo 真实歌词，需 Bearer Token |
| `POST` | `/api/v1/review/sources/import` | 选取一行真实歌词并加入待审，需 Bearer Token |
| `POST` | `/api/v1/review/local/fetch` | 下载整首歌词到 SQLite 并本地分析，需 Bearer Token |
| `POST` | `/api/v1/review/local/upload` | 人工上传整首歌词并本地分析，需 Bearer Token |
| `GET` | `/api/v1/review/local/tracks` | 查看本地曲库和候选统计；加 `?candidates_only=1` 隐藏 0 条待选歌曲，需 Bearer Token |
| `GET` | `/api/v1/review/local/tracks/:id` | 查看一首歌的分词片段，需 Bearer Token |
| `PATCH` | `/api/v1/review/local/segments/:id` | 批准或驳回本地片段，需 Bearer Token |
| `GET` | `/api/v1/openapi.json` | OpenAPI 3.1 描述 |

### 真实数据源

| 数据源 | 数据规模 / 覆盖 | 接入条件 | 本工具中的处理方式 |
|--------|----------------|---------|--------------------|
| LRCLIB | 大量中英文纯文本与 LRC 同步歌词 | 免费、免密钥 | 仅在审核台搜索；选句后补作者与版权依据，再进入待审 |
| Public Domain Lyrics | 1,347 首英文公版歌曲，11 个类别 | 免费、免注册 | 保存公版标记和逐曲 Wikisource / Gutenberg 来源；可批量导入本地候选库 |
| Jamendo | 约 50 万首独立音乐，部分曲目含歌词 | 免费 `client_id` | 保存逐曲 CC 许可链接和艺术家署名，再进入待审 |
| Wikisource / Project Gutenberg | 公开领域历史歌曲 | 免费 | 可直接策展发布，但仍保留原文来源和适用地区 |
| OpenCpop | 100 首中文歌、3756 个演唱切句 | 申请下载、仅非商业 CC BY-NC-ND | 不自动导入；如用于非商业研究需遵守署名、非商业和禁止演绎条件 |
| ChineseLyrics 离线库 | 102,198 条记录，需另行放入项目 `chinese-lyrics` | 原始 JSON 不随 Git 分发，仅供学习交流 | 过滤伴奏/demo/制作信息，限制歌手占比，分词评分后只进入本地候选库 |

审核台使用方法：进入“审核”→ 输入审核口令 → 从真实曲库下载，或展开“人工上传整首歌词”粘贴本地资料 → 在“本地候选库”查看分词、评分和重复次数 → 核对词作者和版权依据 → 批准后进入公开 API。

### 本地下载示例

先在审核台搜索并取得 LRCLIB 的 `providerId`，再执行：

```bash
curl -X POST 'http://localhost:8787/api/v1/review/local/fetch' \
  -H 'Authorization: Bearer demo-review-token' \
  -H 'Content-Type: application/json' \
  -d '{"provider":"lrclib","providerId":"18454","language":"zh-CN"}'

curl 'http://localhost:8787/api/v1/review/local/tracks' \
  -H 'Authorization: Bearer demo-review-token'
```

本地分析会保留每行的 tokens、语言、字符/词数、重复次数、同步时间戳和 0–100 候选分数。自动分析只负责筛选候选，不会自动公开内容。

也可以从命令行批量抓取，搜索结果中第一个有歌词、非纯音乐的版本会写入本地库：

```bash
npm run lyrics:fetch -- "Amazing Grace" "Auld Lang Syne" "Jingle Bells"

# 从其他来源批量导入 40 首可追溯公版歌曲
npm run lyrics:fetch:public-domain -- --limit=40 --start-page=1

# 将另行取得的 JSON 放入 chinese-lyrics/ 后，先查看拟导入样本
npm run lyrics:import:chinese -- --limit=800 --dry-run

# 正式导入；默认每位普通歌手最多 3 首，重点歌手最多 8 首
npm run lyrics:import:chinese -- --limit=800 --max-per-singer=3 --min-candidates=10 --min-score=68

# 再次执行默认是增量导入：自动跳过清单中已有歌曲，再补 200 首
npm run lyrics:import:chinese -- --limit=200

# 重新分析已有歌曲，而不是增量补充
npm run lyrics:import:chinese -- --limit=800 --refresh-existing

# 随时从当前数据库重新生成 JSON / CSV / Markdown 入库清单
npm run manifest:export -- --provider=chinese_lyrics

# 从待审库生成只读精选批次；原始分只用于排序，不会自动批准
npm run lyrics:curate -- --provider=chinese_lyrics --language=zh-CN --limit=80 --per-track=3 --output=/tmp/lyric-review-batch.json

# 按相邻 2–4 行、每首最多 3 段预演最终审核候选重建
npm run lyrics:rebuild:candidates -- --provider=chinese_lyrics,lrclib --output=/tmp/final-candidate-preview.json

# 创建 SQLite 快照后，把旧单行候选转为 filtered，并写入多行 candidate
npm run lyrics:rebuild:candidates -- --provider=chinese_lyrics,lrclib --apply

# 将自有 SQL 备份放入被 Git 忽略的 backup/ 后，预演恢复并生成对比清单
npm run lyrics:import:legacy -- --backup-dir=backup --output-dir=backup/converted

# 创建一致性 SQLite 备份后，把无冲突记录恢复为 candidate
npm run lyrics:import:legacy -- --backup-dir=backup --output-dir=backup/converted --apply

# 预览旧 SQL 恢复候选；加 --apply 后通过审核 API 批量批准并生成 JSON 记录
REVIEWER_TOKEN='your-reviewer-token' npm run lyrics:approve:legacy
REVIEWER_TOKEN='your-reviewer-token' npm run lyrics:approve:legacy -- --apply

# 搜索误命中时，可按本地歌曲 ID 删除；已有批准片段的歌曲会被保护
npm run lyrics:remove -- 12
```

在支持本地 Skills 的 Codex 中，也可以直接说：“使用 `$curate-lyric-lines`，从完整歌词中按相邻 2–4 行、每首最多 3 段重建最终审核候选。”Skill 默认只输出建议；只有明确要求重建时才写候选库，批准和发布始终是独立审核动作。

### Git 与数据库 Release

Git 仓库只提交程序、网页、测试、Skill 和 `data/store.json` 种子。原始中文 JSON、旧 SQL 备份、导入清单、运行数据库、WAL 文件及历史数据库快照均由 `.gitignore` 排除，避免把本地原料和可变数据库混入代码提交。

构建命令会在终端显示当前机器上的输出位置，便于本地打开文件；真正上传的 manifest 只记录可移植的文件名、数据库统计和 SHA-256，不保存本机绝对路径。

创建可上传到 GitHub Release 的一致性数据库快照：

```bash
# 生成独立 .db、SHA-256 校验文件和 JSON 清单
npm run db:release -- --version 2026.07.19

# 创建 GitHub Release；先把 OWNER/REPO 换成实际仓库
gh release create db-2026.07.19 \
  dist/releases/2026.07.19/sps-lyric-api-2026.07.19.db \
  dist/releases/2026.07.19/sps-lyric-api-2026.07.19.db.sha256 \
  dist/releases/2026.07.19/sps-lyric-api-2026.07.19.manifest.json \
  --repo OWNER/REPO --title "Lyrics database 2026.07.19" --generate-notes

# 其他用户下载同一版本的三个文件
gh release download db-2026.07.19 --pattern 'sps-lyric-api-2026.07.19*'
```

使用别人发布的数据库时，应先停止 API 服务，再校验并替换。安装脚本默认只预检，加入 `--apply` 后会先为现有数据库创建一致性备份，再原子替换：

```bash
npm run db:install -- \
  --asset /path/to/sps-lyric-api-2026.07.19.db \
  --checksum /path/to/sps-lyric-api-2026.07.19.db.sha256

npm run db:install -- \
  --asset /path/to/sps-lyric-api-2026.07.19.db \
  --checksum /path/to/sps-lyric-api-2026.07.19.db.sha256 \
  --apply
```

Release 数据库包含完整来源歌词和审核记录；公开发布前仍需确认其中歌曲的来源、作者标注和再分发条件。

### 数据与部署

- 运行数据库是 `data/lyrics.db`。首次执行 `npm run db:init` 时，会把 `data/store.json` 中的 20 条公版种子数据迁移到 SQLite。
- 运行数据库不会提交到 Git，准确统计以每个 Release 随附的 manifest 为准。当前生成的 `2026.07.19` 快照包含 1,044 个歌曲来源、27,323 个分片、1,854 条待审核候选、701 条已批准片段和 721 条公开记录；候选均由相邻 2–4 行构成，每首最多 3 段。
- 最终对齐后的候选重建记录位于 `data/import-manifests/final-candidate-rebuild-20260716-aligned.json`，首批 80 条可读审核清单位于 `data/import-manifests/final-candidate-review-top80-20260716.md`；最终校准前的一致性快照位于 `data/backups/lyrics-before-multiline-reflective-v2-2026-07-16T03-42-26-402Z.db`。本轮扫描的 804 首歌曲中有 770 首缺少词作者信息，补齐并核验前应保持待审状态。
- 完整入库记录位于 `data/import-manifests/`：Markdown 用于浏览，CSV 用于人工筛选，JSON 包含稳定去重键和歌词哈希，适合后续程序化对比。
- 旧备份的可读工作簿、正式摘句 CSV、待审投稿 CSV 和逐条导入决策位于 `backup/converted/`；恢复前的 SQLite 快照位于 `data/backups/`。
- 可用 `LYRICS_DB_PATH=/absolute/path/lyrics.db npm start` 指定其他本地数据库。
- 可用 `PUBLIC_BASE_URL=http://localhost:8787` 固定公开条目中的本地来源链接；旧 SQL 恢复记录会指向本地来源说明页，而不会伪装成外部授权链接。
- `data/store.json` 只保留为可审阅的初始种子，不再作为运行时写入文件。
- 多实例或正式生产环境应迁移到 PostgreSQL，并增加用户登录、角色权限、操作审计、限流和内容下架流程。
- LRCLIB 的 MIT License 适用于服务端代码，不等于其中每首歌词都获得统一授权，因此本工具不会批量镜像或自动发布。
- Public Domain Lyrics 的批量结果同样只进入本地候选库；系统保存其逐曲原始来源，仍由审核员确认后发布摘句。
- MusicBrainz 可继续用于补歌曲、作品和创作者标识；正式生产建议用 MusicBrainz ID / ISRC 解决同名歌曲和不同版本匹配。

### 可申请的大型研究曲库

- **DALI v2**：7,756 首，歌词带段落、行、词、音符四级时间对齐。需要注册 Zenodo，在数据页点击 “Request access”，填写所属机构（个人研究可如实说明）和“非商业个人歌词分析”用途；数据只允许非商业研究使用。
- **OpenCpop**：100 首普通话歌曲、3,756 个演唱切句，适合补中文分词和音素数据；采用 CC BY-NC-ND 4.0，仅限非商业用途。

DALI 获批或 OpenCpop 下载完成后，可把压缩包放在本工具目录外，再为其增加离线导入器；无需把大体积音频提交进项目。

## 验证

```bash
npm test
```

## 相关链接

- [源码](./server.mjs)
- [OpenAPI 示例](./public/api.html)
- [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API)
- [LRCLIB](https://lrclib.net/)
- [Public Domain Lyrics](https://pubdomainonly.com/)
- [Jamendo Tracks API](https://developer.jamendo.com/v3.0/tracks)
- [DALI v2 数据申请](https://zenodo.org/records/3576083)
- [OpenCpop 许可](https://wenet-e2e.github.io/opencpop/liscense/)
- [美国版权局：音乐作品与录音版权](https://copyright.gov/engage/docs/recording.pdf)
