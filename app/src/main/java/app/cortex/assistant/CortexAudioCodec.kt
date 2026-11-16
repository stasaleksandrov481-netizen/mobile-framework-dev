package app.cortex.assistant

/** Decodes the size-bounded C4A1/IMA ADPCM voice format, without native libraries. */
internal object CortexAudioCodec {
    const val ADPCM_FORMAT = "ima_adpcm4_24000_mono"
    const val PCM_FORMAT = "pcm_s16le_24000_mono"
    private val steps = intArrayOf(
        7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
        34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
        157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544,
        598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707,
        1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871,
        5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
        15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
    )
    private val indexChanges = intArrayOf(-1, -1, -1, -1, 2, 4, 6, 8)

    fun decode(frame: ByteArray): ByteArray? {
        if (frame.size < 13 || frame[0] != 0x43.toByte() || frame[1] != 0x34.toByte() ||
            frame[2] != 0x41.toByte() || frame[3] != 0x31.toByte()) return null
        val count = (frame[4].toLong() and 255) or ((frame[5].toLong() and 255) shl 8) or
            ((frame[6].toLong() and 255) shl 16) or ((frame[7].toLong() and 255) shl 24)
        if (count < 2L || count > 1_200_000L || frame.size.toLong() != 12 + count / 2 ||
            frame[10] != 0.toByte() || frame[11] != 0.toByte()) return null
        var predictor = ((frame[8].toInt() and 255) or ((frame[9].toInt() and 255) shl 8)).toShort().toInt()
        var stepIndex = 0
        val pcm = ByteArray(count.toInt() * 2)
        fun sample(index: Int, value: Int) {
            pcm[index * 2] = (value and 255).toByte()
            pcm[index * 2 + 1] = ((value shr 8) and 255).toByte()
        }
        sample(0, predictor)
        for (index in 1 until count.toInt()) {
            val position = index - 1
            val pair = frame[12 + position / 2].toInt() and 255
            val code = if (position % 2 == 0) pair and 15 else pair shr 4
            val delta = code and 7
            val step = steps[stepIndex]
            val difference = (step shr 3) + (if ((delta and 4) != 0) step else 0) +
                (if ((delta and 2) != 0) step shr 1 else 0) +
                (if ((delta and 1) != 0) step shr 2 else 0)
            predictor = (predictor + (if ((code and 8) != 0) -difference else difference)).coerceIn(-32768, 32767)
            stepIndex = (stepIndex + indexChanges[delta]).coerceIn(0, 88)
            sample(index, predictor)
        }
        return pcm
    }
}
