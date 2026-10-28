# SPDX-License-Identifier: GPL-3.0-or-later
# Embedded fixed script. Request data enters through stdin, never evaluated.
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
 $r = [Console]::In.ReadToEnd() | ConvertFrom-Json
 Add-Type -AssemblyName System.Drawing
 Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public static class ElioStudioInput {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; public POINT(int x,int y){X=x;Y=y;} }
 [StructLayout(LayoutKind.Sequential)] public struct MI {public int x,y;public uint data,flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Sequential)] public struct KI {public ushort vk,scan;public uint flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Explicit)] public struct UNION {[FieldOffset(0)] public MI mouse;[FieldOffset(0)] public KI key;}
 [StructLayout(LayoutKind.Sequential)] public struct INPUT {public uint type;public UNION data;}
 [StructLayout(LayoutKind.Sequential)] public struct GUI {public uint cbSize,flags;public IntPtr active,focus,capture,menu,movesize,caret;public RECT rect;}
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr w,out RECT r);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr w,ref POINT p);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr w);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr w);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr w);
 [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr w);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr w,out uint pid);
 [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint thread,out GUI g);
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr w,uint f);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
 [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] static extern uint SendInput(uint n,INPUT[] input,int size);
 public static void Dpi(){try{SetThreadDpiAwarenessContext(new IntPtr(-4));}catch(EntryPointNotFoundException){}}
 public static long Focus(IntPtr hwnd){uint pid;uint thread=GetWindowThreadProcessId(hwnd,out pid);GUI g=new GUI();g.cbSize=(uint)Marshal.SizeOf(typeof(GUI));if(!GetGUIThreadInfo(thread,out g))throw new Exception("Cannot read keyboard focus");return g.focus.ToInt64();}
 public static void NoModifiers(){foreach(int k in new int[]{16,17,18,91,92,1,2,4})if((GetAsyncKeyState(k)&0x8000)!=0)throw new Exception("Release physical modifiers/mouse buttons before automation");}
 static INPUT Key(ushort vk,ushort scan,uint f){INPUT i=new INPUT();i.type=1;i.data.key=new KI{vk=vk,scan=scan,flags=f};return i;}
 static void Send(INPUT[] input){if(SendInput((uint)input.Length,input,Marshal.SizeOf(typeof(INPUT)))!=input.Length)throw new Exception("SendInput incomplete (possibly elevation/UIPI); input uncertain, do not replay");}
 public static void Text(string text){var inputs=new List<INPUT>();foreach(char c in text){inputs.Add(Key(0,c,4));inputs.Add(Key(0,c,6));}Send(inputs.ToArray());}
 public static void Keys(string key){var keys=new Dictionary<string,ushort>{{"ENTER",13},{"TAB",9},{"ESCAPE",27},{"LEFT",37},{"UP",38},{"RIGHT",39},{"DOWN",40},{"HOME",36},{"END",35},{"PAGEUP",33},{"PAGEDOWN",34}};if(key=="CTRL+A"){Send(new INPUT[]{Key(17,0,0),Key(65,0,0),Key(65,0,2),Key(17,0,2)});}else{ushort v=keys[key];uint e=(v>=33&&v<=40)?1u:0u;Send(new INPUT[]{Key(v,0,e),Key(v,0,e|2)});}}
 public static void Mouse(bool right,int scroll){INPUT a=new INPUT();a.type=0;if(scroll!=0){a.data.mouse=new MI{data=unchecked((uint)(scroll*120)),flags=0x800};Send(new INPUT[]{a});}else{INPUT b=new INPUT();b.type=0;a.data.mouse=new MI{flags=right?8u:2u};b.data.mouse=new MI{flags=right?16u:4u};Send(new INPUT[]{a,b});}}
}
'@
 [ElioStudioInput]::Dpi()
 $processes = @(Get-Process -Name RobloxStudioBeta -ErrorAction SilentlyContinue)
 if ($processes.Count -ne 1) { throw 'Require exactly one RobloxStudioBeta process; no window guessed' }
 $p=$processes[0]; $hwnd=$p.MainWindowHandle
 if ($hwnd -eq [IntPtr]::Zero -or -not [ElioStudioInput]::IsWindowVisible($hwnd) -or [ElioStudioInput]::IsIconic($hwnd)) { throw 'Studio main window unavailable/minimized; open it first' }
 if ([IO.Path]::GetFileName($p.MainModule.FileName) -ine 'RobloxStudioBeta.exe') {throw 'Unexpected Studio executable'}
 $start=$p.StartTime.ToUniversalTime().Ticks.ToString()
 if ($r.action -eq 'snapshot' -and $r.focus -eq $true) { [void][ElioStudioInput]::SetForegroundWindow($hwnd); Start-Sleep -Milliseconds 180 }
 function Check-Window {
  if ([ElioStudioInput]::GetForegroundWindow() -ne $hwnd -or -not [ElioStudioInput]::IsWindowEnabled($hwnd)) {throw 'Studio main window is not foreground/enabled (possibly a dialog). No input sent'}
 }
 Check-Window
 $rect=New-Object ElioStudioInput+RECT
 if (-not [ElioStudioInput]::GetClientRect($hwnd,[ref]$rect)) {throw 'Cannot get Studio client rectangle'}
 $origin=New-Object ElioStudioInput+POINT 0,0
 if (-not [ElioStudioInput]::ClientToScreen($hwnd,[ref]$origin)) {throw 'Cannot map Studio client rectangle'}
 $rect.Right+=$origin.X;$rect.Bottom+=$origin.Y;$rect.Left=$origin.X;$rect.Top=$origin.Y
 $w=$rect.Right-$rect.Left; $h=$rect.Bottom-$rect.Top
 if ($w -lt 100 -or $h -lt 100 -or $w -gt 8192 -or $h -gt 8192 -or ([long]$w*$h) -gt 16777216) {throw 'Invalid/oversize Studio window'}
 Add-Type -AssemblyName System.Windows.Forms
 $screen=[System.Windows.Forms.SystemInformation]::VirtualScreen
 if ($rect.Left -lt $screen.Left -or $rect.Top -lt $screen.Top -or $rect.Right -gt $screen.Right -or $rect.Bottom -gt $screen.Bottom) {throw 'Studio window partly outside screen; move it fully on screen'}
 $uia=$false;$focused='';$controls=@();$truncated=$false
 try {Add-Type -AssemblyName WindowsBase;Add-Type -AssemblyName UIAutomationClient;Add-Type -AssemblyName UIAutomationTypes;$uia=$true;$f=[System.Windows.Automation.AutomationElement]::FocusedElement;if($null -ne $f){$focused=($f.GetRuntimeId() -join ',')}} catch {$focused=''}
 $guard=@{pid=$p.Id;start=$start;hwnd=$hwnd.ToInt64();title=$p.MainWindowTitle;left=$rect.Left;top=$rect.Top;width=$w;height=$h;focus=[ElioStudioInput]::Focus($hwnd);uia_focus=$focused}
 if ($r.action -ne 'snapshot') {
  foreach ($key in @('pid','start','hwnd','title','left','top','width','height')) {if ([string]$guard[$key] -cne [string]$r.guard.$key) {throw "Stale window guard: $key. Take a fresh snapshot"}}
  if ($r.action -eq 'key' -or $r.action -eq 'type_text') {
   if ($guard.focus -ne $r.guard.focus -or $focused -cne $r.guard.uia_focus) {throw 'Keyboard focus changed; take a new snapshot'}
   if ($guard.focus -eq 0) {throw 'No keyboard focus'}
  } else {
   $x=[int]$r.x;$y=[int]$r.y
   if ($x -lt 0 -or $y -lt 0 -or $x -ge $w -or $y -ge $h) {throw 'Point outside screenshot'}
   $point=New-Object ElioStudioInput+POINT ($rect.Left+$x),($rect.Top+$y)
   if ($null -ne $r.element) {
    if (-not $uia) {throw 'Accessibility no longer available'}
    $e=[System.Windows.Automation.AutomationElement]::FromPoint((New-Object System.Windows.Point $point.X,$point.Y))
    $depth=0
    while($null -ne $e -and ($e.GetRuntimeId() -join ',') -cne $r.element.runtime_id -and $depth -lt 8){$e=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($e);$depth++}
    if($null -eq $e){throw 'Accessibility target no longer exists'}
    $name=[string]$e.Current.Name;if($name.Length -gt 240){$name=$name.Substring(0,240)}
    if (($e.GetRuntimeId() -join ',') -cne $r.element.runtime_id -or $name -cne $r.element.name -or $e.Current.ControlType.ProgrammaticName -cne $r.element.control_type -or $e.Current.IsOffscreen -or -not $e.Current.IsEnabled) {throw 'Accessibility target changed/occluded; inspect again'}
   }
   $hit=[ElioStudioInput]::WindowFromPoint($point)
   [uint32]$hitPid=0;[void][ElioStudioInput]::GetWindowThreadProcessId($hit,[ref]$hitPid)
   if ($hitPid -ne $p.Id -or [ElioStudioInput]::GetAncestor($hit,2) -ne $hwnd -or -not [ElioStudioInput]::IsWindowEnabled($hit)) {throw 'Point is covered or outside the Studio main window'}
   if(-not [ElioStudioInput]::SetCursorPos($point.X,$point.Y)){throw 'Cannot move cursor on the current input desktop'}
   $actual=New-Object ElioStudioInput+POINT 0,0
   if(-not [ElioStudioInput]::GetCursorPos([ref]$actual) -or $actual.X -ne $point.X -or $actual.Y -ne $point.Y){throw 'Cursor moved unexpectedly; input cancelled'}
  }
  if([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge [long]$r.deadline_unix_ms){throw 'Snapshot expired before native input; inspect again'}
  [ElioStudioInput]::NoModifiers();Check-Window
  # No implicit retries: this is one atomic SendInput batch.
  switch ($r.action) {
   'click' {[ElioStudioInput]::Mouse(($r.button -eq 'right'),0)}
   'scroll' {[ElioStudioInput]::Mouse($false,[int]$r.delta)}
   'type_text' {[ElioStudioInput]::Text([string]$r.text)}
   'key' {[ElioStudioInput]::Keys([string]$r.key)}
   default {throw 'Unsupported input'}
  }
  @{ok=$true;input_sent=$true;action=$r.action;verified_effect=$false;note='Input submitted once; inspect actual UI/DataModel before any next action. No import, save, trust or visual success inferred.'} | ConvertTo-Json -Compress
 } else {
  if ($uia) {try {
   $root=[System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
   $walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker
   $queue=New-Object 'System.Collections.Generic.Queue[System.Windows.Automation.AutomationElement]';$queue.Enqueue($root)
   $visited=0;$clock=[Diagnostics.Stopwatch]::StartNew()
   while ($queue.Count -gt 0 -and $visited -lt 300 -and $clock.ElapsedMilliseconds -lt 1500) {
    $e=$queue.Dequeue();$visited++;$c=$e.Current;$b=$c.BoundingRectangle
    if (-not $c.IsOffscreen -and $b.Width -gt 0 -and $b.Height -gt 0 -and $c.ProcessId -eq $p.Id) {
     $cx=[int][Math]::Floor($b.X+$b.Width/2)-$rect.Left;$cy=[int][Math]::Floor($b.Y+$b.Height/2)-$rect.Top
     if($cx -ge 0 -and $cy -ge 0 -and $cx -lt $w -and $cy -lt $h){$n=[string]$c.Name;if($n.Length -gt 240){$n=$n.Substring(0,240)};$controls+=@{element_id=$controls.Count;name=$n;control_type=$c.ControlType.ProgrammaticName;enabled=$c.IsEnabled;offscreen=$c.IsOffscreen;x=$cx;y=$cy;runtime_id=($e.GetRuntimeId() -join ',')}}
    }
    $child=$walker.GetFirstChild($e);$siblings=0
    while($null -ne $child -and ($queue.Count+$visited) -lt 300 -and $siblings -lt 100 -and $clock.ElapsedMilliseconds -lt 1500){$queue.Enqueue($child);$child=$walker.GetNextSibling($child);$siblings++}
    if($null -ne $child){$truncated=$true}
   }
   if($queue.Count -gt 0){$truncated=$true}
  } catch {$uia=$false;$controls=@();$truncated=$true} }
  Check-Window
  # Actual screen pixels, not PrintWindow's hidden/offscreen backing content.
  $bitmap=New-Object System.Drawing.Bitmap $w,$h
  try {$graphics=[Drawing.Graphics]::FromImage($bitmap);try{$graphics.CopyFromScreen($rect.Left,$rect.Top,0,0,$bitmap.Size)}finally{$graphics.Dispose()};$stream=New-Object IO.MemoryStream;try{$bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png);if($stream.Length -gt 8388608){throw 'Screenshot exceeds 8 MiB'};$image=[Convert]::ToBase64String($stream.ToArray())}finally{$stream.Dispose()}}finally{$bitmap.Dispose()}
  Check-Window
  @{ok=$true;guard=$guard;image=$image;width=$w;height=$h;window_title=$p.MainWindowTitle;elements=$controls;uia_available=$uia;truncated=$truncated;scope='Real Studio main-window screen pixels. Occluding windows may appear; hit-test guards reject input through them. Floating plugin windows not supported: dock them. Accessibility coverage may be incomplete; use observed screenshot coordinates. Never infer a private catalog search or import.'} | ConvertTo-Json -Depth 8 -Compress
 }
} catch { [Console]::Error.WriteLine($_.Exception.Message);exit 1 }
