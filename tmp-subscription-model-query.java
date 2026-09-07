import java.nio.file.*;
import java.sql.*;
import java.util.*;

class SubscriptionModelQuery {
  public static void main(String[] args) throws Exception {
    var props = new Properties();
    try (var in = Files.newInputStream(Path.of("I:/G盘迁移备份/workrpase/spring-app/src/main/resources/application.properties"))) { props.load(in); }
    String host = value(props.getProperty("app.db.host"), "120.48.151.202");
    String port = value(props.getProperty("app.db.port"), "3307");
    String db = value(props.getProperty("app.db.name"), "token_system");
    String user = value(props.getProperty("app.db.username"), "stock_app");
    try (var c = DriverManager.getConnection("jdbc:mysql://"+host+":"+port+"/"+db+"?sslMode=DISABLED&allowPublicKeyRetrieval=true&serverTimezone=Asia/Shanghai", user, props.getProperty("app.db.password", ""));
         var s = c.createStatement()) {
      try (var rs=s.executeQuery("select id,plan_code,status,available_model_ids from subscription_plans order by id")) {
        while(rs.next()) System.out.printf("PLAN %d %s %s %s%n",rs.getLong(1),rs.getString(2),rs.getString(3),rs.getString(4));
      }
      try (var rs=s.executeQuery("select user_email,plan_id,status from user_subscriptions where status='active' order by id desc limit 10")) {
        while(rs.next()) System.out.printf("USER %s plan=%d %s%n",rs.getString(1).replaceAll("(^.).*(@.*$)","$1***$2"),rs.getLong(2),rs.getString(3));
      }
    }
  }
  static String value(String raw,String fallback){ if(raw==null||raw.isBlank())return fallback; int c=raw.indexOf(':'),e=raw.lastIndexOf('}'); return raw.startsWith("${")&&c>0&&e>c?raw.substring(c+1,e):raw; }
}
