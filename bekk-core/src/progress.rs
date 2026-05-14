use std::{sync::Mutex, time::{Duration, Instant}};

use rustic_core::{Progress, ProgressBars, ProgressType, RusticProgress};
use serde_json::{Value, json};

const PROGRESS_THROTTLE_MS: u64 = 50;

#[derive(Debug)]
pub struct JsonProgress {
    pub prefix: String,
    pub progress_type: ProgressType,
    pub last_emit: Mutex<Instant>,
}

impl JsonProgress {
    pub fn emit(&self, event: Value) {
        let mut last = self.last_emit.lock().unwrap();
        if last.elapsed() >= Duration::from_millis(PROGRESS_THROTTLE_MS) {
            println!("{}", event);
            *last = Instant::now();
        }
    }

    pub fn progress_type_str(&self) -> &'static str {
        match self.progress_type {
            ProgressType::Spinner => "spinner",
            ProgressType::Counter => "counter",
            ProgressType::Bytes => "bytes",
        }
    }
}

impl RusticProgress for JsonProgress {
    fn is_hidden(&self) -> bool { false }
    fn set_length(&self, len: u64) {
        self.emit(json!({
            "type": "progress",
            "phase": self.prefix,
            "progress_type": self.progress_type_str(),
            "action": "set_length",
            "length": len
        }));
    }
    fn set_title(&self, title: &str) {
        self.emit(json!({
            "type": "progress",
            "phase": self.prefix,
            "progress_type": self.progress_type_str(),
            "action": "set_title",
            "title": title
        }));
    }
    fn inc(&self, inc: u64) {
        self.emit(json!({
            "type": "progress",
            "phase": self.prefix,
            "progress_type": self.progress_type_str(),
            "action": "inc",
            "increment": inc
        }));
    }
    fn finish(&self) {
        println!("{}", json!({
            "type": "progress",
            "phase": self.prefix,
            "progress_type": self.progress_type_str(),
            "action": "finish"
        }));
    }
}

#[derive(Debug)]
pub struct JsonProgressBars;

impl ProgressBars for JsonProgressBars {
    fn progress(&self, progress_type: ProgressType, prefix: &str) -> Progress {
        Progress::new(JsonProgress {
            prefix: prefix.to_string(),
            progress_type,
            last_emit: Mutex::new(Instant::now() - Duration::from_secs(1)),
        })
    }
}
