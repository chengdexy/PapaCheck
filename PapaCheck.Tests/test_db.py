import json
import sqlite3

import pytest


class TestInitDB:
    ALL_TABLES = [
        'active_buffs', 'badges', 'bounty_completions',
        'bounty_submissions', 'bounty_tasks', 'daily_settlement',
        'efficiency_history', 'free_time_tasks', 'homeworks',
        'meta', 'points', 'points_history', 'redemptions',
        'reward_box', 'settings', 'shop_items',
    ]

    @pytest.mark.parametrize('table_name', ALL_TABLES)
    def test_table_exists(self, db, table_name):
        conn = db._mgr.get()
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        assert table_name in tables, f'table {table_name} should exist'

    def test_default_points_balance_zero(self, db):
        conn = db._mgr.get()
        assert conn.execute(
            "SELECT balance FROM points WHERE id = 1"
        ).fetchone()['balance'] == 0

    def test_default_shop_items_empty(self, db):
        conn = db._mgr.get()
        assert json.loads(conn.execute(
            "SELECT data FROM shop_items WHERE id = 1"
        ).fetchone()['data']) == []

    def test_default_settings_empty(self, db):
        conn = db._mgr.get()
        assert json.loads(conn.execute(
            "SELECT data FROM settings WHERE id = 1"
        ).fetchone()['data']) == {}

    def test_default_bounty_tasks_empty(self, db):
        conn = db._mgr.get()
        assert json.loads(conn.execute(
            "SELECT data FROM bounty_tasks WHERE id = 1"
        ).fetchone()['data']) == []

    def test_init_db_idempotent(self, db):
        db.init_db()
        db.init_db()
        conn = db._mgr.get()
        count = conn.execute("SELECT COUNT(*) as c FROM points WHERE id = 1").fetchone()['c']
        assert count == 1


class TestHomeworks:
    def test_get_homeworks_empty(self, db, test_date):
        assert db.get_homeworks(test_date) == []

    def test_save_and_get_homeworks(self, db, test_date, sample_homeworks):
        db.save_homeworks(test_date, sample_homeworks)
        result = db.get_homeworks(test_date)
        assert len(result) == 2
        assert result[0]['id'] == 'hw1'
        assert result[1]['id'] == 'hw2'

    def test_save_homeworks_overwrite(self, db, test_date, sample_homeworks):
        db.save_homeworks(test_date, sample_homeworks)
        db.save_homeworks(test_date, [sample_homeworks[0]])
        result = db.get_homeworks(test_date)
        assert len(result) == 1

    def test_move_homework_success(self, db, test_date, sample_homeworks):
        db.save_homeworks(test_date, sample_homeworks)
        result = db.move_homework(test_date, '2025-06-16', 'hw1')
        assert result is not None
        assert result['id'] == 'hw1'
        assert len(db.get_homeworks(test_date)) == 1
        assert len(db.get_homeworks('2025-06-16')) == 1

    def test_move_homework_nonexistent_date(self, db, test_date):
        result = db.move_homework(test_date, '2025-06-16', 'hw1')
        assert result is None

    def test_move_homework_nonexistent_id(self, db, test_date, sample_homeworks):
        db.save_homeworks(test_date, sample_homeworks)
        result = db.move_homework(test_date, '2025-06-16', 'nonexistent')
        assert result is None


class TestPoints:
    def test_get_points_balance_default_zero(self, db):
        assert db.get_points_balance() == 0

    def test_update_points_earn(self, db):
        result = db.update_points('earn', 10, '完成语文作业')
        assert result == 10
        assert db.get_points_balance() == 10

    def test_update_points_spend(self, db):
        db.update_points('earn', 50, '初始积分')
        result = db.update_points('spend', 20, '兑换奖励')
        assert result == 30
        assert db.get_points_balance() == 30

    def test_update_points_multiple(self, db):
        db.update_points('earn', 10, '第一次')
        db.update_points('earn', 15, '第二次')
        db.update_points('spend', 5, '消费')
        assert db.get_points_balance() == 20

    def test_update_points_zero_amount_no_effect(self, db):
        db.update_points('earn', 0, '零值加分')
        assert db.get_points_balance() == 0

    def test_update_points_history(self, db):
        db.update_points('earn', 10, '完成作业')
        data = db.get_full_data()
        history = data['points']['history']
        assert len(history) == 1
        assert history[0]['earned'] == 10
        assert history[0]['spent'] == 0
        assert history[0]['balance'] == 10

    def test_reset_points(self, db):
        db.update_points('earn', 100, '测试积分')
        db.reset_points()
        assert db.get_points_balance() == 0
        data = db.get_full_data()
        assert len(data['points']['history']) == 0


