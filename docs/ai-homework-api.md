# PapaCheck 发作业 API（给 AI 用）

Base URL：

```
https://chengdexy.cn/papacheck/api
```

---

## 1. 换 token

```
POST /api/auth/exchange
{ "access_code": "<家长访问码>", "role": "parent" }
```

返回 `token`。之后每个请求带 `Authorization: Bearer <token>`。child_id 由 token 自动带，不用手动传。

---

## 2. 查科目（发作业前必须先做）

```
GET /api/settings
```

返回里取 `subjects`，它是该家庭**实际启用的科目列表**，每项形如 `{ "id": "数学", "icon": "🔢", "color": "..." }`。

**发作业时 `subject` 字段必须用 `subjects[].id` 里某个值**（如 `数学`）。**
- 把用户说的科目名归一化（去空格/「课」「科目」后缀、忽略大小写）后匹配 `id`；命中用该 `id`。
- 未命中 → 用 `其他`，或提示家长先在设置里添加该科目。**不要擅自填列表里没有的科目。**
- 默认 5 科参考：语文 / 数学 / 英语 / 科学 / 其他（家长可自定义增删，以 `GET /api/settings` 实时返回为准）。

---

## 3. 发作业

```
PUT /api/homeworks/:id
```

- `:id` 是你自己生成的**唯一字符串**（UUID），全局不能重复。
- `:id` 不存在 → 新增；已存在 → 整条覆盖。
- **日期写在 body 的 `dateKey`，不在 URL**（`YYYY-MM-DD`）。不带 `dateKey` 会落到服务器当天。

字段（照填）：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 与 URL `:id` 一致 |
| `dateKey` | ⚠️ | 归属日期 `YYYY-MM-DD`；**建议始终带**，不带会落到服务器当天 |
| `subject` | ✅ | 第 2 节取到的科目 `id` |
| `content` | ✅ | 作业内容。**必须用 `content`**（不是 `name`） |
| `name` | ⬜ | 与 `content` 同值（兜底） |
| `status` | ✅ | 固定 `pending` |
| `mode` | ✅ | 固定 `pending` |
| `suggestedDuration` | ✅ | 建议时长（分钟，整数） |
| `basePoints` | ✅ | 奖励分 1–100，默认 `10` |
| `actualDuration` | ✅ | `null` |
| `startedAt` | ✅ | `null` |
| `completedAt` | ✅ | `null` |
| `completedInSchool` | ✅ | `false` |
| `source` | ⬜ | 填 `ai` |

curl 示例：

```bash
curl -X PUT 'https://chengdexy.cn/papacheck/api/homeworks/<唯一ID>' \
  -H 'Authorization: Bearer <TOKEN>' -H 'Content-Type: application/json' \
  -d '{
    "id": "<唯一ID>", "dateKey": "2026-07-18", "subject": "数学",
    "content": "练习册 P23 第1-5题", "name": "练习册 P23 第1-5题",
    "status": "pending", "mode": "pending", "suggestedDuration": 30, "basePoints": 10,
    "actualDuration": null, "startedAt": null, "completedAt": null, "completedInSchool": false,
    "source": "ai"
  }'
```

返回 `{ "ok": true }`。发后可用 `GET /api/homeworks/:date`（`:date` 为日期）验证。

---

## 4. 易错点（照做就不会错）

1. **没有 `POST /api/homeworks`**，发作业只用 `PUT /api/homeworks/:id`（新增时 `:id` 用新 ID）。
2. **日期在 body 的 `dateKey`，不在 URL**；别写成 `PUT /api/homeworks/2026-07-18`。
3. **内容字段是 `content` 不是 `name`**，两者同值都带上。
4. **`subject` 必须匹配 `GET /api/settings` 返回的 `subjects[].id`**，不能瞎填。
5. **别用 `PUT /api/homeworks`（无 id）**——那是整日覆盖，会清空当天所有作业。
6. **邮件解析链路（`POST /api/email/sync` 等）已弃用**，别走。
