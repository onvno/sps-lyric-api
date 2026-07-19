# 数据库与审核输出约定

## SQLite 范围

本 Skill 适配项目 schema version 2：

- `source_tracks`：歌曲元数据和完整 `lyrics_text`。
- `lyric_segments`：原始分行、重建候选和审核状态。
- `entries`：已经批准公开的摘句。
- `review_actions`：批准、驳回和候选重建日志。
- `metadata`：候选规则版本、重建时间和摘要。

状态含义：

- `candidate`：每首最多 3 段、等待人工终审的多行候选。
- `filtered`：自动规则未通过，或已被新版多行候选替代；仍保留原文以便审计。
- `approved`：已生成公开 `entries`，候选重建不得覆盖。
- `rejected`：人工驳回并保留原因，候选重建不得覆盖。

## 候选重建报告

`rebuild-final-candidates.mjs` 默认只读。报告至少包含：

```json
{
  "summary": {
    "rule_version": "multiline-reflective-v2",
    "tracks_scanned": 800,
    "old_candidates": 18000,
    "selected_candidates": 1800,
    "tracks_by_selected_count": {"0": 40, "1": 100, "2": 160, "3": 500},
    "max_candidates_per_track": 3
  },
  "hard_reject_counts": {},
  "tracks": []
}
```

每个候选必须包含原文换行、`line_count`、原始行号、预分、信号、具体理由和风险提醒。

用户明确要求 `--apply` 时，脚本必须：

1. 使用 SQLite `VACUUM INTO` 创建一致性快照。
2. 只把目标来源的旧 `candidate` 转成 `filtered`，不改 `approved/rejected`。
3. 写入相邻 2–4 行的新 `candidate`，每首不超过 3 段。
4. 为每首歌写一条 `candidate_rebuild` 审核日志。
5. 写入 `candidate_curation_version`、重建时间和摘要。

## 预筛批次输出

`prepare-review-batch.mjs` 只读取 `candidate` 或 `filtered`，不改变状态。`pre_score` 只安排复核顺序，不能触发自动批准。

## 语义终审 decision

```json
{
  "segment_id": 123,
  "text": "相邻第一行\n相邻第二行\n形成完整落点的第三行",
  "line_count": 3,
  "adjacent_lines_verified": true,
  "track": "歌曲名",
  "artist": "表演者",
  "creator": {
    "name": "词作者",
    "role": "作词",
    "status": "verified"
  },
  "rubric": {
    "self_contained": 18,
    "line_cohesion": 14,
    "expression_density": 13,
    "reflective_aftertaste": 18,
    "imagery": 8,
    "emotional_resonance": 8,
    "rhythm_quotability": 9
  },
  "semantic_score": 88,
  "decision": "shortlist",
  "reasons": ["相邻句形成转折", "结尾提供可继续思考的落点"],
  "flags": [],
  "themes": ["时间", "成长"],
  "source": {
    "provider": "chinese_lyrics",
    "url": "",
    "rights_status": "needs_review"
  },
  "same_track_duplicate": false
}
```

约束：

- 七项之和必须等于 `semantic_score`。
- `decision` 只能是 `shortlist`、`hold`、`reject`。
- `reasons` 必须描述可核验的句间关系或文本特征。
- `creator.status` 只能是 `verified`、`provided_unverified`、`missing`。
- `rights_status` 只能是 `confirmed`、`needs_review`、`unknown`。
- `creator.status != verified` 或 `rights_status != confirmed` 时不得批准公开。

## 审核写回

只有用户明确授权后才执行批准或驳回。调用：

```text
PATCH /api/v1/review/local/segments/{segment_id}
Authorization: Bearer <reviewer-token>
Content-Type: application/json
```

批准至少包含 `action=approve`、创作者姓名与角色、权利依据与说明、`rightsConfirmed=true` 和具体审核意见。驳回包含 `action=reject` 和具体原因。

不得直接用 SQL 绕过批准/驳回日志；候选重建是独立的数据准备流程。不要记录或输出真实审核口令。