class TestSettlement:
    def test_get_settlement_empty(self, db, test_date):
        assert db.get_settlement(test_date) is None

    def test_save_and_get_settlement(self, db, test_date):
        settlement = {'dailyBase': 50, 'homeworkBonus': 20, 'rating': '优'}
        db.save_settlement(test_date, settlement)
        result = db.get_settlement(test_date)
        assert result['dailyBase'] == 50
        assert result['rating'] == '优'


class TestShopItems:
    def test_get_shop_items_default(self, db):
        assert db.get_shop_items() == []

    def test_save_and_get_shop_items(self, db):
        items = [
            {'id': 's1', 'name': '看动画30分钟', 'cost': 10, 'type': 'time', 'baseQuantity': 3, 'remainingQuantity': 3},
        ]
        db.save_shop_items(items)
        result = db.get_shop_items()
        assert len(result) == 1
        assert result[0]['name'] == '看动画30分钟'


class TestRedemptions:
    def test_redemptions_crud(self, db):
        assert db.get_redemptions() == []
        items = [{'id': 'r1', 'itemId': 's1', 'status': 'pending'}]
        db.save_redemptions(items)
        result = db.get_redemptions()
        assert len(result) == 1
        assert result[0]['status'] == 'pending'


class TestRewardBox:
    def test_reward_box_crud(self, db):
        assert db.get_reward_box() == []
        items = [{'id': 'rb1', 'name': '神秘奖励', 'quantity': 1}]
        db.save_reward_box(items)
        result = db.get_reward_box()
        assert len(result) == 1


class TestActiveBuffs:
    def test_active_buffs_crud(self, db):
        assert db.get_active_buffs() == []
        buffs = [{'id': 'b1', 'name': '双倍积分', 'duration': 30, 'unit': 'minutes', 'startDate': '2025-06-15'}]
        db.save_active_buffs(buffs)
        result = db.get_active_buffs()
        assert len(result) == 1


class TestSettings:
    def test_get_settings_default(self, db):
        assert db.get_settings() == {}

    def test_save_and_get_settings(self, db):
        settings = {'dailyBasePoints': 80, 'ratingMultipliers': {'优': 1.2}}
        db.save_settings(settings)
        result = db.get_settings()
        assert result['dailyBasePoints'] == 80


class TestBountyTasks:
    def test_get_bounty_tasks_empty(self, db):
        assert db.get_bounty_tasks() == []

    def test_save_and_get_bounty_tasks(self, db, sample_bounty_tasks):
        db.save_bounty_tasks(sample_bounty_tasks)
        result = db.get_bounty_tasks()
        assert len(result) == 2

    def test_bounty_submissions_crud(self, db, test_date):
        submissions = [{'taskId': 'bt1', 'status': 'doing', 'startedAt': '2025-06-15T10:00:00', 'submittedAt': None}]
        db.save_bounty_submissions(test_date, submissions)
        result = db.get_bounty_submissions(test_date)
        assert len(result) == 1
        assert result[0]['status'] == 'doing'

    def test_bounty_submissions_empty_default(self, db, test_date):
        assert db.get_bounty_submissions(test_date) == []

    def test_bounty_completions_crud(self, db, test_date):
        completions = {'bt1': True}
        db.save_bounty_completions(test_date, completions)
        result = db.get_bounty_completions(test_date)
        assert result == {'bt1': True}

    def test_bounty_completions_empty_default(self, db, test_date):
        assert db.get_bounty_completions(test_date) == {}

    def test_bounty_total_key_persists_after_reset_date(self, db, test_date, sample_bounty_tasks):
        db.save_bounty_tasks(sample_bounty_tasks)
        db.save_bounty_completions('_total', {'bt1': 3})
        db.save_bounty_submissions(test_date, [{'taskId': 'bt1', 'status': 'doing'}])
        db.reset_date(test_date)
        result = db.get_bounty_completions('_total')
        assert result == {'bt1': 3}


