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

公开 Web 地址：<https://lyrics.lemmon.cn/>。本机部署使用 PM2 和独立 Cloudflare Tunnel，API 服务监听 `127.0.0.1:8791`；原本的 `8787` 本地开发端口保持独立。公开进程明确设置 `ADMIN_MODE=false`，不提供管理员操作。

代码更新后运行 `npm run service:restart`，Tunnel 单独重启用 `npm run service:restart:tunnel`。首次启动使用 `pm2 start ecosystem.config.cjs`，加入登录恢复清单使用 `pm2 save`。本机使用现有 PM2 登录恢复任务，macOS 用户登录后自动恢复；电脑必须保持在线。

公开进程默认使用同一份 `data/lyrics.db`。新增内容需经过发布审核才会出现在公开 API；整体安装或替换数据库前，请先停止 `sps-lyric-api` 进程，以及任何正在使用该数据库的本地服务，完成后重新启动。修改产品介绍或入口时，还需在个人站点仓库更新配置并执行 `npm run publish:local`。

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

## Docker 部署与数据更新

需要已启动的 Docker Engine / Docker Desktop，以及支持 `up --wait` 的 Docker Compose v2。Docker 方式不要求宿主机安装 Node.js 或 npm。

### 首次部署

在仓库根目录执行（已有 `.env` 时直接编辑，保留原配置）：

```bash
cp .env.example .env
mkdir -p data dist/releases
# 让容器以当前用户身份写入宿主机数据目录
printf 'LOCAL_UID=%s\nLOCAL_GID=%s\n' "$(id -u)" "$(id -g)" >> .env
docker compose build
```

将下载的三个 Release 附件放入 `dist/releases/版本/`，例如 `dist/releases/2026.07.19/`。然后预检、安装并启动：

```bash
sh scripts/docker-db.sh --version 2026.07.19
sh scripts/docker-db.sh --version 2026.07.19 --apply
docker compose ps
curl 'http://localhost:8787/api/health'
```

`--apply` 成功后会启动服务并等待健康检查通过，打开 <http://localhost:8787> 即可使用。若只想体验演示库，可以跳过 Release 安装，执行 `docker compose up -d --wait`。

Compose 将宿主机 `data/` 挂载到容器的 `/var/lib/sps-lyrics/`，运行库为其中的 `lyrics.db`，备份位于 `backups/`。下载附件以只读方式挂载到 `/releases/`。镜像只包含应用与少量演示数据，不包含你的运行库或 Release 数据库；重建、删除容器后，宿主机数据仍会保留。

若已有通过 `npm start` 启动的服务，请先停止它，再用 Docker 接管同一个 `data/` 目录。不要让两个实例同时维护或替换同一运行库。不同实例应分别设置 `LYRICS_DATA_DIR` 和 `PORT`。

### 配置与管理

编辑 `.env` 可设置端口、管理员口令和数据目录。默认仅绑定本机 `127.0.0.1:8787`。部署到服务器时，推荐通过反向代理提供 HTTPS；需要直接对外监听时，将 `BIND_HOST` 设为 `0.0.0.0`。

启用管理员模式：在 `.env` 中设置 `ADMIN_MODE=true`，并为 `REVIEWER_TOKEN` 填入自己的长随机口令，再执行：

```bash
docker compose up -d --wait
```

网页会出现“录入”和“审核”入口。配置变更后使用 `up`，让 Compose 重新创建容器并应用配置；具体录入流程见 [ADMIN.md](./ADMIN.md)。`.env` 由 Compose 读取，普通 `npm start` 不会自动读取它；原生 Node.js 方式可用 `node --env-file=.env server.mjs` 显式加载。

### 更新数据库

将新版附件放入 `dist/releases/新版版本/`，运行相同的 `docker-db.sh --version 新版版本` 命令。默认仅预检；加 `--apply` 才会停服、备份并整体替换运行库，随后启动服务并检查健康状态。预检失败不会停止服务。

**整库更新不会合并个人新增、修改或审核的数据。** 自行维护曲库的用户应保留自己的数据库；请不要把安装新版 Release 当作增量同步。每次覆盖前都会生成备份，但备份后的新写入也不会出现在旧备份中。

脚本输出的 `backup` 路径指向容器中的备份，例如 `/var/lib/sps-lyrics/backups/lyrics-before-release-install-时间.db`。回滚时只传入该文件名：

```bash
# 默认仍是预检
sh scripts/docker-db.sh --backup lyrics-before-release-install-时间.db
# 确认后回滚；回滚前也会备份当前库
sh scripts/docker-db.sh --backup lyrics-before-release-install-时间.db --apply
```

将上面的示例文件名换成实际备份文件名。更新后若健康检查失败，脚本会报错；用 `docker compose logs --tail=100 api` 查看原因，再修正配置或回滚，不会把失败报告为更新成功。数据库更新应安排在没有其他管理员操作或导入任务时执行。

### 更新应用与常用运维命令

```bash
# 更新代码及镜像，继续使用已有数据库
git pull
docker compose up -d --build --wait

# 查看日志 / 停服
docker compose logs --tail=100 api
docker compose stop api

# 停止并移除容器（宿主机 data/ 和备份保留）
docker compose down
```

数据库与应用分别发布、分别更新。仅升级镜像不会安装或下载新的数据库。首次拉取 Node.js 基础镜像需要网络；不要删除宿主机 `data/` 目录，日常备份也应复制到另一存储位置。

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
