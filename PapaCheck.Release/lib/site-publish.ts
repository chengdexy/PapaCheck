import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, unlinkSync } from 'fs';
import { Executor, type StepDef } from './executor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SITE_DIR = join(ROOT, 'PapaCheck.Site');
const DIST_DIR = join(SITE_DIR, 'dist');

function requireEnv(): { ip: string; user: string } {
  const ip = process.env.PAPACHECK_CLOUD_IP;
  const user = process.env.PAPACHECK_SSH_USER;
  if (!ip) throw new Error('请设置环境变量 PAPACHECK_CLOUD_IP（服务器地址或域名）');
  if (!user) throw new Error('请设置环境变量 PAPACHECK_SSH_USER（SSH 登录用户名）');
  return { ip, user };
}

/**
 * 生成通过 SSH pipe 上传文件的步骤
 * 用 Node.js spawn + pipe 代替 scp，避免 Windows scp 协议行为差异
 */
function sshUploadStep(id: string, desc: string, localFile: string, remoteFile: string, host: string, user: string): StepDef {
  const sshArgs = JSON.stringify(['-o', 'StrictHostKeyChecking=accept-new', `${user}@${host}`, 'cat>' + remoteFile]);
  const localPath = JSON.stringify(localFile);
  const code = `const f=require('fs'),p=require('child_process');const s=f.createReadStream(${localPath});const c=p.spawn('ssh',${sshArgs});s.pipe(c.stdin);s.on('error',e=>{console.error(e.message);process.exit(1)});c.on('exit',c=>process.exit(c??1))`;
  return { id, desc, cmd: ['node', '-e', code], timeout: 120 };
}

export async function sitePublish(executor: Executor): Promise<boolean> {
  const { ip: CLOUD_SERVER_IP, user: CLOUD_SERVER_USER } = requireEnv();
  const steps: StepDef[] = [];

  steps.push({
    id: '1', desc: '构建 Vite 工程',
    cmd: 'npm run build', cwd: SITE_DIR, shell: true, timeout: 180,
  });

  // MSYS2 工具（tar）需要正斜杠路径
  const toPosix = (p: string) => p.replace(/\\/g, '/');
  const landingTar = toPosix(join(ROOT, '.site-landing.tar.gz'));
  const adminTar = toPosix(join(ROOT, '.site-admin.tar.gz'));
  const distDir = toPosix(DIST_DIR);
  const distAdminDir = toPosix(join(DIST_DIR, 'admin'));

  // 上传落地页：打包 → SSH pipe 上传 → 远程解压
  steps.push({
    id: '2', desc: '打包落地页',
    cmd: ['tar', '-czf', landingTar, '--exclude=admin', '-C', distDir, '.'],
    cwd: ROOT, timeout: 60,
  });
  steps.push(sshUploadStep('3', '上传落地页 tar 包', landingTar, '/tmp/site-landing.tar.gz', CLOUD_SERVER_IP, CLOUD_SERVER_USER));
  steps.push({
    id: '4', desc: '远程解压落地页',
    cmd: ['ssh', '-o', 'StrictHostKeyChecking=accept-new', `${CLOUD_SERVER_USER}@${CLOUD_SERVER_IP}`,
      `mkdir -p /opt/papacheck/PapaCheck.Site && tar xzf /tmp/site-landing.tar.gz -C /opt/papacheck/PapaCheck.Site/ && rm /tmp/site-landing.tar.gz`],
    timeout: 60,
  });

  // 上传管理面板：打包 → SSH pipe 上传 → 远程解压
  steps.push({
    id: '5', desc: '打包管理面板',
    cmd: ['tar', '-czf', adminTar, '-C', distAdminDir, '.'],
    cwd: ROOT, timeout: 60,
  });
  steps.push(sshUploadStep('6', '上传管理面板 tar 包', adminTar, '/tmp/site-admin.tar.gz', CLOUD_SERVER_IP, CLOUD_SERVER_USER));
  steps.push({
    id: '7', desc: '远程解压管理面板',
    cmd: ['ssh', '-o', 'StrictHostKeyChecking=accept-new', `${CLOUD_SERVER_USER}@${CLOUD_SERVER_IP}`,
      `mkdir -p /opt/papacheck/PapaCheck.Site/admin && tar xzf /tmp/site-admin.tar.gz -C /opt/papacheck/PapaCheck.Site/admin/ && rm /tmp/site-admin.tar.gz`],
    timeout: 60,
  });

  const cleanupCode = `const{rmSync,existsSync}=require('fs');const d=${JSON.stringify(distDir)};const f1=${JSON.stringify(landingTar)};const f2=${JSON.stringify(adminTar)};if(existsSync(d))rmSync(d,{recursive:true,force:true});if(existsSync(f1))rmSync(f1);if(existsSync(f2))rmSync(f2);console.log('OK')`;
  steps.push({
    id: '8', desc: '清理构建产物', cmd: ['node', '-e', cleanupCode], timeout: 10,
  });

  return executor.runAndReport('部署 Site', steps);
}
