param(
    [Parameter(Mandatory=$true)][string]$ExePath
)

Add-Type -AssemblyName System.Drawing

$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

$rect = New-Object System.Drawing.RectangleF(10, 10, 236, 236)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 42.0
$path.AddArc($rect.X, $rect.Y, $r, $r, 180, 90)
$path.AddArc($rect.Right-$r, $rect.Y, $r, $r, 270, 90)
$path.AddArc($rect.Right-$r, $rect.Bottom-$r, $r, $r, 0, 90)
$path.AddArc($rect.X, $rect.Bottom-$r, $r, $r, 90, 90)
$path.CloseFigure()

$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 5, 15, 29),
    [System.Drawing.Color]::FromArgb(255, 12, 31, 52),
    45
)
$g.FillPath($bg, $path)

$border = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 255, 151, 39), 6)
$g.DrawPath($border, $path)

$orange = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 166, 52))
$dark = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 6, 20, 38))

$g.FillRectangle($orange, 72, 62, 30, 120)
$g.FillRectangle($orange, 94, 62, 72, 28)
$g.FillRectangle($orange, 94, 112, 64, 28)
$g.FillEllipse($orange, 128, 62, 62, 78)
$g.FillEllipse($dark, 139, 86, 28, 30)
$g.FillRectangle($dark, 96, 90, 60, 22)

$points1 = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF(78, 170)),
    (New-Object System.Drawing.PointF(103, 170)),
    (New-Object System.Drawing.PointF(78, 220)),
    (New-Object System.Drawing.PointF(53, 220))
)
$points2 = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF(111, 170)),
    (New-Object System.Drawing.PointF(136, 170)),
    (New-Object System.Drawing.PointF(111, 220)),
    (New-Object System.Drawing.PointF(86, 220))
)
$g.FillPolygon($orange, $points1)
$g.FillPolygon($orange, $points2)

$icoPath = [System.IO.Path]::ChangeExtension($ExePath, ".ico")
$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$stream = [System.IO.File]::Create($icoPath)
$icon.Save($stream)
$stream.Close()
$icon.Dispose()

$g.Dispose()
$bmp.Dispose()
$bg.Dispose()
$border.Dispose()
$orange.Dispose()
$dark.Dispose()
$path.Dispose()

$source = @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class elioIconResource {
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    static extern IntPtr BeginUpdateResource(string fileName, bool deleteExistingResources);

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool UpdateResource(
        IntPtr update,
        IntPtr type,
        IntPtr name,
        ushort language,
        byte[] data,
        uint size
    );

    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool EndUpdateResource(IntPtr update, bool discard);

    static IntPtr Resource(int id) { return (IntPtr)id; }

    public static void Apply(string exePath, string icoPath) {
        const int RT_ICON = 3;
        const int RT_GROUP_ICON = 14;

        byte[] ico = File.ReadAllBytes(icoPath);
        int count = BitConverter.ToUInt16(ico, 4);
        if (count < 1) throw new InvalidDataException("Generated icon contains no image.");

        int width = ico[6] == 0 ? 256 : ico[6];
        int height = ico[7] == 0 ? 256 : ico[7];
        byte colorCount = ico[8];
        ushort planes = BitConverter.ToUInt16(ico, 10);
        ushort bitCount = BitConverter.ToUInt16(ico, 12);
        int bytesInRes = BitConverter.ToInt32(ico, 14);
        int offset = BitConverter.ToInt32(ico, 18);

        byte[] image = new byte[bytesInRes];
        Buffer.BlockCopy(ico, offset, image, 0, bytesInRes);

        byte[] group = new byte[20];
        group[0] = 0; group[1] = 0;
        group[2] = 1; group[3] = 0;
        group[4] = 1; group[5] = 0;
        group[6] = (byte)(width == 256 ? 0 : width);
        group[7] = (byte)(height == 256 ? 0 : height);
        group[8] = colorCount;
        group[9] = 0;
        Buffer.BlockCopy(BitConverter.GetBytes(planes), 0, group, 10, 2);
        Buffer.BlockCopy(BitConverter.GetBytes(bitCount), 0, group, 12, 2);
        Buffer.BlockCopy(BitConverter.GetBytes(bytesInRes), 0, group, 14, 4);
        Buffer.BlockCopy(BitConverter.GetBytes((ushort)1), 0, group, 18, 2);

        IntPtr update = BeginUpdateResource(exePath, false);
        if (update == IntPtr.Zero) {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }

        if (!UpdateResource(update, Resource(RT_ICON), Resource(1), 0, image, (uint)image.Length)) {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }

        if (!UpdateResource(update, Resource(RT_GROUP_ICON), Resource(1), 0, group, (uint)group.Length)) {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }

        if (!EndUpdateResource(update, false)) {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
    }
}
'@

Add-Type -TypeDefinition $source -Language CSharp
[elioIconResource]::Apply($ExePath, $icoPath)
Remove-Item $icoPath -Force
Write-Host "Embedded elio icon into $ExePath"
