# Prepara a Secretária no Windows e abre o painel. Rodar de novo não estraga nada.
# Só faz o que precisa existir antes do Bun; o resto é `bun secretaria instalar`.
$ErrorActionPreference = "Stop"

# Mínimo de `engines.bun` no package.json, e a versão que este script instala quando falta.
$BunVersao = "1.4.4"
$BunRaiz = if ($env:BUN_INSTALL) { $env:BUN_INSTALL } else { Join-Path $HOME ".bun" }
$BunExe = Join-Path $BunRaiz "bin\bun.exe"

Set-Location -LiteralPath $PSScriptRoot

# Verdadeiro quando o comando existe e responde uma versão igual ou mais nova que a mínima.
# Um Bun mais novo serve como está: este script nunca rebaixa.
function Test-BunServe([string]$Comando) {
  try { $texto = [string](& $Comando --version 2>$null) } catch { return $false }
  $versao = $null
  if (-not [version]::TryParse(($texto.Trim() -replace '[^0-9.].*$', ''), [ref]$versao)) { return $false }
  return $versao -ge [version]$BunVersao
}

if (-not (Test-BunServe "bun")) {
  if (-not (Test-BunServe $BunExe)) {
    # Instalador oficial com versão fixa: https://bun.com/docs/installation
    Invoke-Expression "& {$(Invoke-RestMethod https://bun.com/install.ps1)} -Version $BunVersao"
  }
  $env:Path = "$(Join-Path $BunRaiz 'bin');$env:Path"
}

# Programa externo não para o script sozinho quando falha; a saída diferente de zero para.
foreach ($argumentos in @(@("install", "--frozen-lockfile"), @("secretaria", "instalar"), @("secretaria", "abrir"))) {
  & bun @argumentos
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
