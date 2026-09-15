using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using VectorPortable;

internal static class UpdateTests
{
    private static void Fails(Action action, Action<bool, string> check, string label)
    { bool failed = false; try { action(); } catch { failed = true; } check(failed, label); }
    private static Dictionary<string, object> Release(string version = "0.3.0")
    {
        return new Dictionary<string, object> { { "tag_name", "v" + version }, { "draft", false }, { "prerelease", false },
            { "assets", new object[] { new Dictionary<string, object> { { "name", "Vector.exe" }, { "state", "uploaded" }, { "size", 4096 },
                { "digest", "sha256:" + new string('a', 64) }, { "browser_download_url", "https://github.com/S0hei/warthunder-vector/releases/download/v" + version + "/Vector.exe" } } } } };
    }
    private static UpdatePlan Fixture(string directory, out string stage)
    {
        string root = Path.Combine(directory, Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root);
        stage = Path.Combine(root, "Vector-data", "updates", "stage-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(stage);
        string target = Path.Combine(root, "Vector with spaces.exe"), candidate = Path.Combine(stage, "Vector.exe");
        File.WriteAllText(target, "old executable fixture");
        File.Copy(Assembly.GetExecutingAssembly().Location, candidate);
        File.WriteAllText(Path.Combine(root, "Vector-data", "keep-user-data.txt"), "untouched");
        return new UpdatePlan { Target = target, OldHash = UpdateSource.Hash(target), Sha256 = UpdateSource.Hash(candidate), Size = new FileInfo(candidate).Length,
            Version = VectorVersion.Current, Nonce = Guid.NewGuid().ToString("N"), ParentId = Process.GetCurrentProcess().Id, ParentStarted = Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks };
    }
    public static void Run(Action<bool, string> check, string directory)
    {
        UpdateInterface(check, directory);
        BattleReadiness(check);
        var json = new JavaScriptSerializer();
        check(UpdateSource.Parse(json.Serialize(Release("0.10.0")), "0.2.0").Version == "0.10.0", "update versions compare numerically");
        check(UpdateSource.Parse(json.Serialize(Release("0.2.0")), "0.2.0") == null && UpdateSource.Parse(json.Serialize(Release("0.1.9")), "0.2.0") == null, "same versions and downgrades are ignored");
        foreach (string bad in new[] { "v1.2.3", "1.2", "1.2.3-beta", "01.2.3", "65535.0.0", "../1.2.3" }) Fails(() => UpdateSource.ParseVersion(bad), check, "reject unsupported version " + bad);
        foreach (string field in new[] { "draft", "prerelease" }) { var release = Release(); release[field] = true; Fails(() => UpdateSource.Parse(json.Serialize(release), "0.2.0"), check, "reject " + field + " release"); }
        foreach (string field in new[] { "digest", "browser_download_url", "name", "state", "size" })
        { var release = Release(); ((Dictionary<string, object>)((object[])release["assets"])[0])[field] = "invalid"; Fails(() => UpdateSource.Parse(json.Serialize(release), "0.2.0"), check, "reject invalid asset " + field); }
        var duplicate = Release(); duplicate["assets"] = new object[] { ((object[])duplicate["assets"])[0], ((object[])duplicate["assets"])[0] };
        Fails(() => UpdateSource.Parse(json.Serialize(duplicate), "0.2.0"), check, "duplicate release executables are rejected");
        foreach (string url in new[] { "http://github.com/S0hei/warthunder-vector/releases/download/v1.0.0/Vector.exe", "https://github.com/other/repo/releases/download/v1/Vector.exe",
            "https://github.com.evil.example/file", "https://github.com@evil.example/file", "https://release-assets.githubusercontent.com:444/file", "file:///C:/bad.exe", "https://release-assets.githubusercontent.com/file#fragment" })
            check(!UpdateSource.AllowedDownload(new Uri(url)), "reject untrusted update URL " + new Uri(url).Host);
        check(UpdateSource.AllowedDownload(new Uri("https://release-assets.githubusercontent.com/github-production-release-asset/123/file?sig=value")), "GitHub HTTPS asset redirects are allowed");
        Fails(() => { using (var input = new MemoryStream(new byte[1025])) using (var output = new MemoryStream()) UpdateSource.CopyBounded(input, output, 1024); }, check, "oversized update streams are rejected");

        string stage; var plan = Fixture(directory, out stage);
        UpdateSource.VerifyBinary(Path.Combine(stage, "Vector.exe"), plan.Release()); check(true, "checksum and assembly product/version verified without executing download");
        var originalTarget = plan.Target; plan.Target = Path.Combine(directory, "outside.exe"); Fails(() => UpdateInstaller.ValidatePlan(stage, plan), check, "installer cannot replace a file outside its app folder"); plan.Target = originalTarget;
        check(UpdateInstaller.ReplaceAndConfirm(stage, plan, path => UpdateSource.Hash(path) == plan.Sha256), "verified replacement succeeds");
        check(UpdateSource.Hash(Path.Combine(stage, "previous.exe")) == plan.OldHash, "previous executable retained as a backup");
        check(File.ReadAllText(Path.Combine(Path.GetDirectoryName(plan.Target), "Vector-data", "keep-user-data.txt")) == "untouched", "updater leaves user history untouched");
        plan = Fixture(directory, out stage);
        check(!UpdateInstaller.ReplaceAndConfirm(stage, plan, _ => false) && UpdateSource.Hash(plan.Target) == plan.OldHash, "failed startup rolls back the original executable");
        check(File.Exists(Path.Combine(stage, "failed.exe")), "failed replacement retained for recovery");
        plan = Fixture(directory, out stage); File.AppendAllText(Path.Combine(stage, "Vector.exe"), "corrupt");
        Fails(() => UpdateInstaller.ReplaceAndConfirm(stage, plan, _ => true), check, "corrupt candidate never replaces the installed app");
        check(UpdateSource.Hash(plan.Target) == plan.OldHash, "installed app is intact after checksum failure");

        // Real helper, parent exit and startup handshake in a private temporary
        // fixture. Never starts Vector's collector, browser, game or production mutex.
        plan = Fixture(directory, out stage);
        File.Copy(Assembly.GetExecutingAssembly().Location, plan.Target, true);
        File.Copy(Assembly.GetExecutingAssembly().Location, Path.Combine(stage, "VectorUpdater.exe"));
        using (var parent = Process.Start(new ProcessStartInfo(plan.Target, "--fixture-parent \"" + stage + "\"") { UseShellExecute = false, CreateNoWindow = true }))
        { check(parent.WaitForExit(10000) && parent.ExitCode == 0, "fixture parent exits only after the helper is ready"); }
        var clock = Stopwatch.StartNew(); string done = Path.Combine(stage, "fixture-done.txt");
        while (!File.Exists(done) && clock.Elapsed < TimeSpan.FromSeconds(15)) Thread.Sleep(100);
        check(File.Exists(done) && File.ReadAllText(done) == "0" && File.Exists(Path.Combine(stage, "previous.exe")), "real update helper replaces and confirms its replacement process");
        foreach (string file in new[] { Path.Combine(stage, "fixture-helper-id.txt"), Path.Combine(Path.GetDirectoryName(plan.Target), "fixture-child-id.txt") })
        {
            try { using (var process = Process.GetProcessById(int.Parse(File.ReadAllText(file)))) check(process.WaitForExit(5000), "update fixture child exits cleanly"); }
            catch (ArgumentException) { }
        }
    }
    private static string UpdateRequest(string url, string token, string origin, string method, out int status, string body = null)
    {
        var request = (HttpWebRequest)WebRequest.Create(url); request.Proxy = null; request.Timeout = 5000; request.Method = method;
        if (token != null) request.Headers.Add("X-Vector-Token", token);
        if (origin != null) request.Headers.Add("Origin", origin);
        if (body != null)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(body); request.ContentLength = bytes.Length;
            using (var stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
        }
        HttpWebResponse response;
        try { response = (HttpWebResponse)request.GetResponse(); }
        catch (WebException error) { response = error.Response as HttpWebResponse; if (response == null) throw; }
        using (response) using (var reader = new StreamReader(response.GetResponseStream())) { status = (int)response.StatusCode; return reader.ReadToEnd(); }
    }
    private static void UpdateInterface(Action<bool, string> check, string directory)
    {
        var prompt = new UpdatePrompt();
        check(!prompt.RequestRestart() && !prompt.TakeRestart(), "no restart before a verified download is ready");
        prompt.Downloaded("9.8.7");
        check(!prompt.RestartRequested && !prompt.TakeRestart(), "download completion never authorizes automatic installation");
        check(prompt.RequestRestart() && !prompt.RequestRestart(), "one click authorizes one restart, duplicate clicks do not");
        prompt.Downloaded("9.8.7");
        check(prompt.RestartRequested && prompt.TakeRestart() && !prompt.TakeRestart(), "concurrent update check cannot erase a click or authorize a second installation");
        prompt.Blocked();
        check(!prompt.RestartRequested && prompt.Snapshot().Contains("battle-active") && prompt.RequestRestart(), "unsafe battle status requires a fresh click after returning to the hangar");
        prompt.Failed("install-failed");
        check(!prompt.RequestRestart() && prompt.Snapshot().Contains("install-failed"), "failed installation is visible and never loops automatically");

        prompt = new UpdatePrompt();
        using (var server = new LocalServer(new BattleFileStore(Path.Combine(directory, "update-api")), 0, null, null, prompt))
        {
            int status;
            string html = UpdateRequest(server.Origin + "/", null, null, "GET", out status);
            string token = System.Text.RegularExpressions.Regex.Match(html, "token:'([a-f0-9]{64})'").Groups[1].Value;
            check(html.Contains("updates:true"), "native bootstrap explicitly advertises update controls");
            UpdateRequest(server.Origin + "/api/updates", null, null, "GET", out status);
            check(status == 403, "update status requires the per-launch token");
            foreach (string origin in new[] { null, "null", "https://unrelated.example" })
            {
                UpdateRequest(server.Origin + "/api/updates/restart", token, origin, "POST", out status);
                check(status == 403 && !prompt.RestartRequested, "restart requires an explicit same-origin request");
            }
            UpdateRequest(server.Origin + "/api/updates/restart", "wrong-token", server.Origin, "POST", out status);
            check(status == 403, "restart rejects a wrong token");
            UpdateRequest(server.Origin + "/api/updates/restart", token, server.Origin, "GET", out status);
            check(status == 405, "reading a restart URL cannot restart the app");
            UpdateRequest(server.Origin + "/api/updates", token, server.Origin, "POST", out status);
            check(status == 405, "only the restart action accepts POST");
            UpdateRequest(server.Origin + "/api/updates/restart", token, server.Origin, "POST", out status, "{}");
            check(status == 400, "restart cannot accept a path, release URL or other body");
            UpdateRequest(server.Origin + "/api/updates/restart", token, server.Origin, "POST", out status);
            check(status == 409, "restart without a ready download is rejected");
            prompt.Downloaded("9.8.7");
            string snapshot = UpdateRequest(server.Origin + "/api/updates", token, server.Origin, "GET", out status);
            check(status == 200 && snapshot == "{\"state\":\"ready\",\"version\":\"9.8.7\",\"error\":null}" && !prompt.RestartRequested, "update polling exposes only state/version/error and never installs");
            snapshot = UpdateRequest(server.Origin + "/api/updates/restart", token, server.Origin, "POST", out status);
            check(status == 202 && prompt.RestartRequested && snapshot.Contains("restarting"), "authenticated restart click queues the native handoff without closing the HTTP response");
            UpdateRequest(server.Origin + "/api/updates/restart", token, server.Origin, "POST", out status);
            check(status == 409 && prompt.TakeRestart() && !prompt.TakeRestart(), "multiple browser tabs cannot start duplicate installers");
        }
    }
    private static void BattleReadiness(Action<bool, string> check)
    {
        // Private loopback fixtures: never query the user's game or live map port.
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        string url = "http://127.0.0.1:" + ((IPEndPoint)listener.LocalEndpoint).Port + "/map_info.json";
        listener.Stop();
        check(AppUpdates.OutOfBattle(url, () => true), "closed game permits installation after Windows reports connection refusal");
        check(!AppUpdates.OutOfBattle(url, () => false), "missing map feed with a running game defers installation");
        check(!AppUpdates.OutOfBattle(url, () => { throw new IOException("process check unavailable"); }), "unavailable game process check defers installation");

        foreach (string body in new[] { "{\"valid\":false}", "{\"valid\":true}", "{\"valid\":\"false\"}", "{}", "invalid", null })
        {
            listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
            url = "http://127.0.0.1:" + ((IPEndPoint)listener.LocalEndpoint).Port + "/map_info.json";
            var readyListener = listener;
            using (var stop = new ManualResetEvent(false))
            {
                var responder = new Thread(() => {
                    try
                    {
                        using (var client = readyListener.AcceptTcpClient())
                        using (var stream = client.GetStream())
                        {
                            if (body == null) { stop.WaitOne(7000); return; }
                            stream.ReadTimeout = 5000;
                            var reader = new StreamReader(stream, Encoding.ASCII);
                            for (int line = 0; line < 64; line++) { if (string.IsNullOrEmpty(reader.ReadLine())) break; }
                            byte[] bytes = Encoding.UTF8.GetBytes(body);
                            byte[] headers = Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Length: " + bytes.Length + "\r\nConnection: close\r\n\r\n");
                            stream.Write(headers, 0, headers.Length); stream.Write(bytes, 0, bytes.Length);
                        }
                    }
                    catch (SocketException) { }
                    catch (IOException) { }
                }) { IsBackground = true };
                responder.Start();
                try
                {
                    bool checkedGame = false;
                    bool result = AppUpdates.OutOfBattle(url, () => { checkedGame = true; return true; });
                    check(result == (body == "{\"valid\":false}") && !checkedGame,
                        body == null ? "unresponsive feed still defers installation with the game closed" : "only an explicit hangar response permits installation: " + body);
                }
                finally { stop.Set(); listener.Stop(); responder.Join(8000); }
            }
        }
    }
    public static int FixtureMain(string[] args)
    {
        if (args[0] == "--updated") { File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "fixture-child-id.txt"), Process.GetCurrentProcess().Id.ToString()); UpdateInstaller.AcknowledgeStartup(args); Thread.Sleep(500); return 0; }
        if (args[0] == "--apply-update")
        {
            string folder = AppDomain.CurrentDomain.BaseDirectory; var plan = UpdateInstaller.ReadPlan(folder);
            int result = UpdateInstaller.Run(@"Local\VectorUpdateFixture-" + plan.Nonce);
            File.WriteAllText(Path.Combine(folder, "fixture-done.txt"), result.ToString()); return result;
        }
        string stage = args[1], target = Assembly.GetExecutingAssembly().Location, candidate = Path.Combine(stage, "Vector.exe");
        var setup = new UpdatePlan { Target = target, OldHash = UpdateSource.Hash(target), Sha256 = UpdateSource.Hash(candidate), Size = new FileInfo(candidate).Length, Version = VectorVersion.Current,
            ParentId = Process.GetCurrentProcess().Id, ParentStarted = Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks, Nonce = Guid.NewGuid().ToString("N") };
        File.WriteAllText(Path.Combine(stage, "plan.json"), new JavaScriptSerializer().Serialize(setup));
        using (var mutex = new Mutex(true, @"Local\VectorUpdateFixture-" + setup.Nonce))
        using (var ready = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\VectorUpdateReady-" + setup.Nonce))
        using (var helper = Process.Start(new ProcessStartInfo(Path.Combine(stage, "VectorUpdater.exe"), "--apply-update") { UseShellExecute = false, CreateNoWindow = true }))
        { File.WriteAllText(Path.Combine(stage, "fixture-helper-id.txt"), helper.Id.ToString()); bool ok = ready.WaitOne(5000); mutex.ReleaseMutex(); return ok ? 0 : 1; }
    }
}
