# kotlinx.serialization, Retrofit, OkHttp e Hilt já trazem regras próprias (consumer rules).
# Mantém os modelos serializáveis do app.
-keep,includedescriptorclasses class app.otto.data.**$$serializer { *; }
-keepclassmembers class app.otto.data.** {
    *** Companion;
}
-keepclasseswithmembers class app.otto.data.** {
    kotlinx.serialization.KSerializer serializer(...);
}
