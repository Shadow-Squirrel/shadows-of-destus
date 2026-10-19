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

# -- refuse to push storage features that need a paid plan --------
# The CLI template turns on vector buckets by default; on the free tier
# the storage push then fails with "402 ... upgrade ... vector buckets".
$toml = Get-Content (Join-Path $root "supabase\config.toml") -Raw
foreach ($feature in @("vector", "analytics", "image_transformation")) {
  $section = [regex]::Match($toml, '(?ms)^\[storage\.' + $feature + '\][ \t]*(?:#[^\r\n]*)?\r?$(.*?)(?=^[ \t]*\[|\z)')
  if ($section.Success -and ($section.Groups[1].Value -match '(?m)^\s*enabled\s*=\s*true')) {
    Write-Host "supabase\config.toml turns on [storage.$feature], which needs a paid Supabase plan." -ForegroundColor Red
    Write-Host "Comment that block out (there's a note above it in the file) and re-run."
    exit 1
  }
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
  Write-Host ""
  npx supabase config diff
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Couldn't read the project's config (see above). Nothing was changed." -ForegroundColor Red
    Write-Host "Usually this means 'npx supabase login' or 'npx supabase link' needs re-running." -ForegroundColor Yellow
    exit 1
  }
  Write-Host ""

  # -- 2/3 push ---------------------------------------------------
  Write-Host "2/3  Pushing. The CLI asks about each section that has changes, in this order:" -ForegroundColor Cyan
  Write-Host "       api  ->  db.settings  ->  db.network_restrictions  ->  db.ssl_enforcement  ->  AUTH  ->  storage" -ForegroundColor DarkGray
  Write-Host "     Answer Y ONLY to 'auth' (that's the email settings)." -ForegroundColor Yellow
  Write-Host "     Answer N to every other section it offers - type the letter N; just pressing" -ForegroundColor Yellow
  Write-Host "     Enter picks the highlighted Yes." -ForegroundColor Yellow
  Write-Host "     A section that prints 'is up to date' asks nothing - that's fine." -ForegroundColor DarkGray
  Write-Host ""
  npx supabase config push
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Push stopped on an error (see above)." -ForegroundColor Red
    Write-Host "If it died on 'storage' (the section after auth), the auth settings were already" -ForegroundColor Yellow
    Write-Host "pushed: re-run this script, answer N to storage, and it carries on to the test email." -ForegroundColor Yellow
    Write-Host "If it died on api or db, nothing was pushed yet - fix the message above and re-run." -ForegroundColor Yellow
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
    Write-Host "Request accepted. If that address has an account on the site, 'Reset Your Password'" -ForegroundColor Green
    Write-Host "is on its way - check the inbox and spam. If it arrived, email is set up for good." -ForegroundColor Green
  } catch {
    # Show what Supabase actually said (the JSON body), not just the HTTP status.
    $status = $null
    $detail = $_.ErrorDetails.Message
    if ($_.Exception.Response) {
      try { $status = [int]$_.Exception.Response.StatusCode } catch {}
      if (-not $detail) {
        try { $detail = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
      }
    }
    Write-Host "Test send failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($detail) { Write-Host "  Supabase said: $detail" -ForegroundColor Red }
    if ($status -eq 429) {
      Write-Host "That's the hourly email limit, not an SMTP problem. The settings are pushed;" -ForegroundColor Yellow
      Write-Host "wait an hour, then try 'Forgot password?' on the site." -ForegroundColor Yellow
    } else {
      Write-Host "The settings are pushed; check Supabase -> Authentication -> Logs for the SMTP error." -ForegroundColor Yellow
    }
  }
}
