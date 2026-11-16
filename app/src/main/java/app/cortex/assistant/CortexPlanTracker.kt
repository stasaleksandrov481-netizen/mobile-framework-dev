package app.cortex.assistant

/** Stops a visual agent that asks for the same steps on an unchanged screen. */
internal class CortexPlanTracker(private val repeatedPlanLimit: Int = 2) {
    private var lastSignature: String? = null
    private var repetitions = 0

    fun accept(signature: String): Boolean {
        if (lastSignature == signature) repetitions++
        else repetitions = 0
        lastSignature = signature
        return repetitions < repeatedPlanLimit
    }
}
