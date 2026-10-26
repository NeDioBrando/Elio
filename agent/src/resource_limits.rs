// SPDX-License-Identifier: GPL-3.0-or-later
//! Bounded bridge buffers. Overflow refuses new work; existing mutations are never replayed.
use std::{collections::VecDeque, sync::{Arc,atomic::{AtomicUsize,Ordering}}};
pub struct BudgetQueue<T>{items:VecDeque<(T,usize)>,bytes:usize,max_items:usize,max_bytes:usize}
impl<T> BudgetQueue<T>{
 pub fn new(max_items:usize,max_bytes:usize)->Self{Self{items:VecDeque::new(),bytes:0,max_items,max_bytes}}
 pub fn push(&mut self,item:T,bytes:usize)->Result<(), &'static str>{if self.items.len()>=self.max_items||bytes>self.max_bytes.saturating_sub(self.bytes){return Err("Studio queue is full. No command was queued; wait for existing work or reconnect Studio.");}self.items.push_back((item,bytes));self.bytes+=bytes;Ok(())}
 pub fn pop_front(&mut self)->Option<T>{self.items.pop_front().map(|(item,n)|{self.bytes-=n;item})}
 pub fn len(&self)->usize{self.items.len()}
 pub fn is_empty(&self)->bool{self.items.is_empty()}
}
pub struct Frame{pub text:String,bytes:usize,budget:Arc<AtomicUsize>}
impl Drop for Frame{fn drop(&mut self){self.budget.fetch_sub(self.bytes,Ordering::AcqRel);}}
#[derive(Clone)]pub struct BridgeSender{tx:tokio::sync::mpsc::Sender<Frame>,budget:Arc<AtomicUsize>,closed:tokio::sync::watch::Sender<bool>,max_bytes:usize}
impl BridgeSender{
 pub fn channel(items:usize,max_bytes:usize)->(Self,tokio::sync::mpsc::Receiver<Frame>,tokio::sync::watch::Receiver<bool>){let(tx,rx)=tokio::sync::mpsc::channel(items);let(closed,watch)=tokio::sync::watch::channel(false);(Self{tx,budget:Arc::new(AtomicUsize::new(0)),closed,max_bytes},rx,watch)}
 pub fn close(&self){self.closed.send_replace(true);}
 pub fn send(&self,text:String)->Result<(), &'static str>{
  if *self.closed.borrow()||self.tx.is_closed(){return Err("Bridge is closed");}
  let bytes=text.len();if self.budget.fetch_update(Ordering::AcqRel,Ordering::Acquire,|used|used.checked_add(bytes).filter(|n|*n<=self.max_bytes)).is_err(){self.close();return Err("Bridge byte budget exceeded; connection closed without replay");}
  let frame=Frame{text,bytes,budget:self.budget.clone()};
  if self.tx.try_send(frame).is_err(){self.close();return Err("Bridge buffer full; connection closed without replay");}Ok(())
 }
}
#[cfg(test)]mod tests{use super::*;
 #[test]fn queue_has_count_and_byte_limits_without_eviction(){let mut q=BudgetQueue::new(2,10);assert!(q.push("a",6).is_ok());assert!(q.push("b",5).is_err());assert_eq!(q.pop_front(),Some("a"));assert!(q.push("b",5).is_ok());assert!(q.push("c",5).is_ok());assert!(q.push("d",0).is_err());assert_eq!(q.pop_front(),Some("b"));assert_eq!(q.pop_front(),Some("c"));assert!(q.is_empty());assert_eq!(q.bytes,0);assert!(q.push("large",11).is_err());}
 #[tokio::test]async fn outbound_frames_release_budget_on_send_drop_and_overflow(){let(tx,mut rx,watch)=BridgeSender::channel(2,10);tx.send("12345".into()).unwrap();let f=rx.recv().await.unwrap();assert_eq!(tx.budget.load(Ordering::Relaxed),5);drop(f);assert_eq!(tx.budget.load(Ordering::Relaxed),0);tx.send("12345".into()).unwrap();assert!(tx.send("123456".into()).is_err());assert!(*watch.borrow());drop(rx);assert_eq!(tx.budget.load(Ordering::Relaxed),0);assert!(tx.send("a".into()).is_err());}
 #[tokio::test]async fn count_overflow_closes_and_frees_rejected_frame(){let(tx,rx,watch)=BridgeSender::channel(1,100);tx.send("a".into()).unwrap();assert!(tx.send("b".into()).is_err());assert!(*watch.borrow());assert_eq!(tx.budget.load(Ordering::Relaxed),1);drop(rx);assert_eq!(tx.budget.load(Ordering::Relaxed),0);}
}

