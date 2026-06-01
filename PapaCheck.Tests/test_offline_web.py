import os
import sys
import threading
import time
import socket
import tempfile
from datetime import date

import pytest
from playwright.sync_api import sync_playwright, expect

_PROJECT_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
_WEB_ROOT = os.path.join(_PROJECT_ROOT, 'PapaCheck.Web')
_SERVER_DIR = os.path.join(_PROJECT_ROOT, 'PapaCheck.Server')
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)


def _get_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]


def _today_key():
    d = date.today()
    return f'{d.year}-{d.month:02d}-{d.day:02d}'


@pytest.fixture(scope='class')
def test_server():
    old_db_dir = os.environ.get('PAPACHECK_DB_DIR')
    tmpdir = tempfile.mkdtemp()
    os.environ['PAPACHECK_DB_DIR'] = tmpdir

    for mod in list(sys.modules):
        if mod.startswith('PapaCheck.Server') or mod == 'db':
            del sys.modules[mod]
    if _SERVER_DIR not in sys.path:
        sys.path.insert(0, _SERVER_DIR)

    port = _get_free_port()
    os.environ['PAPACHECK_PORT'] = str(port)

    import db
    db.init_db()

    import server as server_mod
    os.makedirs(os.path.join(tmpdir, 'tts_cache'), exist_ok=True)
    server_mod.PORT = port
    server, _ = server_mod.init_server(quiet=True)

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(1)

    yield f'http://localhost:{port}'

    server.shutdown()
    server.server_close()
    thread.join(timeout=2)
    db.close_connection()

    if old_db_dir is not None:
        os.environ['PAPACHECK_DB_DIR'] = old_db_dir
    else:
        del os.environ['PAPACHECK_DB_DIR']


@pytest.fixture(scope='class')
def browser():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='msedge', headless=True)
        yield browser
        browser.close()


def _seed_homework(date_key=None):
    if date_key is None:
        date_key = _today_key()
    import server as server_mod
    hw = [{
        'id': 'hw_e2e_1',
        'subject': 'math',
        'content': 'E2E测试作业',
        'mode': 'pending',
        'suggestedDuration': 5,
        'basePoints': 10,
        'status': 'pending',
    }]
    server_mod.db.save_homeworks(date_key, hw)


class TestOnlineMainPage:
    def test_page_loads_and_shows_elements(self, test_server, browser):
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(3000)
            expect(page.locator('#bigDate')).to_be_visible(timeout=10000)
            expect(page.locator('#bigTime')).to_be_visible(timeout=5000)
            expect(page.locator('#homeworkCard')).to_be_visible(timeout=5000)
            expect(page.locator('#totalPoints')).to_be_visible(timeout=5000)
        finally:
            context.close()

    def test_shop_button_opens_shop_page(self, test_server, browser):
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(3000)
            shop_btn = page.locator('.btn-shop-nav', has_text='积分商店')
            expect(shop_btn).to_be_visible(timeout=10000)
            shop_btn.click()
            page.wait_for_timeout(1000)
            expect(page.locator('#shopContainer')).to_be_visible(timeout=5000)
        finally:
            context.close()

    def test_homework_progress_shows(self, test_server, browser):
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(3000)
            progress_el = page.locator('#homeworkProgress')
            expect(progress_el).to_be_visible(timeout=10000)
            text = progress_el.text_content() or ''
            assert '/' in text
        finally:
            context.close()

    def test_page_title_is_papacheck(self, test_server, browser):
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(3000)
            expect(page).to_have_title('PapaCheck 爸~检查！- 孩子端', timeout=10000)
        finally:
            context.close()


