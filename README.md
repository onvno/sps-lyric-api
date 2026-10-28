---
name: sps-lyric-api
description: 可搜索的中英文经典歌词摘句 API 网站
tags: [api, lyrics, curation]
status: active
---

# sps-lyric-api

一个可本地运行的中英文歌词摘句 API。公开读取接口只返回已收录的短摘录；默认启动为只读模式，不显示投稿或审核入口。

每条记录包含歌词摘录、歌曲名称、演唱者/作词人、语言及内部来源信息。一首歌可有多条摘句。

## 快速开始

需要 Node.js 22.5 或更高版本（使用内置 `node:sqlite`），无需另外安装 SQLite、MySQL 或数据库服务。以下命令均在仓库根目录执行。

```bash
cd sps-lyric-api
npm install
```

**使用完整发布库：** 从本仓库的 GitHub Releases 下载同一版本的 `.db`、`.db.sha256` 和 `.manifest.json` 附件，再按[安装发布数据库](#安装发布数据库)操作。数据库不随 Git clone 下载；仅执行 `db:init` 或 `npm start` 不会加载下载目录中的数据库。

**仅体验演示数据：** 无需下载 Release，直接运行：

```bash
npm run db:init
npm start
```

`db:init` 创建表结构，并在摘句表为空时加载 `data/store.json` 中的少量演示条目；服务启动时也会执行这一步。它不导入完整发布库，已有摘句不会被演示数据覆盖。

启动后打开 <http://localhost:8787>。默认模式无需账号、口令或第三方服务。

## 浏览曲库

首页提供“按摘句浏览”和“按歌曲浏览”，每页 24 条，可通过底部按钮翻页。搜索及语言筛选作用于整个公开库；按歌曲浏览时展开歌曲即可查看符合当前条件的摘句，点击摘句查看完整详情。页面显示的总数仅包含已发布内容，未审核的来源歌曲保留在管理员曲库。

## 使用 API

```bash
# 搜索公开摘句
curl 'http://localhost:8787/api/v1/entries?q=送别&language=zh-CN'

# 随机获取一条英文摘句
curl 'http://localhost:8787/api/v1/random?language=en'

# 按歌曲聚合
curl 'http://localhost:8787/api/v1/songs?q=Amazing%20Grace'
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/entries` | 搜索公开摘句 |
| `GET` | `/api/v1/entries/:id` | 查看单条摘句 |
| `GET` | `/api/v1/songs` | 按歌曲聚合 |
| `GET` | `/api/v1/random` | 随机获取一条摘句 |
| `GET` | `/api/v1/openapi.json` | OpenAPI 3.1 描述 |
| `GET` | `/api/health` | SQLite 状态与健康检查 |

## 安装发布数据库

### 下载与预检

将同一版本的三个附件放到一个本地目录中，保留原文件名。`.db` 是完整 SQLite 数据库；`.sha256` 用于校验文件是否完整；`.manifest.json` 记录版本和数据统计，供人工核对，安装命令不需要传入它。无需解压 `.db` 或执行 SQL 导入。

下面以附件保存在仓库的 `dist/releases/2026.07.19/` 为例；使用其他版本时替换目录和文件名：

```bash
npm run db:install -- \
  --asset ./dist/releases/2026.07.19/sps-lyric-api-2026.07.19.db \
  --checksum ./dist/releases/2026.07.19/sps-lyric-api-2026.07.19.db.sha256
```

默认只预检，不写入运行数据库。确认输出为 `mode: "dry-run"`、`integrity: "ok"`，并核对数据统计。校验失败时请重新下载同一版本的附件。

### 安装与启动

如果服务正在运行，先在运行服务的终端按 `Ctrl+C` 停止它，然后执行：

```bash
npm run db:install -- \
  --asset ./dist/releases/2026.07.19/sps-lyric-api-2026.07.19.db \
  --checksum ./dist/releases/2026.07.19/sps-lyric-api-2026.07.19.db.sha256 \
  --apply

npm start
```

`--apply` 会再次校验，并把发布库复制到默认运行位置 `data/lyrics.db`；下载的原文件保留不变。首次安装不必先执行 `db:init`。

升级已有数据库时使用相同步骤。安装会**整体替换数据库，不合并本机新增或审核的数据**；原运行库会自动备份到 `data/backups/`，输出中的 `backup` 字段给出备份路径（首次安装没有旧库时为空）。

### 验证数据

服务启动后，在另一个终端执行：

```bash
curl 'http://localhost:8787/api/health'
curl 'http://localhost:8787/api/v1/entries?limit=1'
```

健康检查应返回 `ok: true`、`storage: "sqlite"`。例如 `2026.07.19` 发布库包含 `database.entries: 721`、`database.sourceTracks: 1044` 和 `database.candidates: 1854`；其他版本以对应 manifest 为准。公开 API 只返回已发布摘句，来源歌曲和待审候选数量不代表公开歌曲、摘句数量。

### 自定义数据库路径

安装时用 `--db` 指定目标文件，启动时用 `LYRICS_DB_PATH` 指向同一个文件：

```bash
npm run db:install -- \
  --asset ./dist/releases/2026.07.19/sps-lyric-api-2026.07.19.db \
  --checksum ./dist/releases/2026.07.19/sps-lyric-api-2026.07.19.db.sha256 \
  --db /absolute/path/lyrics.db \
  --apply

LYRICS_DB_PATH=/absolute/path/lyrics.db npm start
```

`db:install` 不读取 `LYRICS_DB_PATH`，需要显式传入 `--db`；自定义位置的旧库备份在目标文件旁的 `backups/` 目录。建议安装和启动均使用绝对路径，含空格的路径用引号包裹。

### 常见问题

- **下载后仍只有演示数据：** 确认执行了带 `--apply` 的安装命令，并重启服务；仅把文件放到仓库目录不会自动加载。使用自定义路径时，确认安装目标与启动路径一致。
- **找不到 `node:sqlite`：** 用 `node --version` 确认当前终端使用 Node.js 22.5 或更高版本。
- **端口已占用（`EADDRINUSE`）：** 停止占用 8787 的服务，或使用 `PORT=8788 npm start` 并访问对应端口。

运行数据库保存在 `data/lyrics.db`，备份保存在 `data/backups/`，下载及生成的 Release 附件统一放在 `dist/releases/版本/`。这些本机文件均被 Git 忽略；数据库通过 GitHub Release 单独发布，不提交到 Git。

## 歌词计划与入库清单

计划收录和已录入歌曲的人工维护清单见 [Song.md](./Song.md)。后续新增歌曲后，请同步更新这个文件并提交。

如需核对自动导入的 ChineseLyrics 逐曲统计、候选数量和去重键，见 [自动生成的入库明细](./data/import-manifests/chinese_lyrics.md)。该明细可通过以下命令重新生成：

```bash
npm run manifest:export -- --provider=chinese_lyrics
```

## 贡献歌曲建议

默认不开放网页投稿。希望建议歌曲或摘句，请在项目的 GitHub Issues 新建 issue，并使用仓库内的“歌词摘录建议”模板。维护者可设置 `GITHUB_ISSUES_URL`，让网页空状态显示对应链接。

维护、导入与审核流程见 [ADMIN.md](./ADMIN.md)。

## 测试

```bash
npm test
```

歌词及其再分发权利因作品而异。使用或发布数据库前，请自行核验来源、署名和适用的授权条件。
