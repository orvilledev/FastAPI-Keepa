# Sends raw bytes (ZPL) to a Windows-installed printer by name via the print
# spooler's RAW datatype. Printer name and source file are passed as env vars
# (ZPL_PRINTER / ZPL_FILE) to avoid any command-line quoting/injection issues.
$ErrorActionPreference = 'Stop'

$printerName = $env:ZPL_PRINTER
$filePath = $env:ZPL_FILE

if ([string]::IsNullOrWhiteSpace($printerName)) { throw 'Printer name is required.' }
if (-not (Test-Path -LiteralPath $filePath)) { throw "Label data file not found: $filePath" }

$source = @'
using System;
using System.Runtime.InteropServices;

public static class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFO di);
  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
  static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static void Send(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
      throw new Exception("Could not open printer '" + printerName + "' (error " + Marshal.GetLastWin32Error() + ").");
    try {
      DOCINFO di = new DOCINFO();
      di.pDocName = "ZPL Label";
      di.pDataType = "RAW";
      if (!StartDocPrinter(hPrinter, 1, ref di))
        throw new Exception("StartDocPrinter failed (error " + Marshal.GetLastWin32Error() + ").");
      try {
        if (!StartPagePrinter(hPrinter))
          throw new Exception("StartPagePrinter failed (error " + Marshal.GetLastWin32Error() + ").");
        IntPtr pBytes = Marshal.AllocHGlobal(bytes.Length);
        try {
          Marshal.Copy(bytes, 0, pBytes, bytes.Length);
          int written;
          if (!WritePrinter(hPrinter, pBytes, bytes.Length, out written))
            throw new Exception("WritePrinter failed (error " + Marshal.GetLastWin32Error() + ").");
        } finally {
          Marshal.FreeHGlobal(pBytes);
        }
        EndPagePrinter(hPrinter);
      } finally {
        EndDocPrinter(hPrinter);
      }
    } finally {
      ClosePrinter(hPrinter);
    }
  }
}
'@

Add-Type -TypeDefinition $source -Language CSharp

$bytes = [System.IO.File]::ReadAllBytes($filePath)
[RawPrinter]::Send($printerName, $bytes)
Write-Output 'OK'