class TestEfficiency:
    def test_efficiency_crud(self, db, test_date):
        data = {'efficiencyRatio': 0.85, 'totalTime': 45}
        db.save_efficiency(test_date, data)
        result = db.get_efficiency(test_date)
        assert result['efficiencyRatio'] == 0.85

    def test_get_efficiency_empty(self, db, test_date):
        assert db.get_efficiency(test_date) is None


class TestFreeTime:
    def test_free_time_crud(self, db, test_date):
        tasks = [{'id': 'ft1', 'name': '玩游戏', 'duration': 30, 'status': 'done'}]
        db.save_free_time(test_date, tasks)
        result = db.get_free_time(test_date)
        assert len(result) == 1

    def test_get_free_time_empty_default(self, db, test_date):
        assert db.get_free_time(test_date) == []


class TestFullDataImportExport:
    def test_get_full_data_empty(self, db):
        data = db.get_full_data()
        assert data['points']['balance'] == 0
        assert data['homeworks'] == {}
        assert data['bountyTasks'] == []

    def test_full_data_includes_homeworks(self, db, test_date, sample_homeworks):
        db.save_homeworks(test_date, sample_homeworks)
        data = db.get_full_data()
        assert len(data['homeworks'][test_date]) == 2

    def test_full_data_includes_points_balance(self, db):
        db.update_points('earn', 20, '测试')
        data = db.get_full_data()
        assert data['points']['balance'] == 20

    def test_import_roundtrip_points(self, db):
        db.update_points('earn', 50, '测试积分')
        exported = db.get_full_data()

        db.reset_points()
        db.import_full_data(exported)

        assert db.get_points_balance() == 50

    def test_import_roundtrip_homeworks(self, db, test_date, sample_homeworks):
        db.save_homeworks(test_date, sample_homeworks)
        exported = db.get_full_data()

        db.save_homeworks(test_date, [])
        db.import_full_data(exported)

        assert len(db.get_homeworks(test_date)) == 2

    def test_import_roundtrip_settings(self, db):
        db.save_settings({'dailyBasePoints': 80})
        exported = db.get_full_data()

        db.save_settings({})
        db.import_full_data(exported)

        assert db.get_settings()['dailyBasePoints'] == 80

    def test_import_full_data_preserves_bounty_total(self, db, sample_bounty_tasks):
        db.save_bounty_tasks(sample_bounty_tasks)
        db.save_bounty_completions('_total', {'bt1': 5})
        exported = db.get_full_data()

        db.save_bounty_completions('_total', {})
        db.import_full_data(exported)

        result = db.get_bounty_completions('_total')
        assert result == {'bt1': 5}


class TestResetDate:
    def test_reset_date_clears_homeworks(self, db, test_date, sample_homeworks):
        db.save_homeworks(test_date, sample_homeworks)
        db.reset_date(test_date)
        assert db.get_homeworks(test_date) == []

    def test_reset_date_clears_settlement(self, db, test_date):
        db.save_settlement(test_date, {'dailyBase': 50})
        db.reset_date(test_date)
        assert db.get_settlement(test_date) is None

    def test_reset_date_clears_bounty_submissions(self, db, test_date):
        db.save_bounty_submissions(test_date, [{'taskId': 'bt1', 'status': 'doing'}])
        db.reset_date(test_date)
        assert db.get_bounty_submissions(test_date) == []

    def test_reset_date_preserves_other_dates(self, db, test_date, sample_homeworks):
        other_date = '2025-06-16'
        db.save_homeworks(test_date, sample_homeworks)
        db.save_homeworks(other_date, [sample_homeworks[0]])
        db.reset_date(test_date)
        assert db.get_homeworks(test_date) == []
        assert len(db.get_homeworks(other_date)) == 1

    def test_reset_date_clears_active_buffs(self, db, test_date):
        buffs = [{'id': 'b1', 'name': '双倍积分', 'duration': 30, 'unit': 'minutes', 'startDate': test_date}]
        db.save_active_buffs(buffs)
        db.reset_date(test_date)
        result = db.get_active_buffs()
        assert len(result) == 0


class TestCloseConnection:
    def test_close_connection(self, db):
        db.close_connection()
