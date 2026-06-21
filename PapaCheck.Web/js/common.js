/**
 * common.js - PapaCheck Web 通用工具模块
 * 提供跨页面共享的工具函数和初始化逻辑
 *
 * 该文件必须在 app.js / admin.js 之前加载，以确保函数全局可用。
 */

// ==================== Transition Mask ====================
/**
 * 显示过渡遮罩层
 * @param {string} text - 遮罩层显示的文本
 */
function showTransitionMask(text) {
  var mask = document.getElementById('transitionMask');
  if (!mask) return;
  if (mask.style.display === 'flex') return;
  var textEl = document.getElementById('transitionText');
  if (textEl) textEl.textContent = text;
  mask.style.display = 'flex';
  clearTimeout(mask._timeout);
  mask._timeout = setTimeout(function () { mask.style.display = 'none'; }, 5000);
}

/**
 * 隐藏过渡遮罩层
 */
function hideTransitionMask() {
  var mask = document.getElementById('transitionMask');
  if (!mask) return;
  clearTimeout(mask._timeout);
  mask.style.display = 'none';
}

// ==================== HTML 安全 ====================
/**
 * HTML 转义，防止 XSS 攻击
 * @param {string} str - 需要转义的字符串
 * @returns {string} 转义后的安全字符串
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ==================== Service Worker ====================
// Android WebView 跳过 SW 注册（WebView 生命周期与浏览器不同，SW 缓存可能导致意外行为）
if ('serviceWorker' in navigator && !/Android.*wv/i.test(navigator.userAgent)) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      console.log('[common] SW registered:', reg.scope);
    }).catch(function (err) {
      console.log('[common] SW registration failed:', err);
    });

    // 监听 SW 发来的强制刷新消息
    navigator.serviceWorker.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'FORCE_REFRESH') {
        sessionStorage.setItem('sw_updated', 'true');
        showTransitionMask('检测到新版本，正在刷新页面...');
        window.location.reload();
      }
    });
  });
}

// 页面加载时检测是否为刷新后
if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('sw_updated') === 'true') {
  sessionStorage.removeItem('sw_updated');
  setTimeout(function () {
    if (typeof showToast === 'function') {
      showToast('已更新到最新版本');
    }
  }, 500);
}
