package app.cortex.assistant

import java.io.Reader

/** Read only a fixed amount even when the HTTP server omits Content-Length. */
internal object CortexBoundedText {
    fun read(reader: Reader, maxChars: Int): String {
        require(maxChars in 1..2_000_000)
        val result = StringBuilder(minOf(maxChars, 4096))
        val buffer = CharArray(4096)
        reader.use { source ->
            while (true) {
                val count = source.read(buffer, 0, minOf(buffer.size, maxChars - result.length + 1))
                if (count < 0) break
                if (count == 0) continue
                require(result.length + count <= maxChars) { "HTTP response exceeds configured limit" }
                result.append(buffer, 0, count)
            }
        }
        return result.toString()
    }
}
