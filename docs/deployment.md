# 部署与数据维护

首次运行参考 [README](../README.md)。默认演示数据即可使用，下载其他数据库不是启动前置条件。

## 配置

Compose 从 `.env` 读取配置，原生 Node.js 可用 `node --env-file=.env server.mjs` 显式读取。普通 `npm start` 不自动加载 `.env`。

| 配置 | 用途 |
| --- | --- |
| `PORT` | 宿主机访问端口，默认 8787 |
| `BIND_HOST` | Docker 端口绑定地址，默认仅本机 `127.0.0.1` |
| `HOST` | 原生 Node.js 监听地址，默认 `127.0.0.1` |
| `ADMIN_MODE` / `REVIEWER_TOKEN` | 显式启用管理模式并设置自己的口令 |
| `LYRICS_DB_PATH` | 原生 Node.js 数据库路径；安装器用 `--db` 指定同一个文件 |
| `LYRICS_DATA_DIR` | Docker 宿主机数据目录，默认 `./data` |
| `LYRICS_RELEASE_DIR` | Docker 挂载的下载附件目录，默认 `./dist/releases` |
| `LOCAL_UID` / `LOCAL_GID` | Docker 写入数据目录的用户与组编号，应匹配目录所有者 |
| `PUBLIC_BASE_URL` | 自己部署的完整站点 URL，例如 `https://lyrics.example.com`，用于公开来源链接和接口描述 |

公开网络部署时自行配置 HTTPS 反向代理。管理功能建议仅在可信网络使用。不要同时用原生进程和容器替换同一个数据库文件。

## 私有备份和公开附件

```bash
# 在原生安装的仓库目录执行，完整备份不可公开分发
npm run db:backup -- --version 2026.10.30

# Docker：在容器内备份挂载的运行库
# 输出也在挂载数据目录中，宿主机可在 data/backups/snapshots/ 找到
docker compose exec api node scripts/build-database-release.mjs \
  --db /var/lib/sps-lyrics/lyrics.db --version 2026.10.30 \
  --output-dir /var/lib/sps-lyrics/backups/snapshots/2026.10.30

# 仅演示数据附件，不读取私人运行库
npm run db:release -- --version 2026.10.30
```

完整备份包括来源、原始歌词和内部记录；公开演示附件只含仓库自带的演示摘句。两者都提供 SHA-256 和 manifest，但用途不同。备份还应保存到另一存储位置。

## 安装数据库

仅安装你确认来源、版本及使用范围的附件。文件放在 `dist/releases/版本/`。这不是增量同步：**会整体替换个人库**。

```bash
# Docker：默认只预检，错误校验不会停止服务
sh scripts/docker-db.sh --version 版本
# 停服、备份、替换、启动并等待健康检查
sh scripts/docker-db.sh --version 版本 --apply
```

Node.js 方式先预检；带 `--apply` 前停止所有读写该库的实例：

```bash
npm run db:install -- \
  --asset dist/releases/版本/sps-lyric-api-版本.db \
  --checksum dist/releases/版本/sps-lyric-api-版本.db.sha256
# 停止服务后，将 --apply 加到同一命令末尾执行，再 npm start
```

安装器自动备份到目标库旁的 `backups/`，输出 `backup` 给出具体路径。首次安装无旧库时该值为空。

## 回滚

```bash
# 将备份文件名替换成安装时输出的真实文件名
sh scripts/docker-db.sh --backup lyrics-before-release-install-时间.db
sh scripts/docker-db.sh --backup lyrics-before-release-install-时间.db --apply
```

Node.js 用户可在停服后用 `db:install --asset 备份路径 --db 运行库路径 --apply` 恢复。回滚前也会备份被替换的当前库。完整快照备份位于 `backups/snapshots/` 时，Node 安装器可直接指定其文件路径；Docker 回滚快捷命令只读取 `backups/` 下的备份文件名。

## 升级应用和排查

```bash
git pull
docker compose up -d --build --wait
docker compose ps
docker compose logs --tail=100 api
curl http://localhost:8787/api/health
```

`docker compose down` 删除容器但不删除宿主机数据目录。升级应用不会自动下载或覆盖数据库；修改 `.env` 后用 `up` 应用配置。

![Docker 演示部署的健康检查](screenshots/04-health.jpg)

图中为隔离演示环境的实际响应，演示库为 20 条摘句。截图里的测试端口可能不同于默认 8787。
