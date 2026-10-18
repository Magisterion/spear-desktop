using System;
using System.IO;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Runs independently of Electron and the NSIS portable extraction directory.
internal static class PortableUpdater {
  public sealed class Request {
    public int pid; public string source; public string target; public string hash;
    public string ready; public string result; public string launch; public string version;
  }
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
  static void Write(string path, object value) {
    File.WriteAllText(path, Json.Serialize(value), new UTF8Encoding(false));
  }
  [STAThread] static int Main(string[] args) {
    Request p = null; bool acknowledged = false; string stage = "startup";
    try {
      p = Json.Deserialize<Request>(Encoding.UTF8.GetString(Convert.FromBase64String(args[0])));
      stage = "verification";
      string digest;
      using (var stream = File.OpenRead(p.source)) using (var sha = SHA256.Create())
        digest = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
      if (!String.Equals(digest, p.hash, StringComparison.OrdinalIgnoreCase)) throw new Exception("The downloaded file failed verification.");
      string incoming = p.target + ".incoming";
      // Check write access before allowing the app to shut down. Keep the cached download intact.
      File.Copy(p.source, incoming, true);
      Write(p.ready, new { state = "ready", pid = Process.GetCurrentProcess().Id });
      acknowledged = true;
      stage = "waiting-for-player";
      try { using (var parent = Process.GetProcessById(p.pid)) {
        if (!parent.WaitForExit(120000)) throw new Exception("The player did not exit within two minutes.");
      }} catch (ArgumentException) { /* Already exited. */ }
      stage = "replacement";
      string backup = p.target + ".previous";
      Exception last = null;
      for (int i = 0; i < 120; i++) {
        try {
          // The portable launcher can briefly hold the EXE while cleaning its temporary extraction.
          if (File.Exists(p.target)) File.Replace(incoming, p.target, backup, true);
          else File.Move(incoming, p.target);
          last = null; break;
        } catch (IOException e) { last = e; Thread.Sleep(500); }
          catch (UnauthorizedAccessException e) { last = e; Thread.Sleep(500); }
      }
      if (last != null) throw last;
      stage = "relaunch";
      if (File.Exists(p.launch)) File.Delete(p.launch);
      var start = new ProcessStartInfo(p.target) { WorkingDirectory = Path.GetDirectoryName(p.target), UseShellExecute = false };
      // Never inherit the old portable extraction or Electron/Node launch mode.
      foreach (string key in new [] { "PORTABLE_EXECUTABLE_DIR", "PORTABLE_EXECUTABLE_FILE", "PORTABLE_EXECUTABLE_APP_FILENAME", "ELECTRON_RUN_AS_NODE", "NODE_OPTIONS" }) start.EnvironmentVariables.Remove(key);
      Process.Start(start);
      stage = "confirming-launch";
      bool launched = false;
      for (int i = 0; i < 180; i++) {
        try {
          var receipt = Json.Deserialize<Request>(File.ReadAllText(p.launch));
          if (receipt.version == p.version && receipt.pid != p.pid) {
            using (var process = Process.GetProcessById(receipt.pid)) launched = !process.HasExited;
            if (launched) break;
          }
        } catch { }
        Thread.Sleep(500);
      }
      if (!launched) throw new Exception("The new version did not confirm startup. Start YouTube-Music-Spear.exe manually. The verified download and previous EXE are preserved.");
      Write(p.result, new { success = true, stage = "complete", version = p.version });
      return 0;
    } catch (Exception e) {
      if (p != null) {
        try { Write(p.result, new { success = false, stage, error = e.Message }); } catch { }
        if (!acknowledged) { try { Write(p.ready, new { state = "error", stage, error = e.Message }); } catch { } }
      }
      if (acknowledged) MessageBox.Show("Update stopped at " + stage + ".\n\n" + e.Message + "\n\nYour data folder has not been removed or had its permissions changed.", "YouTube Music Spear update", MessageBoxButtons.OK, MessageBoxIcon.Error);
      return 1;
    }
  }
}
