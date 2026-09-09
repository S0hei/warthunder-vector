using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

namespace VectorPortable
{
    internal sealed class ReleaseUpdate
    {
        public string Version, Url, Sha256;
        public long Size;
    }

    internal static class UpdateSource
    {
        public const string Repository = "S0hei/warthunder-vector";
        public const string Latest = "https://api.github.com/repos/" + Repository + "/releases/latest";
        public const long MaxBinary = 64 * 1024 * 1024;
        public static Version ParseVersion(string text)
        {
            if (text == null || !Regex.IsMatch(text, @"^(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})$")) throw new InvalidDataException("Invalid update version.");
            var version = new Version(text);
            if (version.Major > 65534 || version.Minor > 65534 || version.Build > 65534) throw new InvalidDataException("Unsupported update version.");
            return version;
        }
        public static ReleaseUpdate Parse(string text, string current)
        {
            var json = new JavaScriptSerializer { MaxJsonLength = 1024 * 1024, RecursionLimit = 32 };
            var release = json.DeserializeObject(text) as Dictionary<string, object>;
            if (release == null || !release.ContainsKey("draft") || !(release["draft"] is bool) || (bool)release["draft"] ||
                !release.ContainsKey("prerelease") || !(release["prerelease"] is bool) || (bool)release["prerelease"]) throw new InvalidDataException("Not a stable release.");
            string tag = Value(release, "tag_name");
            if (tag == null || !tag.StartsWith("v", StringComparison.Ordinal)) throw new InvalidDataException("Invalid release tag.");
            string version = tag.Substring(1);
            if (ParseVersion(version) <= ParseVersion(current)) return null;
            object list;
            if (!release.TryGetValue("assets", out list) || !(list is object[])) throw new InvalidDataException("Release has no assets.");
            var assets = ((object[])list).OfType<Dictionary<string, object>>().Where(a => Value(a, "name") == "Vector.exe").ToList();
            if (assets.Count != 1) throw new InvalidDataException("Release executable is missing or ambiguous.");
            var asset = assets[0]; string digest = Value(asset, "digest"), url = Value(asset, "browser_download_url"); long size;
            if (Value(asset, "state") != "uploaded" || digest == null || !Regex.IsMatch(digest, "^sha256:[a-f0-9]{64}$") ||
                !asset.ContainsKey("size") || !long.TryParse(Convert.ToString(asset["size"], CultureInfo.InvariantCulture), out size) || size < 1024 || size > MaxBinary ||
                url != "https://github.com/" + Repository + "/releases/download/" + tag + "/Vector.exe") throw new InvalidDataException("Unverified release asset.");
            return new ReleaseUpdate { Version = version, Url = url, Sha256 = digest.Substring(7), Size = size };
        }
        private static string Value(Dictionary<string, object> data, string name) { object value; return data.TryGetValue(name, out value) ? value as string : null; }
        public static bool AllowedDownload(Uri uri)
        {
            if (uri == null || uri.Scheme != "https" || !uri.IsDefaultPort || uri.UserInfo.Length != 0 || uri.Fragment.Length != 0) return false;
            return (uri.Host == "github.com" && uri.AbsolutePath.StartsWith("/" + Repository + "/releases/download/", StringComparison.Ordinal)) ||
                uri.Host == "release-assets.githubusercontent.com" || uri.Host == "objects.githubusercontent.com";
        }
        public static HttpWebResponse Open(Uri uri, bool metadata)
        {
            // TLS/certificate validation stays with Windows. No credentials or game data.
            ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072;
            for (int redirect = 0; redirect < 5; redirect++)
            {
                if (metadata ? uri.AbsoluteUri != Latest : !AllowedDownload(uri)) throw new InvalidDataException("Untrusted update URL.");
                var request = (HttpWebRequest)WebRequest.Create(uri);
                request.UserAgent = "Vector/" + VectorVersion.Current;
                request.Accept = metadata ? "application/vnd.github+json" : "application/octet-stream";
                request.Headers["X-GitHub-Api-Version"] = "2022-11-28";
                request.AllowAutoRedirect = false; request.UseDefaultCredentials = false;
                request.Timeout = 10000; request.ReadWriteTimeout = 10000;
                var response = (HttpWebResponse)request.GetResponse();
                if ((int)response.StatusCode >= 300 && (int)response.StatusCode < 400)
                {
                    string location = response.Headers["Location"]; response.Dispose();
                    if (metadata || string.IsNullOrEmpty(location)) throw new InvalidDataException("Unexpected update redirect.");
                    uri = new Uri(uri, location); continue;
                }
                if (response.StatusCode != HttpStatusCode.OK) { response.Dispose(); throw new InvalidDataException("Update download unavailable."); }
                return response;
            }
            throw new InvalidDataException("Too many update redirects.");
        }
        public static void CopyBounded(Stream input, Stream output, long limit)
        {
            var timer = Stopwatch.StartNew(); var buffer = new byte[32768]; long total = 0; int count;
            while ((count = input.Read(buffer, 0, buffer.Length)) != 0)
            {
                total += count;
                if (total > limit || timer.Elapsed > TimeSpan.FromMinutes(2)) throw new InvalidDataException("Update download exceeded its limit.");
                output.Write(buffer, 0, count);
            }
        }
        public static ReleaseUpdate LatestRelease()
        {
            try
            {
                using (var response = Open(new Uri(Latest), true))
                using (var data = new MemoryStream())
                { CopyBounded(response.GetResponseStream(), data, 1024 * 1024); return Parse(Encoding.UTF8.GetString(data.ToArray()), VectorVersion.Current); }
            }
            catch (WebException error)
            {
                var response = error.Response as HttpWebResponse;
                bool absent = response != null && response.StatusCode == HttpStatusCode.NotFound;
                if (response != null) response.Dispose();
                if (absent) return null;
                throw;
            }
        }
        public static string Hash(string path)
        { using (var input = File.OpenRead(path)) using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "").ToLowerInvariant(); }
        public static void VerifyBinary(string path, ReleaseUpdate release)
        {
            if (new FileInfo(path).Length != release.Size || Hash(path) != release.Sha256) throw new InvalidDataException("Update checksum mismatch.");
            var version = AssemblyName.GetAssemblyName(path).Version;
            var expected = ParseVersion(release.Version);
            if (version.Major != expected.Major || version.Minor != expected.Minor || version.Build != expected.Build || version.Revision != 0 ||
                FileVersionInfo.GetVersionInfo(path).ProductName != "Vector") throw new InvalidDataException("Unexpected update executable.");
        }
    }

    internal sealed class UpdatePlan
    {
        public string Target, OldHash, Version, Sha256, Nonce;
        public long Size, ParentStarted;
        public int ParentId;
        public ReleaseUpdate Release() { return new ReleaseUpdate { Version = Version, Sha256 = Sha256, Size = Size }; }
    }

    internal static class UpdateInstaller
    {
        public const string MutexName = @"Local\VectorPortableReports-v1";
        public static void CheckNoLinks(string path)
        {
            for (string current = Path.GetFullPath(path); current != null; current = Path.GetDirectoryName(current))
                if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("Updates cannot use linked folders.");
        }
        public static void ValidatePlan(string stage, UpdatePlan plan)
        {
            stage = Path.GetFullPath(stage).TrimEnd(Path.DirectorySeparatorChar);
            if (!Regex.IsMatch(Path.GetFileName(stage), "^stage-[a-f0-9]{32}$") ||
                Path.GetFileName(Path.GetDirectoryName(stage)) != "updates" || Path.GetFileName(Path.GetDirectoryName(Path.GetDirectoryName(stage))) != "Vector-data") throw new InvalidDataException("Invalid update staging folder.");
            string root = Path.GetDirectoryName(Path.GetDirectoryName(Path.GetDirectoryName(stage)));
            if (plan == null || string.IsNullOrEmpty(plan.Target) || !Path.IsPathRooted(plan.Target) || Path.GetFullPath(plan.Target) != plan.Target ||
                !string.Equals(Path.GetDirectoryName(plan.Target), root, StringComparison.OrdinalIgnoreCase) || Path.GetExtension(plan.Target) != ".exe" ||
                !Regex.IsMatch(plan.Nonce ?? "", "^[a-f0-9]{32}$") || !Regex.IsMatch(plan.OldHash ?? "", "^[a-f0-9]{64}$") ||
                !Regex.IsMatch(plan.Sha256 ?? "", "^[a-f0-9]{64}$") || plan.Size < 1024 || plan.Size > UpdateSource.MaxBinary || plan.ParentId <= 0 || plan.ParentStarted <= 0)
                throw new InvalidDataException("Invalid update plan.");
            UpdateSource.ParseVersion(plan.Version); CheckNoLinks(stage); CheckNoLinks(plan.Target);
        }
        public static UpdatePlan ReadPlan(string stage)
        {
            string path = Path.Combine(stage, "plan.json");
            CheckNoLinks(path);
            if (new FileInfo(path).Length > 8192) throw new InvalidDataException("Update plan too large.");
            var plan = new JavaScriptSerializer().Deserialize<UpdatePlan>(File.ReadAllText(path)); ValidatePlan(stage, plan); return plan;
        }
        public static bool ReplaceAndConfirm(string stage, UpdatePlan plan, Func<string, bool> startAndConfirm)
        {
            ValidatePlan(stage, plan);
            string candidate = Path.Combine(stage, "Vector.exe"), backup = Path.Combine(stage, "previous.exe"), failed = Path.Combine(stage, "failed.exe");
            CheckNoLinks(candidate); CheckNoLinks(backup); CheckNoLinks(failed);
            if (File.Exists(backup) || File.Exists(failed) || UpdateSource.Hash(plan.Target) != plan.OldHash) throw new IOException("Installed app changed during update.");
            UpdateSource.VerifyBinary(candidate, plan.Release());
            File.Replace(candidate, plan.Target, backup);
            bool healthy = startAndConfirm(plan.Target);
            if (!healthy)
            {
                if (UpdateSource.Hash(backup) != plan.OldHash || UpdateSource.Hash(plan.Target) != plan.Sha256) throw new IOException("Rollback files changed.");
                File.Replace(backup, plan.Target, failed);
            }
            return healthy;
        }
        public static void AcknowledgeStartup(string[] args)
        {
            if (args.Length != 2 || args[0] != "--updated" || !Regex.IsMatch(args[1], "^[a-f0-9]{32}$")) return;
            try { using (var ready = EventWaitHandle.OpenExisting(@"Local\VectorUpdated-" + args[1])) ready.Set(); } catch (WaitHandleCannotBeOpenedException) { }
        }
        internal static bool WaitForStartup(EventWaitHandle ready, Process child)
        {
            var clock = Stopwatch.StartNew();
            while (clock.Elapsed < TimeSpan.FromSeconds(20)) { if (ready.WaitOne(100)) return !child.HasExited; if (child.HasExited) return false; }
            return false;
        }
        public static int Run(string mutexName = MutexName)
        {
            string stage = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar); UpdatePlan plan = null; bool parentExited = false;
            try
            {
                plan = ReadPlan(stage);
                using (var parent = Process.GetProcessById(plan.ParentId))
                {
                    if (parent.StartTime.ToUniversalTime().Ticks != plan.ParentStarted || !string.Equals(parent.MainModule.FileName, plan.Target, StringComparison.OrdinalIgnoreCase) ||
                        UpdateSource.Hash(plan.Target) != plan.OldHash) throw new InvalidDataException("Update parent changed.");
                    UpdateSource.VerifyBinary(Path.Combine(stage, "Vector.exe"), plan.Release());
                    using (var ready = EventWaitHandle.OpenExisting(@"Local\VectorUpdateReady-" + plan.Nonce)) ready.Set();
                    if (!parent.WaitForExit(30000)) return 1; // Never terminate the app that requested an update.
                    parentExited = true;
                }
                using (var mutex = new Mutex(false, mutexName))
                {
                    bool owns;
                    try { owns = mutex.WaitOne(10000); } catch (AbandonedMutexException) { owns = true; }
                    if (!owns) return 1;
                    bool locked = true;
                    try
                    {
                        bool healthy = ReplaceAndConfirm(stage, plan, target => {
                            using (var ready = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\VectorUpdated-" + plan.Nonce))
                            {
                                mutex.ReleaseMutex(); locked = false;
                                Process child = null; bool healthyChild = false;
                                try
                                {
                                    child = Process.Start(new ProcessStartInfo(target, "--updated " + plan.Nonce) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetDirectoryName(target) });
                                    healthyChild = WaitForStartup(ready, child);
                                }
                                catch { }
                                finally
                                {
                                    if (child != null)
                                    {
                                        // Only our exact, failed-to-start replacement child can be stopped.
                                        if (!healthyChild && !child.HasExited) { child.Kill(); if (!child.WaitForExit(5000)) throw new IOException("Replacement did not exit."); }
                                        child.Dispose();
                                    }
                                    if (!healthyChild)
                                    {
                                        try { locked = mutex.WaitOne(10000); } catch (AbandonedMutexException) { locked = true; }
                                        if (!locked) throw new IOException("Another Vector instance started.");
                                    }
                                }
                                return healthyChild;
                            }
                        });
                        if (!healthy)
                        {
                            MarkFailure(stage, plan);
                            if (locked) { mutex.ReleaseMutex(); locked = false; }
                            Process.Start(new ProcessStartInfo(plan.Target, "--skip-update-once --no-browser") { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetDirectoryName(plan.Target) });
                        }
                        return healthy ? 0 : 1;
                    }
                    finally { if (locked) mutex.ReleaseMutex(); }
                }
            }
            catch
            {
                if (plan != null)
                {
                    try
                    {
                        MarkFailure(stage, plan);
                        if (parentExited && File.Exists(plan.Target) && UpdateSource.Hash(plan.Target) == plan.OldHash)
                            Process.Start(new ProcessStartInfo(plan.Target, "--skip-update-once --no-browser") { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetDirectoryName(plan.Target) });
                    }
                    catch { }
                }
                return 1;
            }
        }
        private static void MarkFailure(string stage, UpdatePlan plan)
        {
            ValidatePlan(stage, plan);
            string path = Path.Combine(Path.GetDirectoryName(stage), "failed-version.txt");
            CheckNoLinks(path);
            File.WriteAllText(path, plan.Version + " " + plan.Sha256);
        }
    }

    internal sealed class AppUpdates : IDisposable
    {
        private readonly Timer timer;
        private readonly string executable, cache;
        private int busy;
        private volatile bool stopped;
        private string stage;
        private DateTime nextInstallAttempt;
        private volatile ReleaseUpdate pending;
        public volatile string Status = "App updates on";
        public volatile bool ReadyToExit;
        public AppUpdates(bool skipStartup)
        {
            executable = Assembly.GetExecutingAssembly().Location;
            cache = Path.Combine(Path.GetDirectoryName(executable), "Vector-data", "updates");
            timer = new Timer(_ => Check(false), null, skipStartup ? 3600000 : 0, 3600000);
        }
        public void Check(bool manual)
        {
            if (stopped || ReadyToExit || Interlocked.CompareExchange(ref busy, 1, 0) != 0) return;
            try
            {
                if (pending == null)
                {
                    Status = "Checking for app updates";
                    var release = UpdateSource.LatestRelease();
                    if (stopped) return;
                    if (release == null) { Status = "Vector " + VectorVersion.Current + " is up to date"; return; }
                    UpdateInstaller.CheckNoLinks(cache);
                    string failed = Path.Combine(cache, "failed-version.txt");
                    UpdateInstaller.CheckNoLinks(failed);
                    if (File.Exists(failed) && new FileInfo(failed).Length > 256) throw new InvalidDataException("Invalid update recovery record.");
                    if (!manual && File.Exists(failed) && File.ReadAllText(failed) == release.Version + " " + release.Sha256) { Status = "Update failed; current version kept"; return; }
                    Directory.CreateDirectory(cache);
                    stage = Path.Combine(cache, "stage-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(stage);
                    Status = "Downloading Vector " + release.Version;
                    string candidate = Path.Combine(stage, "Vector.exe");
                    using (var response = UpdateSource.Open(new Uri(release.Url), false))
                    using (var output = new FileStream(candidate, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    { UpdateSource.CopyBounded(response.GetResponseStream(), output, release.Size); output.Flush(true); }
                    UpdateSource.VerifyBinary(candidate, release);
                    if (stopped) return;
                    pending = release;
                }
                Status = "Update ready; waiting for the hangar";
            }
            catch { Status = "App update check failed; will retry"; }
            finally
            {
                if (pending == null && stage != null)
                {
                    // Remove only this attempt's uninstalled download, never a backup or history.
                    try
                    {
                        string candidate = Path.Combine(stage, "Vector.exe");
                        if (Path.GetDirectoryName(stage) == cache && Regex.IsMatch(Path.GetFileName(stage), "^stage-[a-f0-9]{32}$"))
                        {
                            UpdateInstaller.CheckNoLinks(candidate);
                            if (File.Exists(candidate)) File.Delete(candidate);
                            if (Directory.Exists(stage) && !Directory.EnumerateFileSystemEntries(stage).Any()) Directory.Delete(stage, false);
                        }
                    }
                    catch { }
                    stage = null;
                }
                Interlocked.Exchange(ref busy, 0);
            }
        }
        public void TryInstall()
        {
            if (stopped || pending == null || ReadyToExit || Interlocked.CompareExchange(ref busy, 1, 0) != 0) return;
            try
            {
                if (DateTime.UtcNow < nextInstallAttempt) return;
                if (!OutOfBattle()) return;
                UpdateInstaller.CheckNoLinks(stage); UpdateInstaller.CheckNoLinks(executable);
                var plan = new UpdatePlan { Target = executable, OldHash = UpdateSource.Hash(executable), Version = pending.Version, Size = pending.Size, Sha256 = pending.Sha256,
                    Nonce = Guid.NewGuid().ToString("N"), ParentId = Process.GetCurrentProcess().Id, ParentStarted = Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks };
                UpdateInstaller.ValidatePlan(stage, plan);
                UpdateInstaller.CheckNoLinks(Path.Combine(stage, "plan.json"));
                File.WriteAllText(Path.Combine(stage, "plan.json"), new JavaScriptSerializer().Serialize(plan));
                string helper = Path.Combine(stage, "VectorUpdater.exe");
                UpdateInstaller.CheckNoLinks(helper);
                if (!File.Exists(helper)) File.Copy(executable, helper);
                if (UpdateSource.Hash(helper) != plan.OldHash) throw new IOException("Update helper changed.");
                using (var ready = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\VectorUpdateReady-" + plan.Nonce))
                using (var process = Process.Start(new ProcessStartInfo(helper, "--apply-update") { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = stage }))
                {
                    // A helper that sees us stay in battle exits after 30 seconds.
                    nextInstallAttempt = DateTime.UtcNow.AddSeconds(45);
                    if (!ready.WaitOne(5000) || process.HasExited) throw new IOException("Update helper could not start.");
                    if (stopped || !OutOfBattle()) return;
                    ReadyToExit = true; Status = "Restarting Vector";
                }
            }
            catch { Status = "Update could not be installed; current version kept"; pending = null; }
            finally { Interlocked.Exchange(ref busy, 0); }
        }
        internal static bool OutOfBattle()
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:8111/map_info.json");
                request.Proxy = null; request.AllowAutoRedirect = false; request.Timeout = 1500; request.ReadWriteTimeout = 1500;
                using (var response = request.GetResponse()) using (var data = new MemoryStream())
                {
                    UpdateSource.CopyBounded(response.GetResponseStream(), data, 65536);
                    var info = new JavaScriptSerializer().DeserializeObject(Encoding.UTF8.GetString(data.ToArray())) as Dictionary<string, object>;
                    object valid; return info != null && info.TryGetValue("valid", out valid) && valid is bool && !(bool)valid;
                }
            }
            catch (WebException error)
            {
                if (error.Response != null) error.Response.Dispose();
                // A timeout/error is ambiguous. Only a refused loopback connection with
                // no running game is safe to treat as the game being closed.
                if (error.Status != WebExceptionStatus.ConnectFailure) return false;
                var games = Process.GetProcessesByName("aces");
                bool closed = games.Length == 0;
                foreach (var game in games) game.Dispose();
                return closed;
            }
            catch { return false; }
        }
        public void Dispose() { stopped = true; timer.Dispose(); }
    }
}
