package app.cortex.assistant

import android.app.Activity
import android.app.AlertDialog
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast

/** Bridges Android's explicit assist gesture to the existing island. */
class CortexAssistActivity : Activity() {
    private var handled = false

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus || handled) return
        handled = true
        if (intent.action != Intent.ACTION_ASSIST || !selected(this) || !CortexSchedule.screenReady(this)) {
            finish()
            return
        }

        if (!Settings.canDrawOverlays(this)) {
            AlertDialog.Builder(this)
                .setTitle("Разрешите показывать островок")
                .setMessage("Включите «Поверх других приложений» для CORTEX, затем вызовите помощника снова.")
                .setPositiveButton("Настройки") { _, _ ->
                    val permission = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))
                    runCatching { startActivity(permission) }
                        .recoverCatching { startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION)) }
                        .onFailure { showMessage("Не удалось открыть разрешения Android.") }
                    finish()
                }
                .setNegativeButton("Позже") { _, _ -> finish() }
                .setOnCancelListener { finish() }
                .show()
            return
        }

        val allowed = CortexIslandService.allowedInOrientation(this)
        if (allowed) {
            runCatching {
                startForegroundService(Intent(this, CortexIslandService::class.java)
                    .setAction(CortexIslandService.ACTION_SYSTEM_ASSIST))
            }.onFailure { showMessage("Android не запустил островок.") }
        } else showMessage("Островок скрыт в альбомном режиме. Настройку можно изменить в «Вызове».")
        finish()
    }

    private fun showMessage(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()

    companion object {
        internal fun available(context: Context): Boolean =
            if (Build.VERSION.SDK_INT >= 29) context.getSystemService(RoleManager::class.java)
                ?.isRoleAvailable(RoleManager.ROLE_ASSISTANT) == true else true

        internal fun selected(context: Context): Boolean =
            if (Build.VERSION.SDK_INT >= 29) context.getSystemService(RoleManager::class.java)
                ?.isRoleHeld(RoleManager.ROLE_ASSISTANT) == true
            else Settings.Secure.getString(context.contentResolver, "assistant")?.substringBefore('/') == context.packageName
    }
}
