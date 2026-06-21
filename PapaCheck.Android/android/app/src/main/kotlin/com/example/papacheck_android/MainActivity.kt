package com.example.papacheck_android

import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import com.example.papacheck_android.queue.QueueBridge
import kotlinx.coroutines.MainScope

class MainActivity : FlutterActivity() {
    private val scope = MainScope()
    private lateinit var queueBridge: QueueBridge

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        queueBridge = QueueBridge(this, scope)
        queueBridge.register(flutterEngine)
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::queueBridge.isInitialized) {
            // scope 会在 onDestroy 时自动清理协程
        }
    }
}
