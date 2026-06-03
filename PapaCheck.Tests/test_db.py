import json
import sqlite3
from unittest.mock import patch

import pytest


# Feature: 数据库初始化
class TestInitDB:
    ALL_TABLES = [
        'active_buffs', 'badges', 'bounty_completions',
        'bounty_submissions', 'bounty_tasks', 'daily_settlement',
        'efficiency_history', 'free_time_tasks', 'homeworks',
        'last_modified', 'meta', 'points', 'points_history',
        'redemptions', 'reward_box', 'settings', 'shop_items',
    ]

    @pytest.mark.parametrize('table_name', ALL_TABLES)
    # Feature: 数据库初始化
    #   Scenario: 初始化后所有必需表均已创建
    #     Given 数据库已初始化
    #     When 查询 sqlite_master 中的表列表
    #     Then 指定表名应存在于表列表中
    def test_table_exists(self, db, table_name):
        conn = db._mgr.get()
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        assert table_name in tables, f'table {table_name} should exist'

    # Feature: 数据库初始化
    #   Scenario: 初始化后积分余额默认为零
    #     Given 数据库已初始化
    #     When 查询 points 表的 balance 字段
    #     Then balance 应为 0
    def test_init_creates_points_with_zero_balance(self, db):
        conn = db._mgr.get()
        assert conn.execute(
            "SELECT balance FROM points WHERE id = 1"
        ).fetchone()['balance'] == 0

    # Feature: 数据库初始化
    #   Scenario: 初始化后商店商品列表默认为空
    #     Given 数据库已初始化
    #     When 查询 shop_items 表的 data 字段
    #     Then data 应为空列表
    def test_init_creates_empty_shop_items(self, db):
        conn = db._mgr.get()
        assert json.loads(conn.execute(
            "SELECT data FROM shop_items WHERE id = 1"
        ).fetchone()['data']) == []

    # Feature: 数据库初始化
    #   Scenario: 初始化后设置默认为空字典
    #     Given 数据库已初始化
    #     When 查询 settings 表的 data 字段
    #     Then data 应为空字典
    def test_init_creates_empty_settings(self, db):
        conn = db._mgr.get()
        assert json.loads(conn.execute(
            "SELECT data FROM settings WHERE id = 1"
        ).fetchone()['data']) == {}

    # Feature: 数据库初始化
    #   Scenario: 初始化后赏金任务列表默认为空
    #     Given 数据库已初始化
    #     When 查询 bounty_tasks 表的 data 字段
    #     Then data 应为空列表
    def test_init_creates_empty_bounty_tasks(self, db):
        conn = db._mgr.get()
        assert json.loads(conn.execute(
            "SELECT data FROM bounty_tasks WHERE id = 1"
        ).fetchone()['data']) == []

    # Feature: 数据库初始化
    #   Scenario: 重复调用 init_db 不会创建重复记录
    #     Given 数据库已初始化
    #     When 再次调用 init_db
    #     Then points 表中 id=1 的记录应只有一条
    def test_init_db_called_twice_creates_single_points_row(self, db):
        db.init_db()
        db.init_db()
        conn = db._mgr.get()
        count = conn.execute("SELECT COUNT(*) as c FROM points WHERE id = 1").fetchone()['c']
        assert count == 1


# Feature: 作业管理
class TestHomeworks:
    # Feature: 作业管理
    #   Scenario: 未保存作业时查询返回空列表
    #     Given 数据库已初始化且无作业数据
    #     When 查询指定日期的作业
    #     Then 返回空列表
    def test_get_homeworks_returns_empty_when_no_data(self, db, test_date):
        assert db.get_homeworks(test_date) == []

    # Feature: 作业管理
    #   Scenario: 保存作业后查询返回已保存的作业
    #     Given 数据库已初始化
    #     When 保存两条作业数据并查询
    #     Then 返回的列表包含两条作业且 id 正确
    def test_save_homeworks_then_get_returns_saved_items(self, db, test_date, sample_homeworks):
        db.save_homeworks(test_date, sample_homeworks)
        result = db.get_homeworks(test_date)
        assert len(result) == 2
        assert result[0]['id'] == 'hw1'
        assert result[1]['id'] == 'hw2'

    # Feature: 作业管理
    #   Scenario: 再次保存同一日期作业会覆盖之前的数据
    #     Given 数据库已保存两条作业
    #     When 再次保存一条作业到同一日期
    #     Then 查询结果只包含一条作业
    def test_save_homeworks_twice_overwrites_previous(self, db, test_date, sample_homeworks):
        db.save_homeworks(test_date, sample_homeworks)
        db.save_homeworks(test_date, [sample_homeworks[0]])
        result = db.get_homeworks(test_date)
        assert len(result) == 1

    # Feature: 作业管理
    #   Scenario: 移动作业到另一日期后两个日期数据正确
    #     Given 数据库已保存两条作业到指定日期
    #     When 将其中一条作业移动到另一日期
    #     Then 原日期剩一条作业，目标日期有一条作业，返回被移动的作业
    def test_move_homework_moves_item_to_target_date(self, db, test_date, sample_homeworks):
        db.save_homeworks(test_date, sample_homeworks)
        result = db.move_homework(test_date, '2025-06-16', 'hw1')
        assert result is not None
        assert result['id'] == 'hw1'
        assert len(db.get_homeworks(test_date)) == 1
        assert len(db.get_homeworks('2025-06-16')) == 1

    # Feature: 作业管理
    #   Scenario: 源日期无作业时移动返回 None
    #     Given 数据库中指定日期无作业数据
    #     When 尝试移动作业
    #     Then 返回 None
    def test_move_homework_returns_none_when_source_empty(self, db, test_date):
        result = db.move_homework(test_date, '2025-06-16', 'hw1')
        assert result is None

    # Feature: 作业管理
    #   Scenario: 移动不存在的作业 id 返回 None
    #     Given 数据库已保存作业但不含指定 id
    #     When 尝试移动不存在的作业 id
    #     Then 返回 None
    def test_move_homework_returns_none_when_id_not_found(self, db, test_date, sample_homeworks):
        db.save_homeworks(test_date, sample_homeworks)
        result = db.move_homework(test_date, '2025-06-16', 'nonexistent')
        assert result is None


