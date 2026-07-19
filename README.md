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

需要 Node.js 22.5 或更高版本（使用内置 `node:sqlite`）。

```bash
cd sps-lyric-api
npm run db:init
npm start
```

打开 <http://localhost:8787>。默认模式无需账号、口令或第三方服务。

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

## 使用发布的数据库

GitHub Release 会提供独立的 SQLite 数据库、校验文件与 manifest。先停止服务，再先预检、后替换：

```bash
npm run db:install -- \
  --asset /path/to/sps-lyric-api-YYYY.MM.DD.db \
  --checksum /path/to/sps-lyric-api-YYYY.MM.DD.db.sha256

npm run db:install -- \
  --asset /path/to/sps-lyric-api-YYYY.MM.DD.db \
  --checksum /path/to/sps-lyric-api-YYYY.MM.DD.db.sha256 \
  --apply
```

也可使用自己的数据库位置：

```bash
LYRICS_DB_PATH=/absolute/path/lyrics.db npm start
```

运行数据库、原始歌词备份和导入原料都被 Git 忽略，不会随代码仓库提交。

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
