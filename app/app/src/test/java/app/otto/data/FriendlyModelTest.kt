package app.otto.data

import org.junit.Assert.assertEquals
import org.junit.Test

class FriendlyModelTest {
    @Test fun gptOss() = assertEquals("GPT-OSS 120B", friendlyModelName("openai/gpt-oss-120b"))
    @Test fun gemini() = assertEquals("Gemini 3.8 Flash", friendlyModelName("gemini-3.8-flash"))
}
