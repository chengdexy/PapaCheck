package com.example.papacheck_android.queue

import android.content.Context
import androidx.work.*

class WriteQueueWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        val tenantId = inputData.getString("tenantId") ?: return Result.failure()
        val token = inputData.getString("token") ?: return Result.failure()
        val baseUrl = inputData.getString("baseUrl") ?: return Result.failure()

        val db = AppDatabase.getInstance(applicationContext)
        val pending = db.dao().getPending(tenantId)
        val apiClient = ApiClient(applicationContext)

        for (op in pending) {
            try {
                val response = apiClient.post("$baseUrl/api/sync/write", op.body, token)
                if (response.isSuccessful) {
                    db.dao().delete(op.id)
                } else {
                    throw Exception("HTTP ${response.code}")
                }
            } catch (e: Exception) {
                if (runAttemptCount >= 5) {
                    db.dao().update(op.copy(status = "failed"))
                    return Result.failure()
                }
                return Result.retry()
            }
        }
        return Result.success()
    }

    companion object {
        fun enqueue(context: Context, tenantId: String, token: String, baseUrl: String) {
            val workRequest = OneTimeWorkRequestBuilder<WriteQueueWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    30,
                    java.util.concurrent.TimeUnit.SECONDS
                )
                .setInputData(
                    workDataOf(
                        "tenantId" to tenantId,
                        "token" to token,
                        "baseUrl" to baseUrl
                    )
                )
                .build()

            WorkManager.getInstance(context)
                .enqueueUniqueWork(
                    "write_queue_$tenantId",
                    ExistingWorkPolicy.REPLACE,
                    workRequest
                )
        }
    }
}
