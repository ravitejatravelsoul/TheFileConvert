# Renders .docx files to PDF with the installed Microsoft Word (QA only).
#   powershell -NoProfile -File qa/validate/wordrender.ps1 -OutDir <dir> <file.docx> [...]
# Uses its own invisible Word instance; never touches documents the user has open: it opens only the given
# files read-only, closes only them, and quits Word only if this script's instance had no other documents.
param([Parameter(Mandatory = $true)][string]$OutDir, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Files)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$ownInstance = ($word.Documents.Count -eq 0)
$results = @()
try {
  foreach ($f in $Files) {
    $full = (Resolve-Path $f).Path
    $out = Join-Path (Resolve-Path $OutDir).Path (([IO.Path]::GetFileNameWithoutExtension($full)) + ".pdf")
    $doc = $null
    try {
      # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles)
      $doc = $word.Documents.Open($full, $false, $true, $false)
      $doc.ExportAsFixedFormat($out, 17)  # 17 = wdExportFormatPDF
      $results += [pscustomobject]@{ file = $full; pdf = $out; pages = $doc.ComputeStatistics(2); ok = $true }
    } catch {
      $results += [pscustomobject]@{ file = $full; pdf = $null; pages = $null; ok = $false; error = $_.Exception.Message }
    } finally {
      if ($doc) { $doc.Close(0) }  # 0 = wdDoNotSaveChanges
    }
  }
} finally {
  if ($ownInstance -and $word.Documents.Count -eq 0) { $word.Quit(0) }
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
$results | ConvertTo-Json -Compress
