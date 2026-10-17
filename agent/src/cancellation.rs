// SPDX-License-Identifier: GPL-3.0-or-later
use std::{collections::HashMap, sync::Mutex};
use tokio::sync::watch;
#[derive(Default)]
pub struct Hub { requests: Mutex<HashMap<String,watch::Sender<bool>>> }
impl Hub {
    pub fn register(&self,id:&str)->watch::Receiver<bool>{
        let mut requests=self.requests.lock().unwrap_or_else(|e|e.into_inner());
        if requests.len()>=128 { requests.retain(|_,sender|sender.receiver_count()>0); }
        requests.entry(id.into()).or_insert_with(||watch::channel(false).0).subscribe()
    }
    pub fn cancel(&self,id:&str)->bool{
        let mut requests=self.requests.lock().unwrap_or_else(|e|e.into_inner());
        if let Some(sender)=requests.get_mut(id) { sender.send_replace(true);true } else {false}
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    #[tokio::test]
    async fn cancellation_is_scoped_and_survives_a_signal_before_wait(){let hub=Hub::default();let mut first=hub.register("a");let second=hub.register("b");assert!(hub.cancel("a"));first.changed().await.unwrap();assert!(*first.borrow());assert!(!*second.borrow());assert!(*hub.register("a").borrow());assert!(!hub.cancel("missing"));}
}
