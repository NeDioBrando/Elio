# Burst-capture a Roblox Studio window to numbered frames, for frame-by-frame review.
#
# WHY. A single screenshot cannot show a SWING. It cannot show whether a weapon
# passes through the forearm at the top of an arc, whether a trail follows the
# blade, or whether a shockwave draws at the right radius - those are all things
# that exist for a handful of frames and are gone. Judging animation and VFX
# from one still is how a build gets signed off with the weapon in the wrong
# hand, which is exactly what happened here.
#
#   powershell -File render/capture_frames.ps1 -TitleMatch "Place1" -Seconds 12 -Fps 5
#
# Then assemble a contact sheet and LOOK at every frame.
#
# TWO TRAPS THIS SCRIPT NOW REFUSES TO WALK INTO, both of which produced a
# 45-frame capture of the wrong thing:
#
# 1. A "Server & Clients" playtest runs FOUR RobloxStudioBeta processes - the
#    editor, the server, and one per client. `Get-Process | Select -First 1`
#    returns whichever the OS lists first, and here that was the EDITOR, which
#    is a maximised window sitting behind everything. Pick the window by TITLE
#    (a client window is titled "Place1", the host is "Server", the editor is
#    the place name), never by process order.
#
# 2. `SetForegroundWindow` IS REFUSED when called from a process that does not
#    already own the foreground - Windows returns false and does nothing. The
#    capture then reads the screen at the target's rect and gets whatever is
#    actually on top of it. That is not a subtle corruption: it produced a
#    contact sheet of the chat window with the game nowhere in it. So this
#    script VERIFIES the foreground window is the target after asking, and
#    ABORTS if it is not. A capture that cannot see its subject must fail, not
#    return 45 confident PNGs of something else.

param(
  [string]$TitleMatch = "Place1",
  [double]$Seconds = 12,
  [double]$Fps = 5,
  [string]$Out = "render/frames",
  [string]$Prefix = "f",
  [switch]$AllowBackground,  # only for a window you have already confirmed is visible
  [int64]$Hwnd = 0,          # pick an exact window when several share a title
  [string]$MoveTo = ""       # "x,y,w,h" - reposition the window clear of any overlay first
)

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace CapN -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int n);
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
public struct RECT { public int Left, Top, Right, Bottom; }
'@

# ---- find the window by title, among every visible top-level window ----------
$found = New-Object System.Collections.ArrayList
$cb = [CapN.W+EnumWindowsProc]{
  param($h, $l)
  if ([CapN.W]::IsWindowVisible($h)) {
    $len = [CapN.W]::GetWindowTextLength($h)
    if ($len -gt 0) {
      $sb = New-Object System.Text.StringBuilder ($len + 1)
      [void][CapN.W]::GetWindowText($h, $sb, $sb.Capacity)
      $t = $sb.ToString()
      if ($t -like "*$TitleMatch*") {
        $r = New-Object CapN.W+RECT
        [void][CapN.W]::GetWindowRect($h, [ref]$r)
        if (($r.Right - $r.Left) -gt 200 -and ($r.Bottom - $r.Top) -gt 200) {
          [void]$found.Add([pscustomobject]@{ H = $h; T = $t; R = $r })
        }
      }
    }
  }
  return $true
}
[void][CapN.W]::EnumWindows($cb, [IntPtr]::Zero)

if ($found.Count -eq 0) { Write-Output "no visible window matching '$TitleMatch'"; exit 1 }
if ($found.Count -gt 1 -and $Hwnd -eq 0) {
  # A "Server & Clients" test gives every client the SAME title. Guessing which
  # one is a coin flip, and a coin flip is how a capture of the wrong window
  # gets believed. Say so, and list them.
  Write-Output "several windows match '$TitleMatch' - pass -Hwnd to choose:"
  $found | ForEach-Object { Write-Output ("  -Hwnd {0}  '{1}'  {2},{3} {4}x{5}" -f [int64]$_.H, $_.T, $_.R.Left, $_.R.Top, ($_.R.Right-$_.R.Left), ($_.R.Bottom-$_.R.Top)) }
  exit 3
}
$target = if ($Hwnd -ne 0) { $found | Where-Object { [int64]$_.H -eq $Hwnd } | Select-Object -First 1 } else { $found[0] }
if (-not $target) { Write-Output "hwnd $Hwnd is not among the matching windows"; exit 1 }
Write-Output ("target: hwnd={0} title='{1}'" -f [int64]$target.H, $target.T)

# ---- move it clear of anything drawing over it ------------------------------
# An always-on-top panel covers a foreground window without changing which
# window IS the foreground, so the abort check below cannot see it. Moving the
# game window out from under the overlay is the only reliable answer.
if ($MoveTo -ne "") {
  $m = $MoveTo -split ","
  [void][CapN.W]::SetWindowPos($target.H, [IntPtr]::Zero, [int]$m[0], [int]$m[1], [int]$m[2], [int]$m[3], 0x0014)
  Start-Sleep -Milliseconds 500
}

# ---- bring it forward, and PROVE it came forward ----------------------------
[void][CapN.W]::ShowWindow($target.H, 5)
Start-Sleep -Milliseconds 200
[void][CapN.W]::SetForegroundWindow($target.H)
Start-Sleep -Milliseconds 600

$fg = [CapN.W]::GetForegroundWindow()
if ($fg -ne $target.H -and -not $AllowBackground) {
  Write-Output ("ABORT: foreground is hwnd={0}, not the target. SetForegroundWindow was refused." -f [int64]$fg)
  Write-Output "Click the window first (or pass -AllowBackground if you know it is unoccluded)."
  exit 2
}

# Re-read the rect AFTER activation; restoring a window changes it.
$r = New-Object CapN.W+RECT
[void][CapN.W]::GetWindowRect($target.H, [ref]$r)
$x = [Math]::Max(0, $r.Left); $y = [Math]::Max(0, $r.Top)
$w = $r.Right - $x; $h2 = $r.Bottom - $y

if (-not (Test-Path $Out)) { New-Item -ItemType Directory -Force -Path $Out | Out-Null }
Get-ChildItem -Path $Out -Filter "$Prefix*.png" -ErrorAction SilentlyContinue | Remove-Item -Force

$total = [int]($Seconds * $Fps)
$interval = [int](1000 / $Fps)
$bmp = New-Object System.Drawing.Bitmap $w, $h2
$g = [System.Drawing.Graphics]::FromImage($bmp)

for ($i = 0; $i -lt $total; $i++) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $g.CopyFromScreen($x, $y, 0, 0, $bmp.Size)
  $name = "{0}{1:d3}.png" -f $Prefix, $i
  $bmp.Save((Join-Path $Out $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $sw.Stop()
  $wait = $interval - $sw.ElapsedMilliseconds
  if ($wait -gt 0) { Start-Sleep -Milliseconds $wait }
}

$g.Dispose()
$bmp.Dispose()
Write-Output ("captured {0} frames at {1}fps into {2} (rect {3},{4} {5}x{6})" -f $total, $Fps, $Out, $x, $y, $w, $h2)