# Feature: 积分管理
class TestPoints:
    # Feature: 积分管理
    #   Scenario: 初始状态下积分余额为零
    #     Given 数据库已初始化
    #     When 查询积分余额
    #     Then 余额为 0
    def test_get_points_balance_returns_zero_initially(self, db):
        assert db.get_points_balance() == 0

    # Feature: 积分管理
    #   Scenario: 赚取积分后余额增加
    #     Given 数据库已初始化且余额为 0
    #     When 赚取 10 积分
    #     Then 返回新余额 10 且查询余额为 10
    def test_earn_points_increases_balance(self, db):
        result = db.update_points('earn', 10, '完成语文作业')
        assert result == 10
        assert db.get_points_balance() == 10

    # Feature: 积分管理
    #   Scenario: 消费积分后余额减少
    #     Given 数据库已有 50 积分
    #     When 消费 20 积分
    #     Then 返回新余额 30 且查询余额为 30
    def test_spend_points_decreases_balance(self, db):
        db.update_points('earn', 50, '初始积分')
        result = db.update_points('spend', 20, '兑换奖励')
        assert result == 30
        assert db.get_points_balance() == 30

    # Feature: 积分管理
    #   Scenario: 多次积分操作后余额累计正确
    #     Given 数据库已初始化
    #     When 赚取 10、再赚取 15、再消费 5
    #     Then 余额为 20
    def test_multiple_points_operations_accumulate_correctly(self, db):
        db.update_points('earn', 10, '第一次')
        db.update_points('earn', 15, '第二次')
        db.update_points('spend', 5, '消费')
        assert db.get_points_balance() == 20

    # Feature: 积分管理
    #   Scenario: 赚取零积分不影响余额
    #     Given 数据库已初始化且余额为 0
    #     When 赚取 0 积分
    #     Then 余额仍为 0
    def test_earn_zero_points_leaves_balance_unchanged(self, db):
        db.update_points('earn', 0, '零值加分')
        assert db.get_points_balance() == 0

    # Feature: 积分管理
    #   Scenario: 赚取积分后历史记录包含对应条目
    #     Given 数据库已初始化
    #     When 赚取 10 积分
    #     Then 积分历史包含一条记录，earned 为 10，spent 为 0，balance 为 10
    def test_earn_points_records_history_entry(self, db):
        db.update_points('earn', 10, '完成作业')
        data = db.get_full_data()
        history = data['points']['history']
        assert len(history) == 1
        assert history[0]['earned'] == 10
        assert history[0]['spent'] == 0
        assert history[0]['balance'] == 10

    # Feature: 积分管理
    #   Scenario: 重置积分后余额归零且历史清空
    #     Given 数据库已有 100 积分和历史记录
    #     When 调用 reset_points
    #     Then 余额为 0 且历史为空
    def test_reset_points_clears_balance_and_history(self, db):
        db.update_points('earn', 100, '测试积分')
        db.reset_points()
        assert db.get_points_balance() == 0
        data = db.get_full_data()
        assert len(data['points']['history']) == 0


# Feature: 每日结算
class TestSettlement:
    # Feature: 每日结算
    #   Scenario: 未保存结算时查询返回 None
    #     Given 数据库已初始化且无结算数据
    #     When 查询指定日期的结算
    #     Then 返回 None
    def test_get_settlement_returns_none_when_no_data(self, db, test_date):
        assert db.get_settlement(test_date) is None

    # Feature: 每日结算
    #   Scenario: 保存结算后查询返回已保存的数据
    #     Given 数据库已初始化
    #     When 保存结算数据并查询
    #     Then 返回的结算数据字段值正确
    def test_save_settlement_then_get_returns_saved_data(self, db, test_date):
        settlement = {'dailyBase': 50, 'homeworkBonus': 20, 'rating': '优'}
        db.save_settlement(test_date, settlement)
        result = db.get_settlement(test_date)
        assert result['dailyBase'] == 50
        assert result['rating'] == '优'


# Feature: 商店商品管理
class TestShopItems:
    # Feature: 商店商品管理
    #   Scenario: 初始状态下商店商品列表为空
    #     Given 数据库已初始化
    #     When 查询商店商品
    #     Then 返回空列表
    def test_get_shop_items_returns_empty_initially(self, db):
        assert db.get_shop_items() == []

    # Feature: 商店商品管理
    #   Scenario: 保存商店商品后查询返回已保存的商品
    #     Given 数据库已初始化
    #     When 保存一条商品数据并查询
    #     Then 返回列表包含一条商品且名称正确
    def test_save_shop_items_then_get_returns_saved_items(self, db):
        items = [
            {'id': 's1', 'name': '看动画30分钟', 'cost': 10, 'type': 'time', 'baseQuantity': 3, 'remainingQuantity': 3},
        ]
        db.save_shop_items(items)
        result = db.get_shop_items()
        assert len(result) == 1
        assert result[0]['name'] == '看动画30分钟'


