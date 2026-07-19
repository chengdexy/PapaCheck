# 积分商城「单字商品无法删除 / DELETE 200 假成功」诊断与方案

> 现象：最近一次修改后，生产家长端积分商城出现大量单字名称商品，点删除时 Network 里能看到 DELETE 请求返回 200 OK，但商品并未真正删除（刷新后仍在）。
> 结论先行：**这是「软删除 + 静默吞错 + 脏数据缺 id」三者叠加导致的假成功**，不是网络或权限问题。

> ⚠️ **2026-07-19 实测修订（重要）**：以上是第 1 轮诊断。实际部署并核对线上代码后发现，**真正的根因在「读取侧」**：
> `getShopItems()`（被 `GET /api/shop` 调用，前端 admin 的 `adminShopItems` 正来源于它）**从不过滤 `isDeleted`**，
> 而 `DELETE /api/shop/:id` 其实早已正确软删除（置 `isDeleted=true`，返回 200）。
> 于是「删了→刷新→已删除项又被原样捞回→看起来没删」。前端删除得到 200 是**真删成功**，不是假成功。
> 最终修复 = （1）`getShopItems` 过滤 `isDeleted` 且无 id 的损坏项（核心）；
> （2）删除找不到时返回 404（诚实化，已部署）；
> （3）前端删除后校验而非乐观「已删除」（已部署）。
> 单条 DELETE 对「无有效 id」的损坏项永远命中不到，这类需用附带的批量清理脚本 `PUT /api/shop` 真删。

---

## 一、根因（证据链）

### 1. 后端删除是软删除，且「找不到也不报错」
`PapaCheck.CloudFunc/papacheck-api/src/db/postgres-adapter.ts:1073`

```ts
async deleteShopItem(id: string, tenantId?: string): Promise<void> {
  const items = (await this._getJson('shop_items', tenantId)) ?? [];
  const { index } = this._findInArray(items, id);
  if (index === -1) return;          // ← 没找到就直接 return，HTTP 仍是 200
  ...
  items[index].isDeleted = true;     // ← 软删除标记
  ...
}
```

### 2. 路由从不校验是否真的删到了
`app.ts:905`

```ts
app.delete('/api/shop/:id', { schema: deleteParamSchema }, async (request, reply) => {
  const tenantId = request.jwtPayload?.tenant_id;
  await db.deleteShopItem(request.params.id, tenantId);  // 找不到也只是 200
  return sendJson(reply, { ok: true });
});
```

### 3. 查找用严格相等，但路由参数永远是字符串
`_findInArray` → `_findByUuid`（`src/db/adapter.ts:19-31`）：

```ts
if (item?.uuid === uuid || item?.id === uuid || item?.taskId === uuid) { ... }
```

`request.params.id` 经 Fastify 解析**永远是 string**。若存储的 `item.id` 是 `undefined` / 缺失 / number，严格 `===` 比较必然失败 → `index === -1` → 命中第 1 点的静默 return。

### 4. 前端乐观删除制造「已删除」假象
`PapaCheck.Web/js/admin.js:860`

```js
async function deleteShopItem(id) {
  adminShopItems = adminShopItems.filter(i => i.id !== id); // 本地先删
  await API.deleteShopItem(id);                              // 后端其实 200 没动
  await refreshAllData();                                    // 重拉 → 脏数据又回来
  renderShopTab();
  showToast('商品已删除');                                    // 用户以为成功了
}
```

### 5. 单字商品从哪来
前端正常新建商品一定会带合法 id（`Date.now().toString(36)+random`，`admin.js:824`）。
这些缺 id 的脏数据只能来自**异常写入路径**——数据导入 / 迁移脚本 / 旧版客户端 / 某次 bulk 写入。当前代码里正常 Web 新建不会产出这种数据，因此**必须定位并堵住那条写入路径**，否则清完还会再冒。

---

## 二、解决方案

