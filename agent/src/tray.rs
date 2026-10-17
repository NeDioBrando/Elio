// Windows notification-area lifetime belongs to the desktop window.
use super::UiShared;
use std::{ffi::c_void, sync::Arc};
use tao::{platform::windows::WindowExtWindows, window::Window};

type Handle = *mut c_void;
#[repr(C)]
struct Guid { a: u32, b: u16, c: u16, d: [u8; 8] }
#[repr(C)]
struct NotifyIcon {
    size: u32, window: Handle, id: u32, flags: u32, message: u32, icon: Handle,
    tip: [u16; 128], state: u32, state_mask: u32, info: [u16; 256], version: u32,
    title: [u16; 64], info_flags: u32, guid: Guid, balloon: Handle,
}
#[repr(C)]
struct Point { x: i32, y: i32 }
const CALLBACK: u32 = 0x8000 + 97;
const SUBCLASS: usize = 0x504c415a;
type Procedure = unsafe extern "system" fn(Handle, u32, usize, isize, usize, usize) -> isize;
#[link(name="shell32")]
unsafe extern "system" { fn Shell_NotifyIconW(operation: u32, data: *const NotifyIcon) -> i32; }
#[link(name="comctl32")]
unsafe extern "system" {
    fn SetWindowSubclass(window: Handle, proc: Procedure, id: usize, data: usize) -> i32;
    fn RemoveWindowSubclass(window: Handle, proc: Procedure, id: usize) -> i32;
    fn DefSubclassProc(window: Handle, msg: u32, w: usize, l: isize) -> isize;
}
#[link(name="user32")]
unsafe extern "system" {
    fn GetSystemMetrics(index: i32) -> i32;
    fn LoadImageW(instance: Handle, name: *const u16, kind: u32, width: i32, height: i32, flags: u32) -> Handle;
    fn LoadIconW(instance: Handle, name: *const u16) -> Handle;
    fn RegisterWindowMessageW(name: *const u16) -> u32;
    fn CreatePopupMenu() -> Handle;
    fn AppendMenuW(menu: Handle, flags: u32, id: usize, text: *const u16) -> i32;
    fn TrackPopupMenu(menu: Handle, flags: u32, x: i32, y: i32, reserved: i32, window: Handle, rect: *const c_void) -> u32;
    fn DestroyMenu(menu: Handle) -> i32;
    fn GetCursorPos(point: *mut Point) -> i32;
    fn SetForegroundWindow(window: Handle) -> i32;
    fn PostMessageW(window: Handle, msg: u32, w: usize, l: isize) -> i32;
}
fn wide(text: &str) -> Vec<u16> { text.encode_utf16().chain(Some(0)).collect() }
struct State { data: NotifyIcon, shared: Arc<UiShared>, restart: u32, registered: bool }
impl State {
    fn register(&mut self) -> bool {
        if self.registered { return true; }
        self.registered = unsafe { Shell_NotifyIconW(0, &self.data) != 0 };
        if !self.registered { self.shared.log("Windows could not register the synerixcode tray icon."); }
        self.registered
    }
}
fn show_menu(window: Handle, shared: Arc<UiShared>) {
        unsafe {
            let menu = CreatePopupMenu();
            if menu.is_null() { return; }
            AppendMenuW(menu, 0, 1, wide("Open synerixcode").as_ptr());
            AppendMenuW(menu, 0x800, 0, std::ptr::null());
            AppendMenuW(menu, 0, 2, wide("Quit synerixcode").as_ptr());
            let mut point = Point { x: 0, y: 0 };
            if GetCursorPos(&mut point) != 0 {
                SetForegroundWindow(window);
                let action = TrackPopupMenu(menu, 0x182, point.x, point.y, 0, window, std::ptr::null());
                if action == 1 { shared.request_show(); }
                if action == 2 { shared.request_quit(); }
                PostMessageW(window, 0, 0, 0);
            }
            DestroyMenu(menu);
        }
    }

unsafe extern "system" fn procedure(window: Handle, msg: u32, w: usize, l: isize, _id: usize, data: usize) -> isize {
    // State lives in a stable Box until the subclass is removed in Drop.
    if msg == CALLBACK {
        let state = unsafe { &*(data as *const State) };
        let shared = state.shared.clone();
        match l as u32 { 0x202 | 0x203 => shared.request_show(), 0x205 | 0x7b => show_menu(window, shared), _ => {} }
        return 0;
    }
    let restart = unsafe { (*(data as *const State)).restart };
    if restart != 0 && msg == restart {
        let state = unsafe { &mut *(data as *mut State) };
        state.registered = false;
        if !state.register() { state.shared.request_show(); }
    }
    unsafe { DefSubclassProc(window, msg, w, l) }
}
pub struct Tray { state: Box<State>, hooked: bool }
impl Tray {
    pub fn new(window: &Window, shared: Arc<UiShared>) -> Self {
        let mut data: NotifyIcon = unsafe { std::mem::zeroed() };
        data.size = std::mem::size_of::<NotifyIcon>() as u32;
        data.window = window.hwnd() as Handle; data.id = 1; data.flags = 7; data.message = CALLBACK;
        // Shared resource handles remain valid for the process lifetime. Select the small
        // system icon size from the multi-resolution icon rather than downscaling 32px.
        data.icon = unsafe { LoadImageW(window.hinstance() as Handle, 1usize as *const u16, 1, GetSystemMetrics(49), GetSystemMetrics(50), 0x8000) };
        if data.icon.is_null() { data.icon = unsafe { LoadIconW(window.hinstance() as Handle, 1usize as *const u16) }; }
        if data.icon.is_null() { shared.log("Embedded synerixcode application icon could not be loaded."); }
        if data.icon.is_null() { data.icon = unsafe { LoadIconW(std::ptr::null_mut(), 32512usize as *const u16) }; }
        let tip = wide("synerixcode — click to reopen; right-click for menu");
        data.tip[..tip.len()].copy_from_slice(&tip);
        let mut state = Box::new(State { data, shared, restart: unsafe { RegisterWindowMessageW(wide("TaskbarCreated").as_ptr()) }, registered: false });
        let hooked = unsafe { SetWindowSubclass(state.data.window, procedure, SUBCLASS, (&mut *state as *mut State) as usize) != 0 };
        if hooked { state.register(); }
        Self { state, hooked }
    }
    pub fn ensure_registered(&mut self) -> bool { self.hooked && self.state.register() }
}
impl Drop for Tray {
    fn drop(&mut self) { unsafe {
        if self.state.registered { Shell_NotifyIconW(2, &self.state.data); }
        if self.hooked { RemoveWindowSubclass(self.state.data.window, procedure, SUBCLASS); }
    } }
}
// SDK NOTIFYICONDATAW layout for the shipped x64 Windows target.
const _: () = assert!(std::mem::size_of::<NotifyIcon>() == 976);