/// Cancellation-safe line reader: a helper cannot grow one unterminated line indefinitely.
pub struct LimitedLines<R>{reader:tokio::io::BufReader<R>,buffer:Vec<u8>,limit:usize,overflow:bool}
impl<R:tokio::io::AsyncRead+Unpin> LimitedLines<R>{
 pub fn new(reader:R,limit:usize)->Self{Self{reader:tokio::io::BufReader::new(reader),buffer:Vec::new(),limit,overflow:false}}
 pub async fn next_line(&mut self)->std::io::Result<Option<String>>{
  use tokio::io::AsyncBufReadExt;
  loop{
   let chunk=self.reader.fill_buf().await?;
   if chunk.is_empty(){if self.buffer.is_empty()&&!self.overflow{return Ok(None);}return self.finish();}
   let newline=chunk.iter().position(|b|*b==b'\n');let n=newline.map_or(chunk.len(),|n|n+1);
   let remaining=self.limit.saturating_sub(self.buffer.len());self.buffer.extend_from_slice(&chunk[..n.min(remaining)]);if n>remaining{self.overflow=true;}
   self.reader.consume(n);
   if newline.is_some(){return self.finish();}
  }
 }
 fn finish(&mut self)->std::io::Result<Option<String>>{
  let bytes=std::mem::take(&mut self.buffer);let overflow=std::mem::replace(&mut self.overflow,false);
  if overflow{return Err(std::io::Error::new(std::io::ErrorKind::InvalidData,"MCP response line exceeds its memory limit"));}
  let mut text=String::from_utf8(bytes).map_err(|e|std::io::Error::new(std::io::ErrorKind::InvalidData,e))?;
  if text.ends_with('\n'){text.pop();if text.ends_with('\r'){text.pop();}}Ok(Some(text))
 }
}
#[cfg(test)]mod line_tests{use super::*;use tokio::io::AsyncWriteExt;
 #[tokio::test]async fn oversized_lines_are_drained_with_bounded_memory(){let data=format!("{}\nvalid\r\n","x".repeat(100000));let mut r=LimitedLines::new(data.as_bytes(),32);assert_eq!(r.next_line().await.unwrap_err().kind(),std::io::ErrorKind::InvalidData);assert_eq!(r.next_line().await.unwrap(),Some("valid".into()));assert_eq!(r.next_line().await.unwrap(),None);}
 #[tokio::test]async fn partial_lines_survive_timeout_without_unbounded_retention(){let(mut write,read)=tokio::io::duplex(4096);let mut r=LimitedLines::new(read,16);write.write_all(&[b'x';1024]).await.unwrap();assert!(tokio::time::timeout(std::time::Duration::from_millis(5),r.next_line()).await.is_err());assert!(r.buffer.len()<=16);write.write_all(b"\nnext\n").await.unwrap();assert!(r.next_line().await.is_err());assert_eq!(r.next_line().await.unwrap(),Some("next".into()));}
}

