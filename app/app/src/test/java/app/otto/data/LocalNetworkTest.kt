package app.otto.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalNetworkTest {
    @Test fun enderecosLocais() {
        listOf("10.0.2.2", "192.168.1.10", "172.16.0.5", "172.31.255.1", "127.0.0.1", "localhost", "otto.local", "nas", "100.107.143.36", "169.254.1.1", "::1", "fd12::1", "fe80::1")
            .forEach { assertTrue(it, LocalNetwork.isLocalHost(it)) }
    }

    @Test fun enderecosPublicos() {
        listOf("otto.seudominio.com", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2001:db8::1", "api.pluggy.ai")
            .forEach { assertFalse(it, LocalNetwork.isLocalHost(it)) }
    }
}