# Feature: 兑换记录管理
class TestRedemptions:
    # Feature: 兑换记录管理
    #   Scenario: 保存兑换记录后查询返回已保存的记录
    #     Given 数据库已初始化且兑换记录为空
    #     When 保存一条兑换记录并查询
    #     Then 返回列表包含一条记录且状态正确
    def test_save_redemptions_then_get_returns_saved_items(self, db):
        assert db.get_redemptions() == []
        items = [{'id': 'r1', 'itemId': 's1', 'status': 'pending'}]
        db.save_redemptions(items)
        result = db.get_redemptions()
        assert len(result) == 1
        assert result[0]['status'] == 'pending'


# Feature: 奖励宝箱管理
class TestRewardBox:
    # Feature: 奖励宝箱管理
    #   Scenario: 保存奖励宝箱物品后查询返回已保存的物品
    #     Given 数据库已初始化且奖励宝箱为空
    #     When 保存一条奖励宝箱物品并查询
    #     Then 返回列表包含一条物品
    def test_save_reward_box_items_then_get_returns_saved_items(self, db):
        assert db.get_reward_box() == []
        items = [{'id': 'rb1', 'name': '神秘奖励', 'quantity': 1}]
        db.save_reward_box(items)
        result = db.get_reward_box()
        assert len(result) == 1


# Feature: 活跃增益管理
class TestActiveBuffs:
    # Feature: 活跃增益管理
    #   Scenario: 保存活跃增益后查询返回已保存的增益
    #     Given 数据库已初始化且无活跃增益
    #     When 保存一条活跃增益并查询
    #     Then 返回列表包含一条增益
    def test_save_active_buffs_then_get_returns_saved_buffs(self, db):
        assert db.get_active_buffs() == []
        buffs = [{'id': 'b1', 'name': '双倍积分', 'duration': 30, 'unit': 'minutes', 'startDate': '2025-06-15'}]
        db.save_active_buffs(buffs)
        result = db.get_active_buffs()
        assert len(result) == 1


# Feature: 设置管理
class TestSettings:
    # Feature: 设置管理
    #   Scenario: 初始状态下设置为空字典
    #     Given 数据库已初始化
    #     When 查询设置
    #     Then 返回空字典
    def test_get_settings_returns_empty_dict_initially(self, db):
        assert db.get_settings() == {}

    # Feature: 设置管理
    #   Scenario: 保存设置后查询返回已保存的设置
    #     Given 数据库已初始化
    #     When 保存设置数据并查询
    #     Then 返回的设置数据字段值正确
    def test_save_settings_then_get_returns_saved_settings(self, db):
        settings = {'dailyBasePoints': 80, 'ratingMultipliers': {'优': 1.2}}
        db.save_settings(settings)
        result = db.get_settings()
        assert result['dailyBasePoints'] == 80


# Feature: 赏金任务管理
class TestBountyTasks:
    # Feature: 赏金任务管理
    #   Scenario: 初始状态下赏金任务列表为空
    #     Given 数据库已初始化
    #     When 查询赏金任务
    #     Then 返回空列表
    def test_get_bounty_tasks_returns_empty_initially(self, db):
        assert db.get_bounty_tasks() == []

    # Feature: 赏金任务管理
    #   Scenario: 保存赏金任务后查询返回已保存的任务
    #     Given 数据库已初始化
    #     When 保存两条赏金任务并查询
    #     Then 返回列表包含两条任务
    def test_save_bounty_tasks_then_get_returns_saved_tasks(self, db, sample_bounty_tasks):
        db.save_bounty_tasks(sample_bounty_tasks)
        result = db.get_bounty_tasks()
        assert len(result) == 2

    # Feature: 赏金任务管理
    #   Scenario: 保存赏金提交后查询返回已保存的提交
    #     Given 数据库已初始化
    #     When 保存一条赏金提交并查询
    #     Then 返回列表包含一条提交且状态正确
    def test_save_bounty_submissions_then_get_returns_them(self, db, test_date):
        submissions = [{'taskId': 'bt1', 'status': 'doing', 'startedAt': '2025-06-15T10:00:00', 'submittedAt': None}]
        db.save_bounty_submissions(test_date, submissions)
        result = db.get_bounty_submissions(test_date)
        assert len(result) == 1
        assert result[0]['status'] == 'doing'

    # Feature: 赏金任务管理
    #   Scenario: 未保存赏金提交时查询返回空列表
    #     Given 数据库已初始化且无赏金提交数据
    #     When 查询指定日期的赏金提交
    #     Then 返回空列表
    def test_get_bounty_submissions_returns_empty_initially(self, db, test_date):
        assert db.get_bounty_submissions(test_date) == []

    # Feature: 赏金任务管理
    #   Scenario: 查询赏金提交时过滤已删除条目
    #     Given 数据库已保存两条赏金提交，其中一条标记为 isDeleted
    #     When 查询赏金提交
    #     Then 返回列表只包含未删除的条目
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

    # Feature: 赏金任务管理
    #   Scenario: 保存赏金完成记录后查询返回已保存的记录
    #     Given 数据库已初始化
    #     When 保存赏金完成记录并查询
    #     Then 返回的完成记录与保存的一致
    def test_save_bounty_completions_then_get_returns_them(self, db, test_date):
        completions = {'bt1': True}
        db.save_bounty_completions(test_date, completions)
        result = db.get_bounty_completions(test_date)
        assert result == {'bt1': True}

    # Feature: 赏金任务管理
    #   Scenario: 未保存赏金完成记录时查询返回空字典
    #     Given 数据库已初始化且无赏金完成记录
    #     When 查询指定日期的赏金完成记录
    #     Then 返回空字典
    def test_get_bounty_completions_returns_empty_initially(self, db, test_date):
        assert db.get_bounty_completions(test_date) == {}

    # Feature: 赏金任务管理
    #   Scenario: 重置日期后赏金总完成次数仍然保留
    #     Given 数据库已保存赏金任务、总完成次数和当日提交
    #     When 重置当日数据
    #     Then _total 键的完成次数不受影响
    def test_bounty_total_key_persists_after_reset_date(self, db, test_date, sample_bounty_tasks):
        db.save_bounty_tasks(sample_bounty_tasks)
        db.save_bounty_completions('_total', {'bt1': 3})
        db.save_bounty_submissions(test_date, [{'taskId': 'bt1', 'status': 'doing'}])
        db.reset_date(test_date)
        result = db.get_bounty_completions('_total')
        assert result == {'bt1': 3}


