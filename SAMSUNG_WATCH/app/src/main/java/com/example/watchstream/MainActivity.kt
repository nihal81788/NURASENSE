package com.example.watchstream

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.PowerManager
import android.util.Log
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.samsung.android.service.health.tracking.ConnectionListener
import com.samsung.android.service.health.tracking.HealthTracker
import com.samsung.android.service.health.tracking.HealthTrackerException
import com.samsung.android.service.health.tracking.HealthTrackingService
import com.samsung.android.service.health.tracking.data.DataPoint
import com.samsung.android.service.health.tracking.data.ExerciseType
import com.samsung.android.service.health.tracking.data.HealthTrackerType
import com.samsung.android.service.health.tracking.data.TrackerUserProfile
import com.samsung.android.service.health.tracking.data.ValueKey
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.math.sqrt

class MainActivity : ComponentActivity() {

    companion object {
        private const val TAG = "GalaxyStream"
        private const val DEFAULT_SERVER_URL = "http://127.0.0.1:8000/sensor-data"
        private const val DIRECT_WIFI_URL = "http://192.168.31.208:8000/sensor-data"
    }

    private val targetUrls = arrayOf(DEFAULT_SERVER_URL, DIRECT_WIFI_URL)
    private var activeUrlIndex = 0
    private var consecutiveFailures = 0
    private var serverUrl: String = DEFAULT_SERVER_URL
    private var wakeLock: PowerManager.WakeLock? = null

    // Samsung Health Tracking Service & Multi-Sensor Trackers
    private var healthTrackingService: HealthTrackingService? = null
    private var hrTracker: HealthTracker? = null
    private var sweatTracker: HealthTracker? = null
    private var accelTracker: HealthTracker? = null
    private var spo2Tracker: HealthTracker? = null
    private var tempTracker: HealthTracker? = null

    // Tracking states
    private var isHrTracking = false
    private var isSweatTracking = false
    private var isAccelTracking = false
    private var isSpo2Tracking = false
    private var isTempTracking = false
    private var isAllStreaming = false

    // OkHttp Client
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(2, TimeUnit.SECONDS)
        .writeTimeout(2, TimeUnit.SECONDS)
        .readTimeout(2, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    // UI elements
    private lateinit var tvStatus: TextView
    private lateinit var tvHeartRate: TextView
    private lateinit var tvIbi: TextView
    private lateinit var tvSpo2: TextView
    private lateinit var tvSpo2Status: TextView
    private lateinit var tvSkinTemp: TextView
    private lateinit var tvAmbientTemp: TextView
    private lateinit var tvAccelMagnitude: TextView
    private lateinit var tvAccelAxes: TextView
    private lateinit var tvSweatLoss: TextView
    private lateinit var tvSweatStatus: TextView

    private lateinit var btnStreamAll: Button
    private lateinit var btnToggleHr: Button
    private lateinit var btnToggleSpo2: Button
    private lateinit var btnToggleTemp: Button
    private lateinit var btnToggleAccel: Button
    private lateinit var btnToggleSweat: Button
    private lateinit var btnPing: Button

    // Accelerometer batch buffer to throttle network calls
    private val accelBatch = mutableListOf<JSONObject>()
    private var lastAccelSendTime = 0L

    // Permission launcher for BODY_SENSORS & ACTIVITY_RECOGNITION
    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val bodySensorsGranted = permissions[Manifest.permission.BODY_SENSORS] ?: false
        if (bodySensorsGranted) {
            Log.i(TAG, "Body sensors permission granted")
            connectHealthTrackingService()
        } else {
            Log.w(TAG, "Body sensors permission denied")
            tvStatus.text = "Permission Denied: BODY_SENSORS"
            Toast.makeText(this, "Body sensors permission required", Toast.LENGTH_LONG).show()
        }
    }

