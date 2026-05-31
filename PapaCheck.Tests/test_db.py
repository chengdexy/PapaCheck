import json
import sqlite3
from unittest.mock import patch

import pytest


class TestInitDB:
    ALL_TABLES = [
        'active_buffs', 'badges', 'bounty_completions',
        'bounty_submissions', 'bounty_tasks', 'daily_settlement',
        'efficiency_history', 'free_time_tasks', 'homeworks',
        'last_modified', 'meta', 'points', 'points_history',
        'redemptions', 'reward_box', 'settings', 'shop_items',
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

    def test_get_bounty_submissions_filters_isDeleted(self, db, test_date):
        """get_bounty_submissions 应过滤 isDeleted 条目，否则孩子端无法重新开始赏金"""
        db.save_bounty_submissions(test_date, [
            {'id': 'bs1', 'taskId': 'bt1', 'status': 'submitted',
             'startedAt': '2025-06-15T10:00:00', 'submittedAt': '2025-06-15T11:00:00',
             'isDeleted': True},
            {'id': 'bs2', 'taskId': 'bt2', 'status': 'doing',
             'startedAt': '2025-06-15T10:00:00', 'submittedAt': None,
             'isDeleted': False},
        ])
        result = db.get_bounty_submissions(test_date)
        assert len(result) == 1, f'应过滤 isDeleted 条目，实际: {len(result)} 条'
        assert result[0]['id'] == 'bs2'

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


class TestRecordModification:
    def test_record_modification_inserts_timestamp(self, db):
        import time
        timestamp = '2025-06-15T10:30:00'
        db.record_modification('homeworks', '2025-06-15', timestamp)

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('homeworks', '2025-06-15')
        ).fetchone()
        assert row is not None
        assert row['table_name'] == 'homeworks'
        assert row['record_key'] == '2025-06-15'
        assert row['last_modified'] == timestamp

    def test_record_modification_overwrites_existing(self, db):
        timestamp1 = '2025-06-15T10:00:00'
        timestamp2 = '2025-06-15T10:30:00'
        db.record_modification('shop_items', '1', timestamp1)
        db.record_modification('shop_items', '1', timestamp2)

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('shop_items', '1')
        ).fetchone()
        assert row['last_modified'] == timestamp2


class TestGetModifiedSince:
    def test_returns_only_newer_records(self, db):
        db.save_homeworks('2025-06-15', [{'id': 'hw1', 'subject': 'math'}])
        db.record_modification('homeworks', '2025-06-15', '2025-06-15T08:00:00')
        db.save_homeworks('2025-06-16', [{'id': 'hw2', 'subject': 'english'}])
        db.record_modification('homeworks', '2025-06-16', '2025-06-16T10:00:00')

        result = db.get_modified_since('2025-06-16T00:00:00')

        assert len(result) == 1
        assert result[0]['table_name'] == 'homeworks'
        assert result[0]['record_key'] == '2025-06-16'
        assert result[0]['last_modified'] == '2025-06-16T10:00:00'
        assert result[0]['data'] == [{'id': 'hw2', 'subject': 'english'}]

    def test_returns_all_when_none_newer(self, db):
        db.save_homeworks('2025-06-15', [{'id': 'hw1', 'subject': 'math'}])
        db.record_modification('homeworks', '2025-06-15', '2025-06-15T08:00:00')

        result = db.get_modified_since('2025-06-16T00:00:00')

        assert result == []

    def test_handles_boundary_correctly(self, db):
        db.save_shop_items([{'id': 's1', 'name': 'item1'}])
        db.record_modification('shop_items', '1', '2025-06-15T10:00:00')

        result_exact = db.get_modified_since('2025-06-15T10:00:00')

        assert len(result_exact) == 0

    def test_returns_multiple_tables(self, db):
        db.save_homeworks('2025-06-15', [{'id': 'hw1', 'subject': 'math'}])
        db.record_modification('homeworks', '2025-06-15', '2025-06-15T10:00:00')
        db.save_settings({'dailyBasePoints': 80})
        db.record_modification('settings', '1', '2025-06-15T10:30:00')

        result = db.get_modified_since('2025-06-14T00:00:00')

        assert len(result) == 2
        table_names = {r['table_name'] for r in result}
        assert table_names == {'homeworks', 'settings'}


