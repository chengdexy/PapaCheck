import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, unlinkSync } from 'fs';
import { Executor, type StepDef } from './executor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SITE_DIR = join(ROOT, 'PapaCheck.Site');
const DIST_DIR = join(SITE_DIR, 'dist');

const CLOUD_SERVER_IP = process.env.PAPACHECK_CLOUD_IP || 'papacheck.chengdexy.cn';
const CLOUD_SERVER_USER = 'root';

export async function sitePublish(executor: Executor): Promise<boolean> {
  const steps: StepDef[] = [];

  steps.push({
    id: '1', desc: '构建 Vite 工程',
    cmd: 'npm run build', cwd: SITE_DIR, shell: true, timeout: 180,
  });

  const landingTar = join(ROOT, '.site-landing.tar.gz');
  const landingCmd = `tar -czf "${landingTar}" --exclude=admin -C "${DIST_DIR}" . && scp -o StrictHostKeyChecking=accept-new "${landingTar}" ${CLOUD_SERVER_USER}@${CLOUD_SERVER_IP}:/tmp/ && ssh -o StrictHostKeyChecking=accept-new ${CLOUD_SERVER_USER}@${CLOUD_SERVER_IP} "mkdir -p /opt/papacheck/PapaCheck.Site && tar xzf /tmp/site-landing.tar.gz -C /opt/papacheck/PapaCheck.Site/ && rm /tmp/site-landing.tar.gz"`;
  steps.push({
    id: '2', desc: '上传落地页', cmd: landingCmd, cwd: ROOT, shell: true, timeout: 120,
  });

  const adminTar = join(ROOT, '.site-admin.tar.gz');
  const adminCmd = `tar -czf "${adminTar}" -C "${join(DIST_DIR, 'admin')}" . && scp -o StrictHostKeyChecking=accept-new "${adminTar}" ${CLOUD_SERVER_USER}@${CLOUD_SERVER_IP}:/tmp/ && ssh -o StrictHostKeyChecking=accept-new ${CLOUD_SERVER_USER}@${CLOUD_SERVER_IP} "mkdir -p /opt/papacheck/PapaCheck.Site/admin && tar xzf /tmp/site-admin.tar.gz -C /opt/papacheck/PapaCheck.Site/admin/ && rm /tmp/site-admin.tar.gz"`;
  steps.push({
    id: '3', desc: '上传管理面板', cmd: adminCmd, cwd: ROOT, shell: true, timeout: 120,
  });

  const cleanupCmd = `npx tsx -e "
const { rmSync, existsSync } = require('fs');
const dist = '${DIST_DIR.replace(/\\/g, '/')}';
const f1 = '${landingTar.replace(/\\/g, '/')}';
const f2 = '${adminTar.replace(/\\/g, '/')}';
if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
if (existsSync(f1)) rmSync(f1);
if (existsSync(f2)) rmSync(f2);
console.log('OK');
"`;
  steps.push({
    id: '4', desc: '清理构建产物', cmd: cleanupCmd, cwd: ROOT, shell: true, timeout: 10,
  });

  return executor.runAndReport('部署 Site', steps);
}
