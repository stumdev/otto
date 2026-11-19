# kotlinx.serialization, Retrofit, OkHttp e Hilt já trazem regras próprias (consumer rules).
# Mantém os modelos serializáveis do app.
-keep,includedescriptorclasses class app.tony.data.**$$serializer { *; }
-keepclassmembers class app.tony.data.** {
    *** Companion;
}
-keepclasseswithmembers class app.tony.data.** {
    kotlinx.serialization.KSerializer serializer(...);
}
