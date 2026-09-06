$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Write-Host ''
Write-Host 'LUXX HOSTED DEPLOYMENT - NO GITHUB REQUIRED' -ForegroundColor Magenta
Write-Host 'This deploys the app and Functions directly from this folder.'
Write-Host 'Your LUXX passcode is already built into the private server package.'
Write-Host ''
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'Node.js is required for this CLI method. You can instead use Netlify Drop in your browser with the DROP-READY ZIP.' -ForegroundColor Yellow; Read-Host 'Press Enter'; exit 1 }
Write-Host 'Installing deployment dependencies...'
npm install
Write-Host 'Netlify will open its own login page. GitHub is NOT required.' -ForegroundColor Cyan
npx netlify-cli@latest login
$linked = Test-Path '.netlify\state.json'
if ($linked) {
  npx netlify-cli@latest deploy --prod --open
} else {
  $suffix = Get-Random -Minimum 10000 -Maximum 99999
  $site = "luxx-private-$suffix"
  npx netlify-cli@latest deploy --prod --site-name $site --open
}
Write-Host ''
Write-Host 'DEPLOY COMPLETE. The opened https://...netlify.app address is the LUXX link for your iPhone.' -ForegroundColor Green
Write-Host 'Open YOUR_LUXX_PASSCODE.txt for the private passcode.'
Read-Host 'Press Enter to close'
