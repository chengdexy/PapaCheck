import cloudbase from '@cloudbase/js-sdk';

const ENV_ID = 'child-teacher-parent-d9aef9d2208';
let appInstance = null;
let dbInstance = null;
let authInstance = null;

export function initCloudBase() {
  if (!appInstance) {
    appInstance = cloudbase.init({ env: ENV_ID });
    dbInstance = appInstance.rdb();
    authInstance = appInstance.auth({ persistence: 'session' });
  }
  return appInstance;
}

export async function signInWithJwt(jwtToken) {
  if (!authInstance) {
    initCloudBase();
  }
  await authInstance.signInWithJwt(jwtToken);
}

export function getDb() {
  if (!dbInstance) {
    initCloudBase();
  }
  return dbInstance;
}

export function getCurrentTenantId() {
  return sessionStorage.getItem('papacheck_tenant_id') || '';
}

export function getCurrentChildId() {
  return sessionStorage.getItem('papacheck_child_id') || '';
}
