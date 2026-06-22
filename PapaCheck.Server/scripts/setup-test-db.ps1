<#
.SYNOPSIS
  PapaCheck 本地测试数据库搭建脚本 (PostgreSQL 16)
.DESCRIPTION
  本脚本完成以下工作：
    1. 检查本地 PostgreSQL 是否可用
    2. 创建测试数据库和测试用户
    3. 执行 init-pg-schema.sql 建表
    4. 写入 .env.test 环境变量文件
    5. 验证连接并输出测试命令
.PARAMETER PG_DATABASE
  测试数据库名，默认为 papacheck_test
.PARAMETER PG_USER
  测试用户/模式所有者，默认为 papacheck
.PARAMETER PG_PASSWORD
  测试用户密码，默认为 papacheck
.PARAMETER PG_HOST
  PostgreSQL 主机，默认为 localhost
.PARAMETER PG_PORT
  PostgreSQL 端口，默认为 5432
.PARAMETER PG_SUPERUSER
  执行建库操作的管理员用户，默认为 postgres
.EXAMPLE
  .\setup-test-db.ps1
  .\setup-test-db.ps1 -PG_DATABASE "papacheck_test" -PG_PASSWORD "mysecret"
.NOTES
  作者: AI 辅助
  日期: 2026-06-21
#>

param(
  [string]$PG_DATABASE = "papacheck_test",
  [string]$PG_USER = "papacheck",
  [string]$PG_PASSWORD = "papacheck",
  [string]$PG_HOST = "localhost",
  [int]$PG_PORT = 5432,
  [string]$PG_SUPERUSER = "postgres"
)

$ErrorActionPreference = "Stop"

# ─── 1. 检查 PostgreSQL 可用性 ────────────────────────────────────────────────

$PSQL = Get-Command "psql" -ErrorAction SilentlyContinue

if (-not $PSQL) {
  Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Yellow
  Write-Host "║  PostgreSQL 未安装，请先安装 PostgreSQL 16               ║" -ForegroundColor Yellow
  Write-Host "╠══════════════════════════════════════════════════════════════╣" -ForegroundColor Yellow
  Write-Host "║ 方式一：winget 安装（推荐）                               ║" -ForegroundColor Yellow
  Write-Host "║   winget install PostgreSQL.PostgreSQL.16                 ║" -ForegroundColor Yellow
  Write-Host "║                                                          ║" -ForegroundColor Yellow
  Write-Host "║ 方式二：手动下载安装包                                    ║" -ForegroundColor Yellow
  Write-Host "║   https://www.enterprisedb.com/downloads/postgres-postgresql-downloads  ║" -ForegroundColor Yellow
  Write-Host "║                                                          ║" -ForegroundColor Yellow
  Write-Host "║ 安装完成后，重新运行本脚本                                ║" -ForegroundColor Yellow
  Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Yellow
  exit 1
}

Write-Host "✔ PostgreSQL 客户端已找到: $($PSQL.Source)" -ForegroundColor Green

# ─── 2. 检查 PostgreSQL 服务是否运行 ───────────────────────────────────────

