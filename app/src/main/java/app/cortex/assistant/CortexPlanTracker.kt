package app.cortex.assistant

/** Stops a visual agent that asks for the same steps on an unchanged screen. */
internal class CortexPlanTracker(private val repeatedPlanLimit: Int = 2) {
    private val attempts = mutableMapOf<String, Int>()

    fun accept(signature: String): Boolean {
        val count = (attempts[signature] ?: 0) + 1
        attempts[signature] = count
        return count <= repeatedPlanLimit
    }
}
