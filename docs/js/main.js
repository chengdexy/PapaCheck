// 轮播图的标签顺序
const tabsOrder = ['kid', 'admin', 'stats'];
let currentTabIndex = 0;
let carouselInterval;

function switchTab(tab, manual = false) {
    if (manual) {
        resetCarousel();
    }
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    // 找到对应的按钮
    const tabButtons = document.querySelectorAll('.tab-btn');
    let targetBtn;
    tabButtons.forEach((btn, index) => {
        if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(tab)) {
            targetBtn = btn;
            currentTabIndex = index;
        }
    });

    if (targetBtn) {
        targetBtn.classList.add('active');
    }
    const targetContent = document.getElementById('tab-' + tab);
    if (targetContent) {
        targetContent.classList.add('active');
    }
}

function nextTab() {
    currentTabIndex = (currentTabIndex + 1) % tabsOrder.length;
    switchTab(tabsOrder[currentTabIndex]);
}

function startCarousel() {
    carouselInterval = setInterval(nextTab, 4000);
}

function resetCarousel() {
    if (carouselInterval) {
        clearInterval(carouselInterval);
    }
    startCarousel();
}

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
});

// 页面加载完成后启动轮播
window.addEventListener('DOMContentLoaded', startCarousel);
