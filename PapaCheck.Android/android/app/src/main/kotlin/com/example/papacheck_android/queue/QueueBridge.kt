package com.example.papacheck_android.queue

import android.content.Context
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import kotlinx.coroutines.*
import org.json.JSONObject

class QueueBridge(private val context: Context, private val scope: CoroutineScope) {

    private val CHANNEL = "com.example.papacheck_android/queue"
    private var _token: String? = null
    private var _baseUrl: String? = null
    private var _tenantId: String? = null

    fun register(flutterEngine: FlutterEngine) {
        val channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)

        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "enqueue" -> {
                    val json = call.argument<String>("operation")
                    if (json != null) {
                        scope.launch {
                            enqueue(json)
                        }
                        result.success(true)
                    } else {
                        result.error("INVALID_ARG", "operation is null", null)
                    }
                }
                "setAuth" -> {
                    _token = call.argument<String>("token")
                    _baseUrl = call.argument<String>("baseUrl")
                    _tenantId = call.argument<String>("tenantId")
                    result.success(true)
                }
                "getFailedOperations" -> {
                    val tenantId = _tenantId ?: run {
                        result.error("NO_AUTH", "tenantId not set", null)
                        return@setMethodCallHandler
                    }
                    scope.launch {
                        val db = AppDatabase.getInstance(context)
                        val failed = db.dao().getFailed(tenantId)
                        val ids = failed.map { it.id }
                        if (ids.isNotEmpty()) {
                            // 重置为 pending 并清空重试计数，等待下次入队重试
                            db.dao().resetFailedToPending(tenantId)
                            // 触发 WorkManager 重新处理
                            val token = _token ?: ""
                            val baseUrl = _baseUrl ?: ""
                            if (token.isNotEmpty() && baseUrl.isNotEmpty()) {
                                WriteQueueWorker.enqueue(context, tenantId, token, baseUrl)
                            }
                        }
                        result.success(ids)
                    }
                }
                else -> result.notImplemented()
            }
        }
    }

    private suspend fun enqueue(json: String) {
        try {
            val op = JSONObject(json)
            val id = op.optString("id", "")
            val table = op.optString("table", "")
            val resourceId = op.optString("resourceId", "")
            val opType = op.optString("type", "update")
            val tenantId = _tenantId ?: return

            val db = AppDatabase.getInstance(context)
            val dao = db.dao()

            val entity = WriteOperation(
                id = id,
                method = "POST",
                path = "/api/sync/write",
                body = json,
                table = table,
                resourceId = resourceId,
                opType = opType,
                tenantId = tenantId,
                createdAt = System.currentTimeMillis()
            )
            dao.insert(entity)

            val token = _token ?: return
            val baseUrl = _baseUrl ?: return
            WriteQueueWorker.enqueue(context, tenantId, token, baseUrl)
        } catch (_: Exception) {
            // 非致命：入队失败由 H5 降级为直接 fetch
        }
    }
}
