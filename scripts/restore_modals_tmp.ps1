$base='c:\Users\Damir\Desktop\myhflixer\CURRENT BACKUP'
$map=@(
  @{name='indexMain.html'; start='<div id="settingsModal" class="settings-modal-overlay">'; end='<div id="localDbWarningModal" class="confirm-modal-overlay" style="display:none;">'},
  @{name='indexBrowse.html'; start='<div id="settingsModal" class="settings-modal-overlay">'; end='<script>'; endHint='checkBrowseAccess'},
  @{name='allMovies.html'; start='<div id="settingsModal" class="settings-modal-overlay">'; end='<div id="localDbWarningModal" class="confirm-modal-overlay" style="display:none;">'},
  @{name='personalList.html'; start='<div id="settingsModal" class="settings-modal-overlay">'; end='<script src="/js/myList.js"></script>'},
  @{name='customPlaylists.html'; start='<div id="settingsModal" class="settings-modal-overlay">'; end='<div id="localDbWarningModal" class="confirm-modal-overlay" style="display:none;">'},
  @{name='movieInfo.html'; start='<div id="reviewModal" class="settings-modal-overlay">'; end='<div id="localDbWarningModal" class="confirm-modal-overlay" style="display:none;">'}
)
foreach($m in $map){
  $src=Join-Path $base ('_source_backup\\html\\' + $m.name)
  $dst=Join-Path $base ('html\\' + $m.name)
  $srcText=Get-Content -Raw -Path $src
  $dstText=Get-Content -Raw -Path $dst
  $s1=$srcText.IndexOf($m.start)
  if($s1 -lt 0){ Write-Output "SRC start missing $($m.name)"; continue }
  if($m.ContainsKey('endHint')){
    $e1=$srcText.IndexOf($m.end,$s1)
    while($e1 -ge 0 -and -not $srcText.Substring($e1,[Math]::Min(220,$srcText.Length-$e1)).Contains($m.endHint)){
      $e1=$srcText.IndexOf($m.end,$e1+1)
    }
  } else {
    $e1=$srcText.IndexOf($m.end,$s1)
  }
  if($e1 -lt 0){ Write-Output "SRC end missing $($m.name)"; continue }
  $segment=$srcText.Substring($s1,$e1-$s1)

  $s2=$dstText.IndexOf($m.start)
  if($s2 -lt 0){ Write-Output "DST start missing $($m.name)"; continue }
  if($m.ContainsKey('endHint')){
    $e2=$dstText.IndexOf($m.end,$s2)
    while($e2 -ge 0 -and -not $dstText.Substring($e2,[Math]::Min(220,$dstText.Length-$e2)).Contains($m.endHint)){
      $e2=$dstText.IndexOf($m.end,$e2+1)
    }
  } else {
    $e2=$dstText.IndexOf($m.end,$s2)
  }
  if($e2 -lt 0){ Write-Output "DST end missing $($m.name)"; continue }

  $newText=$dstText.Substring(0,$s2) + $segment + $dstText.Substring($e2)
  Set-Content -Path $dst -Value $newText -Encoding UTF8
  Write-Output "Restored segment in $($m.name)"
}
