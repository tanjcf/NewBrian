use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Default)]
pub struct Store { threads: HashMap<String, Value> }

impl Store {
    pub fn create(&mut self, id: &str, project_id: &str, title: &str) -> Value {
        let thread = json!({"thread_id": id, "project_id": project_id, "title": title, "status": "idle", "messages": []});
        self.threads.insert(id.to_owned(), thread.clone()); thread
    }
    pub fn get(&self, id: &str) -> Option<Value> { self.threads.get(id).cloned() }
    pub fn activate(&mut self, id: &str) -> Result<Value, &'static str> { self.update_status(id, "active") }
    pub fn archive(&mut self, id: &str) -> Result<Value, &'static str> { self.update_status(id, "archived") }
    pub fn begin(&mut self, id: &str, turn_id: &str) -> Result<Value, &'static str> {
        let t = self.threads.get_mut(id).ok_or("BRAIN_THREAD_NOT_FOUND")?;
        t["active_turn_id"] = json!(turn_id); t["status"] = json!("running"); Ok(t.clone())
    }
    pub fn append(&mut self, id: &str, role: &str, content: &str) -> Result<Value, &'static str> {
        let t = self.threads.get_mut(id).ok_or("BRAIN_THREAD_NOT_FOUND")?;
        t["messages"].as_array_mut().ok_or("BRAIN_THREAD_STATE")?.push(json!({"role": role, "content": content})); Ok(t.clone())
    }
    pub fn finish(&mut self, id: &str) -> Result<Value, &'static str> { self.update_status(id, "idle") }
    pub fn cancel(&mut self, id: &str) -> Result<Value, &'static str> { self.update_status(id, "idle") }
    fn update_status(&mut self, id: &str, status: &str) -> Result<Value, &'static str> { let t=self.threads.get_mut(id).ok_or("BRAIN_THREAD_NOT_FOUND")?; t["status"]=json!(status); Ok(t.clone()) }
}

#[cfg(test)]
mod tests {
    use super::Store;
    #[test]
    fn thread_turn_lifecycle_is_explicit() {
        let mut store = Store::default();
        let created = store.create("t1", "p1", "测试");
        assert_eq!(created["status"], "idle");
        store.activate("t1").unwrap();
        store.begin("t1", "turn1").unwrap();
        store.append("t1", "user", "你好").unwrap();
        store.finish("t1").unwrap();
        assert_eq!(store.get("t1").unwrap()["messages"].as_array().unwrap().len(), 1);
        store.archive("t1").unwrap();
        assert_eq!(store.get("t1").unwrap()["status"], "archived");
    }
}
