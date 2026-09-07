import java.nio.file.*;
import java.sql.*;
import java.util.*;

class EnableVideoModelsInPlan {
  public static void main(String[] args) throws Exception {
    var props=new Properties();
    try(var in=Files.newInputStream(Path.of("I:/G盘迁移备份/workrpase/spring-app/src/main/resources/application.properties"))){props.load(in);}
    String host=value(props.getProperty("app.db.host"),"120.48.151.202"),port=value(props.getProperty("app.db.port"),"3307"),db=value(props.getProperty("app.db.name"),"token_system"),user=value(props.getProperty("app.db.username"),"stock_app");
    try(var c=DriverManager.getConnection("jdbc:mysql://"+host+":"+port+"/"+db+"?sslMode=DISABLED&allowPublicKeyRetrieval=true&serverTimezone=Asia/Shanghai",user,props.getProperty("app.db.password",""))){
      c.setAutoCommit(false);
      var ids=new LinkedHashSet<Long>();
      try(var q=c.prepareStatement("select available_model_ids from subscription_plans where plan_code=? for update")){q.setString(1,"plan.team_pro");try(var rs=q.executeQuery()){if(!rs.next())throw new IllegalStateException("plan.team_pro not found");for(String v:String.valueOf(rs.getString(1)).split("[,\\s]+")){try{ids.add(Long.parseLong(v.trim()));}catch(Exception ignored){}}}}
      try(var q=c.prepareStatement("select id from model_configs where is_active=1 and (capability_tags like '%video%' or capability_tags like '%audio%' or capability_tags like '%tts%')" );var rs=q.executeQuery()){while(rs.next())ids.add(rs.getLong(1));}
      String joined=ids.stream().map(String::valueOf).reduce((a,b)->a+","+b).orElse("");
      try(var u=c.prepareStatement("update subscription_plans set available_model_ids=?,updated_at=? where plan_code=?")){u.setString(1,joined);u.setString(2,java.time.Instant.now().toString());u.setString(3,"plan.team_pro");if(u.executeUpdate()!=1)throw new IllegalStateException("plan update failed");}
      c.commit();
      System.out.println("plan.team_pro media models enabled; model_count="+ids.size());
    }
  }
  static String value(String raw,String fallback){if(raw==null||raw.isBlank())return fallback;int c=raw.indexOf(':'),e=raw.lastIndexOf('}');return raw.startsWith("${")&&c>0&&e>c?raw.substring(c+1,e):raw;}
}
