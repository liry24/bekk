use serde_json::{Value, json};

pub fn ok() -> Value {
    json!({ "status": "ok" })
}

pub fn ok_data(data: Value) -> Value {
    json!({ "status": "ok", "data": data })
}

pub fn err(msg: String) -> Value {
    json!({ "status": "error", "message": msg })
}
