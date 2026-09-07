import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Properties;

class UpsertTokenHubVideoModels {
  private record VideoModel(String name, String modelName, String tags, String wireApi, int sortOrder,
                            double inputTokenPrice, double outputTokenPrice) {}

  public static void main(String[] args) throws Exception {
    var props = new Properties();
    try (var in = Files.newInputStream(Path.of("I:/G盘迁移备份/workrpase/spring-app/src/main/resources/application.properties"))) {
      props.load(in);
    }
    String host = defaultValue(props.getProperty("app.db.host"), "120.48.151.202");
    String port = defaultValue(props.getProperty("app.db.port"), "3307");
    String db = defaultValue(props.getProperty("app.db.name"), "token_system");
    String user = defaultValue(props.getProperty("app.db.username"), "stock_app");
    String password = props.getProperty("app.db.password", "");
    String url = "jdbc:mysql://" + host + ":" + port + "/" + db
        + "?sslMode=DISABLED&allowPublicKeyRetrieval=true&connectTimeout=10000&serverTimezone=Asia/Shanghai";

    List<VideoModel> models = List.of(
        new VideoModel("TokenHub 混元生图 3.0", "hy-image-v3",
            "image,image-generation,text-to-image,image-to-image",
            "wand/hunyuan-image/v3-generation", 59, 10, 10),
        new VideoModel("TokenHub MiniMax 视频 H3", "minimax-video-h3",
            "video,text-to-video,image-to-video,audio-to-video,video-to-video,first-last-frame-video,minimax-video",
            "wand/minimax-video-v2/generation", 60, 10, 10),
        new VideoModel("TokenHub 可灵视频 V3", "kling-video-v3",
            "video,text-to-video,image-to-video,first-last-frame-video,kling",
            "wand/kling/text-to-video", 61, 10, 10),
        new VideoModel("TokenHub PixVerse 视频 C1", "pixverse-video-c1",
            "video,text-to-video,image-to-video,reference-to-video,first-last-frame-video,pixverse",
            "wand/pixverse/text-to-video", 62, 10, 10),
        new VideoModel("TokenHub Vidu 视频 Q3 Pro", "vidu-video-q3-pro",
            "video,text-to-video,image-to-video,vidu",
            "api/video/submit", 63, 10, 10),
        new VideoModel("TokenHub 混元视频 1.5", "hy-video-1.5",
            "video,text-to-video,image-to-video,hy-video",
            "api/video/submit", 64, 0, 0),
        new VideoModel("TokenHub 优图数字人视频", "yt-video-humanactor",
            "video,image-to-video,audio-to-video,talking-avatar,humanactor,yt-video",
            "api/video/submit", 65, 0, 0),
        new VideoModel("TokenHub MiniMax 语音 2.8 HD", "minimax-speech-2.8-hd",
            "audio,tts,speech-generation,text-to-speech,minimax-speech",
            "wand/minimax-tts/sync_tts", 66, 10, 10),
        new VideoModel("TokenHub MiniMax 语音 2.8 Turbo", "minimax-speech-2.8-turbo",
            "audio,tts,speech-generation,text-to-speech,minimax-speech,turbo",
            "wand/minimax-tts/sync_tts", 67, 10, 10));

    try (Connection connection = DriverManager.getConnection(url, user, password)) {
      connection.setAutoCommit(false);
      for (VideoModel model : models) {
        upsert(connection, model);
      }
      connection.commit();
    }
  }

  private static void upsert(Connection connection, VideoModel model) throws Exception {
    String now = OffsetDateTime.now().toString();
    try (PreparedStatement update = connection.prepareStatement("""
        UPDATE model_configs
           SET name=?, provider_name='TokenHub', provider_type='tokenhub', capability_tags=?,
               base_url='https://tokenhub.tencentmaas.com/v1', auth_type='bearer', wire_api=?,
               role='upgrade', sort_order=?, routing_priority=40, routing_weight=100,
               input_token_price_per_million=?, output_token_price_per_million=?,
               is_active=1, updated_at=?
         WHERE model_name=?
        """)) {
      update.setString(1, model.name());
      update.setString(2, model.tags());
      update.setString(3, model.wireApi());
      update.setInt(4, model.sortOrder());
      update.setDouble(5, model.inputTokenPrice());
      update.setDouble(6, model.outputTokenPrice());
      update.setString(7, now);
      update.setString(8, model.modelName());
      if (update.executeUpdate() > 0) return;
    }

    try (PreparedStatement insert = connection.prepareStatement("""
        INSERT INTO model_configs
          (name,provider_name,provider_type,capability_tags,model_name,base_url,api_key,access_token,
           auth_type,custom_headers,credential_id,wire_api,role,sort_order,routing_priority,routing_weight,
           input_token_price_per_million,output_token_price_per_million,is_active,created_at,updated_at)
        SELECT ?, 'TokenHub', 'tokenhub', ?, ?, 'https://tokenhub.tencentmaas.com/v1',
               source.api_key, source.access_token, 'bearer', source.custom_headers, source.credential_id,
               ?, 'upgrade', ?, 40, 100, ?, ?, 1, ?, ?
          FROM model_configs source
         WHERE source.base_url='https://tokenhub.tencentmaas.com/v1'
           AND (COALESCE(source.api_key,'') <> '' OR source.credential_id IS NOT NULL)
         ORDER BY CASE WHEN source.provider_type='tokenhub' THEN 0 ELSE 1 END, source.id
         LIMIT 1
        """)) {
      insert.setString(1, model.name());
      insert.setString(2, model.tags());
      insert.setString(3, model.modelName());
      insert.setString(4, model.wireApi());
      insert.setInt(5, model.sortOrder());
      insert.setDouble(6, model.inputTokenPrice());
      insert.setDouble(7, model.outputTokenPrice());
      insert.setString(8, now);
      insert.setString(9, now);
      if (insert.executeUpdate() != 1) {
        throw new IllegalStateException("No existing TokenHub credential is available for " + model.modelName());
      }
    }
  }

  private static String defaultValue(String raw, String fallback) {
    if (raw == null || raw.isBlank()) return fallback;
    int colon = raw.indexOf(':');
    int close = raw.lastIndexOf('}');
    return raw.startsWith("${") && colon > 0 && close > colon ? raw.substring(colon + 1, close) : raw;
  }
}
