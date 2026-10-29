# 部署与数据维护

首次运行参考 [README](../README.md)。先用自带的演示数据就能体验全部功能，不用先下载其他数据库。

## 配置

Docker Compose 会读取 `.env` 中的配置。不用 Docker、直接通过 Node.js 启动时，可以用 `node --env-file=.env server.mjs` 读取这份配置。普通 `npm start` 不自动加载 `.env`。

| 配置 | 用途 |
| --- | --- |
| `PORT` | 电脑对外使用的端口，默认 8787 |
| `BIND_HOST` | Docker 端口绑定地址，默认仅本机 `127.0.0.1` |
| `HOST` | 原生 Node.js 监听地址，默认 `127.0.0.1` |
| `ADMIN_MODE` / `REVIEWER_TOKEN` | 开启管理模式，并设置自己的管理口令 |
| `LYRICS_DB_PATH` | 原生 Node.js 数据库路径；安装器用 `--db` 指定同一个文件 |
| `LYRICS_DATA_DIR` | Docker 在电脑上保存数据的位置，默认 `./data` |
| `LYRICS_RELEASE_DIR` | Docker 读取数据库附件的位置，默认 `./dist/releases` |
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

完整备份会保存原始歌词、来源和审核记录，应该留给自己保管。演示附件只包含仓库自带的少量摘句，可以用来体验功能。两者都会生成校验文件和数据说明文件。重要的备份建议再复制一份到其他硬盘或存储空间。

示例使用 `2026.10.30` 作为版本号，可以换成自己的名称。每次备份请使用新的版本号，方便区分，也避免与已有文件重名。

## 安装数据库

仅安装你确认来源、版本及使用范围的附件。文件放在 `dist/releases/2026.10.30/`。安装后，**原来的数据库会被新库替换，两边的数据不会自动合并**。

```bash
# Docker：先检查文件是否完整；检查失败不会停止网站
sh scripts/docker-db.sh --version 2026.10.30
# 停止网站、备份旧库、换成新库，再启动并检查状态
sh scripts/docker-db.sh --version 2026.10.30 --apply
```

Node.js 方式先预检；带 `--apply` 前停止所有读写该库的实例：

```bash
npm run db:install -- \
  --asset dist/releases/2026.10.30/sps-lyric-api-2026.10.30.db \
  --checksum dist/releases/2026.10.30/sps-lyric-api-2026.10.30.db.sha256
# 停止服务后，将 --apply 加到同一命令末尾执行，再 npm start
```

安装器自动备份到目标库旁的 `backups/`，输出 `backup` 给出具体路径。首次安装无旧库时该值为空。

## 恢复旧数据库

```bash
# 将备份文件名替换成安装时输出的真实文件名
sh scripts/docker-db.sh --backup lyrics-before-release-install-时间.db
sh scripts/docker-db.sh --backup lyrics-before-release-install-时间.db --apply
```

Node.js 用户可在停服后用 `db:install --asset 备份路径 --db 运行库路径 --apply` 恢复。恢复旧库前，也会先备份当前数据库。完整快照备份位于 `backups/snapshots/` 时，Node 安装器可直接指定其文件路径；Docker 回滚快捷命令只读取 `backups/` 下的备份文件名。

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

图中是单独搭建的演示站点返回的真实结果，演示库为 20 条摘句。截图里的测试端口可能不同于默认 8787。
