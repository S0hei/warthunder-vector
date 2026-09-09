using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
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
