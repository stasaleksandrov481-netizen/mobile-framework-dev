package app.cortex.assistant

import android.content.Intent
import android.content.ActivityNotFoundException
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.webkit.*
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.browser.auth.AuthTabIntent
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/** Re-created Android host compatible with the web assets shipped in CORTEX 0.8.6.
 * Original Android Kotlin sources are not embedded in the distribution APK.
 */
class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var server: CortexServerBridge
    private lateinit var device: CortexDeviceBridge
    private lateinit var speech: CortexSpeech
    private lateinit var island: CortexIslandBridge
    private lateinit var container: FrameLayout
    private var rendererFailed = false
    private var nativeReady = false
    private var pendingSchedule: String? = null
    private var pendingAuthReturn = false
    private val webUpdates by lazy { CortexWebUpdates(applicationContext) }
    private var webSnapshot = 0L
    private val leaveForAction: () -> Unit = { moveTaskToBack(true) }
    private val wakeCommand: (String) -> Boolean = { command ->
        val available = !rendererFailed && nativeReady && CortexRuntime.appVisible
        if (available) deviceEvent(JSONObject().put("type", "wake-command").put("text", command))
        available
    }
    private val authTab = AuthTabIntent.registerActivityResultLauncher(this) { result ->
        val uri = result.resultUri
        if (result.resultCode == AuthTabIntent.RESULT_OK && uri != null) authReturned(uri)
        else if (::webView.isInitialized) deviceEvent(JSONObject().put("type", "auth-tab-closed"))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pendingSchedule = intent.getStringExtra(CortexSchedule.EXTRA_TASK)
        CortexSchedule.initialize(applicationContext)
        if (cleanupStarted.compareAndSet(false, true)) {
            val context = applicationContext
            Thread({
                File(context.filesDir, "voices").deleteRecursively()
                context.deleteSharedPreferences("cortex-voices")
            }, "CortexStorageCleanup").start()
        }
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.decorView.isSoundEffectsEnabled = false
        container = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        val safeAreas = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
        ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
            val safe = insets.getInsets(safeAreas)
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(container)
        runCatching { createWebView(savedInstanceState) }
            .onFailure { showRendererError("Не удалось запустить системный WebView. Проверьте, что он включён и обновлён.") }
        intent.data?.let(::authReturned)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (rendererFailed) {
                    finish()
                    return
                }
                val activeView = webView
                activeView.evaluateJavascript("Boolean(window.cortexBack && window.cortexBack())") { handled ->
                    if (webView === activeView && !rendererFailed && handled != "true") finish()
                }
            }
        })
    }

    private fun createWebView(savedInstanceState: Bundle? = null) {
        rendererFailed = false
        nativeReady = false
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            showRendererError("Системный WebView слишком старый для защищённого подключения CORTEX к Android. Обновите или включите WebView и попробуйте снова.")
            return
        }
        webSnapshot = webUpdates.snapshot()
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/web/", webUpdates.handler(webSnapshot))
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        webUpdates.checkAsync()
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            isSoundEffectsEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                cacheMode = WebSettings.LOAD_NO_CACHE
                blockNetworkLoads = true  // All backend traffic uses the native HTTPS gateway.
                javaScriptCanOpenWindowsAutomatically = false
                setSupportMultipleWindows(false)
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = !isAsset(request.url)
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                    if (request.method == "GET" && isAsset(request.url)) {
                        loader.shouldInterceptRequest(request.url)?.let { return it }
                    }
                    return WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                }
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    if (view === webView) webUpdates.rollback(webSnapshot)
                    if (!rendererFailed && view === webView) showRendererError()
                    return true
                }
                override fun onPageFinished(view: WebView, url: String) {
                    if (webSnapshot <= 0 || view !== webView || !isAsset(Uri.parse(url))) return
                    view.postDelayed({
                        if (view !== webView || rendererFailed) return@postDelayed
                        view.evaluateJavascript("Boolean(document.getElementById('app') && document.getElementById('screen')?.children.length && typeof Cortex !== 'undefined' && typeof CortexApi !== 'undefined' && window.CortexSetup)") { healthy ->
                            if (view === webView && !rendererFailed && healthy != "true" && webUpdates.rollback(webSnapshot)) {
                                closeWebView()
                                createWebView()
                            }
                        }
                    }, 5000L)
                }
            }
        }
        container.removeAllViews()
        container.addView(webView, FrameLayout.LayoutParams(-1, -1))
        speech = CortexSpeech(this) { event -> deviceEvent(event) }
        device = CortexDeviceBridge(this, speech, ::openYandexLogin, ::deviceEvent)
        server = CortexServerBridge(applicationContext)
        val origin = "https://$ASSET_HOST"
        WebViewCompat.addWebMessageListener(webView, "CortexServer", setOf(origin)) { _, message, source, mainFrame, reply ->
                if (mainFrame && source.toString().trimEnd('/') == origin) server.handle(message.data.orEmpty(), reply)
        }
        WebViewCompat.addWebMessageListener(webView, "CortexDevice", setOf(origin)) { _, message, source, mainFrame, _ ->
                if (mainFrame && source.toString().trimEnd('/') == origin) runOnUiThread {
                    val data = message.data.orEmpty()
                    if (!nativeReady && runCatching { JSONObject(data).optString("operation") }.getOrNull() == "permissions") {
                        nativeReady = true
                        if (pendingAuthReturn) {
                            pendingAuthReturn = false
                            deviceEvent(JSONObject().put("type", "auth-return"))
                        }
                    }
                    device.handle(data)
                    showPendingSchedule()
                }
        }
        CortexRuntime.wakeCommand = wakeCommand
        CortexRuntime.leaveForAction = leaveForAction
        island = CortexIslandBridge(this, webView, "https://$ASSET_HOST")
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl("https://$ASSET_HOST/assets/web/index.html?android=1")
        }
    }

    private fun showRendererError(reason: String = "Android System WebView завершился. Попробуйте снова или обновите Android System WebView.") {
        rendererFailed = true
        closeWebView()
        val density = resources.displayMetrics.density
        val padding = (24 * density).toInt()
        val message = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER
            setPadding(padding, padding, padding, padding)
            addView(TextView(this@MainActivity).apply {
                text = reason
                textSize = 16f
                setTextColor(Color.WHITE)
                gravity = android.view.Gravity.CENTER
            }, LinearLayout.LayoutParams(-1, -2))
            addView(Button(this@MainActivity).apply {
                text = "Повторить"
                isSoundEffectsEnabled = false
                setOnClickListener {
                    runCatching { createWebView() }
                        .onFailure { showRendererError("Не удалось запустить системный WebView. Обновите его и попробуйте снова.") }
                    if (!rendererFailed && ::island.isInitialized) {
                        notifyVisibility(true)
                        island.refresh()
                        island.ensureIsland()
                    }
                }
            })
            val provider = runCatching { WebView.getCurrentWebViewPackage()?.packageName }.getOrNull()
            if (!provider.isNullOrBlank()) addView(Button(this@MainActivity).apply {
                text = "Настройки системного WebView"
                isSoundEffectsEnabled = false
                setOnClickListener {
                    runCatching { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:$provider"))) }
                }
            })
        }
        container.addView(message, FrameLayout.LayoutParams(-1, -1))
    }

    private fun openYandexLogin(raw: String): Boolean = runCatching {
        val uri = Uri.parse(raw)
        require(uri.scheme == "https" && uri.encodedAuthority == "oauth.yandex.ru" &&
            uri.path == "/authorize" && uri.getQueryParameter("response_type") == "code" &&
            uri.getQueryParameter("redirect_uri") == "https://jjcqrjztxohnifmziksy.supabase.co/functions/v1/cortex/v1/auth/callback/yandex")
        try {
            val browser = CustomTabsClient.getPackageName(this, null)
            if (browser != null && CustomTabsClient.isAuthTabSupported(this, browser)) {
                AuthTabIntent.Builder().build().also { it.intent.setPackage(browser) }
                    .launch(authTab, uri, BuildConfig.APPLICATION_ID)
            } else {
                CustomTabsIntent.Builder().setColorScheme(CustomTabsIntent.COLOR_SCHEME_DARK).build()
                    .also { if (browser != null) it.intent.setPackage(browser) }.launchUrl(this, uri)
            }
        } catch (_: ActivityNotFoundException) {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        }
        true
    }.getOrDefault(false)

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.data?.let(::authReturned)
        pendingSchedule = intent.getStringExtra(CortexSchedule.EXTRA_TASK)
        showPendingSchedule()
    }

    private fun showPendingSchedule() {
        if (!nativeReady || rendererFailed) return
        val id = pendingSchedule ?: return
        pendingSchedule = null
        intent.removeExtra(CortexSchedule.EXTRA_TASK)
        if (id.length == 36) device.scheduleEntry(id)
    }

    private fun authReturned(uri: Uri) {
        if (uri.scheme == BuildConfig.APPLICATION_ID && uri.host == "oauth" && uri.path == "/return" && ::webView.isInitialized) {
            if (nativeReady && !rendererFailed) deviceEvent(JSONObject().put("type", "auth-return"))
            else pendingAuthReturn = true
        }
    }

    private fun deviceEvent(event: JSONObject) {
        runOnUiThread {
            if (rendererFailed || !::webView.isInitialized) return@runOnUiThread
            // Escape untrusted JSON as a JS string. No JS string interpolation.
            val json = JSONObject.quote(event.toString())
            webView.evaluateJavascript("window.dispatchEvent(new MessageEvent('cortex-native', {data:$json}));" +
                "if(window.CortexDevice&&typeof window.CortexDevice.onmessage==='function')window.CortexDevice.onmessage({data:$json});", null)
        }
    }

    private fun isAsset(uri: Uri) = uri.scheme == "https" && uri.host == ASSET_HOST && uri.path?.startsWith("/assets/web/") == true

    @Deprecated("For Android document pickers")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (!rendererFailed && ::device.isInitialized) device.handleActivityResult(requestCode, resultCode, data)
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (!rendererFailed && ::device.isInitialized) device.refreshPermissions()
        if (!rendererFailed && ::island.isInitialized) island.refresh()
    }
    override fun onResume() {
        super.onResume()
        CortexRuntime.setAppVisible(true)
        notifyVisibility(true)
        if (!rendererFailed && ::device.isInitialized) device.refreshPermissions()
        if (!rendererFailed && ::island.isInitialized) { island.refresh(); island.ensureIsland() }
    }
    override fun onPause() {
        CortexRuntime.setAppVisible(false)
        notifyVisibility(false)
        if (!rendererFailed && ::speech.isInitialized) speech.stop()
        super.onPause()
    }
    private fun notifyVisibility(visible: Boolean) {
        if (!rendererFailed && ::webView.isInitialized) webView.evaluateJavascript(
            "window.cortexAppVisible=$visible;window.dispatchEvent(new Event('cortex-app-visibility'));", null)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        if (!rendererFailed) webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }
    override fun onDestroy() {
        if (!rendererFailed) closeWebView()
        super.onDestroy()
    }

    private fun closeWebView() {
        if (CortexRuntime.wakeCommand === wakeCommand) CortexRuntime.wakeCommand = null
        if (CortexRuntime.leaveForAction === leaveForAction) CortexRuntime.leaveForAction = null
        nativeReady = false
        if (::speech.isInitialized) speech.close()
        if (::device.isInitialized) device.close()
        if (::server.isInitialized) server.close()
        if (::island.isInitialized) island.close()
        if (::webView.isInitialized) {
            (webView.parent as? FrameLayout)?.removeView(webView)
            runCatching { webView.destroy() }
        }
    }
    private companion object {
        private val cleanupStarted = AtomicBoolean()
        const val ASSET_HOST = WebViewAssetLoader.DEFAULT_DOMAIN
    }
}
