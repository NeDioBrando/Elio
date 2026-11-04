//! Windows closes this native job handle when Elio exits, including abrupt exit.
//! KILL_ON_JOB_CLOSE prevents an orphan Blender even during a blocked C operation.
#[cfg(windows)]mod windows {
 use std::{ffi::c_void,mem::size_of,os::windows::io::AsRawHandle,process::Child};
 type Handle=*mut c_void;
 #[repr(C)]#[derive(Default)]struct Basic{process_time:i64,job_time:i64,flags:u32,min_working:usize,max_working:usize,active:u32,affinity:usize,priority:u32,scheduling:u32}
 #[repr(C)]#[derive(Default)]struct Extended{basic:Basic,io:[u64;6],process_memory:usize,job_memory:usize,peak_process:usize,peak_job:usize}
 #[link(name="kernel32")]extern "system"{
  fn CreateJobObjectW(attributes:Handle,name:*const u16)->Handle;
  fn SetInformationJobObject(job:Handle,class:i32,information:Handle,length:u32)->i32;
  fn AssignProcessToJobObject(job:Handle,process:Handle)->i32;
  fn CloseHandle(handle:Handle)->i32;
 }
 pub struct OwnedJob(usize);
 impl OwnedJob{pub fn attach(child:&Child)->anyhow::Result<Self>{unsafe{
  let handle=CreateJobObjectW(std::ptr::null_mut(),std::ptr::null());anyhow::ensure!(!handle.is_null(),"Cannot create owned Blender process job: {}",std::io::Error::last_os_error());
  let job=Self(handle as usize);let mut limits=Extended::default();limits.basic.flags=0x00002000;
  anyhow::ensure!(SetInformationJobObject(handle,9,&mut limits as *mut _ as Handle,size_of::<Extended>() as u32)!=0,"Cannot set Blender job lifetime: {}",std::io::Error::last_os_error());
  anyhow::ensure!(AssignProcessToJobObject(handle,child.as_raw_handle())!=0,"Cannot attach Blender to its Elio lifetime job: {}",std::io::Error::last_os_error());Ok(job)
 }}}
 impl Drop for OwnedJob{fn drop(&mut self){unsafe{CloseHandle(self.0 as Handle);}}}
}
#[cfg(windows)]pub use windows::OwnedJob;
