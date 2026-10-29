# 管理员手册

本手册面向维护本地 SQLite 歌词库的管理员。普通用户无需启用本模式。

## 启动管理员模式

管理员功能必须同时显式启用模式和设置口令；不再提供演示口令。

```bash
ADMIN_MODE=true \
REVIEWER_TOKEN='replace-with-a-long-secret' \
npm start
```

如果使用 Docker，按 [部署文档](docs/deployment.md)修改 `.env` 并执行 `docker compose up -d --wait`。原生 Node.js 也可以在配置 `.env` 后通过 `node --env-file=.env server.mjs` 启动；`npm start` 本身不自动加载 `.env`。

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
3. 在“本地候选库”搜索歌曲、歌手、词曲作者或来源编号。默认只显示有待审候选的歌曲，可切换为“全部来源歌曲”；每页 24 首，可翻页。展开后默认显示待审候选，切换“全部片段与状态”可查看已发布、已驳回和自动过滤的片段。顶部待选数量为全库统计，匹配歌曲数为当前筛选结果。
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

## 私有备份与演示数据库发布

日常录入、导入与审核默认写入 `data/lyrics.db`；设置 `LYRICS_DB_PATH` 时使用该文件。不要在数据库运行时直接复制 `.db` 或只上传 WAL 文件。

```bash
# 完整私有备份：包含原始歌词、候选及审核记录，不上传公开 Release
npm run db:backup -- --version YYYY.MM.DD

# 自定义运行库的完整备份
npm run db:backup -- --db /absolute/path/lyrics.db --version YYYY.MM.DD

# 公开演示数据库：只从仓库种子生成，不读取运行库
npm run db:release -- --version YYYY.MM.DD
```

完整备份默认位于 `data/backups/snapshots/版本/`。演示附件位于 `dist/releases/版本/`，包含 `.db`、`.db.sha256`、`.manifest.json` 三个文件。后者的 `release_type` 为 `demo_sqlite_database`，统计为 20 条摘句、0 首原始来源歌曲、0 条候选。

发布代码或分发内容时，分别遵循 [NOTICE.md](NOTICE.md) 的许可边界。不要把自己的完整私有备份当作演示发布库。来源与许可未经确认的数据仍应保留在本机。

安装与回滚见 [部署文档](docs/deployment.md)。替换数据库前停止所有使用该文件的实例；安装会整体替换而不合并内容。安装器使用显式 `--db` 参数，不读取 `LYRICS_DB_PATH`。

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