    // Samsung Health Connection Listener
    private val connectionListener = object : ConnectionListener {
        override fun onConnectionSuccess() {
            Log.i(TAG, "Connected to Samsung Health Tracking Service")
            runOnUiThread {
                tvStatus.text = "Service: Connected"
                tvStatus.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_green_light))
                setButtonsEnabled(true)
            }
            initTrackers()
            runOnUiThread {
                isAllStreaming = false
                Log.i(TAG, "Auto-starting all sensors upon connection...")
                toggleAllSensors()
            }
        }

        override fun onConnectionEnded() {
            Log.w(TAG, "Health Tracking Service connection ended")
            runOnUiThread {
                tvStatus.text = "Service: Disconnected"
                tvStatus.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_red_light))
            }
        }

        override fun onConnectionFailed(e: HealthTrackerException) {
            Log.e(TAG, "Health Tracking Service failed: ${e.message} (code=${e.errorCode})", e)
            runOnUiThread {
                tvStatus.text = "Failed: ${e.errorCode}"
                tvStatus.setTextColor(ContextCompat.getColor(this@MainActivity, android.R.color.holo_red_light))
            }
        }
    }

    // 1. Continuous Heart Rate & IBI Listener
    private val hrListener = object : HealthTracker.TrackerEventListener {
        override fun onDataReceived(dataPoints: MutableList<DataPoint>) {
            for (dp in dataPoints) {
                val hr = dp.getValue(ValueKey.HeartRateSet.HEART_RATE)
                val ibiList = dp.getValue(ValueKey.HeartRateSet.IBI_LIST)
                val hrStatus = dp.getValue(ValueKey.HeartRateSet.HEART_RATE_STATUS)
                val timestamp = dp.timestamp

                runOnUiThread {
                    if (hr != null && hr > 0) tvHeartRate.text = "$hr BPM"
                    if (!ibiList.isNullOrEmpty()) tvIbi.text = "IBI: ${ibiList.last()} ms (${ibiList.size} beats)"
                }

                val payload = JSONObject().apply {
                    put("type", "heart_rate")
                    put("timestamp", timestamp)
                    put("heartRate", hr ?: 0)
                    val ibiArray = JSONArray()
                    ibiList?.forEach { ibiArray.put(it) }
                    put("ibi", ibiArray)
                    put("hr_status", hrStatus ?: 0)
                }
                postSensorPayload(payload.toString())
            }
        }

        override fun onFlushCompleted() {}
        override fun onError(error: HealthTracker.TrackerError) {
            Log.e(TAG, "HR Tracker Error: $error")
        }
    }

    // 2. SpO2 Blood Oxygen Listener
    private val spo2Listener = object : HealthTracker.TrackerEventListener {
        override fun onDataReceived(dataPoints: MutableList<DataPoint>) {
            for (dp in dataPoints) {
                val spo2 = dp.getValue(ValueKey.SpO2Set.SPO2)
                val status = dp.getValue(ValueKey.SpO2Set.STATUS)
                val hr = dp.getValue(ValueKey.SpO2Set.HEART_RATE)
                val timestamp = dp.timestamp

                runOnUiThread {
                    if (spo2 != null && spo2 > 0) {
                        tvSpo2.text = "$spo2 %"
                    }
                    tvSpo2Status.text = "Status: $status (HR: $hr)"
                }

                val payload = JSONObject().apply {
                    put("type", "spo2")
                    put("timestamp", timestamp)
                    put("spo2", spo2 ?: 0)
                    put("spo2_status", status ?: 0)
                    if (hr != null && hr > 0) put("heartRate", hr)
                }
                postSensorPayload(payload.toString())
            }
        }

        override fun onFlushCompleted() {}
        override fun onError(error: HealthTracker.TrackerError) {
            Log.e(TAG, "SpO2 Tracker Error: $error")
        }
    }

    // 3. Skin Temperature Listener
    private val tempListener = object : HealthTracker.TrackerEventListener {
        override fun onDataReceived(dataPoints: MutableList<DataPoint>) {
            for (dp in dataPoints) {
                val objectTemp = dp.getValue(ValueKey.SkinTemperatureSet.OBJECT_TEMPERATURE)
                val ambientTemp = dp.getValue(ValueKey.SkinTemperatureSet.AMBIENT_TEMPERATURE)
                val status = dp.getValue(ValueKey.SkinTemperatureSet.STATUS)
                val timestamp = dp.timestamp

                runOnUiThread {
                    if (objectTemp != null) {
                        tvSkinTemp.text = String.format("%.1f °C", objectTemp)
                    }
                    if (ambientTemp != null) {
                        tvAmbientTemp.text = String.format("Ambient: %.1f °C", ambientTemp)
                    }
                }

                val payload = JSONObject().apply {
                    put("type", "skin_temperature")
                    put("timestamp", timestamp)
                    put("skin_temp", objectTemp?.toDouble() ?: 0.0)
                    put("ambient_temp", ambientTemp?.toDouble() ?: 0.0)
                    put("temp_status", status ?: 0)
                }
                postSensorPayload(payload.toString())
            }
        }

        override fun onFlushCompleted() {}
        override fun onError(error: HealthTracker.TrackerError) {
            Log.e(TAG, "Skin Temp Tracker Error: $error")
        }
    }

    // 4. 3-Axis Accelerometer Listener (Tremor & Motion Tracking)
    private val accelListener = object : HealthTracker.TrackerEventListener {
        override fun onDataReceived(dataPoints: MutableList<DataPoint>) {
            if (dataPoints.isEmpty()) return

            val now = System.currentTimeMillis()
            var latestX = 0
            var latestY = 0
            var latestZ = 0
            var latestMag = 0.0

            synchronized(accelBatch) {
                for (dp in dataPoints) {
                    val x = dp.getValue(ValueKey.AccelerometerSet.ACCELEROMETER_X) ?: 0
                    val y = dp.getValue(ValueKey.AccelerometerSet.ACCELEROMETER_Y) ?: 0
                    val z = dp.getValue(ValueKey.AccelerometerSet.ACCELEROMETER_Z) ?: 0
                    val mag = sqrt((x * x + y * y + z * z).toDouble())

                    latestX = x
                    latestY = y
                    latestZ = z
                    latestMag = mag

                    val sampleObj = JSONObject().apply {
                        put("x", x)
                        put("y", y)
                        put("z", z)
                        put("mag", mag)
                    }
                    accelBatch.add(sampleObj)
                }

                // Throttle transmission to ~5-10 Hz to prevent network congestion
                if (now - lastAccelSendTime >= 100 && accelBatch.isNotEmpty()) {
                    val batchToSend = JSONArray(accelBatch)
                    accelBatch.clear()
                    lastAccelSendTime = now

                    val payload = JSONObject().apply {
                        put("type", "accelerometer")
                        put("timestamp", now)
                        put("accel_x", latestX)
                        put("accel_y", latestY)
                        put("accel_z", latestZ)
                        put("accel_magnitude", latestMag)
                        put("accel_samples", batchToSend)
                    }
                    postSensorPayload(payload.toString())
                }
            }

            runOnUiThread {
                tvAccelMagnitude.text = String.format("|a|: %.2f m/s²", latestMag)
                tvAccelAxes.text = "X: $latestX  Y: $latestY  Z: $latestZ"
            }
        }

        override fun onFlushCompleted() {}
        override fun onError(error: HealthTracker.TrackerError) {
            Log.e(TAG, "Accel Tracker Error: $error")
        }
    }

    // 5. Sweat Loss (Running Workout Water Loss) Listener
    private val sweatLossListener = object : HealthTracker.TrackerEventListener {
        override fun onDataReceived(dataPoints: MutableList<DataPoint>) {
            for (dp in dataPoints) {
                val sweatLossMl = dp.getValue(ValueKey.SweatLossSet.SWEAT_LOSS)
                val status = dp.getValue(ValueKey.SweatLossSet.STATUS)
                val timestamp = dp.timestamp

                runOnUiThread {
                    if (sweatLossMl != null && sweatLossMl >= 0) {
                        tvSweatLoss.text = String.format("%.1f mL", sweatLossMl)
                    }
                    tvSweatStatus.text = "Status: ${formatSweatStatus(status)}"
                }

                val payload = JSONObject().apply {
                    put("type", "sweat_loss")
                    put("timestamp", timestamp)
                    put("sweat_loss", sweatLossMl?.toDouble() ?: 0.0)
                    put("sweat_status", status ?: 0)
                }
                postSensorPayload(payload.toString())
            }
        }

        override fun onFlushCompleted() {}
        override fun onError(error: HealthTracker.TrackerError) {
            Log.e(TAG, "Sweat Loss Tracker Error: $error")
            runOnUiThread { tvSweatStatus.text = "Error: $error" }
        }
    }

    private fun formatSweatStatus(status: Int?): String {
        return when (status) {
            0 -> "Tracking Running Workout"
            1 -> "Workout In Progress"
            -1 -> "Workout Not Started"
            -2 -> "Low Duration (<5m)"
            else -> "Active ($status)"
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        try {
            val powerManager = getSystemService(POWER_SERVICE) as? PowerManager
            wakeLock = powerManager?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GalaxyStream:WakeLock")
            wakeLock?.acquire(24 * 60 * 60 * 1000L)
            Log.i(TAG, "WakeLock acquired")
        } catch (e: Exception) {
            Log.w(TAG, "WakeLock acquisition failed: ${e.message}")
        }

        setContentView(R.layout.activity_main)

        initViews()
        requestPermissionsAndConnect()
    }

    override fun onResume() {
        super.onResume()
        if (hrTracker != null && !isAllStreaming) {
            runOnUiThread { toggleAllSensors() }
        }
    }

    private fun initViews() {
        tvStatus = findViewById(R.id.tvStatus)
        tvHeartRate = findViewById(R.id.tvHeartRate)
        tvIbi = findViewById(R.id.tvIbi)
        tvSpo2 = findViewById(R.id.tvSpo2)
        tvSpo2Status = findViewById(R.id.tvSpo2Status)
        tvSkinTemp = findViewById(R.id.tvSkinTemp)
        tvAmbientTemp = findViewById(R.id.tvAmbientTemp)
        tvAccelMagnitude = findViewById(R.id.tvAccelMagnitude)
        tvAccelAxes = findViewById(R.id.tvAccelAxes)
        tvSweatLoss = findViewById(R.id.tvSweatLoss)
        tvSweatStatus = findViewById(R.id.tvSweatStatus)

        btnStreamAll = findViewById(R.id.btnStreamAll)
        btnToggleHr = findViewById(R.id.btnToggleHr)
        btnToggleSpo2 = findViewById(R.id.btnToggleSpo2)
        btnToggleTemp = findViewById(R.id.btnToggleTemp)
        btnToggleAccel = findViewById(R.id.btnToggleAccel)
        btnToggleSweat = findViewById(R.id.btnToggleSweat)
        btnPing = findViewById(R.id.btnPing)

        setButtonsEnabled(false)

        btnStreamAll.setOnClickListener { toggleAllSensors() }
        btnToggleHr.setOnClickListener { toggleHr() }
        btnToggleSpo2.setOnClickListener { toggleSpo2() }
        btnToggleTemp.setOnClickListener { toggleTemp() }
        btnToggleAccel.setOnClickListener { toggleAccel() }
        btnToggleSweat.setOnClickListener { toggleSweat() }
        btnPing.setOnClickListener { testPing() }
    }

    private fun setButtonsEnabled(enabled: Boolean) {
        btnStreamAll.isEnabled = enabled
        btnToggleHr.isEnabled = enabled
        btnToggleSpo2.isEnabled = enabled
        btnToggleTemp.isEnabled = enabled
        btnToggleAccel.isEnabled = enabled
        btnToggleSweat.isEnabled = enabled
    }

    private fun requestPermissionsAndConnect() {
        val permissions = arrayOf(
            Manifest.permission.BODY_SENSORS,
            Manifest.permission.ACTIVITY_RECOGNITION
        )
        val missing = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (missing.isEmpty()) {
            connectHealthTrackingService()
        } else {
            permissionLauncher.launch(permissions)
        }
    }

    private fun connectHealthTrackingService() {
        try {
            tvStatus.text = "Connecting SDK..."
            healthTrackingService = HealthTrackingService(connectionListener, applicationContext)
            healthTrackingService?.connectService()
        } catch (e: Exception) {
            Log.e(TAG, "HealthTrackingService init failed: ${e.message}", e)
            tvStatus.text = "Init Error: ${e.message}"
        }
    }

    private fun initTrackers() {
        val capability = healthTrackingService?.trackingCapability
        val supportedTypes = capability?.supportHealthTrackerTypes ?: emptyList()
        Log.i(TAG, "Supported tracker types: $supportedTypes")

        try {
            // Heart Rate
            hrTracker = if (supportedTypes.contains(HealthTrackerType.HEART_RATE_CONTINUOUS)) {
                healthTrackingService?.getHealthTracker(HealthTrackerType.HEART_RATE_CONTINUOUS)
            } else {
                healthTrackingService?.getHealthTracker(HealthTrackerType.HEART_RATE)
            }

            // Sweat Loss (Lost water amount after running workout)
            sweatTracker = if (supportedTypes.contains(HealthTrackerType.SWEAT_LOSS)) {
                try {
                    val profile = TrackerUserProfile.Builder()
                        .setHeight(175f)
                        .setWeight(70f)
                        .setGender(1)
                        .setAge(25)
                        .build()
                    healthTrackingService?.getHealthTracker(
                        HealthTrackerType.SWEAT_LOSS,
                        profile,
                        ExerciseType.RUNNING
                    ) ?: healthTrackingService?.getHealthTracker(HealthTrackerType.SWEAT_LOSS)
                } catch (e: Exception) {
                    Log.w(TAG, "Sweat tracker fallback to default: ${e.message}")
                    healthTrackingService?.getHealthTracker(HealthTrackerType.SWEAT_LOSS)
                }
            } else null

            // Accelerometer
            accelTracker = if (supportedTypes.contains(HealthTrackerType.ACCELEROMETER_CONTINUOUS)) {
                healthTrackingService?.getHealthTracker(HealthTrackerType.ACCELEROMETER_CONTINUOUS)
            } else if (supportedTypes.contains(HealthTrackerType.ACCELEROMETER)) {
                healthTrackingService?.getHealthTracker(HealthTrackerType.ACCELEROMETER)
            } else null

            // SpO2
            spo2Tracker = if (supportedTypes.contains(HealthTrackerType.SPO2_ON_DEMAND)) {
                healthTrackingService?.getHealthTracker(HealthTrackerType.SPO2_ON_DEMAND)
            } else if (supportedTypes.contains(HealthTrackerType.SPO2)) {
                healthTrackingService?.getHealthTracker(HealthTrackerType.SPO2)
            } else null

            // Skin Temperature
            tempTracker = if (supportedTypes.contains(HealthTrackerType.SKIN_TEMPERATURE_CONTINUOUS)) {
                healthTrackingService?.getHealthTracker(HealthTrackerType.SKIN_TEMPERATURE_CONTINUOUS)
            } else if (supportedTypes.contains(HealthTrackerType.SKIN_TEMPERATURE_ON_DEMAND)) {
                healthTrackingService?.getHealthTracker(HealthTrackerType.SKIN_TEMPERATURE_ON_DEMAND)
            } else if (supportedTypes.contains(HealthTrackerType.SKIN_TEMPERATURE)) {
                healthTrackingService?.getHealthTracker(HealthTrackerType.SKIN_TEMPERATURE)
            } else null

            Log.i(TAG, "Trackers initialized: HR=$hrTracker, Sweat=$sweatTracker, Accel=$accelTracker, SpO2=$spo2Tracker, Temp=$tempTracker")
        } catch (e: Exception) {
            Log.e(TAG, "Error acquiring trackers: ${e.message}", e)
        }
    }

    private fun toggleAllSensors() {
        if (!isAllStreaming) {
            Log.i(TAG, "toggleAllSensors -> Starting all sensors")
            if (!isHrTracking) toggleHr()
            if (!isTempTracking) toggleTemp()
            if (!isAccelTracking) toggleAccel()
            if (!isSweatTracking) toggleSweat()
            isAllStreaming = (isHrTracking || isAccelTracking || isSweatTracking || isTempTracking)
            if (isAllStreaming) {
                btnStreamAll.text = "Stop All Sensors"
                btnStreamAll.setBackgroundColor(0xFFEF4444.toInt())
            }
        } else {
            Log.i(TAG, "toggleAllSensors -> Stopping all sensors")
            if (isHrTracking) toggleHr()
            if (isTempTracking) toggleTemp()
            if (isAccelTracking) toggleAccel()
            if (isSweatTracking) toggleSweat()
            if (isSpo2Tracking) toggleSpo2()
            isAllStreaming = false
            btnStreamAll.text = "Stream All Sensors"
            btnStreamAll.setBackgroundColor(0xFF06B6D4.toInt())
        }
    }

    private fun toggleHr() {
        if (!isHrTracking) {
            try {
                if (hrTracker == null) {
                    Log.w(TAG, "hrTracker is null")
                    return
                }
                hrTracker?.setEventListener(hrListener)
                isHrTracking = true
                btnToggleHr.text = "Stop HR"
                btnToggleHr.setBackgroundColor(0xFFEF4444.toInt())
                Log.i(TAG, "hrTracker listener set successfully")
            } catch (e: Exception) {
                Log.e(TAG, "Start HR failed: ${e.message}", e)
                Toast.makeText(this, "Start HR failed: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        } else {
            try { hrTracker?.unsetEventListener() } catch (_: Exception) {}
            isHrTracking = false
            btnToggleHr.text = "Start HR"
            btnToggleHr.setBackgroundColor(0xFF10B981.toInt())
            tvHeartRate.text = "-- BPM"
            tvIbi.text = "IBI: -- ms"
        }
    }

    private fun toggleSpo2() {
        if (!isSpo2Tracking) {
            try {
                if (spo2Tracker == null) {
                    Log.w(TAG, "spo2Tracker is null")
                    return
                }
                spo2Tracker?.setEventListener(spo2Listener)
                isSpo2Tracking = true
                btnToggleSpo2.text = "Stop SpO2"
                btnToggleSpo2.setBackgroundColor(0xFFEF4444.toInt())
                Toast.makeText(this, "Keep wrist still for SpO2", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Log.e(TAG, "Start SpO2 failed: ${e.message}", e)
                Toast.makeText(this, "Start SpO2 failed: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        } else {
            try { spo2Tracker?.unsetEventListener() } catch (_: Exception) {}
            isSpo2Tracking = false
            btnToggleSpo2.text = "Measure SpO2"
            btnToggleSpo2.setBackgroundColor(0xFF0284C7.toInt())
            tvSpo2.text = "-- %"
            tvSpo2Status.text = "Status: Idle"
        }
    }

    private fun toggleTemp() {
        if (!isTempTracking) {
            try {
                if (tempTracker == null) {
                    Log.w(TAG, "tempTracker is null")
                    return
                }
                tempTracker?.setEventListener(tempListener)
                isTempTracking = true
                btnToggleTemp.text = "Stop Temp"
                btnToggleTemp.setBackgroundColor(0xFFEF4444.toInt())
                Log.i(TAG, "tempTracker listener set successfully")
            } catch (e: Exception) {
                Log.e(TAG, "Start Temp failed: ${e.message}", e)
                Toast.makeText(this, "Start Temp failed: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        } else {
            try { tempTracker?.unsetEventListener() } catch (_: Exception) {}
            isTempTracking = false
            btnToggleTemp.text = "Start Temp"
            btnToggleTemp.setBackgroundColor(0xFFD97706.toInt())
            tvSkinTemp.text = "-- °C"
            tvAmbientTemp.text = "Ambient: -- °C"
        }
    }

    private fun toggleAccel() {
        if (!isAccelTracking) {
            try {
                if (accelTracker == null) {
                    Log.w(TAG, "accelTracker is null")
                    return
                }
                accelTracker?.setEventListener(accelListener)
                isAccelTracking = true
                btnToggleAccel.text = "Stop Accel"
                btnToggleAccel.setBackgroundColor(0xFFEF4444.toInt())
                Log.i(TAG, "accelTracker listener set successfully")
            } catch (e: Exception) {
                Log.e(TAG, "Start Accel failed: ${e.message}", e)
                Toast.makeText(this, "Start Accel failed: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        } else {
            try { accelTracker?.unsetEventListener() } catch (_: Exception) {}
            isAccelTracking = false
            btnToggleAccel.text = "Start Accel"
            btnToggleAccel.setBackgroundColor(0xFF059669.toInt())
            tvAccelMagnitude.text = "|a|: -- m/s²"
            tvAccelAxes.text = "X: 0  Y: 0  Z: 0"
        }
    }

    private fun toggleSweat() {
        if (!isSweatTracking) {
            try {
                if (sweatTracker == null) {
                    Log.w(TAG, "sweatTracker is null")
                    tvSweatStatus.text = "Sweat Tracker: Unsupported"
                    return
                }
                sweatTracker?.setEventListener(sweatLossListener)
                isSweatTracking = true
                btnToggleSweat.text = "Stop Sweat Loss"
                btnToggleSweat.setBackgroundColor(0xFFEF4444.toInt())
                tvSweatStatus.text = "Tracking Running Workout..."
                Log.i(TAG, "sweatTracker listener set successfully")
                Toast.makeText(this, "Sweat Loss tracker active", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Log.e(TAG, "Start Sweat Loss failed: ${e.message}", e)
                Toast.makeText(this, "Start Sweat Loss failed: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        } else {
            try { sweatTracker?.unsetEventListener() } catch (_: Exception) {}
            isSweatTracking = false
            btnToggleSweat.text = "Track Sweat Loss"
            btnToggleSweat.setBackgroundColor(0xFF0284C7.toInt())
            tvSweatStatus.text = "Status: Idle"
        }
    }

    private fun testPing() {
        val currentUrl = targetUrls[activeUrlIndex]
        val pingJson = JSONObject().apply {
            put("type", "ping")
            put("timestamp", System.currentTimeMillis())
            put("device", "Samsung Galaxy Watch FE")
            put("status", "connected")
            put("target_url", currentUrl)
        }.toString()

        val request = Request.Builder()
            .url(currentUrl)
            .post(pingJson.toRequestBody(jsonMediaType))
            .build()

        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                // Try next endpoint immediately
                activeUrlIndex = (activeUrlIndex + 1) % targetUrls.size
                val nextUrl = targetUrls[activeUrlIndex]
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Fail ($currentUrl). Switched -> $nextUrl", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onResponse(call: Call, response: Response) {
                response.close()
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Connected OK to $currentUrl", Toast.LENGTH_SHORT).show()
                }
            }
        })
    }

    private fun postSensorPayload(jsonString: String) {
        val currentUrl = targetUrls[activeUrlIndex]
        val body = jsonString.toRequestBody(jsonMediaType)
        val request = Request.Builder()
            .url(currentUrl)
            .post(body)
            .build()

        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                consecutiveFailures++
                if (consecutiveFailures >= 3) {
                    activeUrlIndex = (activeUrlIndex + 1) % targetUrls.size
                    consecutiveFailures = 0
                    Log.i(TAG, "Transmission fail. Auto-switched to: ${targetUrls[activeUrlIndex]}")
                }
            }
            override fun onResponse(call: Call, response: Response) {
                consecutiveFailures = 0
                response.close()
            }
        })
    }

    override fun onDestroy() {
        super.onDestroy()
        try {
            if (wakeLock?.isHeld == true) wakeLock?.release()
        } catch (_: Exception) {}
        try {
            if (isHrTracking) hrTracker?.unsetEventListener()
            if (isSweatTracking) sweatTracker?.unsetEventListener()
            if (isAccelTracking) accelTracker?.unsetEventListener()
            if (isSpo2Tracking) spo2Tracker?.unsetEventListener()
            if (isTempTracking) tempTracker?.unsetEventListener()
            healthTrackingService?.disconnectService()
        } catch (e: Exception) {
            Log.e(TAG, "Error cleaning up trackers: ${e.message}")
        }
    }
}