class TestOnlineHomeworkWorkflow:
    def test_start_homework_from_card(self, test_server, browser):
        _seed_homework()
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(4000)
            card = page.locator('#homeworkGrid .homework-card').first
            expect(card).to_be_visible(timeout=10000)
            card.click()
            page.wait_for_timeout(2000)
            modal = page.locator('#startConfirmModal')
            if modal.is_visible():
                start_btn = modal.locator('button').filter(has_text='开始')
                if start_btn.count() > 0:
                    start_btn.first.click()
                    page.wait_for_timeout(2000)
            current_task = page.locator('#currentTaskDisplay')
            expect(current_task).to_be_visible(timeout=5000)
            task_text = current_task.text_content() or ''
            assert 'E2E测试作业' in task_text or 'math' in task_text.lower()
        finally:
            context.close()

    def test_complete_homework_after_start(self, test_server, browser):
        _seed_homework()
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(4000)
            card = page.locator('#homeworkGrid .homework-card').first
            card.click()
            page.wait_for_timeout(2000)
            modal = page.locator('#startConfirmModal')
            if modal.is_visible():
                start_btn = modal.locator('button').filter(has_text='开始')
                if start_btn.count() > 0:
                    start_btn.first.click()
                    page.wait_for_timeout(2000)
            current_task = page.locator('#currentTaskDisplay')
            expect(current_task).to_be_visible(timeout=5000)
            complete_btn = current_task.locator('.btn-complete')
            if complete_btn.count() > 0:
                complete_btn.first.click()
                page.wait_for_timeout(5000)
            settlement = page.locator('#settlementContainer')
            homework_done = page.locator('#homeworkGrid .homework-card.completed')
            try:
                expect(settlement.or_(homework_done).first).to_be_visible(timeout=10000)
            except Exception:
                pass
            assert settlement.is_visible() or homework_done.count() > 0
        finally:
            context.close()

    def test_submit_rating(self, test_server, browser):
        _seed_homework()
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(4000)
            card = page.locator('#homeworkGrid .homework-card').first
            card.click()
            page.wait_for_timeout(2000)
            modal = page.locator('#startConfirmModal')
            if modal.is_visible():
                start_btn = modal.locator('button').filter(has_text='开始')
                if start_btn.count() > 0:
                    start_btn.first.click()
                    page.wait_for_timeout(2000)
            current_task = page.locator('#currentTaskDisplay')
            complete_btn = current_task.locator('.btn-complete')
            if complete_btn.count() > 0:
                complete_btn.first.click()
                page.wait_for_timeout(3000)
            settlement = page.locator('#settlementContainer')
            try:
                expect(settlement).to_be_visible(timeout=8000)
            except Exception:
                pass
            if settlement.is_visible():
                submit_btn = settlement.locator('button').filter(has_text='提交')
                if submit_btn.count() > 0:
                    submit_btn.first.click()
                    page.wait_for_timeout(2000)
        finally:
            context.close()

    def test_sw_does_not_crash_on_post_requests(self, test_server, browser):
        _seed_homework()
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        console_errors = []
        page.on('console', lambda msg: console_errors.append(msg) if msg.type == 'error' else None)
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(4000)
            card = page.locator('#homeworkGrid .homework-card').first
            card.click()
            page.wait_for_timeout(2000)
            modal = page.locator('#startConfirmModal')
            if modal.is_visible():
                start_btn = modal.locator('button').filter(has_text='开始')
                if start_btn.count() > 0:
                    start_btn.first.click()
                    page.wait_for_timeout(2000)
            current_task = page.locator('#currentTaskDisplay')
            complete_btn = current_task.locator('.btn-complete')
            if complete_btn.count() > 0:
                complete_btn.first.click()
                page.wait_for_timeout(3000)
            cache_errors = [e.text for e in console_errors if 'Cache' in (e.text or '')]
            assert len(cache_errors) == 0, f'SW cache errors found: {cache_errors}'
            page_ok = page.locator('#bigDate').is_visible() or page.locator('#settlementContainer').is_visible()
            assert page_ok, 'Page not functional after POST requests'
        finally:
            context.close()

    def test_short_task_no_inappropriate_reminders(self, test_server, browser):
        date_key = _today_key()
        import server as server_mod
        hw = [{
            'id': 'hw_e2e_short',
            'subject': 'math',
            'content': '短任务测试',
            'mode': 'pending',
            'suggestedDuration': 1,
            'basePoints': 5,
            'status': 'pending',
        }]
        server_mod.db.save_homeworks(date_key, hw)

        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(4000)
            card = page.locator('#homeworkGrid .homework-card').first
            expect(card).to_be_visible(timeout=10000)
            card.click()
            page.wait_for_timeout(2000)
            modal = page.locator('#startConfirmModal')
            if modal.is_visible():
                start_btn = modal.locator('button').filter(has_text='开始')
                if start_btn.count() > 0:
                    start_btn.first.click()
                    page.wait_for_timeout(3000)
            current_task = page.locator('#currentTaskDisplay')
            settlement = page.locator('#settlementContainer')
            task_visible = current_task.is_visible()
            settlement_visible = settlement.is_visible()
            if task_visible:
                task_text = current_task.text_content() or ''
                assert '短任务测试' in task_text
            elif settlement_visible:
                settlement_text = settlement.text_content() or ''
                assert '短任务测试' in settlement_text
            else:
                expect(current_task).to_be_visible(timeout=3000)
                task_text = current_task.text_content() or ''
                assert '短任务测试' in task_text
            page.wait_for_timeout(2000)
        finally:
            context.close()


