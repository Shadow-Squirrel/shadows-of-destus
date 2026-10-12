# ===============================================================
#  setup-email.ps1 - turn on real email for password resets (one time).
#
#  Supabase's built-in mailer allows ~2-4 emails an hour, so reset links
#  stop arriving almost immediately. This pushes the [auth.email.smtp]
#  block from supabase/config.toml to your hosted project, reading the
#  SMTP password from a hidden prompt (it is never written to disk or to
#  the repo), then sends a real password-reset email to prove it works.
#
#  Before running (once per computer): npx supabase login, then
#  npx supabase link --project-ref <ref>  (see README). Then, from the
#  project folder in PowerShell:
#      .\tools\setup-email.ps1
#  What to paste when asked: a Gmail App Password (16 letters) or a
#  Resend API key (re_...) - docs/ACCOUNTS.md section 4 explains both.
#
#  (Plain ASCII on purpose: Windows PowerShell 5.1 reads BOM-less files
#  as Windows-1252, and non-ASCII punctuation can break string literals.)
# ===============================================================
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ""
Write-Host "Onyx Dungeon - email setup" -ForegroundColor Yellow
Write-Host "Pushes the SMTP settings in supabase\config.toml to your Supabase project."
Write-Host ""

# -- is the project linked on this computer? ----------------------
if (-not (Test-Path (Join-Path $root "supabase\.temp\project-ref"))) {
  Write-Host "This folder isn't linked to your Supabase project yet. Run these first:" -ForegroundColor Red
  Write-Host "    npx supabase login"
  Write-Host "    npx supabase link --project-ref wmagwmnqmapasppgfpnj"
  Write-Host "then run this script again."
  exit 1
}

# -- the secret, typed hidden, kept only in this process ----------
$secure = Read-Host -AsSecureString "SMTP password (typing is hidden)"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
$plain = ($plain -replace '\s', '')   # Gmail shows app passwords with spaces; they aren't part of it
if ([string]::IsNullOrWhiteSpace($plain)) {
  Write-Host "No password entered - nothing changed." -ForegroundColor Red
  exit 1
}
$env:SMTP_PASS = $plain
$plain = $null

try {
  # -- 1/3 preview ------------------------------------------------
  Write-Host "1/3  What would change on the project (review it):" -ForegroundColor Cyan
  Write-Host "     Say Y to the auth / smtp changes. If it offers anything that is NOT under" -ForegroundColor DarkGray
  Write-Host "     'auth' (storage, db, api...), answer N - those aren't part of this." -ForegroundColor DarkGray
  Write-Host ""
  npx supabase config diff
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Couldn't read the project's config (see above). Nothing was changed." -ForegroundColor Red
    Write-Host "Usually this means 'npx supabase login' or 'npx supabase link' needs re-running." -ForegroundColor Yellow
    exit 1
  }
  Write-Host ""

  # -- 2/3 push ---------------------------------------------------
  Write-Host "2/3  Pushing (it asks before each change):" -ForegroundColor Cyan
  npx supabase config push
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Push failed - fix the message above and re-run." -ForegroundColor Red
    exit 1
  }
}
finally {
  Remove-Item Env:SMTP_PASS -ErrorAction SilentlyContinue
}

# -- 3/3 prove it: send a real password-reset email ---------------
Write-Host ""
$cfg  = Get-Content (Join-Path $root "js\config.js") -Raw
$url  = [regex]::Match($cfg, 'SUPABASE_URL:\s*"([^"]+)"').Groups[1].Value
$anon = [regex]::Match($cfg, 'SUPABASE_ANON_KEY:\s*"([^"]+)"').Groups[1].Value
if (-not $url -or -not $anon) {
  Write-Host "Pushed. (Couldn't read js/config.js to send a test - try 'Forgot password?' on the site.)" -ForegroundColor Yellow
  exit 0
}

$to = Read-Host "3/3  Send a test password-reset email to which address? (your own login email; Enter to skip)"
if ($to) {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $redirect = [uri]::EscapeDataString("https://onyxdungeon.com/reset.html")
    $body = @{ email = $to } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post -Uri "$url/auth/v1/recover?redirect_to=$redirect" `
      -Headers @{ apikey = $anon } -ContentType "application/json" -Body $body | Out-Null
    Write-Host ""
    Write-Host "Sent. Check that inbox (and spam) for 'Reset Your Password'." -ForegroundColor Green
    Write-Host "If it arrived, email is set up for good - resets and invites now just work." -ForegroundColor Green
  } catch {
    Write-Host "Test send failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "The settings are pushed; check Supabase -> Authentication -> Logs for the SMTP error." -ForegroundColor Yellow
  }
}