class TestPushMerge:
    def test_push_merge_creates_new_homework(self, db):
        changes = [{
            'type': 'create',
            'uuid': 'hw-new-1',
            'data': {
                'id': 'hw-new-1',
                'subject': 'math',
                'content': '新作业',
                'mode': 'timer',
                'suggestedDuration': 20,
                'basePoints': 10,
                'status': 'pending',
                'date': '2025-06-15',
                'lastModified': '2025-06-15T10:00:00',
                'isDeleted': False,
            },
            'timestamp': '2025-06-15T10:00:00',
        }]

        result = db.push_merge(changes)

        assert result == {'ok': True}
        homeworks = db.get_homeworks('2025-06-15')
        assert len(homeworks) == 1
        assert homeworks[0]['id'] == 'hw-new-1'

    def test_push_merge_lww_newer_wins(self, db):
        db.save_homeworks('2025-06-15', [{
            'id': 'hw-existing',
            'subject': 'math',
            'content': '旧内容',
            'mode': 'timer',
            'suggestedDuration': 10,
            'basePoints': 5,
            'status': 'pending',
            'date': '2025-06-15',
            'lastModified': '2025-06-14T10:00:00',
            'isDeleted': False,
        }])
        db.record_modification('homeworks', '2025-06-15', '2025-06-14T10:00:00')

        changes = [{
            'type': 'update',
            'uuid': 'hw-existing',
            'data': {
                'id': 'hw-existing',
                'subject': 'math',
                'content': '新内容',
                'mode': 'timer',
                'suggestedDuration': 20,
                'basePoints': 10,
                'status': 'done',
                'date': '2025-06-15',
                'lastModified': '2025-06-15T10:00:00',
                'isDeleted': False,
            },
            'timestamp': '2025-06-15T10:00:00',
        }]

        result = db.push_merge(changes)

        assert result == {'ok': True}
        homeworks = db.get_homeworks('2025-06-15')
        assert len(homeworks) == 1
        assert homeworks[0]['content'] == '新内容'
        assert homeworks[0]['lastModified'] == '2025-06-15T10:00:00'

    def test_push_merge_lww_older_ignored(self, db):
        db.save_homeworks('2025-06-15', [{
            'id': 'hw-existing',
            'subject': 'math',
            'content': '较新内容',
            'mode': 'timer',
            'suggestedDuration': 20,
            'basePoints': 10,
            'status': 'done',
            'date': '2025-06-15',
            'lastModified': '2025-06-15T12:00:00',
            'isDeleted': False,
        }])

        changes = [{
            'type': 'update',
            'uuid': 'hw-existing',
            'data': {
                'id': 'hw-existing',
                'subject': 'math',
                'content': '较旧内容',
                'mode': 'timer',
                'suggestedDuration': 10,
                'basePoints': 5,
                'status': 'pending',
                'date': '2025-06-15',
                'lastModified': '2025-06-14T10:00:00',
                'isDeleted': False,
            },
            'timestamp': '2025-06-14T10:00:00',
        }]

        result = db.push_merge(changes)

        assert result == {'ok': True}
        homeworks = db.get_homeworks('2025-06-15')
        assert homeworks[0]['content'] == '较新内容'
        assert homeworks[0]['lastModified'] == '2025-06-15T12:00:00'

    def test_push_merge_soft_delete(self, db):
        db.save_homeworks('2025-06-15', [{
            'id': 'hw-to-delete',
            'subject': 'math',
            'content': '要删除的作业',
            'mode': 'timer',
            'suggestedDuration': 10,
            'basePoints': 5,
            'status': 'pending',
            'date': '2025-06-15',
            'lastModified': '2025-06-14T10:00:00',
            'isDeleted': False,
        }])

        changes = [{
            'type': 'delete',
            'uuid': 'hw-to-delete',
            'data': {
                'id': 'hw-to-delete',
                'subject': 'math',
                'content': '要删除的作业',
                'mode': 'timer',
                'suggestedDuration': 10,
                'basePoints': 5,
                'status': 'pending',
                'date': '2025-06-15',
                'lastModified': '2025-06-15T10:00:00',
                'isDeleted': True,
            },
            'timestamp': '2025-06-15T10:00:00',
        }]

        result = db.push_merge(changes)

        assert result == {'ok': True}
        homeworks = db.get_homeworks('2025-06-15')
        assert len(homeworks) == 0, 'get 过滤 isDeleted，应返回 0 条'

        conn = db._mgr.get()
        raw = json.loads(conn.execute(
            "SELECT data FROM homeworks WHERE date_key = ?", ('2025-06-15',)
        ).fetchone()['data'])
        assert len(raw) == 1
        assert raw[0]['isDeleted'] is True

    def test_push_merge_single_row_table(self, db):
        changes = [{
            'type': 'create',
            'uuid': 's-new-1',
            'data': {
                'id': 's-new-1',
                'name': '新商品',
                'cost': 10,
                'type': 'time',
                'baseQuantity': 3,
                'remainingQuantity': 3,
                'lastModified': '2025-06-15T10:00:00',
                'isDeleted': False,
            },
            'timestamp': '2025-06-15T10:00:00',
        }]

        result = db.push_merge(changes)

        assert result == {'ok': True}
        items = db.get_shop_items()
        assert len(items) == 1
        assert items[0]['id'] == 's-new-1'

    def test_push_merge_redemption_not_misclassified_as_bounty(self, db):
        """兑换记录不应被误判为赏金任务（兑换有 createdAt + points，赏金任务也有）"""
        redemption_change = {
            'type': 'create',
            'uuid': 'red-001',
            'data': {
                'id': 'red-001',
                'itemName': '游戏时间',
                'itemType': 'time',
                'durationMinutes': 30,
                'points': 50,
                'status': 'pending',
                'createdAt': 1700000000000,
                'lastModified': '2025-06-15T10:00:00',
                'isDeleted': False,
            },
            'timestamp': '2025-06-15T10:00:00',
        }

        result = db.push_merge([redemption_change])
        assert result == {'ok': True}

        redemptions = db.get_redemptions()
        bounty_tasks = db.get_bounty_tasks()

        assert len(redemptions) == 1, '兑换记录应写入 redemptions 表'
        assert redemptions[0]['id'] == 'red-001'
        assert len(bounty_tasks) == 0, '兑换记录不应被误判为赏金任务'

    def test_push_merge_old_item_without_uuid_matched_by_id(self, db):
        """旧数据无uuid字段时，push_merge 应通过 id 匹配而非追加为新条目"""
        db.save_bounty_tasks([{
            'id': 'bt-old',
            'name': '旧版赏金任务',
            'points': 5,
            'type': 'recurring',
            'enabled': True,
        }])

        assert len(db.get_bounty_tasks()) == 1

        db.push_merge([{
            'type': 'update',
            'uuid': 'uuid-from-client-xxxx',
            'data': {
                'id': 'bt-old',
                'uuid': 'uuid-from-client-xxxx',
                'name': '旧版赏金任务',
                'points': 10,
                'type': 'recurring',
                'enabled': True,
                'createdAt': 1700000000000,
                'lastModified': '2025-06-16T10:00:00',
            },
            'timestamp': '2025-06-16T10:00:00',
        }])

        after = db.get_bounty_tasks()
        assert len(after) == 1, f'旧数据被重复追加: {len(after)} 条'
        assert after[0]['points'] == 10, '旧数据应被更新为新值'

    def test_push_merge_free_time_not_misclassified(self, db):
        """自由时间变更不应被误判为 bounty_submissions"""
        db.save_free_time('2025-06-15', [{
            'id': 'ft_test',
            'name': '测试自由时间',
            'durationMinutes': 10,
            'status': 'pending',
        }])
        db.push_merge([{
            'type': 'update',
            'uuid': 'ft_test',
            'data': {
                'id': 'ft_test',
                'date': '2025-06-15',
                'name': '测试自由时间',
                'durationMinutes': 10,
                'status': 'done',
                'startedAt': '2025-06-15T10:00:00',
                'completedAt': '2025-06-15T10:10:00',
                'lastModified': '2025-06-15T10:10:00',
                'isDeleted': False,
            },
            'timestamp': '2025-06-15T10:10:00',
        }])
        ft_list = db.get_free_time('2025-06-15')
        assert len(ft_list) == 1, f'自由时间变更丢失或翻倍: {len(ft_list)} 条'
        assert ft_list[0]['status'] == 'done'

    def test_push_merge_points_change(self, db):
        """积分变更应被 push_merge 正确处理"""
        db.update_points('earn', 100, '初始积分')
        db.push_merge([{
            'type': 'update',
            'uuid': 'pts-001',
            'data': {
                'balance': 50,
                'uuid': 'pts-001',
                'lastModified': '2025-06-15T10:10:00',
                'isDeleted': False,
            },
            'timestamp': '2025-06-15T10:10:00',
        }])
        bal = db.get_points_balance()
        assert bal == 50, f'积分变更未生效: balance={bal}'

    def test_push_merge_bounty_submission_without_date_skipped(self, db):
        """离线赏金任务：ChangeLog 缺 date 字段时被静默跳过（bug 复现）

        saveBountySubmissions 写 ChangeLog 时未给条目添加 date 字段，
        导致 push_merge 在 DATE_KEY_TABLES 分支中 record_key 为空，
        continue 静默跳过，赏金任务提交从未同步到服务端。"""
        db.save_bounty_submissions('2025-06-15', [])

        changes = [{
            'type': 'update',
            'uuid': 'bs-uuid-1',
            'data': {
                'taskId': 'bt1',
                'status': 'submitted',
                'startedAt': '2025-06-15T10:00:00',
                'submittedAt': '2025-06-15T10:05:00',
                'uuid': 'bs-uuid-1',
                'lastModified': '2025-06-15T10:05:00',
                'isDeleted': False,
            },
            'timestamp': '2025-06-15T10:05:00',
        }]

        db.push_merge(changes)

        submissions = db.get_bounty_submissions('2025-06-15')
        assert len(submissions) == 0, \
            f'缺 date 时 change 应被跳过，submissions 仍为空，实际: {len(submissions)}'

    def test_push_merge_bounty_submission_with_date_works(self, db):
        """离线赏金任务修复后：ChangeLog 带 date 字段，push_merge 正确写入"""
        db.save_bounty_submissions('2025-06-15', [])

        changes = [{
            'type': 'update',
            'uuid': 'bs-uuid-2',
            'data': {
                'taskId': 'bt2',
                'status': 'submitted',
                'startedAt': '2025-06-15T10:00:00',
                'submittedAt': '2025-06-15T10:05:00',
                'date': '2025-06-15',
                'uuid': 'bs-uuid-2',
                'lastModified': '2025-06-15T10:05:00',
                'isDeleted': False,
            },
            'timestamp': '2025-06-15T10:05:00',
        }]

        db.push_merge(changes)

        submissions = db.get_bounty_submissions('2025-06-15')
        assert len(submissions) == 1, \
            f'带 date 时应写入 1 条，实际: {len(submissions)}'
        assert submissions[0]['status'] == 'submitted'
        assert submissions[0]['taskId'] == 'bt2'

    def test_push_merge_partial_list_leaves_stale_items_on_server(self, db):
        """push 部分列表时（条目被移除但无 delete），服务端残留旧条目（bug 复现）

        管理员离线通过赏金时从列表中移除了任务，但 ChangeLog 只包含剩余条目。
        push_merge 只能新增/更新，不能删除 —— 服务端旧条目残留。"""
        db.save_bounty_submissions('2025-06-15', [
            {'id': 'bs-a', 'taskId': 'bt_a', 'status': 'submitted',
             'startedAt': '2025-06-15T10:00:00', 'submittedAt': '2025-06-15T11:00:00',
             'uuid': 'bs-a', 'lastModified': '2025-06-15T11:00:00', 'isDeleted': False},
            {'id': 'bs-b', 'taskId': 'bt_b', 'status': 'submitted',
             'startedAt': '2025-06-15T10:00:00', 'submittedAt': '2025-06-15T11:00:00',
             'uuid': 'bs-b', 'lastModified': '2025-06-15T11:00:00', 'isDeleted': False},
        ])

        changes = [{
            'type': 'update',
            'uuid': 'bs-a',
            'data': {
                'id': 'bs-a', 'taskId': 'bt_a', 'status': 'submitted',
                'startedAt': '2025-06-15T10:00:00', 'submittedAt': '2025-06-15T11:00:00',
                'date': '2025-06-15', 'uuid': 'bs-a',
                'lastModified': '2025-06-15T12:00:00', 'isDeleted': False,
            },
            'timestamp': '2025-06-15T12:00:00',
        }]

        db.push_merge(changes)

        submissions = db.get_bounty_submissions('2025-06-15')
        assert len(submissions) == 2, \
            f'bs-b 无 delete 条目，仍残留在服务端，实际: {len(submissions)} 条'

    def test_push_merge_delete_removes_item_from_date_keyed_list(self, db):
        """push_merge 收到 delete 条目后应正确移除 DATE_KEY_TABLES 列表项"""
        db.save_bounty_submissions('2025-06-15', [
            {'id': 'bs-c', 'taskId': 'bt_c', 'status': 'submitted',
             'startedAt': '2025-06-15T10:00:00', 'submittedAt': '2025-06-15T11:00:00',
             'uuid': 'bs-c', 'lastModified': '2025-06-15T11:00:00', 'isDeleted': False},
            {'id': 'bs-d', 'taskId': 'bt_d', 'status': 'submitted',
             'startedAt': '2025-06-15T10:00:00', 'submittedAt': '2025-06-15T11:00:00',
             'uuid': 'bs-d', 'lastModified': '2025-06-15T11:00:00', 'isDeleted': False},
        ])

        changes = [
            {
                'type': 'update',
                'uuid': 'bs-c',
                'data': {
                    'id': 'bs-c', 'taskId': 'bt_c', 'status': 'submitted',
                    'startedAt': '2025-06-15T10:00:00', 'submittedAt': '2025-06-15T11:00:00',
                    'date': '2025-06-15', 'uuid': 'bs-c',
                    'lastModified': '2025-06-15T12:00:00', 'isDeleted': False,
                },
                'timestamp': '2025-06-15T12:00:00',
            },
            {
                'type': 'delete',
                'uuid': 'bs-d',
                'data': {
                    'id': 'bs-d', 'taskId': 'bt_d', 'status': 'submitted',
                    'startedAt': '2025-06-15T10:00:00', 'submittedAt': '2025-06-15T11:00:00',
                    'date': '2025-06-15', 'uuid': 'bs-d',
                    'lastModified': '2025-06-15T13:00:00', 'isDeleted': True,
                },
                'timestamp': '2025-06-15T13:00:00',
            },
        ]

        db.push_merge(changes)

        submissions = db.get_bounty_submissions('2025-06-15')
        assert len(submissions) == 1, f'get 过滤 isDeleted，应只剩 1 条，实际: {len(submissions)}'
        assert submissions[0]['id'] == 'bs-c'

    def test_push_merge_match_by_taskId_when_no_uuid_on_server(self, db):
        """旧数据无 uuid 时，push_merge 应通过 taskId 匹配而非重复追加

        服务端旧数据可能没有 uuid（ensureSyncFields 旧版未生成）。
        _find_by_uuid 只匹配 uuid/id，taskId 匹配不上 → append 重复条目。"""
        db.save_bounty_submissions('2025-06-15', [
            {'taskId': 'bt_old', 'status': 'doing',
             'startedAt': '2025-06-15T10:00:00', 'submittedAt': None},
        ])

        changes = [{
            'type': 'update',
            'uuid': 'uuid-from-new-client',
            'data': {
                'taskId': 'bt_old', 'status': 'submitted',
                'startedAt': '2025-06-15T10:00:00', 'submittedAt': '2025-06-15T11:00:00',
                'date': '2025-06-15', 'uuid': 'uuid-from-new-client',
                'lastModified': '2025-06-15T11:00:00', 'isDeleted': False,
            },
            'timestamp': '2025-06-15T11:00:00',
        }]

        db.push_merge(changes)

        submissions = db.get_bounty_submissions('2025-06-15')
        assert len(submissions) == 1, \
            f'应通过 taskId 匹配更新而非重复追加，实际: {len(submissions)} 条'
        assert submissions[0]['status'] == 'submitted'
        assert submissions[0].get('uuid') == 'uuid-from-new-client'

    def test_push_merge_bounty_completions_not_classified(self, db):
        """bounty_completions 数据（task ID 做 key）未被 _classify_change 识别（bug 复现）

        completions 格式为 {bt1: 3, uuid, lastModified, ...}，没有字面量 key 'taskId'。
        _classify_change 中 'taskId' in data 永远不匹配 → 分类为 None → 静默丢弃。"""
        db.save_bounty_completions('_total', {'bt_test': 1})

        changes = [{
            'type': 'update',
            'uuid': 'comp-uuid-1',
            'data': {
                'bt_test': 2,
                'uuid': 'comp-uuid-1',
                'date': '_total',
                'lastModified': '2025-06-15T10:00:00',
                'isDeleted': False,
            },
            'timestamp': '2025-06-15T10:00:00',
        }]

        db.push_merge(changes)

        completions = db.get_bounty_completions('_total')
        assert completions.get('bt_test') == 1, \
            f'completions 未被分类，增量更新被丢弃，bt_test 应仍为 1，实际: {completions.get("bt_test")}'

    def test_push_merge_bounty_completions_with_marker_works(self, db):
        """修复后：带 _table 标记的 completions 数据应被正确分类并合并"""
        db.save_bounty_completions('_total', {'bt_fix': 1})

        changes = [{
            'type': 'update',
            'uuid': 'comp-uuid-2',
            'data': {
                'bt_fix': 5,
                'uuid': 'comp-uuid-2',
                'date': '_total',
                '_table': 'bounty_completions',
                'lastModified': '2025-06-15T10:00:00',
                'isDeleted': False,
            },
            'timestamp': '2025-06-15T10:00:00',
        }]

        db.push_merge(changes)

        completions = db.get_bounty_completions('_total')
        assert completions.get('bt_fix') == 5, \
            f'completions 应被正确合并，bt_fix 应为 5，实际: {completions.get("bt_fix")}'

    def test_push_merge_sequential_changes_same_item(self, db):
        """多次离线修改同一条目：ensureSyncFields 已刷新 lastModified 的正常路径"""
        with patch.object(db, '_reset_daily_shop_quantity', return_value=None):
            db.save_shop_items([{
                'id': 'item_x',
                'name': '测试商品',
                'cost': 10,
                'baseQuantity': 5,
                'remainingQuantity': 5,
                'lastModified': '2025-06-15T08:00:00',
                'isDeleted': False,
            }])

            changes = [
                {
                    'type': 'update',
                    'uuid': 'item_x',
                    'data': {
                        'id': 'item_x',
                        'name': '测试商品',
                        'cost': 10,
                        'baseQuantity': 5,
                        'remainingQuantity': 4,
                        'lastModified': '2025-06-15T09:00:00',
                        'isDeleted': False,
                    },
                    'timestamp': '2025-06-15T09:00:00',
                },
                {
                    'type': 'update',
                    'uuid': 'item_x',
                    'data': {
                        'id': 'item_x',
                        'name': '测试商品',
                        'cost': 10,
                        'baseQuantity': 5,
                        'remainingQuantity': 3,
                        'lastModified': '2025-06-15T10:00:00',
                        'isDeleted': False,
                    },
                    'timestamp': '2025-06-15T10:00:00',
                },
            ]

            db.push_merge(changes)

            items = db.get_shop_items()
            assert len(items) == 1
            assert items[0]['remainingQuantity'] == 3, \
                f'两次修改后剩余数量应为 3，实际为 {items[0]["remainingQuantity"]}'

    def test_push_merge_safety_net_for_old_client_stale_timestamps(self, db):
        """安全网：旧客户端 lastModified 未刷新时，>= 保证后到达的变更生效

        模拟旧版 ensureSyncFields（只在缺失时设 lastModified）产生的数据：
        两次离线变更带着相同的时间戳进入 push_merge。
        主保险在 ensureSyncFields 每次都刷时间戳，此处 >= 作为安全网兜底。"""
        with patch.object(db, '_reset_daily_shop_quantity', return_value=None):
            db.save_shop_items([{
                'id': 'item_y',
                'name': '测试商品B',
                'cost': 10,
                'baseQuantity': 5,
                'remainingQuantity': 5,
                'lastModified': '2025-06-15T08:00:00',
                'isDeleted': False,
            }])

            changes = [
                {
                    'type': 'update',
                    'uuid': 'item_y',
                    'data': {
                        'id': 'item_y',
                        'name': '测试商品B',
                        'cost': 10,
                        'baseQuantity': 5,
                        'remainingQuantity': 4,
                        'lastModified': '2025-06-15T08:00:00',
                        'isDeleted': False,
                    },
                    'timestamp': '2025-06-15T10:00:00',
                },
                {
                    'type': 'update',
                    'uuid': 'item_y',
                    'data': {
                        'id': 'item_y',
                        'name': '测试商品B',
                        'cost': 10,
                        'baseQuantity': 5,
                        'remainingQuantity': 3,
                        'lastModified': '2025-06-15T08:00:00',
                        'isDeleted': False,
                    },
                    'timestamp': '2025-06-15T10:05:00',
                },
            ]

            db.push_merge(changes)

            items = db.get_shop_items()
            assert len(items) == 1
            assert items[0]['remainingQuantity'] == 3, \
                f'旧客户端两次购买（相同 lastModified）后剩余数量应为 3，实际为 {items[0]["remainingQuantity"]}'


