package app.cortex.assistant

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import androidx.test.platform.app.InstrumentationRegistry
import java.time.LocalDateTime
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class CortexScheduleDeviceTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val prefs = context.getSharedPreferences("cortex-schedule", 0)
    private var original: String? = null

    @Before fun isolateSchedule() = runBlocking(Dispatchers.Main) {
        original = prefs.getString("tasks", null)
        check(prefs.edit().remove("tasks").commit())
        CortexSchedule.initialize(context)
    }

    @After fun restoreSchedule() = runBlocking(Dispatchers.Main) {
        tasks().forEach { CortexSchedule.handle(context, it.getString("id"), "cancel") }
        check(prefs.edit().putString("tasks", original).commit())
    }

    @Test fun editReplacesAndroidAlarmAndRejectsItsPreviousIdentity() = runBlocking(Dispatchers.Main) {
        val time = LocalDateTime.now().plusMinutes(15).withNano(0).toString()
        val input = JSONObject().put("kind", "reminder").put("text", "Проверка первого будильника").put("local", time)
        assertTrue(CortexSchedule.save(context, input).ok)
        val first = tasks().single()
        assertNotNull(findAlarm(first))

        assertTrue(CortexSchedule.save(context, input.put("id", first.getString("id")).put("text", "Проверка нового будильника")).ok)
        val edited = tasks().single()
        assertEquals(first.getLong("at"), edited.getLong("at"))
        assertNotEquals(first.getString("occurrence"), edited.getString("occurrence"))
        assertNull(findAlarm(first))
        assertNotNull(findAlarm(edited))

        CortexSchedule.receive(context, event(first, "alarm"))
        assertEquals("Проверка нового будильника", tasks().single().getString("text"))
        assertNull(findAlarm(first))
    }

    @Test fun duplicateLegacyDeliveryAndStaleNotificationLeaveOneRecurrence() = runBlocking(Dispatchers.Main) {
        val legacy = fixture("legacy", "reminder", System.currentTimeMillis() - 60_000L).put("repeat", "daily")
        seed(legacy)
        val tick = event(legacy, "alarm")
        CortexSchedule.receive(context, tick)
        CortexSchedule.receive(context, tick)
        assertEquals(2, tasks().size)
        assertEquals(1, tasks().count { it.getString("status") == "scheduled" })

        val due = tasks().single { it.getString("id") == "legacy" }
        assertEquals("due", due.getString("status"))
        assertTrue(CortexSchedule.handle(context, due.getString("id"), "snooze").ok)
        CortexSchedule.receive(context, event(due, "complete"))
        assertEquals(2, tasks().count { it.getString("status") == "scheduled" })
        assertNotNull(findAlarm(tasks().single { it.getString("id") == "legacy" }))
    }

    @Test fun clockRecoveryHoldsMissedActionsAndRearmsReminders() = runBlocking(Dispatchers.Main) {
        val now = System.currentTimeMillis()
        val action = fixture("missed", "action", now - 1_000L)
        val reminder = fixture("unarmed", "reminder", now + 120_000L).put("status", "unarmed")
        seed(action, reminder)

        CortexSchedule.receive(context, Intent(Intent.ACTION_TIME_CHANGED))
        val held = tasks().single { it.getString("id") == "missed" }
        assertEquals("blocked", held.getString("status"))
        assertTrue(held.getString("detail").contains("Запустите поручение после проверки"))
        val rearmed = tasks().single { it.getString("id") == "unarmed" }
        assertEquals("scheduled", rearmed.getString("status"))
        assertNotNull(findAlarm(rearmed))
    }

    private fun seed(vararg values: JSONObject) {
        check(prefs.edit().putString("tasks", JSONArray(values.toList()).toString()).commit())
    }

    private fun fixture(id: String, kind: String, at: Long) = JSONObject().put("id", id).put("kind", kind)
        .put("text", "Проверка расписания").put("at", at).put("status", "scheduled")

    private fun tasks(): List<JSONObject> = CortexSchedule.list(context).let { list ->
        (0 until list.length()).map(list::getJSONObject)
    }

    private fun event(task: JSONObject, action: String): Intent {
        val uri = Uri.Builder().scheme("cortex-schedule").authority("task").appendPath(task.getString("id"))
        task.optString("occurrence").takeIf(String::isNotBlank)?.let(uri::appendPath)
        return Intent(context, CortexScheduleReceiver::class.java).setAction("cortex.scheduled.$action")
            .setData(uri.build()).putExtra("at", task.getLong("at"))
    }

    private fun findAlarm(task: JSONObject): PendingIntent? = PendingIntent.getBroadcast(context, 0,
        event(task, "alarm"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_NO_CREATE)
}
