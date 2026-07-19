---
name: curate-lyric-lines
description: 从本地 SQLite 整首歌词中构造相邻多行段落，预筛、评分、重建并复核值得思考或品味的中英文歌词摘句；每首歌最多保留3段最终审核候选。Use when a user asks to 精选歌词片段、重建候选库、批量审核入库候选、制定经典摘句标准、从 lyrics.db 选句，或复查自动歌词评分结果。
---

# 歌词摘句精选

## 目标

把整首歌词整理成少量、完整、有余味的最终审核候选。自动分数只负责排序；是否值得收录仍须人工判断。

## 核心约束

- 保留原文和换行，不润色、不改写，不用空格代替换行，不拼接不相邻的歌词行。
- 自动候选默认由相邻 2–4 行组成。单行只有在表达异常完整且不可扩展时才能人工标记 `hold`，不得自动进入最终候选。
- 同一首歌最多保留 3 段待终审候选；已经 `approved` 的段落不计入这 3 段，也不得被候选重建覆盖。
- 同歌候选不得共享相同歌词行，不选同一副歌的轻微变体；三段应分别提供不同场景、观点、时间层次或情绪方向。
- 优先选择“场景→感受”“陈述→转折”“提问→回望”“并列递进→落点”等完整结构。
- “值得品味”必须来自文本中的关系、张力、观察或余味，不因歌曲、歌手知名或关键词命中而加分。
- 不把表演者自动当作词作者。缺少创作者、来源或权利依据时保留为 `hold`，不得批准公开。

## 工作流

### 1. 确认数据库与标准

优先使用用户指定数据库；否则依次查找 `$LYRICS_DB_PATH`、`data/lyrics.db`、`sps-lyric-api/data/lyrics.db`。

完整读取：

- [数据库与输出约定](references/database-and-output.md)
- [精选标准](references/curation-standard.md)
- 重建或校准候选时再读取 [旧 SQL 人工精选校准](references/legacy-calibration.md)

### 2. 重建最终审核候选

先只读预演：

```bash
node scripts/rebuild-final-candidates.mjs \
  --db /absolute/path/to/data/lyrics.db \
  --provider chinese_lyrics,lrclib \
  --per-track 3 \
  --min-score 76 \
  --output /tmp/final-candidate-preview.json
```

检查 `summary`、`tracks_by_selected_count`、`hard_reject_counts` 和不同分数区间的原文样本。只有用户明确要求重建候选库时才加 `--apply`。

```bash
node scripts/rebuild-final-candidates.mjs \
  --db /absolute/path/to/data/lyrics.db \
  --provider chinese_lyrics,lrclib \
  --per-track 3 \
  --min-score 76 \
  --apply
```

脚本创建一致性备份，把旧的未审核单行 `candidate` 转成可追溯的 `filtered`，再写入每首最多 3 段多行 `candidate`。它不批准、不发布内容。

### 3. 生成终审批次

```bash
node scripts/prepare-review-batch.mjs \
  --db /absolute/path/to/data/lyrics.db \
  --provider chinese_lyrics \
  --language zh-CN \
  --limit 80 \
  --per-track 3 \
  --per-artist 6 \
  --output /tmp/lyric-review-batch.json
```

先看批次摘要和审计样本，不能只复核首屏高分记录。

### 4. 语义终审

逐条按七个维度给出整数分和文本证据：

- 段落完整独立性：0–20
- 相邻句衔接与推进：0–15
- 表达密度：0–15
- 思想余味与可品读性：0–20
- 意象与画面：0–10
- 情感真实与共鸣：0–10
- 语言节奏与可引用性：0–10

总分 `82–100` 为 `shortlist`，`72–81` 为 `hold`，`0–71` 为 `reject`。硬性排除优先于总分。

### 5. 歌曲内与全局复选

- 同歌先去除共享歌词行、重叠窗口和副歌变体，再保留最多 3 段。
- 第 2、3 段必须补充不同表达角度；只因分数接近不得凑数。
- 避免批次被同一歌手、年代、主题或情绪占满。
- 抽查低预分样本，发现漏选时调整整批规则并重新生成，不只为个别偏好改阈值。

### 6. 输出与写回

按 [数据库与输出约定](references/database-and-output.md) 输出 JSON 或 Markdown 建议。默认只输出建议。

用户明确要求批准或驳回时，使用项目审核 API 写回以保留 `review_actions`；批准前核对创作者、角色、来源和权利依据。

## 质量检查

- 所有自动候选必须有 2–4 行，换行仍存在于数据库文本中。
- 任一歌曲的 `candidate` 不得超过 3 条。
- 随机复核至少 10% 的 `shortlist`、全部审计样本和所有恰好选出 3 段的歌曲。
- 记录候选规则版本、备份位置、重建前后数量和缺失词作者数量。
- 只要求标准或清单时停止在建议阶段，不改变数据库。
