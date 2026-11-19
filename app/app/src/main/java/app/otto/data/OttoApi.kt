package app.otto.data

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Query

/** API do servidor do Otto. O app nunca fala direto com o banco, o agregador ou a IA. */
interface OttoApi {
    @GET("v1/status")
    suspend fun status(): ServerStatus

    @GET("v1/summary")
    suspend fun summary(): Summary

    @GET("v1/transactions")
    suspend fun transactions(
        @Query("cursor") cursor: String? = null,
        @Query("limit") limit: Int = 30,
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
    ): TransactionsPage

    @POST("v1/sync")
    suspend fun sync(): OkResponse

    @GET("v1/settings")
    suspend fun settings(): ServerSettings

    @PUT("v1/settings")
    suspend fun updateSettings(@Body patch: SettingsPatch): ServerSettings

    @POST("v1/devices")
    suspend fun registerDevice(@Body body: DeviceBody): OkResponse

    @POST("v1/devices/test")
    suspend fun testPush(): OkResponse

    @GET("v1/notifications")
    suspend fun notifications(@Query("after") after: Long, @Query("limit") limit: Int = 50): NotificationsPage

    @POST("v1/events/bank-notification")
    suspend fun bankNotification(@Body body: BankEventBody): BankEventResponse

    @POST("v1/dev/simulate")
    suspend fun simulate(@Body body: SimulateBody): SimulateResult
}