class TestSaveFunctionsTriggerRecordModification:
    def test_save_homeworks_triggers_record_modification(self, db):
        db.save_homeworks('2025-06-15', [{'id': 'hw1', 'subject': 'math'}])

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('homeworks', '2025-06-15')
        ).fetchone()
        assert row is not None
        assert row['table_name'] == 'homeworks'
        assert row['record_key'] == '2025-06-15'
        assert row['last_modified'] is not None

    def test_save_settlement_triggers_record_modification(self, db):
        db.save_settlement('2025-06-15', {'dailyBase': 50, 'rating': '优'})

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('daily_settlement', '2025-06-15')
        ).fetchone()
        assert row is not None
        assert row['last_modified'] is not None

    def test_save_free_time_triggers_record_modification(self, db):
        db.save_free_time('2025-06-15', [{'id': 'ft1', 'name': '玩游戏'}])

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('free_time_tasks', '2025-06-15')
        ).fetchone()
        assert row is not None

    def test_save_shop_items_triggers_record_modification(self, db):
        db.save_shop_items([{'id': 's1', 'name': '奖品', 'cost': 10}])

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('shop_items', '1')
        ).fetchone()
        assert row is not None

    def test_save_redemptions_triggers_record_modification(self, db):
        db.save_redemptions([{'id': 'r1', 'itemId': 's1', 'status': 'pending'}])

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('redemptions', '1')
        ).fetchone()
        assert row is not None

    def test_save_reward_box_triggers_record_modification(self, db):
        db.save_reward_box([{'id': 'rb1', 'name': '神秘奖励', 'quantity': 1}])

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('reward_box', '1')
        ).fetchone()
        assert row is not None

    def test_save_settings_triggers_record_modification(self, db):
        db.save_settings({'dailyBasePoints': 80})

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('settings', '1')
        ).fetchone()
        assert row is not None

    def test_save_active_buffs_triggers_record_modification(self, db):
        db.save_active_buffs([{'id': 'b1', 'name': '双倍', 'duration': 30, 'unit': 'minutes'}])

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('active_buffs', '1')
        ).fetchone()
        assert row is not None

    def test_save_bounty_tasks_triggers_record_modification(self, db):
        db.save_bounty_tasks([{'id': 'bt1', 'name': '任务', 'points': 5}])

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('bounty_tasks', '1')
        ).fetchone()
        assert row is not None

    def test_save_bounty_submissions_triggers_record_modification(self, db):
        db.save_bounty_submissions('2025-06-15', [{'taskId': 'bt1', 'status': 'doing'}])

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('bounty_submissions', '2025-06-15')
        ).fetchone()
        assert row is not None

    def test_save_bounty_completions_triggers_record_modification(self, db):
        db.save_bounty_completions('2025-06-15', {'bt1': True})

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('bounty_completions', '2025-06-15')
        ).fetchone()
        assert row is not None

    def test_save_efficiency_triggers_record_modification(self, db):
        db.save_efficiency('2025-06-15', {'efficiencyRatio': 0.85})

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('efficiency_history', '2025-06-15')
        ).fetchone()
        assert row is not None
