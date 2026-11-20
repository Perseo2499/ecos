// Ayudante de Windows Hello para Ecos (se compila con el csc de .NET Framework que trae Windows).
// Uso: winhello.exe check | sign <retoBase64> | enroll <retoBase64> | selftest <base64>
// Responde una línea JSON: {"supported":…} | {"signature":"…"} | {"error":"…"}
using System;
using System.Threading;
using Windows.Foundation;
using Windows.Security.Credentials;
using Windows.Security.Cryptography;

static class EcosHello {
  static string Esc(string s) { return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " "); }
  // Espera una operación de Windows (sin «await»: con .NET Framework las proyecciones no casan)
  static T Wait<T>(IAsyncOperation<T> op) {
    while (op.Status == AsyncStatus.Started) Thread.Sleep(15);
    if (op.Status == AsyncStatus.Error) throw op.ErrorCode;
    if (op.Status == AsyncStatus.Canceled) throw new OperationCanceledException();
    return op.GetResults();
  }
  static int Main(string[] a) {
    try { Console.WriteLine(Run(a)); }
    catch (Exception e) { Console.WriteLine("{\"error\":\"exception\",\"detail\":\"" + Esc(e.Message) + "\"}"); }
    return 0;
  }
  static string Run(string[] a) {
    string mode = a.Length > 0 ? a[0] : "check", arg = a.Length > 1 ? a[1] : "";
    if (mode == "selftest") return "{\"echo\":\"" + CryptographicBuffer.EncodeToBase64String(CryptographicBuffer.DecodeFromBase64String(arg)) + "\"}";
    bool supported = Wait(KeyCredentialManager.IsSupportedAsync());
    if (mode == "check") return "{\"supported\":" + (supported ? "true" : "false") + "}";
    if (!supported) return "{\"error\":\"unsupported\"}";
    KeyCredentialRetrievalResult r = Wait(KeyCredentialManager.OpenAsync("Ecos"));
    if (r.Status != KeyCredentialStatus.Success) {
      if (mode != "enroll") return "{\"error\":\"nokey\"}";
      r = Wait(KeyCredentialManager.RequestCreateAsync("Ecos", KeyCredentialCreationOption.ReplaceExisting));
      if (r.Status != KeyCredentialStatus.Success) return "{\"error\":\"" + r.Status + "\"}";
    }
    KeyCredentialOperationResult s = Wait(r.Credential.RequestSignAsync(CryptographicBuffer.DecodeFromBase64String(arg)));
    if (s.Status != KeyCredentialStatus.Success) return "{\"error\":\"" + s.Status + "\"}";
    return "{\"signature\":\"" + CryptographicBuffer.EncodeToBase64String(s.Result) + "\"}";
  }
}