# Feature: 效率记录管理
class TestEfficiency:
    # Feature: 效率记录管理
    #   Scenario: 保存效率数据后查询返回已保存的数据
    #     Given 数据库已初始化
    #     When 保存效率数据并查询
    #     Then 返回的效率数据字段值正确
    def test_save_efficiency_then_get_returns_saved_data(self, db, test_date):
        data = {'efficiencyRatio': 0.85, 'totalTime': 45}
        db.save_efficiency(test_date, data)
        result = db.get_efficiency(test_date)
        assert result['efficiencyRatio'] == 0.85

    # Feature: 效率记录管理
    #   Scenario: 未保存效率数据时查询返回 None
    #     Given 数据库已初始化且无效率数据
    #     When 查询指定日期的效率数据
    #     Then 返回 None
    def test_get_efficiency_returns_none_when_no_data(self, db, test_date):
        assert db.get_efficiency(test_date) is None


# Feature: 自由时间管理
class TestFreeTime:
    # Feature: 自由时间管理
    #   Scenario: 保存自由时间任务后查询返回已保存的任务
    #     Given 数据库已初始化
    #     When 保存一条自由时间任务并查询
    #     Then 返回列表包含一条任务
    def test_save_free_time_tasks_then_get_returns_saved_tasks(self, db, test_date):
        tasks = [{'id': 'ft1', 'name': '玩游戏', 'duration': 30, 'status': 'done'}]
        db.save_free_time(test_date, tasks)
        result = db.get_free_time(test_date)
        assert len(result) == 1

    # Feature: 自由时间管理
    #   Scenario: 未保存自由时间任务时查询返回空列表
    #     Given 数据库已初始化且无自由时间数据
    #     When 查询指定日期的自由时间
    #     Then 返回空列表
    def test_get_free_time_returns_empty_initially(self, db, test_date):
        assert db.get_free_time(test_date) == []


# Feature: 全量数据导入导出
class TestFullDataImportExport:
    # Feature: 全量数据导入导出
    #   Scenario: 空数据库导出时返回默认值
    #     Given 数据库已初始化且无数据
    #     When 调用 get_full_data
    #     Then 积分余额为 0，作业为空字典，赏金任务为空列表
    def test_get_full_data_returns_defaults_when_empty(self, db):
        data = db.get_full_data()
        assert data['points']['balance'] == 0
        assert data['homeworks'] == {}
        assert data['bountyTasks'] == []

    # Feature: 全量数据导入导出
    #   Scenario: 导出数据包含已保存的作业
    #     Given 数据库已保存作业
    #     When 调用 get_full_data
    #     Then 导出数据中包含对应日期的两条作业
    def test_get_full_data_includes_saved_homeworks(self, db, test_date, sample_homeworks):
        db.save_homeworks(test_date, sample_homeworks)
        data = db.get_full_data()
        assert len(data['homeworks'][test_date]) == 2

    # Feature: 全量数据导入导出
    #   Scenario: 导出数据包含积分余额
    #     Given 数据库已赚取 20 积分
    #     When 调用 get_full_data
    #     Then 导出数据中积分余额为 20
    def test_get_full_data_includes_points_balance(self, db):
        db.update_points('earn', 20, '测试')
        data = db.get_full_data()
        assert data['points']['balance'] == 20

    # Feature: 全量数据导入导出
    #   Scenario: 导出后重新导入可恢复积分余额
    #     Given 数据库已赚取 50 积分
    #     When 导出数据、重置积分、再导入
    #     Then 积分余额恢复为 50
    def test_import_full_data_restores_points_balance(self, db):
        db.update_points('earn', 50, '测试积分')
        exported = db.get_full_data()

        db.reset_points()
        db.import_full_data(exported)

        assert db.get_points_balance() == 50

    # Feature: 全量数据导入导出
    #   Scenario: 导出后重新导入可恢复作业数据
    #     Given 数据库已保存两条作业
    #     When 导出数据、清空作业、再导入
    #     Then 作业数据恢复为两条
    def test_import_full_data_restores_homeworks(self, db, test_date, sample_homeworks):
        db.save_homeworks(test_date, sample_homeworks)
        exported = db.get_full_data()

        db.save_homeworks(test_date, [])
        db.import_full_data(exported)

        assert len(db.get_homeworks(test_date)) == 2

    # Feature: 全量数据导入导出
    #   Scenario: 导出后重新导入可恢复设置
    #     Given 数据库已保存设置
    #     When 导出数据、清空设置、再导入
    #     Then 设置数据恢复正确
    def test_import_full_data_restores_settings(self, db):
        db.save_settings({'dailyBasePoints': 80})
        exported = db.get_full_data()

        db.save_settings({})
        db.import_full_data(exported)

        assert db.get_settings()['dailyBasePoints'] == 80

    # Feature: 全量数据导入导出
    #   Scenario: 导入全量数据时保留赏金总完成次数
    #     Given 数据库已保存赏金任务和总完成次数
    #     When 导出数据、清空完成次数、再导入
    #     Then _total 键的完成次数恢复正确
    def test_import_full_data_preserves_bounty_total(self, db, sample_bounty_tasks):
        db.save_bounty_tasks(sample_bounty_tasks)
        db.save_bounty_completions('_total', {'bt1': 5})
        exported = db.get_full_data()

        db.save_bounty_completions('_total', {})
        db.import_full_data(exported)

        result = db.get_bounty_completions('_total')
        assert result == {'bt1': 5}


