# 摘句 · SPS Lyric API

一个可以自己部署的歌词摘句收藏站：搜索、按歌曲浏览、人工审核，把喜欢的几行歌词做成可下载的图片。

中文内容为主，同时支持英文。开源的是应用代码和少量演示摘句，**不附带维护者的个人完整曲库，也不提供托管公共 API 服务承诺**。名称中的 API 指应用内置的读取接口，网页也通过它们加载数据。

![演示库首页](docs/screenshots/01-home.jpg)

## 可以做什么

- 按摘句或歌曲浏览、搜索和语言筛选，每页 24 条。
- 查看歌名、创作者、来源及收录说明。
- 使用暖纸、松林、深夜三种模板下载 PNG；中文歌词空格按行分隔，长内容自动延展。
- 在显式启用的管理员模式中直接录入摘句，或导入完整歌词后逐条审核。
- SQLite 本地存储，无需单独安装数据库服务；支持 Docker 持久化、数据库预检、备份及回滚。

## 快速开始：Node.js

需要 Node.js 22.5 或更新版本，推荐 Node.js 24。

```bash
git clone https://github.com/onvno/sps-lyric-api.git
cd sps-lyric-api
npm ci
npm start
```

打开 <http://localhost:8787>。首次启动自动建立 `data/lyrics.db` 并加载 20 条演示摘句；无需下载其他数据库、注册账号或申请外部密钥。公开浏览模式默认不显示管理员入口。

## 使用 Docker

需要 Docker Engine / Docker Desktop 和支持 `up --wait` 的 Compose v2。以下命令适用于 macOS / Linux：

```bash
git clone https://github.com/onvno/sps-lyric-api.git
cd sps-lyric-api
cp .env.example .env
mkdir -p data dist/releases
printf 'LOCAL_UID=%s\nLOCAL_GID=%s\n' "$(id -u)" "$(id -g)" >> .env
docker compose up -d --build --wait
```

打开 <http://localhost:8787>。此方式不要求宿主机安装 Node.js。Windows 可在 WSL 中执行这些命令。端口冲突时修改 `.env` 中的 `PORT`。数据库挂载在宿主机 `data/`，重建容器不会清空它。

## 录入、审核与分享

管理员模式需同时设置 `ADMIN_MODE=true` 和自己的 `REVIEWER_TOKEN`。Docker 用户在 `.env` 中设置后执行 `docker compose up -d --wait`；Node.js 用户可执行 `node --env-file=.env server.mjs`。普通 `npm start` 不会自动读取 `.env`。

“录入”直接发布经过你确认的短摘句；“审核”将上传或导入的完整歌词保留在本地，候选通过后才公开。管理库可以搜索、筛选全部来源歌曲、翻页并查看处理状态。现阶段没有完整的已发布条目编辑、下架界面。

点击任一歌词卡片，展开“分享图片”，选择模板并下载 PNG。图片在浏览器生成，不上传到第三方服务。

![图片分享预览](docs/screenshots/02-share.jpg)

## 数据、备份与许可

| 内容 | 位置 / 命令 | 是否适合直接公开 |
| --- | --- | --- |
| 应用代码 | 本仓库，MIT License | 是，遵守许可证 |
| 演示数据 | `data/store.json` | 有独立来源与说明，参阅 NOTICE |
| 私人运行库 | `data/lyrics.db` | 否，Git 已忽略 |
| 演示数据库附件 | `npm run db:release -- --version 版本` | 仅由演示种子生成，不读取私人库 |
| 完整私有备份 | `npm run db:backup -- --version 版本` | 否，包含本地完整内容与内部记录 |

代码许可不覆盖第三方歌词。导入工具的存在不代表内容获得再分发许可。详见 [NOTICE.md](NOTICE.md)。当前版本不自动发布数据库或上传 GitHub 附件；数据库安装是**整库替换，不合并个人新增数据**。

## 文档

- [开源介绍文章：把喜欢的歌词，留成一张卡片](docs/open-source-introduction.md)
- [部署、备份、更新与回滚](docs/deployment.md)
- [管理员手册](ADMIN.md)
- [维护者个人部署记录](docs/maintainer-deployment.md)
- [贡献方式](CONTRIBUTING.md) · [安全反馈](SECURITY.md) · [版本变更](CHANGELOG.md)

## 开发与测试

```bash
npm run dev
npm test
```

GitHub Actions 配置了 Node.js 22 / 24 测试及 Docker 构建与启动检查；其远端执行结果以仓库 Actions 页面为准。

代码采用 [MIT License](LICENSE)。内容许可边界见 [NOTICE.md](NOTICE.md)。
