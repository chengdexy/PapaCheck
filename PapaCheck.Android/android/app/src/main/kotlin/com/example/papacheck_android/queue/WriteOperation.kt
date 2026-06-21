package com.example.papacheck_android.queue

import androidx.room.*

@Entity(tableName = "write_operations")
data class WriteOperation(
    @PrimaryKey
    val id: String,
    val method: String,
    val path: String,
    val body: String,
    val table: String,
    val resourceId: String,
    val opType: String,
    val tenantId: String,
    val createdAt: Long,
    val attemptCount: Int = 0,
    val nextRetryAt: Long = 0,
    val status: String = "pending" // "pending" | "syncing" | "done" | "failed"
)

@Dao
interface WriteOperationDao {
    @Insert
    suspend fun insert(op: WriteOperation)

    @Query("SELECT * FROM write_operations WHERE status = 'pending' AND tenantId = :tenantId ORDER BY createdAt ASC")
    suspend fun getPending(tenantId: String): List<WriteOperation>

    @Update
    suspend fun update(op: WriteOperation)

    @Query("DELETE FROM write_operations WHERE id = :id")
    suspend fun delete(id: String)

    @Query("SELECT COUNT(*) FROM write_operations WHERE status = 'pending' AND tenantId = :tenantId")
    suspend fun pendingCount(tenantId: String): Int
}