# Feature: 日期重置
class TestResetDate:
    # Feature: 日期重置
    #   Scenario: 重置日期后该日期作业被清空
    #     Given 数据库已保存指定日期的作业
    #     When 重置该日期
    #     Then 该日期的作业为空列表
    def test_reset_date_clears_homeworks(self, db, test_date, sample_homeworks):
        db.save_homeworks(test_date, sample_homeworks)
        db.reset_date(test_date)
        assert db.get_homeworks(test_date) == []

    # Feature: 日期重置
    #   Scenario: 重置日期后该日期结算被清除
    #     Given 数据库已保存指定日期的结算
    #     When 重置该日期
    #     Then 该日期的结算为 None
    def test_reset_date_clears_settlement(self, db, test_date):
        db.save_settlement(test_date, {'dailyBase': 50})
        db.reset_date(test_date)
        assert db.get_settlement(test_date) is None

    # Feature: 日期重置
    #   Scenario: 重置日期后该日期赏金提交被清空
    #     Given 数据库已保存指定日期的赏金提交
    #     When 重置该日期
    #     Then 该日期的赏金提交为空列表
    def test_reset_date_clears_bounty_submissions(self, db, test_date):
        db.save_bounty_submissions(test_date, [{'taskId': 'bt1', 'status': 'doing'}])
        db.reset_date(test_date)
        assert db.get_bounty_submissions(test_date) == []

    # Feature: 日期重置
    #   Scenario: 重置某日期不影响其他日期的数据
    #     Given 数据库已保存两个日期的作业
    #     When 重置其中一个日期
    #     Then 被重置日期的作业为空，另一日期的作业不受影响
    def test_reset_date_preserves_other_dates(self, db, test_date, sample_homeworks):
        other_date = '2025-06-16'
        db.save_homeworks(test_date, sample_homeworks)
        db.save_homeworks(other_date, [sample_homeworks[0]])
        db.reset_date(test_date)
        assert db.get_homeworks(test_date) == []
        assert len(db.get_homeworks(other_date)) == 1

    # Feature: 日期重置
    #   Scenario: 重置日期后活跃增益被清空
    #     Given 数据库已保存活跃增益
    #     When 重置增益对应的日期
    #     Then 活跃增益列表为空
    def test_reset_date_clears_active_buffs(self, db, test_date):
        buffs = [{'id': 'b1', 'name': '双倍积分', 'duration': 30, 'unit': 'minutes', 'startDate': test_date}]
        db.save_active_buffs(buffs)
        db.reset_date(test_date)
        result = db.get_active_buffs()
        assert len(result) == 0


# Feature: 数据库连接管理
class TestCloseConnection:
    # Feature: 数据库连接管理
    #   Scenario: 关闭数据库连接不抛出异常
    #     Given 数据库已初始化
    #     When 调用 close_connection
    #     Then 不抛出异常
    def test_close_connection(self, db):
        db.close_connection()


# Feature: 修改记录追踪
class TestRecordModification:
    # Feature: 修改记录追踪
    #   Scenario: 记录修改时插入新的时间戳条目
    #     Given 数据库已初始化
    #     When 调用 record_modification 记录一条修改
    #     Then last_modified 表中存在对应表名和记录键的条目且时间戳正确
    def test_record_modification_inserts_new_timestamp(self, db):
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

    # Feature: 修改记录追踪
    #   Scenario: 对同一记录再次记录修改时覆盖已有时间戳
    #     Given 数据库已记录一条修改时间戳
    #     When 对同一表名和记录键再次记录修改
    #     Then 时间戳被更新为新的值
    def test_record_modification_updates_existing_timestamp(self, db):
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


# Feature: 增量同步查询
class TestGetModifiedSince:
    # Feature: 增量同步查询
    #   Scenario: 查询指定时间后修改的记录
    #     Given 数据库已保存两条不同日期的作业并记录修改时间
    #     When 查询某个时间点之后的修改记录
    #     Then 只返回时间戳更晚的记录
    def test_get_modified_since_returns_only_newer_records(self, db):
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

    # Feature: 增量同步查询
    #   Scenario: 查询时间晚于所有记录时返回空列表
    #     Given 数据库已保存一条修改记录
    #     When 查询时间晚于该记录的时间戳
    #     Then 返回空列表
    def test_get_modified_since_returns_empty_when_none_newer(self, db):
        db.save_homeworks('2025-06-15', [{'id': 'hw1', 'subject': 'math'}])
        db.record_modification('homeworks', '2025-06-15', '2025-06-15T08:00:00')

        result = db.get_modified_since('2025-06-16T00:00:00')

        assert result == []

    # Feature: 增量同步查询
    #   Scenario: 查询时间与记录时间戳完全相同时不返回该记录
    #     Given 数据库已保存一条修改记录
    #     When 查询时间与该记录时间戳相同
    #     Then 返回空列表
    def test_get_modified_since_excludes_exact_timestamp_match(self, db):
        db.save_shop_items([{'id': 's1', 'name': 'item1'}])
        db.record_modification('shop_items', '1', '2025-06-15T10:00:00')

        result_exact = db.get_modified_since('2025-06-15T10:00:00')

        assert len(result_exact) == 0

    # Feature: 增量同步查询
    #   Scenario: 查询返回多个表的修改记录
    #     Given 数据库已保存作业和设置的修改记录
    #     When 查询早于所有记录的时间点
    #     Then 返回两个表的修改记录
    def test_get_modified_since_returns_records_from_multiple_tables(self, db):
        db.save_homeworks('2025-06-15', [{'id': 'hw1', 'subject': 'math'}])
        db.record_modification('homeworks', '2025-06-15', '2025-06-15T10:00:00')
        db.save_settings({'dailyBasePoints': 80})
        db.record_modification('settings', '1', '2025-06-15T10:30:00')

        result = db.get_modified_since('2025-06-14T00:00:00')

        assert len(result) == 2
        table_names = {r['table_name'] for r in result}
        assert table_names == {'homeworks', 'settings'}


