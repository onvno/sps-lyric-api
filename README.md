# 摘句 · SPS Lyric API

一个可以自己搭建的歌词收藏站。用来保存、查找喜欢的几行歌词，也能把它们做成图片下载。

支持中文和英文。仓库提供网站代码和少量演示摘句，**不附带个人完整曲库，暂时也不提供公共 API 服务**。名字里的 API 是网站读取数据用的接口，自己搭建后仍可使用。

![演示库首页](docs/screenshots/01-home.jpg)

## 可以做什么

- 按摘句或歌曲浏览、搜索和语言筛选，每页 24 条。
- 查看歌名、创作者、来源及收录说明。
- 使用暖纸、松林、深夜三种模板下载 PNG；中文歌词里的空格会转成换行，内容较长时图片会跟着变长。
- 开启管理员模式后，可以直接添加摘句，也可以导入完整歌词，再挑选要保留的片段。
- 数据保存在自己的电脑上，不用单独安装数据库服务；支持 Docker 部署、数据检查、备份和恢复。

## 快速开始：Node.js

需要 Node.js 22.5 或更新版本，推荐 Node.js 24。

```bash
git clone https://github.com/onvno/sps-lyric-api.git
cd sps-lyric-api
npm ci
npm start
```

打开 <http://localhost:8787>。首次启动自动建立 `data/lyrics.db` 并加载 20 条演示摘句；无需下载其他数据库、注册账号或申请外部密钥。默认只能浏览，不显示管理员入口。

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

打开 <http://localhost:8787>。这种方式不用在电脑上另装 Node.js。Windows 可在 WSL 中执行这些命令。端口冲突时修改 `.env` 中的 `PORT`。数据库保存在电脑上的 `data/` 目录，重新创建容器不会清空它。

## 录入、审核与分享

第一次配置时，先把 `.env.example` 复制为 `.env`。编辑 `.env`，把 `ADMIN_MODE` 改成 `true`，再给 `REVIEWER_TOKEN` 填上自己的管理口令；不要直接使用示例文字作为口令。Docker 用户在 `.env` 中设置后执行 `docker compose up -d --wait`；Node.js 用户先停止已启动的服务，再执行 `node --env-file=.env server.mjs`。普通 `npm start` 不会自动读取 `.env`。

“录入”提交后，摘句就会显示在网站上；“审核”会先把完整歌词保存在本机，等你选好并批准片段后再显示。管理页面可以搜索、翻页和查看处理状态。目前还没有完整的已发布摘句编辑、下架页面。

点击任一歌词卡片，展开“分享图片”，选择模板并下载 PNG。图片在浏览器生成，不上传到第三方服务。

![图片分享预览](docs/screenshots/02-share.jpg)

## 数据、备份与许可

| 内容 | 位置 / 命令 | 是否适合直接公开 |
| --- | --- | --- |
| 应用代码 | 本仓库，MIT License | 是，遵守许可证 |
| 演示数据 | `data/store.json` | 有独立来源与说明，参阅 NOTICE |
| 私人运行库 | `data/lyrics.db` | 否，Git 已忽略 |
| 演示数据库附件 | `npm run db:release -- --version 2026.10.30` | 只打包自带的演示数据，不读取个人库 |
| 完整私有备份 | `npm run db:backup -- --version 2026.10.30` | 否，包含本地完整内容与内部记录 |

代码可以使用，不代表其中的第三方歌词也都能随意传播。导入内容前，请核对来源和使用条件，详见 [内容使用说明](NOTICE.md)。程序不会自动把数据库上传到 GitHub。安装别人的数据库时，**新库会替换旧库，不会自动合并你的收藏**。

## 文档

- [开源介绍文章：我做了一个收藏歌词的小网站](docs/open-source-introduction.md)
- [部署、备份、更新与回滚](docs/deployment.md)
- [管理员手册](ADMIN.md)
- [维护者个人部署记录](docs/maintainer-deployment.md)
- [贡献方式](CONTRIBUTING.md) · [安全反馈](SECURITY.md) · [版本变更](CHANGELOG.md)

## 开发与测试

```bash
npm run dev
npm test
```

GitHub Actions 配置了 Node.js 22 / 24 测试及 Docker 构建与启动检查；推送后可以到仓库的 Actions 页面查看检查结果。

代码采用 [MIT License](LICENSE)。歌词等内容的使用说明见 [NOTICE.md](NOTICE.md)。
