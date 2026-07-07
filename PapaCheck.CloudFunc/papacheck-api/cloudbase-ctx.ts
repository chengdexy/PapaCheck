/**
 * cloudbase-ctx.ts - 保存 CloudBase SDK 实例（从 SCF context 提取）
 * 在 index.ts main() 中设置，在 app.ts 路由中使用
 */

let _tcbApp: any = null;

export function setCloudBaseApp(app: any): void {
  _tcbApp = app;
}

export function getCloudBaseApp(): any {
  return _tcbApp;
}
