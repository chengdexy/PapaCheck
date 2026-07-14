// 轻量入口 wrapper：先确保 module.exports.main 直接赋值生效，
// 再懒加载真实逻辑（handler-body.js）。这样即使 handler-body 在云端初始化抛错，
// 也能被此处 try/catch 捕获并以 500 JSON 返回真实错误栈，而非 SCF 的 writeRuntimeFile(undefined)。
exports.main = async function (event: any, context: any) {
  try {
    const { run } = require('./handler-body.js');
    return await run(event, context);
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        ok: false,
        error: 'INTERNAL_ERROR',
        message: err?.message ? String(err.message) : String(err),
        stack: err?.stack ? String(err.stack) : undefined,
      }),
    };
  }
};