/// Two bounded diagnostic log files. Never used for chat or project data.
pub struct RollingFile{path:std::path::PathBuf,file:Option<std::fs::File>,bytes:u64,limit:u64}
impl RollingFile{
 pub fn open(path:std::path::PathBuf,limit:u64)->std::io::Result<Self>{
  if limit==0{return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput,"Log limit must be positive"));}
  let file=std::fs::File::options().create(true).append(true).open(&path)?;let bytes=file.metadata()?.len();let mut out=Self{path,file:Some(file),bytes,limit};if bytes>=limit{out.rotate()?;}Ok(out)
 }
 fn rotate(&mut self)->std::io::Result<()>{
  self.file.take();let backup=self.path.with_extension("log.1");
  let outcome=(||{
   if self.path.exists(){
    if std::fs::metadata(&self.path)?.len()>self.limit{
     use std::io::{Read,Seek,SeekFrom};let mut old=std::fs::File::open(&self.path)?;old.seek(SeekFrom::End(-(self.limit as i64)))?;let mut tail=Vec::new();old.take(self.limit).read_to_end(&mut tail)?;std::fs::write(&backup,tail)?;std::fs::File::create(&self.path)?;
    }else{if backup.exists(){std::fs::remove_file(&backup)?;}std::fs::rename(&self.path,&backup)?;}
   }
   Ok::<(),std::io::Error>(())
  })();
  // Recover a handle even if a lock/antivirus blocked rotation; do not append past the cap.
  let file=std::fs::File::options().create(true).append(true).open(&self.path)?;self.bytes=file.metadata()?.len();self.file=Some(file);outcome
 }
}
impl std::io::Write for RollingFile{
 fn write(&mut self,buf:&[u8])->std::io::Result<usize>{
  if buf.is_empty(){return Ok(0);}if self.bytes>=self.limit{self.rotate()?;}
  let count=buf.len().min((self.limit-self.bytes)as usize);let n=std::io::Write::write(self.file.as_mut().ok_or_else(||std::io::Error::other("Log handle unavailable"))?,&buf[..count])?;self.bytes+=n as u64;Ok(n)
 }
 fn flush(&mut self)->std::io::Result<()>{match self.file.as_mut(){Some(file)=>std::io::Write::flush(file),None=>Ok(())}}
}
#[cfg(test)]mod rolling_tests{use super::*;use std::io::Write;
 #[test]fn diagnostic_rotation_bounds_existing_and_new_logs(){let root=std::env::temp_dir().join(format!("elio-log-bound-{}",std::process::id()));std::fs::create_dir_all(&root).unwrap();let path=root.join("agent.log");std::fs::write(&path,vec![b'x';1000]).unwrap();{let mut file=RollingFile::open(path.clone(),16).unwrap();assert!(std::fs::metadata(path.with_extension("log.1")).unwrap().len()<=16);file.write_all(b"abcdefghijklmnopqrstuvwxyz0123456789").unwrap();file.flush().unwrap();}assert!(std::fs::metadata(&path).unwrap().len()<=16);assert!(std::fs::metadata(path.with_extension("log.1")).unwrap().len()<=16);let current=std::fs::read(&path).unwrap();assert!(b"abcdefghijklmnopqrstuvwxyz0123456789".ends_with(&current));let _=std::fs::remove_dir_all(root);}
}

pub async fn register_client(clients:&tokio::sync::RwLock<std::collections::HashMap<String,String>>,id:&str,engine:&str)->Result<(), &'static str>{
 if id.is_empty()||id.len()>256||engine.len()>32{return Err("Invalid bridge client identifier");}
 let mut clients=clients.write().await;if !clients.contains_key(id)&&clients.len()>=128{return Err("Bridge client capacity reached; disconnect an existing client first");}clients.insert(id.into(),engine.into());Ok(())
}
#[cfg(test)]mod client_tests{use super::*;#[tokio::test]async fn client_registry_is_bounded_without_evicting_existing_connections(){let clients=tokio::sync::RwLock::new(std::collections::HashMap::new());for i in 0..128{register_client(&clients,&format!("client-{i}"),"local").await.unwrap();}assert!(register_client(&clients,"extra","local").await.is_err());assert!(register_client(&clients,"client-0","local").await.is_ok());assert!(register_client(&clients,&"x".repeat(257),"local").await.is_err());assert_eq!(clients.read().await.len(),128);}}
