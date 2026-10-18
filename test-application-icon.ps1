$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class elioIconTest {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr LoadLibraryEx(string file,IntPtr unused,uint flags);
 [DllImport("kernel32.dll")] public static extern bool FreeLibrary(IntPtr module);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr LoadImage(IntPtr module,IntPtr name,uint kind,int width,int height,uint flags);
 [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
}
'@
New-Item visual-checks -ItemType Directory -Force | Out-Null
$exe=(Resolve-Path 'agent/target/release/elio.exe').Path
$module=[elioIconTest]::LoadLibraryEx($exe,[IntPtr]::Zero,0x22)
if($module -eq [IntPtr]::Zero){throw 'Cannot open executable resources'}
try {
 foreach($size in @(16,20,24,32,40,48,64,128,256)) {
  $handle=[elioIconTest]::LoadImage($module,[IntPtr]1,1,$size,$size,0)
  if($handle -eq [IntPtr]::Zero){throw "Missing branded resource ID 1 at ${size}px"}
  try {
   $icon=[Drawing.Icon]::FromHandle($handle);$bitmap=$icon.ToBitmap()
   try {
    if($bitmap.Width -ne $size -or $bitmap.Height -ne $size){throw 'Wrong icon dimensions'}
    $orange=0
    for($y=0;$y -lt $size;$y++){for($x=0;$x -lt $size;$x++){$p=$bitmap.GetPixel($x,$y);if($p.R -gt 180 -and $p.G -gt 75 -and $p.G -lt 220 -and $p.B -lt 120 -and $p.A -gt 100){$orange++}}}
    if($orange -lt ($size*$size*0.08)){throw "Missing elio brand pixels at ${size}px"}
    $bitmap.Save((Join-Path $PWD "visual-checks/application-icon-${size}.png"),[Drawing.Imaging.ImageFormat]::Png)
   } finally {$bitmap.Dispose();$icon.Dispose()}
  } finally {[elioIconTest]::DestroyIcon($handle) | Out-Null}
 }
} finally {[elioIconTest]::FreeLibrary($module) | Out-Null}
# Explorer's associated application icon must also resolve the executable resource.
$associated=[Drawing.Icon]::ExtractAssociatedIcon($exe)
try {$bitmap=$associated.ToBitmap();try {$bitmap.Save((Join-Path $PWD 'visual-checks/application-icon-explorer.png'),[Drawing.Imaging.ImageFormat]::Png)} finally {$bitmap.Dispose()}}finally {$associated.Dispose()}
# Compile the production updater and inspect its real background notification icon.
Add-Type -Path (Join-Path $PWD 'Updater-Progress.cs') -ReferencedAssemblies ([Windows.Forms.Form].Assembly.Location),([Drawing.Color].Assembly.Location),'System.dll'
[elio.UpdateProgress]::Open('1.19.30','ocean',$true,'subtle',$true,(Join-Path $PWD 'agent/assets/elio.ico'))
try {
 $binding=[Reflection.BindingFlags]'NonPublic,Static';$window=[elio.UpdateProgress].GetField('currentWindow',$binding).GetValue($null)
 $notice=$window.GetType().GetField('notice',[Reflection.BindingFlags]'NonPublic,Instance').GetValue($window)
 if(!$notice.Visible -or $null -eq $notice.Icon){throw 'Updater tray icon unavailable'}
 $bitmap=$notice.Icon.ToBitmap();try {
 $orange=0;$dark=0
 for($y=0;$y -lt $bitmap.Height;$y++){for($x=0;$x -lt $bitmap.Width;$x++){$p=$bitmap.GetPixel($x,$y);if($p.R -gt 180 -and $p.G -gt 75 -and $p.G -lt 220 -and $p.B -lt 120 -and $p.A -gt 100){$orange++};if($p.R -lt 30 -and $p.G -lt 45 -and $p.B -lt 60 -and $p.A -gt 100){$dark++}}}
 if($orange -lt ($bitmap.Width*$bitmap.Height*0.08) -or $dark -lt ($bitmap.Width*$bitmap.Height*0.35)){throw 'Updater tray icon pixels are corrupt or missing'}
 $bitmap.Save((Join-Path $PWD 'visual-checks/application-icon-updater-tray.png'),[Drawing.Imaging.ImageFormat]::Png)}finally{$bitmap.Dispose()}
 # The loaded icon must not keep the installed asset locked during replacement.
 $stream=[IO.File]::Open((Join-Path $PWD 'agent/assets/elio.ico'),[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);$stream.Dispose()
} finally {[elio.UpdateProgress]::Close()}
Write-Host 'PASS: embedded icon resource, Explorer icon, nine Windows sizes and branded updater tray'
