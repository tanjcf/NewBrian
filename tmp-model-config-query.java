import java.nio.file.*;
import java.sql.*;
import java.util.*;

class ModelConfigQuery {
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
    try (var connection = DriverManager.getConnection(
        "jdbc:mysql://" + host + ":" + port + "/" + db + "?sslMode=DISABLED&allowPublicKeyRetrieval=true&connectTimeout=10000&serverTimezone=Asia/Shanghai", user, password);
        var statement = connection.prepareStatement(
            "select id,name,model_name,provider_type,capability_tags,wire_api,base_url,is_active,credential_id,input_token_price_per_million,output_token_price_per_million from model_configs order by sort_order,id");
        var rows = statement.executeQuery()) {
      while (rows.next()) {
        System.out.printf("%d\t%s\t%s\t%s\t%s\t%s\t%s\t%s\tcredential=%s\tprice=%s/%s%n",
            rows.getLong(1), rows.getString(2), rows.getString(3), rows.getString(4),
            rows.getString(5), rows.getString(6), rows.getString(7), rows.getBoolean(8), rows.getObject(9),
            rows.getBigDecimal(10), rows.getBigDecimal(11));
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
