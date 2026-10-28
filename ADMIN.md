# 管理员手册

本手册面向维护本地 SQLite 歌词库的管理员。普通用户无需启用本模式。

## 启动管理员模式

管理员功能必须同时显式启用模式和设置口令；不再提供演示口令。

```bash
ADMIN_MODE=true \
REVIEWER_TOKEN='replace-with-a-long-secret' \
npm start
```

启动后，网页会出现“录入”和“审核”入口；所有 `/api/v1/admin/*` 和 `/api/v1/review/*` 接口都要求 `Authorization: Bearer <REVIEWER_TOKEN>`。未启用管理员模式时，这些路径返回 `404`。

| 环境变量 | 用途 |
| --- | --- |
| `ADMIN_MODE=true` | 启用网页录入、审核和本地候选库 |
| `REVIEWER_TOKEN` | 管理员/审核接口的 Bearer Token，管理员模式必填 |
| `LYRICS_DB_PATH` | 自定义 SQLite 数据库路径 |
| `PUBLIC_BASE_URL` | 固定公开条目中的本地来源链接 |
| `GITHUB_ISSUES_URL` | 公开网页可选显示的 GitHub Issues 链接 |
| `JAMENDO_CLIENT_ID` | 可选启用 Jamendo 曲库搜索 |

## 直接录入摘句

管理员网页的“录入”会直接发布，不进入待审队列。它只需要：

- 歌曲名称
- 歌词摘录（2–4 行）
- 演唱者
- 作词人（可选）

请保留真实换行：一行原始歌词输入为一行，不要用空格把多行拼成一行。服务会规范化 Windows 与 Unix 换行，但不会把换行改为空格。

版权字段不出现在该表单中，系统会以“个人非商业使用 / 管理员本地录入”作为默认内部记录。直接录入时会按歌曲名复用已有歌曲 ID，并拦截同一歌曲下的重复摘录。

```bash
curl -X POST 'http://localhost:8787/api/v1/admin/entries' \
  -H 'Authorization: Bearer replace-with-a-long-secret' \
  -H 'Content-Type: application/json' \
  -d '{
    "excerpt":"第一行歌词\n第二行歌词",
    "songTitle":"歌曲名",
    "performerName":"演唱者",
    "lyricistName":"作词人（可选）"
  }'
```

## 审核与本地候选库

“审核”入口用于需要来源核对的导入流程：

1. 从 LRCLIB、Public Domain Lyrics 或 Jamendo 搜索歌曲，或人工上传整首歌词。
2. 服务把整首歌词保存到本地 SQLite，完成分词、去重和候选评分。
3. 在“本地候选库”查看有候选的歌曲。默认已隐藏 `0` 条待选的歌曲。
4. 核对词作者、来源和版权依据，批准或驳回候选。批准后才生成公开摘句。

外部来源和整首歌词导入仍要求逐首核验；管理员直发的最简表单不替代这一步。

常用命令：

```bash
# 从 LRCLIB 检索结果批量抓取有歌词的版本到本地候选库
npm run lyrics:fetch -- "Amazing Grace" "Auld Lang Syne"

# 导入可追溯的公版曲目
npm run lyrics:fetch:public-domain -- --limit=40 --start-page=1

# 从 chinese-lyrics/ 的离线 JSON 增量导入
npm run lyrics:import:chinese -- --limit=200

# 先预演、再写入旧 SQL 备份（backup/ 由 Git 忽略）
npm run lyrics:import:legacy -- --backup-dir=backup --output-dir=backup/converted
npm run lyrics:import:legacy -- --backup-dir=backup --output-dir=backup/converted --apply

# 从完整歌词重建相邻 2–4 行审核候选
npm run lyrics:rebuild:candidates -- --provider=chinese_lyrics,lrclib --apply
```

`curate-lyric-lines` Skill 用于从完整歌词评分、去重并重建候选；它不会自动发布条目。

## 来自社区的建议

社区不通过网页写入数据库。请让贡献者提交 GitHub Issue，模板位于 `.github/ISSUE_TEMPLATE/lyric-submission.yml`。管理员应核对歌曲、摘录、演唱者、可选作词人和实际来源后，再采用“直接录入”或“审核候选库”流程。

## 发布数据库 Release

默认运行数据库是 `data/lyrics.db`；如果启动时设置了 `LYRICS_DB_PATH`，则以该变量指向的 `.db` 文件为准。它是你后续录入、导入和审核实际写入的数据库。

不要直接把运行中的 `data/lyrics.db` 上传到 GitHub Release，也不要上传同目录的 `lyrics.db-wal` 或 `lyrics.db-shm`。请先生成一致性快照：构建命令会执行 WAL checkpoint 和 `VACUUM INTO`，再校验快照内容。

```bash
# 默认从 data/lyrics.db 构建
npm run db:release -- --version YYYY.MM.DD

# 若使用了自定义运行数据库，明确指定它
npm run db:release -- \
  --db /absolute/path/lyrics.db \
  --version YYYY.MM.DD
```

上述命令会生成下面三个 Release 附件；请三个都上传：

| 文件 | 是否上传 | 用途 |
| --- | --- | --- |
| `dist/releases/YYYY.MM.DD/sps-lyric-api-YYYY.MM.DD.db` | 是 | 给用户替换使用的独立 SQLite 数据库 |
| `dist/releases/YYYY.MM.DD/sps-lyric-api-YYYY.MM.DD.db.sha256` | 是 | 数据库 SHA-256 校验文件 |
| `dist/releases/YYYY.MM.DD/sps-lyric-api-YYYY.MM.DD.manifest.json` | 是 | 版本、统计和安装说明 |
| `data/lyrics.db`、`lyrics.db-wal`、`lyrics.db-shm` | 否 | 本机运行文件，不作为 Release 直接上传 |

用户下载 Release 后，可按 [README 的安装步骤](./README.md#安装发布数据库)预检、停止服务，再执行 `npm run db:install -- --asset RELEASE_DB --checksum RELEASE_SHA256 --apply` 完成校验和原子替换。安装会整体替换运行库，不合并本机新增或审核的数据；已有运行库会先备份到目标文件旁的 `backups/` 目录，具体路径见命令输出的 `backup` 字段。

若服务使用自定义的 `LYRICS_DB_PATH`，安装命令也必须用 `--db` 显式指定同一个文件，`db:install` 不读取该环境变量。发布前请确认数据库中的来源、作者标注及再分发条件符合你的发布范围。

## API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/admin/entries` | 管理员以最少字段直接发布 |
| `GET` | `/api/v1/review/submissions` | 查看外部来源导入的待审条目 |
| `PATCH` | `/api/v1/review/submissions/:id` | 批准或驳回待审条目 |
| `GET` | `/api/v1/review/sources/search` | 搜索外部曲库 |
| `POST` | `/api/v1/review/local/fetch` | 下载整首歌词并本地分析 |
| `POST` | `/api/v1/review/local/upload` | 手动上传整首歌词并本地分析 |
| `GET` | `/api/v1/review/local/tracks?candidates_only=1` | 只查看仍有候选的歌曲 |
| `PATCH` | `/api/v1/review/local/segments/:id` | 批准或驳回本地片段 |
