# PapaCheck 本地开发环境启动脚本
# 启动顺序：Node.js → Nginx

$ProjectRoot = Split-Path -Parent $PSScriptRoot

# Nginx 路径检测：优先使用环境变量 NGINX_PREFIX，否则自动检测
$NginxPrefix = $env:NGINX_PREFIX
if (-not $NginxPrefix) {
    $nginxCmd = Get-Command nginx -ErrorAction SilentlyContinue
    if (-not $nginxCmd) {
        Write-Host "✖ Nginx 未安装，请先执行: winget install nginxinc.nginx" -ForegroundColor Red
        exit 1
    }
    # winget 安装 nginx 会在 PATH 创建符号链接，取其目标路径作为 prefix
    $nginxItem = Get-Item $nginxCmd.Source -ErrorAction SilentlyContinue
    if ($nginxItem -and $nginxItem.Target) {
        $NginxPrefix = Split-Path -Parent $nginxItem.Target
    } else {
        $NginxPrefix = Split-Path -Parent $nginxCmd.Source
    }
}
$NginxDevConf = Join-Path $ProjectRoot "nginx.dev.conf"
$NginxTargetConf = Join-Path $NginxPrefix "conf\nginx.dev.conf"

Write-Host "=== PapaCheck Dev Environment ===" -ForegroundColor Cyan

# 0. 同步 nginx.dev.conf 到 nginx conf 目录
Write-Host "[0/2] 同步 nginx.dev.conf ..." -NoNewline
Copy-Item $NginxDevConf $NginxTargetConf -Force
Write-Host " ✓" -ForegroundColor Green

# 1. 启动 Node.js 服务器（后台运行）
Write-Host "[1/2] 启动 Node.js 服务器 (端口 8080)..." -NoNewline
$nodeJob = Start-Job -ScriptBlock {
    cd $using:ProjectRoot\PapaCheck.Server.Node
    npm run build 2>&1 | Out-Null
    node dist/index.js --web-dir ..\PapaCheck.Web --tts-python python3
}
Start-Sleep -Seconds 2
if ($nodeJob.State -eq 'Running') {
    Write-Host " ✓" -ForegroundColor Green
} else {
    Write-Host " ✗" -ForegroundColor Red
    Receive-Job $nodeJob
    exit 1
}

# 2. 启动 Nginx（后台运行）
Write-Host "[2/2] 启动 Nginx (端口 8081)..." -NoNewline
$nginxProcess = Start-Process -FilePath "nginx" -ArgumentList "-p `"$NginxPrefix`" -c conf/nginx.dev.conf" -PassThru -NoNewWindow
Start-Sleep -Seconds 1
Write-Host " ✓ PID: $($nginxProcess.Id)" -ForegroundColor Green

Write-Host "`n=== 环境就绪 ===" -ForegroundColor Cyan
Write-Host "   Landing:  http://localhost:8081/"
Write-Host "   孩子端:   http://localhost:8081/app/"
Write-Host "   管理面板: http://localhost:8081/admin/"
Write-Host "   API:      http://localhost:8081/api/ping"
Write-Host "   Node.js:  http://localhost:8080 (直连)"
Write-Host "`n按 Ctrl+C 停止 Node.js，然后运行: nginx -s stop"

# 保持脚本运行直到用户中断
try {
    while ($true) { Start-Sleep -Seconds 1 }
} finally {
    # 退出时清理
    nginx -p "$NginxPrefix" -s stop 2>$null
    Stop-Job $nodeJob 2>$null
    Remove-Job $nodeJob 2>$null
}