# Feature: 推送合并（push_merge）
class TestPushMerge:
    # Feature: 推送合并（push_merge）
    #   Scenario: 推送创建类型的变更后新作业出现在数据库中
    #     Given 数据库已初始化
    #     When 推送一条 create 类型的作业变更
    #     Then 查询该日期作业返回新创建的作业
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

    # Feature: 推送合并（push_merge）
    #   Scenario: 推送较新的更新变更时覆盖旧数据
    #     Given 数据库已保存一条作业
    #     When 推送一条时间戳更晚的 update 变更
    #     Then 作业内容被更新为较新的值
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

    # Feature: 推送合并（push_merge）
    #   Scenario: 推送较旧的更新变更时忽略不覆盖
    #     Given 数据库已保存一条较新的作业
    #     When 推送一条时间戳更早的 update 变更
    #     Then 作业内容保持较新的值不变
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

    # Feature: 推送合并（push_merge）
    #   Scenario: 推送删除变更后作业被软删除
    #     Given 数据库已保存一条作业
    #     When 推送一条 delete 类型的变更
    #     Then 查询作业返回空列表，但数据库中记录标记为 isDeleted
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

    # Feature: 推送合并（push_merge）
    #   Scenario: 推送单行表（如 shop_items）的创建变更后数据正确写入
    #     Given 数据库已初始化
    #     When 推送一条 create 类型的商店商品变更
    #     Then 查询商店商品返回新创建的商品
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

    # Feature: 推送合并（push_merge）
    #   Scenario: 兑换记录不被误分类为赏金任务
    #     Given 数据库已初始化
    #     When 推送一条兑换记录变更
    #     Then 兑换记录写入 redemptions 表，赏金任务表不受影响
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

    # Feature: 推送合并（push_merge）
    #   Scenario: 旧数据无 uuid 字段时通过 id 匹配而非追加为新条目
    #     Given 数据库已保存一条无 uuid 的赏金任务
    #     When 推送一条带 uuid 的 update 变更（id 相同）
    #     Then 赏金任务数量不变且字段被更新
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

    # Feature: 推送合并（push_merge）
    #   Scenario: 自由时间变更不被误分类为赏金提交
    #     Given 数据库已保存自由时间任务
    #     When 推送一条自由时间的 update 变更
    #     Then 自由时间任务被正确更新，不被误判为 bounty_submissions
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

    # Feature: 推送合并（push_merge）
    #   Scenario: 推送积分变更后余额被正确更新
    #     Given 数据库已有 100 积分
    #     When 推送一条积分 update 变更（余额设为 50）
    #     Then 查询积分余额为 50
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

    # Feature: 推送合并（push_merge）
    #   Scenario: 赏金提交变更缺少 date 字段时被静默跳过
    #     Given 数据库已初始化
    #     When 推送一条无 date 字段的赏金提交 update 变更
    #     Then 赏金提交仍为空
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

    # Feature: 推送合并（push_merge）
    #   Scenario: 赏金提交变更带 date 字段时正确写入
    #     Given 数据库已初始化
    #     When 推送一条带 date 字段的赏金提交 update 变更
    #     Then 赏金提交被正确写入
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

    # Feature: 推送合并（push_merge）
    #   Scenario: 推送部分列表时无 delete 条目的旧条目残留在服务端
    #     Given 数据库已保存两条赏金提交
    #     When 推送只包含其中一条的 update 变更
    #     Then 另一条仍残留在服务端
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

    # Feature: 推送合并（push_merge）
    #   Scenario: 推送 delete 变更后从日期键列表中移除对应条目
    #     Given 数据库已保存两条赏金提交
    #     When 推送一条 update 和一条 delete 变更
    #     Then 查询结果只包含未被删除的条目
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

    # Feature: 推送合并（push_merge）
    #   Scenario: 服务端旧数据无 uuid 时通过 taskId 匹配而非重复追加
    #     Given 数据库已保存一条无 uuid 的赏金提交
    #     When 推送一条带 uuid 的 update 变更（taskId 相同）
    #     Then 赏金提交数量不变且状态被更新
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

    # Feature: 推送合并（push_merge）
    #   Scenario: bounty_completions 数据未被 _classify_change 识别时静默丢弃
    #     Given 数据库已保存赏金完成记录
    #     When 推送一条无 _table 标记的 completions 变更
    #     Then 完成记录值不变（增量更新被丢弃）
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

    # Feature: 推送合并（push_merge）
    #   Scenario: 带 _table 标记的 completions 数据被正确分类并合并
    #     Given 数据库已保存赏金完成记录
    #     When 推送一条带 _table=bounty_completions 标记的变更
    #     Then 完成记录被正确更新
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

    # Feature: 推送合并（push_merge）
    #   Scenario: 同一商品多次离线修改后最终值正确
    #     Given 数据库已保存一条商店商品
    #     When 推送两条对同一商品的 update 变更
    #     Then 商品剩余数量为最后一次修改的值
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

    # Feature: 推送合并（push_merge）
    #   Scenario: 旧客户端 lastModified 未刷新时后到达的变更仍生效
    #     Given 数据库已保存一条商店商品
    #     When 推送两条 lastModified 相同但 timestamp 不同的 update 变更
    #     Then 商品剩余数量为最后一次变更的值
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

    # Feature: 推送合并（push_merge）
    #   Scenario: 服务端旧数据无 uuid 时 delete 变更通过 taskId 匹配并标记 isDeleted
    #     Given 数据库已保存两条无 uuid 的赏金提交
    #     When 推送一条 update 和一条 delete 变更（delete 通过 taskId 匹配）
    #     Then 查询结果只包含未被删除的条目，数据库中 isDeleted 标记正确
    def test_push_merge_delete_bounty_submission_no_uuid_on_server(self, db):
        """离线审核后连线：服务端旧数据无 uuid，delete ChangeLog 应通过 taskId 匹配并标记 isDeleted

        复现 Bug：在线提交赏金任务时服务端存储的提交没有 uuid 字段，
        离线审核生成 delete ChangeLog（带本地 uuid），连线后 push_merge
        无法通过 uuid 匹配，但应通过 taskId 回退匹配并标记删除。"""
        db.save_bounty_submissions('2025-06-15', [
            {'taskId': 'bt_to_delete', 'status': 'submitted',
             'startedAt': '2025-06-15T10:00:00', 'submittedAt': '2025-06-15T11:00:00'},
            {'taskId': 'bt_keep', 'status': 'submitted',
             'startedAt': '2025-06-15T10:00:00', 'submittedAt': '2025-06-15T11:00:00'},
        ])

        changes = [
            {
                'type': 'update',
                'uuid': 'local-uuid-keep',
                'data': {
                    'taskId': 'bt_keep', 'status': 'submitted',
                    'startedAt': '2025-06-15T10:00:00', 'submittedAt': '2025-06-15T11:00:00',
                    'date': '2025-06-15', 'uuid': 'local-uuid-keep',
                    'lastModified': '2025-06-15T12:00:00', 'isDeleted': False,
                },
                'timestamp': '2025-06-15T12:00:00',
            },
            {
                'type': 'delete',
                'uuid': 'local-uuid-delete',
                'data': {
                    'taskId': 'bt_to_delete', 'status': 'submitted',
                    'startedAt': '2025-06-15T10:00:00', 'submittedAt': '2025-06-15T11:00:00',
                    'date': '2025-06-15', 'uuid': 'local-uuid-delete',
                    'lastModified': '2025-06-15T12:00:00', 'isDeleted': True,
                },
                'timestamp': '2025-06-15T12:00:00',
            },
        ]

        db.push_merge(changes)

        submissions = db.get_bounty_submissions('2025-06-15')
        assert len(submissions) == 1, \
            f'bt_to_delete 应被标记 isDeleted，只剩 1 条，实际: {len(submissions)}'
        assert submissions[0]['taskId'] == 'bt_keep'

        conn = db._mgr.get()
        raw = json.loads(conn.execute(
            "SELECT data FROM bounty_submissions WHERE date_key = ?", ('2025-06-15',)
        ).fetchone()['data'])
        assert len(raw) == 2
        deleted = [i for i in raw if i.get('taskId') == 'bt_to_delete']
        assert len(deleted) == 1
        assert deleted[0].get('isDeleted') is True

    # Feature: 推送合并（push_merge）
    #   Scenario: push_merge 遇到 data 为非 dict 类型时静默跳过不崩溃
    #     Given 数据库已保存一条赏金提交
    #     When 推送一条 data 为 list 的变更和一条 delete 变更
    #     Then list 类型变更被跳过，delete 变更正常执行
    def test_push_merge_non_dict_data_skipped(self, db):
        """push_merge 遇到 data 为 list 等非 dict 类型时静默跳过，不崩溃

        复现 Bug：ChangeLog 的 data 字段为 Array(1)（bounty_completions 常见），
        'list' object has no attribute 'get' 导致 push_merge 崩溃。"""
        db.save_bounty_submissions('2025-06-15', [
            {'taskId': 'bt_survivor', 'status': 'submitted',
             'startedAt': '2025-06-15T10:00:00', 'submittedAt': '2025-06-15T11:00:00'},
        ])

        changes = [
            {
                'type': 'update',
                'uuid': 'completions-uuid',
                'data': [{
                    'mptyexsoaspz8': 1,
                    'uuid': 'some-uuid',
                    'lastModified': '2025-06-15T10:00:00',
                    'isDeleted': False,
                    'date': '_total',
                    '_table': 'bounty_completions',
                }],
                'timestamp': '2025-06-15T12:00:00',
            },
            {
                'type': 'delete',
                'uuid': 'local-uuid-delete',
                'data': {
                    'taskId': 'bt_survivor', 'status': 'submitted',
                    'startedAt': '2025-06-15T10:00:00', 'submittedAt': '2025-06-15T11:00:00',
                    'date': '2025-06-15', 'uuid': 'local-uuid-delete',
                    'lastModified': '2025-06-15T12:00:00', 'isDeleted': True,
                },
                'timestamp': '2025-06-15T12:00:00',
            },
        ]

        db.push_merge(changes)

        submissions = db.get_bounty_submissions('2025-06-15')
        assert len(submissions) == 0, \
            f'data:Array(1) 条目被跳过不应影响 delete，bt_survivor 应被删除，实际: {len(submissions)}'