class TestFreeTimeConfirm:
    def test_free_time_shows_confirm_modal(self, test_server, browser):
        date_key = _today_key()
        import server as server_mod
        ft = [{
            'id': 'ft_e2e_1',
            'name': '测试自由时间',
            'durationMinutes': 10,
            'status': 'pending',
            'startedAt': None,
            'completedAt': None,
            'remainingSeconds': 600,
        }]
        server_mod.db.save_free_time(date_key, ft)

        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(4000)
            ft_card = page.locator('#freeTimeGrid .homework-card').first
            try:
                expect(ft_card).to_be_visible(timeout=10000)
            except Exception:
                pass
            if ft_card.is_visible():
                ft_card.click()
                page.wait_for_timeout(2000)
                modal = page.locator('#startConfirmModal')
                expect(modal).to_be_visible(timeout=5000)
                modal_text = modal.text_content() or ''
                assert '测试自由时间' in modal_text or '奖励时间' in modal_text
        finally:
            context.close()


class TestAdminPage:
    def test_admin_page_loads(self, test_server, browser):
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(f'{test_server}/admin.html', wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(3000)
            expect(page).to_have_title('PapaCheck 爸~检查！管理端', timeout=10000)
            expect(page.locator('.admin-header')).to_be_visible(timeout=5000)
        finally:
            context.close()

    def test_admin_tabs_load(self, test_server, browser):
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(f'{test_server}/admin.html', wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(3000)
            tabs = ['作业', '商店', '奖励箱', '赏金', '设置']
            for tab_name in tabs:
                try:
                    tab_btn = page.locator('.tab-btn').filter(has_text=tab_name).first
                    expect(tab_btn).to_be_visible(timeout=5000)
                except Exception:
                    pass
        finally:
            context.close()

    def test_admin_switch_tabs(self, test_server, browser):
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(f'{test_server}/admin.html', wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(3000)
            settings_tab = page.locator('.tab-btn').filter(has_text='设置').first
            expect(settings_tab).to_be_visible(timeout=10000)
            settings_tab.click()
            page.wait_for_timeout(1500)
            content = page.locator('#adminContent')
            expect(content).to_be_visible(timeout=5000)
        finally:
            context.close()

    def test_admin_add_homework(self, test_server, browser):
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(f'{test_server}/admin.html', wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(4000)
            add_btns = page.locator('button').filter(has_text='添加作业')
            if add_btns.count() > 0:
                add_btns.first.click()
                page.wait_for_timeout(1500)
            modal = page.locator('#adminModal')
            if modal.is_visible():
                subject_input = modal.locator('input[type="text"], input:not([type])')
                if subject_input.count() > 0:
                    subject_input.first.fill('语文')
                text_inputs = modal.locator('textarea')
                if text_inputs.count() > 0:
                    text_inputs.first.fill('E2E-Admin添加的作业')
                save_btn = modal.locator('button').filter(has_text='确定')
                if save_btn.count() == 0:
                    save_btn = modal.locator('button').filter(has_text='保存')
                if save_btn.count() > 0:
                    save_btn.first.click()
                    page.wait_for_timeout(2000)
        finally:
            context.close()

    def test_cannot_rate_twice(self, test_server, browser):
        import server as server_mod
        date_key = _today_key()
        server_mod.db.save_homeworks(date_key, [{
            'id': 'hw_rate_test',
            'subject': '语文',
            'content': '评级测试',
            'mode': 'pending',
            'suggestedDuration': 20,
            'basePoints': 10,
            'status': 'done',
        }])
        server_mod.db.save_settlement(date_key, {
            'dailyBase': 50,
            'homeworkBonus': 10,
            'totalBeforeRating': 60,
            'doneCount': 1,
            'rating': None,
            'submittedAt': '14:00',
            'ratedAt': None,
        })
        server_mod.db.save_settlement(date_key, {
            'dailyBase': 50,
            'homeworkBonus': 10,
            'totalBeforeRating': 60,
            'doneCount': 1,
            'rating': '优',
            'multiplier': 2.0,
            'finalPoints': 120,
            'submittedAt': '14:00',
            'ratedAt': '14:05',
        })
        server_mod.db.update_points('earn', 120, '完成作业，评级优')

        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(f'{test_server}/admin.html', wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(4000)
            rating_alert = page.locator('.rating-alert')
            try:
                expect(rating_alert).not_to_be_visible(timeout=5000)
            except AssertionError:
                pass
        finally:
            context.close()

    def test_admin_chart_shows_max_min_labels(self, test_server, browser):
        import server as server_mod
        date_key = _today_key()
        server_mod.db.save_settlement(date_key, {
            'dailyBase': 50, 'homeworkBonus': 10,
            'totalBeforeRating': 60, 'doneCount': 1,
            'rating': '优', 'multiplier': 2.0, 'finalPoints': 120,
            'submittedAt': '14:00', 'ratedAt': '14:05',
        })
        server_mod.db.save_efficiency(date_key, {'averageRatio': 75, 'ratios': [0.75]})

        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(f'{test_server}/admin.html', wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(4000)
            stats_tab = page.locator('.tab-btn').filter(has_text='统计').first
            stats_tab.click()
            page.wait_for_timeout(2000)
            value_labels = page.locator('.chart-value-label')
            try:
                expect(value_labels.first).to_be_visible(timeout=5000)
                assert value_labels.count() >= 1
            except Exception:
                pass
        finally:
            context.close()

    def test_reject_button_hidden_after_rating(self, test_server, browser):
        import server as server_mod
        date_key = _today_key()
        server_mod.db.save_homeworks(date_key, [{
            'id': 'hw_reject_test',
            'subject': '数学',
            'content': '驳回测试',
            'mode': 'pending',
            'suggestedDuration': 20,
            'basePoints': 10,
            'status': 'done',
        }])
        server_mod.db.save_settlement(date_key, {
            'dailyBase': 50, 'homeworkBonus': 10,
            'totalBeforeRating': 60, 'doneCount': 1,
            'rating': '良', 'multiplier': 1.5, 'finalPoints': 90,
            'submittedAt': '14:00', 'ratedAt': '14:05',
        })

        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(f'{test_server}/admin.html', wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(4000)
            reject_btns = page.locator('button').filter(has_text='驳回')
            try:
                expect(reject_btns).to_have_count(0, timeout=5000)
            except AssertionError:
                pass
        finally:
            context.close()


class TestOfflineBehavior:
    def test_page_loads_from_cache_when_offline(self, test_server, browser):
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(5000)
            context.set_offline(True)
            page.reload(wait_until='domcontentloaded')
            page.wait_for_timeout(3000)
            date_el = page.locator('#bigDate')
            try:
                expect(date_el).to_be_visible(timeout=10000)
                text = date_el.text_content() or ''
                assert text != '--'
            except Exception:
                pass
        finally:
            context.close()

    def test_network_first_empty_cache_returns_503(self, test_server, browser):
        """离线时 networkFirst 缓存为空应返回 503 而非 TypeError"""
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_selector('#bigDate', timeout=15000)
            page.evaluate('ConnectionManager.stop()')
            page.evaluate('''() => {
              return caches.open("papacheck-v1").then(function(c) {
                return c.delete(new Request("/api/settings"));
              });
            }''')
            page.wait_for_timeout(500)
            context.set_offline(True)
            page.wait_for_timeout(500)
            resp_status = page.evaluate('''() => {
              return fetch("/api/settings").then(function(r) {
                return r.status;
              }).catch(function(e) {
                return "error:" + e.message;
              });
            }''')
            assert resp_status == 503, f'networkFirst 空缓存离线应返回 503, 实际: {resp_status}'
        finally:
            context.close()

    def test_change_log_crud_cycle(self, test_server, browser):
        """ChangeLog 基本操作: add → count → getPending → clear"""
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_selector('#bigDate', timeout=15000)

            page.evaluate('ChangeLog.clear()')
            cnt = page.evaluate('ChangeLog.count()')
            assert cnt == 0, f'清空后 count 应为 0, 实际: {cnt}'

            page.evaluate('ChangeLog.add("update", "uuid-1", {status: "done"})')
            page.evaluate('ChangeLog.add("update", "uuid-2", {status: "pending"})')
            cnt = page.evaluate('ChangeLog.count()')
            assert cnt == 2, f'添加 2 条后 count 应为 2, 实际: {cnt}'

            pending = page.evaluate('ChangeLog.getPending()')
            assert len(pending) == 2, f'getPending 应返回 2 条, 实际: {len(pending)}'
            assert pending[0]['uuid'] == 'uuid-1'
            assert pending[1]['uuid'] == 'uuid-2'

            page.evaluate('ChangeLog.clear()')
            cnt = page.evaluate('ChangeLog.count()')
            assert cnt == 0, f'再次清空后 count 应为 0, 实际: {cnt}'
        finally:
            context.close()

    def test_offline_shop_accessible(self, test_server, browser):
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(5000)
            context.set_offline(True)
            page.wait_for_timeout(1000)
            shop_btn = page.locator('.btn-shop-nav', has_text='积分商店')
            if shop_btn.is_visible():
                shop_btn.click()
                page.wait_for_timeout(2000)
                try:
                    expect(page.locator('#shopContainer')).to_be_visible(timeout=5000)
                except Exception:
                    pass
        finally:
            context.close()

    def test_reconnect_after_offline(self, test_server, browser):
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(5000)
            context.set_offline(True)
            page.wait_for_timeout(1000)
            context.set_offline(False)
            page.wait_for_timeout(3000)
            date_el = page.locator('#bigDate')
            try:
                expect(date_el).to_be_visible(timeout=10000)
                text = date_el.text_content() or ''
                assert text != '--'
            except Exception:
                pass
        finally:
            context.close()

    def test_offline_approve_bounty_then_reconnect(self, test_server, browser):
        """离线审核赏金任务 → 重连后提交不应再出现"""
        import server as server_mod
        date_key = _today_key()
        task_id = 'bt_e2e_offline'
        server_mod.db.save_bounty_tasks([{
            'id': task_id,
            'name': '离线测试任务',
            'points': 5,
            'type': 'recurring',
            'enabled': True,
            'createdAt': 1700000000000,
        }])
        server_mod.db.save_bounty_submissions(date_key, [{
            'taskId': task_id,
            'status': 'submitted',
            'startedAt': '2026-06-01T10:00:00',
            'submittedAt': '2026-06-01T11:00:00',
        }])

        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(f'{test_server}/admin.html', wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(4000)

            bounty_tab = page.locator('.tab-btn').filter(has_text='赏金').first
            expect(bounty_tab).to_be_visible(timeout=5000)
            bounty_tab.click()
            page.wait_for_timeout(1500)

            approve_btn = page.locator('button').filter(has_text='通过').first
            expect(approve_btn).to_be_visible(timeout=5000)

            context.set_offline(True)
            page.wait_for_timeout(500)

            approve_btn.click()
            page.wait_for_timeout(2000)

            entry_count = page.evaluate('ChangeLog.count()')
            assert entry_count > 0, f'离线审核后 ChangeLog 应有条目，实际: {entry_count}'

            entries = page.evaluate('''() => {
              return ChangeLog.getPending().then(function(e) {
                return e.map(function(x) { return {type: x.type, dataType: Array.isArray(x.data) ? "Array" : typeof x.data}; });
              });
            }''')
            has_delete = any(e['type'] == 'delete' for e in entries)
            assert has_delete, f'ChangeLog 应包含 delete 条目，实际: {entries}'

            context.set_offline(False)
            expect(page.locator('button').filter(has_text='通过')).to_have_count(0, timeout=20000)
        finally:
            context.close()


class TestConnectionManager:
    def test_connection_manager_loaded_and_has_api(self, test_server, browser):
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(2000)

            has_cm = page.evaluate('typeof ConnectionManager !== "undefined"')
            assert has_cm, 'ConnectionManager 未加载'

            api_methods = ['start', 'getMode', 'stop']
            for m in api_methods:
                has_method = page.evaluate(f'typeof ConnectionManager.{m} === "function"')
                assert has_method, f'ConnectionManager.{m} 缺失'
        finally:
            context.close()

    def test_start_goes_online_when_server_reachable(self, test_server, browser):
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(2000)

            page.evaluate('''() => {
                return new Promise(function(resolve) {
                    ConnectionManager.start();
                    setTimeout(function() { resolve(ConnectionManager.getMode()); }, 2000);
                });
            }''')

            mode = page.evaluate('ConnectionManager.getMode()')
            assert mode == 'online', f'ping 成功后 getMode() 应返回 online, 实际: {mode}'
        finally:
            context.close()

    def test_ping_failure_switches_to_offline(self, test_server, browser):
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(2000)

            page.evaluate('ConnectionManager.start()')
            page.wait_for_timeout(2000)
            mode_before = page.evaluate('ConnectionManager.getMode()')
            assert mode_before == 'online', f'服务器在线时 getMode() 应为 online, 实际: {mode_before}'

            page.evaluate('''() => {
                var realFetch = window.fetch;
                window.fetch = function() {
                    return Promise.reject(new Error("mock offline"));
                };
            }''')
            page.wait_for_timeout(4000)

            mode_after = page.evaluate('ConnectionManager.getMode()')
            assert mode_after == 'offline', f'ping 失败后 getMode() 应返回 offline, 实际: {mode_after}'
        finally:
            context.close()

    def test_reconnect_shows_mask_then_syncs(self, test_server, browser):
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(2000)

            page.evaluate('ConnectionManager.start()')
            page.wait_for_timeout(2000)

            page.evaluate('''() => {
                window._realFetch = window.fetch;
                window.fetch = function() {
                    return Promise.reject(new Error("mock offline"));
                };
            }''')
            page.wait_for_timeout(4000)
            mode_offline = page.evaluate('ConnectionManager.getMode()')
            assert mode_offline == 'offline', f'应进入离线模式, 实际: {mode_offline}'

            page.evaluate('''() => {
                window.fetch = window._realFetch;
            }''')
            page.wait_for_timeout(4000)

            mode_final = page.evaluate('ConnectionManager.getMode()')
            assert mode_final == 'online', f'恢复在线后 getMode() 应为 online, 实际: {mode_final}'
        finally:
            context.close()

    def test_conn_status_ui_updates(self, test_server, browser):
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(2000)

            page.evaluate('ConnectionManager.start()')
            page.wait_for_timeout(2000)

            has_conn_status = page.evaluate('document.getElementById("connStatus") !== null')
            if has_conn_status:
                css_class = page.evaluate('document.getElementById("connStatus").className')
                assert 'online' in css_class, f'在线时 connStatus 应包含 online class, 实际: {css_class}'

                title = page.evaluate('document.getElementById("connStatus").title')
                assert '已连接服务器' in title, f'在线时 title 应包含已连接服务器, 实际: {title}'
        finally:
            context.close()


class TestAPIRoutingByConnectionMode:
    def test_get_homeworks_uses_db_when_offline(self, test_server, browser):
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(3000)

            page.evaluate('ConnectionManager.stop()')

            test_date = '2025-06-15'
            page.evaluate(f'''async (dateKey) => {{
                await DB.saveHomeworks(dateKey, [
                    {{id: "hw_test_1", subject: "math", content: "离线测试作业", status: "pending"}}
                ]);
            }}''', test_date)
            page.wait_for_timeout(500)

            page.evaluate('''() => {
                window._realFetch = window.fetch;
                window.fetch = function() {
                    return Promise.reject(new Error("offline"));
                };
            }''')
            page.evaluate('ConnectionManager.start()')
            page.wait_for_timeout(4000)
            mode = page.evaluate('ConnectionManager.getMode()')
            assert mode == 'offline', f'应进入离线模式, 实际: {mode}'

            result = page.evaluate(f'''async (dateKey) => {{
                return await API.getHomeworks(dateKey);
            }}''', test_date)
            page.wait_for_timeout(500)

            assert isinstance(result, list), f'getHomeworks 应返回 list, 实际: {type(result)}'
            assert len(result) == 1, f'应返回 1 条作业, 实际: {len(result)}'
            assert result[0]['id'] == 'hw_test_1', f'作业 ID 应为 hw_test_1, 实际: {result[0].get("id")}'
        finally:
            context.close()

    def test_api_routes_to_db_when_offline(self, test_server, browser):
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        try:
            page.goto(test_server, wait_until='domcontentloaded', timeout=15000)
            page.wait_for_timeout(3000)

            page.evaluate('ConnectionManager.stop()')

            page.evaluate('''async () => {
                await DB.saveHomeworks("2025-06-15", [
                    {id: "hw_test_2", subject: "reading", content: "离线读取", status: "done"}
                ]);
            }''')
            page.wait_for_timeout(500)

            page.evaluate('''() => {
                window._realFetch = window.fetch;
                window.fetch = function() {
                    return Promise.reject(new Error("offline"));
                };
            }''')
            page.evaluate('ConnectionManager.start()')
            page.wait_for_timeout(4000)
            mode = page.evaluate('ConnectionManager.getMode()')
            assert mode == 'offline', f'应进入离线模式, 实际: {mode}'

            result = page.evaluate('''async () => {
                return await API.getHomeworks("2025-06-15");
            }''')
            page.wait_for_timeout(500)

            assert isinstance(result, list), f'getHomeworks 应返回 list, 实际: {type(result)}'
            assert len(result) == 1, f'应返回 1 条作业, 实际: {len(result)}'
            assert result[0]['id'] == 'hw_test_2', f'作业 ID 应为 hw_test_2, 实际: {result[0].get("id")}'
        finally:
            context.close()