### A. 立即止血（无需改代码、无需部署）—— 用批量替换真删
单条 DELETE 按 id 命中不到，但 `PUT /api/shop` 会**整体替换** `shop_items` 数组，可绕过软删除把脏数据物理去掉。
见随附脚本 `scripts/cleanup-junk-shop-items.mjs`：

```bash
# 1) 先看会清掉哪些（DRY-RUN，不改数据）
node scripts/cleanup-junk-shop-items.mjs --token "<家长JWT>"

# 2) 确认无误后真正清理（仅删「无有效 id」的商品）
node scripts/cleanup-junk-shop-items.mjs --token "<家长JWT>" --apply

# 可选：连单字名称的一并清掉（谨慎，正常商品也可能单字名）
node scripts/cleanup-junk-shop-items.mjs --token "<家长JWT>" --apply --also-single-char
```

判定规则：
- **无有效 id**（`!id` / 非字符串 / 空串）= 必然无法删除，默认清理；
- **单字名称**单独列出供你肉眼核对，`--also-single-char` 才纳入清理。

> 注意：`PUT /api/shop` 是整表替换，请在低峰期执行；脚本会先打印前后数量再写回。

### B. 后端加固（需部署 CloudFunc）

**B1. 路由：找不到就返回 404，不再假装成功**（`app.ts:905`）
```ts
app.delete('/api/shop/:id', { schema: deleteParamSchema }, async (request, reply) => {
  const tenantId = request.jwtPayload?.tenant_id;
  const existing = await db.getShopItemById(request.params.id, tenantId);
  if (!existing) return reply.status(404).send({ error: '商品不存在或已删除', code: 'NOT_FOUND' });
  await db.deleteShopItem(request.params.id, tenantId);
  return sendJson(reply, { ok: true });
});
```

**B2. 查找容错：id 统一转 string 比较**（根治数字/缺失 id 匹配不到，`adapter.ts:19-31`）
```ts
_findByUuid(data, uuid) {
  const u = String(uuid);
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (item == null) continue;
    if (String(item.uuid) === u || String(item.id) === u || String(item.taskId) === u) {
      return { index: i, item };
    }
  }
  return { index: -1, item: null };
}
```
> 这一条还能让现有前端对缺 id 商品「直接点删除」也能命中（UI 发的是 `String(item.id)`，存的是 `String(undefined)==='undefined'`，两端对齐即可删）。

**B3. 写入兜底：以 URL 路径 id 为准，杜绝存出无 id 商品**（`postgres-adapter.ts:1053 putShopItem`）
```ts
async putShopItem(id: string, data: ShopItemDTO, tenantId?: string): Promise<void> {
  data = { ...data, id };   // 路径 id 权威，覆盖 body 可能缺失的 id
  ...
}
```

### C. 前端诚实化（`admin.js`）
删除后不要无条件弹"已删除"；`refreshAllData()` 后若该项仍在，提示"删除失败，请刷新重试"。

### D. 根治：堵住脏数据写入源（最关键，否则会复发）
当前代码正常 Web 新建不会产出缺 id 商品。请排查「最近一次修改」是否包含：
- 数据迁移 / 导入脚本（`migrate-data.ps1` 之类）批量写 `shop_items`；
- 旧版 Android / 旧接口把 `name` 当 `id` 写入；
- 任何 `saveShopItems` / `putShopItem` 的批量调用漏传 id。
定位后给该路径加 id 生成 + 服务端 B3 兜底，脏数据即不再产生。

---

## 三、建议执行顺序
1. 跑脚本 DRY-RUN，确认脏数据形态（看打印出的 `id` 到底是 `undefined` 还是数字，验证 B2 是否够用）。
2. 应用 B1+B2+B3 并部署 CloudFunc（此后单条删除对缺 id 商品也能生效，且不会再静默假成功）。
3. 脚本 `--apply` 清掉现存脏数据。
4. 排查并修复写入源 D，防止复发。
