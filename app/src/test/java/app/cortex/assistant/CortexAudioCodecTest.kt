package app.cortex.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class CortexAudioCodecTest {
    private fun hex(value: String): ByteArray = value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    @Test fun decodesTheServerGeneratedWireVector() {
        val frame = hex("433441310800000000800000777c770d")
        val pcm = CortexAudioCodec.decode(frame)
        assertNotNull(pcm)
        assertEquals(16, pcm!!.size)
        assertEquals(0, pcm[0].toInt() and 255)
        assertEquals(128, pcm[1].toInt() and 255)
    }

    @Test fun refusesMalformedFramesBeforeAllocatingAudio() {
        val good = hex("433441310800000000800000777c770d")
        assertNull(CortexAudioCodec.decode(good.copyOfRange(0, good.size - 1)))
        assertNull(CortexAudioCodec.decode(good.copyOf().also { it[0] = 0.toByte() }))
        assertNull(CortexAudioCodec.decode(good.copyOf().also { it[7] = 0xff.toByte() }))
        assertNull(CortexAudioCodec.decode(good.copyOf().also { it[10] = 2.toByte() }))
        assertNull(CortexAudioCodec.decode(ByteArray(0)))
    }
}
