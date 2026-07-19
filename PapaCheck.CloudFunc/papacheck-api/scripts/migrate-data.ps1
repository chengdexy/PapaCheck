# migrate-data.ps1
# 从 ECS PostgreSQL 迁移数据到 CloudBase PG

param(
    [Parameter(Mandatory=$true)]
    [string]$CloudBasePgUrl,
    
    [Parameter(Mandatory=$false)]
    [string]$EcsHost = "123.57.129.243",
    
    [Parameter(Mandatory=$false)]
    [string]$EcsUser = "root",
    
    [Parameter(Mandatory=$false)]
    [string]$DumpFile = "$env:TEMP\papacheck.dump"
)

$ErrorActionPreference = "Stop"

Write-Host "=== PapaCheck 数据迁移 ECS → CloudBase PG ===" -ForegroundColor Cyan

# 步骤1: ECS 上导出
Write-Host "[1/4] 从 ECS 导出数据库..." -ForegroundColor Yellow
ssh "$EcsUser@$EcsHost" "sudo -u papacheck pg_dump -Fc -d papacheck -f /tmp/papacheck.dump"
scp "$EcsUser@${EcsHost}:/tmp/papacheck.dump" $DumpFile
Write-Host "  导出完成: $DumpFile" -ForegroundColor Green

# 步骤2: 恢复到 CloudBase PG
Write-Host "[2/4] 恢复到 CloudBase PG..." -ForegroundColor Yellow
pg_restore -d $CloudBasePgUrl --no-owner --no-acl --clean --if-exists $DumpFile
Write-Host "  恢复完成" -ForegroundColor Green

# 步骤3: 行数校验
Write-Host "[3/4] 行数校验..." -ForegroundColor Yellow
$tables = @("users", "children", "access_codes", "homeworks", "daily_settlement", 
             "points", "points_history", "shop_items", "redemptions", "reward_box",
             "bounty_tasks", "bounty_submissions", "bounty_completions", "active_buffs",
             "notifications", "settings")
foreach ($t in $tables) {
    $count = psql -d $CloudBasePgUrl -t -c "SELECT COUNT(*) FROM $t;"
    Write-Host "  $t : $count 行" -ForegroundColor Gray
}

# 步骤4: 完成提示
Write-Host "[4/4] 迁移完成" -ForegroundColor Green
Write-Host "请手动核对关键表行数与 ECS 一致" -ForegroundColor Yellow
