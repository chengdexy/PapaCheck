# PapaCheck API 云函数

PapaCheck 后端 API 的腾讯云 CloudBase SCF 云函数实现，从原 ECS 部署的 Fastify 服务迁移而来。

## 目录结构

```
papacheck-api/
├── index.ts          # 云函数入口
├── scf-handler.ts    # SCF 事件适配层
├── app.ts            # Fastify 应用与路由注册
├── db.ts             # PostgreSQL 数据库连接
├── src/              # 业务模块（auth、admin、crdt、db 等）
├── test/             # 单元测试
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## 开发

```bash
# 安装依赖
npm install

# 运行测试
npm test

# 本地构建
npm run build
```

## 部署

通过 CloudBase CLI 或控制台部署到腾讯云 CloudBase SCF：

```bash
# 构建产物
npm run build

# 使用 cloudbase CLI 部署
cloudbase functions deploy papacheck-api
```

部署前确保 `dist/` 目录已生成（`npm run build`），云函数入口为 `dist/index.js`。

## 环境变量

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `PG_HOST` | PostgreSQL 主机地址 | `xxx.sql.tencentcdb.com` |
| `PG_PORT` | PostgreSQL 端口 | `5432` |
| `PG_DATABASE` | 数据库名 | `papacheck` |
| `PG_USER` | 数据库用户 | `papacheck` |
| `PG_PASSWORD` | 数据库密码 | `********` |
| `JWT_SECRET` | JWT 签名密钥 | `********` |
| `JWT_ISSUER` | JWT 签发者 | `papacheck` |

环境变量通过 CloudBase 云函数配置注入，切勿硬编码到代码中。
