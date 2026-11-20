// Ayudante de Windows Hello para Ecos (se compila con el csc de .NET Framework que trae Windows).
// Uso: winhello.exe check | sign <retoBase64> | enroll <retoBase64> | selftest <base64>
using System;
using System.Threading.Tasks;
using Windows.Security.Credentials;
using Windows.Security.Cryptography;

static class EcosHello {
  static string Esc(string s) { return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " "); }
  static int Main(string[] a) {
    try { Console.WriteLine(Run(a).GetAwaiter().GetResult()); }
    catch (Exception e) { Console.WriteLine("{\"error\":\"exception\",\"detail\":\"" + Esc(e.Message) + "\"}"); }
    return 0;
  }
  static async Task<string> Run(string[] a) {
    string mode = a.Length > 0 ? a[0] : "check", arg = a.Length > 1 ? a[1] : "";
    if (mode == "selftest") return "{\"echo\":\"" + CryptographicBuffer.EncodeToBase64String(CryptographicBuffer.DecodeFromBase64String(arg)) + "\"}";
    bool supported = await KeyCredentialManager.IsSupportedAsync();
    if (mode == "check") return "{\"supported\":" + (supported ? "true" : "false") + "}";
    if (!supported) return "{\"error\":\"unsupported\"}";
    KeyCredentialRetrievalResult r = await KeyCredentialManager.OpenAsync("Ecos");
    if (r.Status != KeyCredentialStatus.Success) {
      if (mode != "enroll") return "{\"error\":\"nokey\"}";
      r = await KeyCredentialManager.RequestCreateAsync("Ecos", KeyCredentialCreationOption.ReplaceExisting);
      if (r.Status != KeyCredentialStatus.Success) return "{\"error\":\"" + r.Status + "\"}";
    }
    KeyCredentialOperationResult s = await r.Credential.RequestSignAsync(CryptographicBuffer.DecodeFromBase64String(arg));
    if (s.Status != KeyCredentialStatus.Success) return "{\"error\":\"" + s.Status + "\"}";
    return "{\"signature\":\"" + CryptographicBuffer.EncodeToBase64String(s.Result) + "\"}";
  }
}