# Feature: 保存操作触发修改记录
class TestSaveFunctionsTriggerRecordModification:
    # Feature: 保存操作触发修改记录
    #   Scenario: 保存作业后 last_modified 表中存在对应记录
    #     Given 数据库已初始化
    #     When 保存一条作业
    #     Then last_modified 表中存在 homeworks 表对应日期的记录
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

    # Feature: 保存操作触发修改记录
    #   Scenario: 保存结算后 last_modified 表中存在对应记录
    #     Given 数据库已初始化
    #     When 保存一条结算数据
    #     Then last_modified 表中存在 daily_settlement 表对应日期的记录
    def test_save_settlement_triggers_record_modification(self, db):
        db.save_settlement('2025-06-15', {'dailyBase': 50, 'rating': '优'})

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('daily_settlement', '2025-06-15')
        ).fetchone()
        assert row is not None
        assert row['last_modified'] is not None

    # Feature: 保存操作触发修改记录
    #   Scenario: 保存自由时间后 last_modified 表中存在对应记录
    #     Given 数据库已初始化
    #     When 保存一条自由时间任务
    #     Then last_modified 表中存在 free_time_tasks 表对应日期的记录
    def test_save_free_time_triggers_record_modification(self, db):
        db.save_free_time('2025-06-15', [{'id': 'ft1', 'name': '玩游戏'}])

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('free_time_tasks', '2025-06-15')
        ).fetchone()
        assert row is not None

    # Feature: 保存操作触发修改记录
    #   Scenario: 保存商店商品后 last_modified 表中存在对应记录
    #     Given 数据库已初始化
    #     When 保存一条商店商品
    #     Then last_modified 表中存在 shop_items 表的记录
    def test_save_shop_items_triggers_record_modification(self, db):
        db.save_shop_items([{'id': 's1', 'name': '奖品', 'cost': 10}])

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('shop_items', '1')
        ).fetchone()
        assert row is not None

    # Feature: 保存操作触发修改记录
    #   Scenario: 保存兑换记录后 last_modified 表中存在对应记录
    #     Given 数据库已初始化
    #     When 保存一条兑换记录
    #     Then last_modified 表中存在 redemptions 表的记录
    def test_save_redemptions_triggers_record_modification(self, db):
        db.save_redemptions([{'id': 'r1', 'itemId': 's1', 'status': 'pending'}])

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('redemptions', '1')
        ).fetchone()
        assert row is not None

    # Feature: 保存操作触发修改记录
    #   Scenario: 保存奖励宝箱后 last_modified 表中存在对应记录
    #     Given 数据库已初始化
    #     When 保存一条奖励宝箱物品
    #     Then last_modified 表中存在 reward_box 表的记录
    def test_save_reward_box_triggers_record_modification(self, db):
        db.save_reward_box([{'id': 'rb1', 'name': '神秘奖励', 'quantity': 1}])

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('reward_box', '1')
        ).fetchone()
        assert row is not None

    # Feature: 保存操作触发修改记录
    #   Scenario: 保存设置后 last_modified 表中存在对应记录
    #     Given 数据库已初始化
    #     When 保存设置数据
    #     Then last_modified 表中存在 settings 表的记录
    def test_save_settings_triggers_record_modification(self, db):
        db.save_settings({'dailyBasePoints': 80})

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('settings', '1')
        ).fetchone()
        assert row is not None

    # Feature: 保存操作触发修改记录
    #   Scenario: 保存活跃增益后 last_modified 表中存在对应记录
    #     Given 数据库已初始化
    #     When 保存一条活跃增益
    #     Then last_modified 表中存在 active_buffs 表的记录
    def test_save_active_buffs_triggers_record_modification(self, db):
        db.save_active_buffs([{'id': 'b1', 'name': '双倍', 'duration': 30, 'unit': 'minutes'}])

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('active_buffs', '1')
        ).fetchone()
        assert row is not None

    # Feature: 保存操作触发修改记录
    #   Scenario: 保存赏金任务后 last_modified 表中存在对应记录
    #     Given 数据库已初始化
    #     When 保存一条赏金任务
    #     Then last_modified 表中存在 bounty_tasks 表的记录
    def test_save_bounty_tasks_triggers_record_modification(self, db):
        db.save_bounty_tasks([{'id': 'bt1', 'name': '任务', 'points': 5}])

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('bounty_tasks', '1')
        ).fetchone()
        assert row is not None

    # Feature: 保存操作触发修改记录
    #   Scenario: 保存赏金提交后 last_modified 表中存在对应记录
    #     Given 数据库已初始化
    #     When 保存一条赏金提交
    #     Then last_modified 表中存在 bounty_submissions 表对应日期的记录
    def test_save_bounty_submissions_triggers_record_modification(self, db):
        db.save_bounty_submissions('2025-06-15', [{'taskId': 'bt1', 'status': 'doing'}])

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('bounty_submissions', '2025-06-15')
        ).fetchone()
        assert row is not None

    # Feature: 保存操作触发修改记录
    #   Scenario: 保存赏金完成记录后 last_modified 表中存在对应记录
    #     Given 数据库已初始化
    #     When 保存一条赏金完成记录
    #     Then last_modified 表中存在 bounty_completions 表对应日期的记录
    def test_save_bounty_completions_triggers_record_modification(self, db):
        db.save_bounty_completions('2025-06-15', {'bt1': True})

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('bounty_completions', '2025-06-15')
        ).fetchone()
        assert row is not None

    # Feature: 保存操作触发修改记录
    #   Scenario: 保存效率数据后 last_modified 表中存在对应记录
    #     Given 数据库已初始化
    #     When 保存一条效率数据
    #     Then last_modified 表中存在 efficiency_history 表对应日期的记录
    def test_save_efficiency_triggers_record_modification(self, db):
        db.save_efficiency('2025-06-15', {'efficiencyRatio': 0.85})

        conn = db._mgr.get()
        row = conn.execute(
            "SELECT * FROM last_modified WHERE table_name = ? AND record_key = ?",
            ('efficiency_history', '2025-06-15')
        ).fetchone()
        assert row is not None