try {
  $PG_ISREADY = & pg_isready -h $PG_HOST -p $PG_PORT 2>&1
  if ($LASTEXITCODE -ne 0) { throw $PG_ISREADY }
  Write-Host "✔ PostgreSQL 服务运行中 ($($PG_HOST):$($PG_PORT))" -ForegroundColor Green
} catch {
  Write-Host "✖ PostgreSQL 服务未运行！请执行以下命令后重试：" -ForegroundColor Red
  Write-Host "    pg_ctl start -D `"C:\Program Files\PostgreSQL\16\data`"" -ForegroundColor Cyan
  Write-Host "  （如果安装路径不同，请自行查找 data 目录）" -ForegroundColor Cyan
  exit 1
}

# 设置 postgres 超级用户密码（安装 PG 时设置的密码）
$PG_SUPER_PASSWORD = $env:PG_SUPER_PASSWORD
if (-not $PG_SUPER_PASSWORD) {
  $PG_SUPER_PASSWORD = "papacheck"  # 默认值，可通过环境变量覆盖
}
$env:PGPASSWORD = $PG_SUPER_PASSWORD

# ─── 3. 创建测试用户（如不存在）────────────────────────────────────────────

Write-Host "→ 检查用户 '$PG_USER'..." -ForegroundColor Cyan
$USER_EXISTS = & psql -U $PG_SUPERUSER -h $PG_HOST -p $PG_PORT -t -A -c "SELECT 1 FROM pg_roles WHERE rolname = '$PG_USER'" 2>$null
if ($USER_EXISTS -ne "1") {
  Write-Host "→ 创建用户 '$PG_USER'..." -ForegroundColor Cyan
  & psql -U $PG_SUPERUSER -h $PG_HOST -p $PG_PORT -c "CREATE ROLE $PG_USER WITH LOGIN PASSWORD '$PG_PASSWORD';"
  Write-Host "✔ 用户已创建" -ForegroundColor Green
} else {
  Write-Host "✔ 用户已存在，跳过" -ForegroundColor Green
}

# ─── 4. 创建测试数据库（如不存在）──────────────────────────────────────────

Write-Host "→ 检查数据库 '$PG_DATABASE'..." -ForegroundColor Cyan
$DB_EXISTS = & psql -U $PG_SUPERUSER -h $PG_HOST -p $PG_PORT -t -A -c "SELECT 1 FROM pg_database WHERE datname = '$PG_DATABASE'" 2>$null
if ($DB_EXISTS -ne "1") {
  Write-Host "→ 创建数据库 '$PG_DATABASE'（所有者: $PG_USER）..." -ForegroundColor Cyan
  & psql -U $PG_SUPERUSER -h $PG_HOST -p $PG_PORT -c "CREATE DATABASE $PG_DATABASE OWNER $PG_USER;"
  Write-Host "✔ 数据库已创建" -ForegroundColor Green
} else {
  Write-Host "✔ 数据库已存在，跳过" -ForegroundColor Green
}

# ─── 5. 授予权限 ─────────────────────────────────────────────────────────────

Write-Host "→ 授予权限..." -ForegroundColor Cyan
& psql -U $PG_SUPERUSER -h $PG_HOST -p $PG_PORT -c "GRANT ALL ON DATABASE $PG_DATABASE TO $PG_USER;"
& psql -U $PG_SUPERUSER -h $PG_HOST -p $PG_PORT -d $PG_DATABASE -c "GRANT ALL ON SCHEMA public TO $PG_USER;"
& psql -U $PG_SUPERUSER -h $PG_HOST -p $PG_PORT -d $PG_DATABASE -c "ALTER SCHEMA public OWNER TO $PG_USER;"

# ─── 6. 执行 schema 初始化 ─────────────────────────────────────────────────

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$SCHEMA_FILE = Join-Path $SCRIPT_DIR "init-pg-schema.sql"

if (Test-Path $SCHEMA_FILE) {
  Write-Host "→ 执行 schema 建表（$SCHEMA_FILE）..." -ForegroundColor Cyan
  & psql -U $PG_USER -h $PG_HOST -p $PG_PORT -d $PG_DATABASE -f "$SCHEMA_FILE"
  if ($LASTEXITCODE -eq 0) {
    Write-Host "✔ Schema 初始化完成" -ForegroundColor Green
  } else {
    Write-Host "✖ Schema 执行失败，请检查 init-pg-schema.sql" -ForegroundColor Red
    exit 1
  }
} else {
  Write-Host "⚠ 未找到 schema 文件: $SCHEMA_FILE，跳过建表" -ForegroundColor Yellow
}

# ─── 7. 验证连接 ─────────────────────────────────────────────────────────────

Write-Host "→ 验证连接..." -ForegroundColor Cyan
$TEST_RESULT = & psql -U $PG_USER -h $PG_HOST -p $PG_PORT -d $PG_DATABASE -t -A -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'" 2>&1
if ($LASTEXITCODE -eq 0) {
  Write-Host "✔ 连接成功，public 下共 $TEST_RESULT 张表" -ForegroundColor Green
} else {
  Write-Host "✖ 连接验证失败" -ForegroundColor Red
  exit 1
}

# ─── 8. 生成 .env.test ─────────────────────────────────────────────────────

$ENV_FILE = Join-Path (Split-Path $SCRIPT_DIR -Parent) ".env.test"
$DATABASE_URL = "postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_DATABASE}"

@"
# PapaCheck 测试环境变量
# 由 setup-test-db.ps1 自动生成，不要提交到 git
DATABASE_URL=$DATABASE_URL
"@ | Out-File -FilePath $ENV_FILE -Encoding UTF8

Write-Host "✔ 环境变量已写入: $ENV_FILE" -ForegroundColor Green

# ─── 9. 输出使用说明 ────────────────────────────────────────────────────────

$BOLD = [char]27 + "[1m"
$RESET = [char]27 + "[0m"
$GREEN = [char]27 + "[32m"
$CYAN = [char]27 + "[36m"

Write-Host "`n$('─' * 60)" -ForegroundColor Cyan
Write-Host " ✅  测试数据库搭建完成！" -ForegroundColor Green
Write-Host "`n  ${BOLD}DATABASE_URL${RESET}: ${CYAN}${DATABASE_URL}${RESET}" -ForegroundColor White
Write-Host "`n  ${BOLD}运行测试：${RESET}" -ForegroundColor White
Write-Host "    `$env:DATABASE_URL=`"${DATABASE_URL}`"; cd PapaCheck.Server; npx vitest run"
Write-Host "`n  ${BOLD}或一键运行（PowerShell）：${RESET}" -ForegroundColor White
Write-Host "    `$env:DATABASE_URL=`"${DATABASE_URL}`"; npx vitest run"
Write-Host "`n  ${BOLD}持久化设置（推荐）：${RESET}" -ForegroundColor White
Write-Host "    [System.Environment]::SetEnvironmentVariable('DATABASE_URL', '${DATABASE_URL}', 'User')"
Write-Host "$('─' * 60)" -ForegroundColor Cyan
