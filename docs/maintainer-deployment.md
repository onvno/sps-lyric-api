# 维护者个人部署记录

以下配置是维护者自己的部署方式，不是新用户安装的前置要求。

公开 Web 地址：<https://lyrics.lemmon.cn/>。本机部署使用 PM2 和独立 Cloudflare Tunnel，API 服务监听 `127.0.0.1:8791`；原本的 `8787` 本地开发端口保持独立。公开进程明确设置 `ADMIN_MODE=false`，不提供管理员操作。

代码更新后运行 `npm run service:restart`，Tunnel 单独重启用 `npm run service:restart:tunnel`。公开服务直接读取本仓库的 `public/`，因此前端文件保存后会对线上生效；服务端代码修改需要重启。首次启动使用 `pm2 start ecosystem.config.cjs`，加入登录恢复清单使用 `pm2 save`。本机使用现有 PM2 登录恢复任务，macOS 用户登录后自动恢复；电脑必须保持在线。

公开进程默认使用同一份 `data/lyrics.db`。新增内容需经过发布审核才会出现在公开 API；整体安装或替换数据库前，请先停止 `sps-lyric-api` 进程，以及任何正在使用该数据库的本地服务，完成后重新启动。修改产品介绍或入口时，还需在个人站点仓库更新配置并执行 `npm run publish:local`。


`scripts/run-cloudflared-tunnel.sh` 中的域名、Tunnel 名称和可执行文件路径需要按自己的机器修改；不配置 Tunnel 也可以完整使用本地应用。
