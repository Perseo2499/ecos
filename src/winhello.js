// Windows Hello (huella, cara o PIN de Windows) para desbloquear Ecos.
// Usa KeyCredentialManager (WinRT) a través de Windows PowerShell, sin módulos nativos: Windows Hello firma
// un reto con una clave guardada en el TPM del ordenador; de esa firma (RSA PKCS#1, siempre la misma para el
// mismo reto) sale la llave que abre la copia de la llave de la bóveda. Sin Windows Hello no hay llave.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SCRIPT = String.raw`param([string]$Mode = 'check', [string]$ChallengeB64 = '')
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + '`' + String.raw`1' })[0]
  function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
  $null = [Windows.Security.Credentials.KeyCredentialManager, Windows.Security.Credentials, ContentType = WindowsRuntime]
  $null = [Windows.Security.Cryptography.CryptographicBuffer, Windows.Security.Cryptography, ContentType = WindowsRuntime]
  $CB = [Windows.Security.Cryptography.CryptographicBuffer]
  $KCM = [Windows.Security.Credentials.KeyCredentialManager]
  $supported = Await ($KCM::IsSupportedAsync()) ([bool])
  if ($Mode -eq 'check') { @{ supported = $supported } | ConvertTo-Json -Compress; exit 0 }
  if (-not $supported) { @{ error = 'unsupported' } | ConvertTo-Json -Compress; exit 0 }
  $RT = [Windows.Security.Credentials.KeyCredentialRetrievalResult]
  $r = Await ($KCM::OpenAsync('Ecos')) ($RT)
  if ([string]$r.Status -ne 'Success') {
    if ($Mode -ne 'enroll') { @{ error = 'nokey' } | ConvertTo-Json -Compress; exit 0 }
    $r = Await ($KCM::RequestCreateAsync('Ecos', [Windows.Security.Credentials.KeyCredentialCreationOption]::ReplaceExisting)) ($RT)
    if ([string]$r.Status -ne 'Success') { @{ error = [string]$r.Status } | ConvertTo-Json -Compress; exit 0 }
  }
  # (conversión con la API de Windows: PowerShell no resuelve bien las de .NET para IBuffer)
  $buf = $CB::DecodeFromBase64String($ChallengeB64)
  $s = Await ($r.Credential.RequestSignAsync($buf)) ([Windows.Security.Credentials.KeyCredentialOperationResult])
  if ([string]$s.Status -ne 'Success') { @{ error = [string]$s.Status } | ConvertTo-Json -Compress; exit 0 }
  @{ signature = $CB::EncodeToBase64String($s.Result) } | ConvertTo-Json -Compress
} catch { @{ error = 'exception'; detail = $_.Exception.Message } | ConvertTo-Json -Compress }
`;

function run(mode, challengeB64 = '') {
  if (process.platform !== 'win32') return Promise.resolve({ error: 'unsupported' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-hello-'));
  const file = path.join(dir, 'hello.ps1');
  fs.writeFileSync(file, '﻿' + SCRIPT, 'utf8');
  return new Promise((resolve) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, '-Mode', mode, '-ChallengeB64', challengeB64], { windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => ps.kill(), 120000);
    ps.stdout.on('data', (d) => (out += d));
    ps.stderr.on('data', (d) => (err += d));
    ps.on('error', (e) => { clearTimeout(timer); resolve({ error: 'exception', detail: e.message }); });
    ps.on('close', () => {
      clearTimeout(timer);
      fs.rmSync(dir, { recursive: true, force: true });
      const line = out.trim().split(/\r?\n/).filter(Boolean).pop() || '';
      try { resolve(JSON.parse(line)); } catch { resolve({ error: 'exception', detail: (err || out).trim().slice(0, 300) }); }
    });
  });
}

const ERRORS = {
  unsupported: 'Windows Hello no está configurado en este ordenador (Configuración de Windows → Cuentas → Opciones de inicio de sesión).',
  nokey: 'Windows Hello ya no tiene la clave de Ecos. Entra con la contraseña y vuelve a activarlo en Ajustes → Seguridad.',
  UserCanceled: 'Has cancelado Windows Hello.',
  NotFound: 'Windows Hello no encuentra la clave de Ecos.',
  UserPrefersPassword: 'Has elegido usar la contraseña.',
  SecurityDeviceLocked: 'El dispositivo de seguridad está bloqueado por demasiados intentos.',
};
const explain = (r) => ERRORS[r.error] || `Windows Hello no ha funcionado (${r.error}${r.detail ? ': ' + r.detail : ''}).`;

let supportedCache = null;
async function supported() {
  if (process.platform !== 'win32') return false;
  if (supportedCache === null) supportedCache = !!(await run('check')).supported;
  return supportedCache;
}
// Firma el reto con Windows Hello y devuelve la llave (32 bytes) derivada de la firma
async function keyFor(challengeB64, enroll = false) {
  const r = await run(enroll ? 'enroll' : 'sign', challengeB64);
  if (!r.signature) throw new Error(explain(r));
  return crypto.createHash('sha256').update('ecos-winhello-v1').update(Buffer.from(r.signature, 'base64')).digest();
}

module.exports = { supported, keyFor, run, SCRIPT };
