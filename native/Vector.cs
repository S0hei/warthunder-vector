using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace VectorPortable
{
    public sealed class LocalServer : IDisposable
    {
        private readonly TcpListener listener;
        private readonly CombatTeamFeed teams;
        private readonly BattleFileStore battles;
        private readonly string html;
        private readonly string token;
        private readonly string instance = Guid.NewGuid().ToString("N");
        private readonly LanguageSettings languages;
        private readonly Semaphore clients = new Semaphore(8, 8);
        private volatile bool stopped;
        public readonly string Origin;

        public LocalServer(BattleFileStore battles, int port, CombatTeamFeed teams = null, LanguageSettings languages = null)
        {
            this.languages = languages;
            this.teams = teams ?? new CombatTeamFeed();
            this.battles = battles;
            byte[] secret = new byte[32];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(secret);
            token = BitConverter.ToString(secret).Replace("-", "").ToLowerInvariant();
            listener = new TcpListener(IPAddress.Loopback, port);
            listener.Server.ExclusiveAddressUse = true;
            listener.Start(16);
            Origin = "http://127.0.0.1:" + ((IPEndPoint)listener.LocalEndpoint).Port;
            using (Stream source = Assembly.GetExecutingAssembly().GetManifestResourceStream("Vector.html"))
            using (StreamReader reader = new StreamReader(source, Encoding.UTF8))
            {
                html = reader.ReadToEnd();
            }
            new Thread(Accept) { IsBackground = true, Name = "Vector loopback server" }.Start();
        }

        private void Accept()
        {
            while (!stopped)
            {
                TcpClient client;
                try { client = listener.AcceptTcpClient(); }
                catch { if (stopped) return; else continue; }
                if (!clients.WaitOne(0)) { client.Close(); continue; }
                ThreadPool.QueueUserWorkItem(_ => { try { Serve(client); } finally { client.Close(); clients.Release(); } });
            }
        }

        private void Serve(TcpClient client)
        {
            try
            {
                client.ReceiveTimeout = 3000;
                client.SendTimeout = 3000;
                using (NetworkStream stream = client.GetStream())
                {
                    // Bounded headers; only the authenticated language setting accepts a tiny JSON body.
                    var header = new StringBuilder();
                    while (header.Length < 16384)
                    {
                        int value = stream.ReadByte();
                        if (value < 0) return;
                        header.Append((char)value);
                        int n = header.Length;
                        if (n >= 4 && header[n - 4] == '\r' && header[n - 3] == '\n' && header[n - 2] == '\r' && header[n - 1] == '\n') break;
                    }
                    if (header.Length >= 16384) { Reply(stream, 431, "text/plain", Encoding.UTF8.GetBytes("Headers too large")); return; }
                    string[] lines = header.ToString().Split(new[] { "\r\n" }, StringSplitOptions.None);
                    string[] request = lines[0].Split(' ');
                    var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    foreach (string line in lines.Skip(1).Where(x => x.Length > 0))
                    {
                        int colon = line.IndexOf(':');
                        if (colon <= 0 || fields.ContainsKey(line.Substring(0, colon))) { Reply(stream, 400, "text/plain", new byte[0]); return; }
                        fields.Add(line.Substring(0, colon), line.Substring(colon + 1).Trim());
                    }
                    string host, origin, supplied;
                    if (request.Length != 3 || !fields.TryGetValue("Host", out host) || host != new Uri(Origin).Authority ||
                        (fields.TryGetValue("Origin", out origin) && origin != Origin)) { Reply(stream, 403, "text/plain", new byte[0]); return; }
                    if (request[1] == "/api/language" && languages != null)
                    {
                        if (!fields.TryGetValue("X-Vector-Token", out supplied) || supplied != token) { Reply(stream, 403, "text/plain", new byte[0]); return; }
                        if (request[0] == "PUT")
                        {
                            string type, lengthText; int length;
                            if (origin != Origin) { Reply(stream, 403, "text/plain", new byte[0]); return; }
                            if (fields.ContainsKey("Transfer-Encoding") || !fields.TryGetValue("Content-Type", out type) || type.Split(';')[0] != "application/json" ||
                                !fields.TryGetValue("Content-Length", out lengthText) || !int.TryParse(lengthText, out length) || length < 1 || length > 128)
                            { Reply(stream, 400, "text/plain", new byte[0]); return; }
                            var body = new byte[length]; int offset = 0;
                            while (offset < length) { int count = stream.Read(body, offset, length - offset); if (count == 0) return; offset += count; }
                            string preference;
                            try { preference = Encoding.UTF8.GetString(body); LanguageSettings.ParsePreference(preference); }
                            catch { Reply(stream, 400, "text/plain", new byte[0]); return; }
                            try { languages.Save(preference); }
                            catch { Reply(stream, 500, "application/json", Encoding.UTF8.GetBytes("{\"error\":\"language-not-saved\"}")); return; }
                        }
                        else if (request[0] != "GET") { Reply(stream, 405, "text/plain", new byte[0]); return; }
                        Reply(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(languages.Json())); return;
                    }
                    if (request[0] != "GET") { Reply(stream, 405, "text/plain", new byte[0]); return; }
                    if (request[1] == "/" || request[1] == "/index.html")
                    {
                        string boot = "<script>window.__VECTOR__={origin:'" + Origin + "',token:'" + token + "',version:'" + VectorVersion.Current + "',instance:'" + instance + "'" + (languages == null ? "" : ",language:" + languages.Json()) + "};</script>";
                        Reply(stream, 200, "text/html; charset=utf-8", Encoding.UTF8.GetBytes(html.Replace("<head>", "<head>" + boot)));
                    }
                    else if (request[1] == "/api/version") Reply(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"version\":\"" + VectorVersion.Current + "\",\"instance\":\"" + instance + "\"}"));
                    else if (request[1] == "/api/activity-teams" || request[1] == "/api/battles")
                    {
                        if (!fields.TryGetValue("X-Vector-Token", out supplied) || supplied != token) { Reply(stream, 403, "text/plain", new byte[0]); return; }
                        string snapshot = request[1] == "/api/battles" ? battles.Snapshot() : teams.Snapshot();
                        string etag;
                        using (var sha = SHA256.Create()) etag = "\"" + Convert.ToBase64String(sha.ComputeHash(Encoding.UTF8.GetBytes(snapshot))) + "\"";
                        string previous;
                        if (fields.TryGetValue("If-None-Match", out previous) && previous == etag) Reply(stream, 304, "application/json", new byte[0], etag);
                        else Reply(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(snapshot), etag);
                    }
                    else Reply(stream, 404, "text/plain", new byte[0]);
                }
            }
            catch { /* Disconnected or timed-out local client; never log headers or game data. */ }
        }

        private static void Reply(Stream stream, int status, string type, byte[] body, string etag = null)
        {
            string reason = status == 200 ? "OK" : status == 304 ? "Not Modified" : "Request rejected";
            string headers = "HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.Length +
                "\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nReferrer-Policy: no-referrer\r\n" +
                (etag == null ? "" : "ETag: " + etag + "\r\n") + "\r\n";
            byte[] bytes = Encoding.ASCII.GetBytes(headers);
            stream.Write(bytes, 0, bytes.Length);
            stream.Write(body, 0, body.Length);
        }

        public void Dispose() { stopped = true; listener.Stop(); }
    }

    internal static class VectorBrand
    {
        public static Icon LoadIcon(Size size)
        {
            using (Stream source = Assembly.GetExecutingAssembly().GetManifestResourceStream("Vector.ico"))
            {
                if (source == null) throw new InvalidDataException("Embedded Vector icon is missing.");
                using (var icon = new Icon(source, size)) return (Icon)icon.Clone();
            }
        }
    }

    internal sealed class VectorContext : ApplicationContext
    {
        private readonly LocalServer server;
        private readonly NotifyIcon tray;
        private readonly Icon trayIcon;
        private readonly System.Windows.Forms.Timer timer;
        private readonly EventWaitHandle reopen;
        private readonly GameFileCollector collector;
        private readonly AppUpdates updates;
        private readonly LanguageSettings languages;
        private readonly ToolStripMenuItem updateStatus;
        private int updateTicks;
        private bool paused;

        public VectorContext(EventWaitHandle reopen, bool openBrowser, bool skipUpdate)
        {
            this.reopen = reopen;
            string data = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Vector-data");
            var battles = new BattleFileStore(Path.Combine(data, "battles"));
            var teams = new CombatTeamFeed();
            languages = new LanguageSettings(data, preference => LanguageDetection.Detect(preference, collector == null ? GameFileCollector.Discover() : collector.GameFolder));
            server = new LocalServer(battles, 8112, teams, languages);
            collector = new GameFileCollector(battles, data, teams);
            updates = new AppUpdates(skipUpdate);
            var menu = new ContextMenuStrip();
            menu.Items.Add(Item("Open Vector", (s, e) => Open()));
            var pause = Item("Pause history updates", null);
            pause.Click += (s, e) => { paused = !paused; pause.Tag = paused ? "Resume history updates" : "Pause history updates"; pause.Text = languages.Text((string)pause.Tag); collector.Pause(paused); };
            menu.Items.Add(pause);
            menu.Items.Add(Item("Choose War Thunder folder…", (s, e) => {
                using (var picker = new FolderBrowserDialog { Description = languages.Text("Select your War Thunder installation folder"), ShowNewFolderButton = false })
                {
                    if (picker.ShowDialog() != DialogResult.OK) return;
                    try { collector.Choose(picker.SelectedPath); languages.Refresh(); }
                    catch (InvalidDataException error) { MessageBox.Show(languages.Text(error.Message), "Vector"); }
                    catch { MessageBox.Show(languages.Text("Could not use this folder. Check folder access and free disk space."), "Vector"); }
                }
            }));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("Vector " + VectorVersion.Current) { Enabled = false });
            updateStatus = new ToolStripMenuItem(languages.Text("Checking for app updates")) { Enabled = false };
            menu.Items.Add(updateStatus);
            menu.Items.Add(Item("Check for app updates", (s, e) => ThreadPool.QueueUserWorkItem(_ => updates.Check(true))));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(Item("Exit Vector", (s, e) => ExitThread()));
            trayIcon = VectorBrand.LoadIcon(SystemInformation.SmallIconSize);
            tray = new NotifyIcon { Icon = trayIcon, Text = languages.Text("Vector: automatic battle history"), ContextMenuStrip = menu, Visible = true };
            tray.DoubleClick += (s, e) => Open();
            timer = new System.Windows.Forms.Timer { Interval = 1000 };
            timer.Tick += (s, e) => {
                if (reopen.WaitOne(0)) Open();
                updateStatus.Text = languages.Text(updates.Status);
                foreach (ToolStripItem item in menu.Items) if (item.Tag is string) item.Text = languages.Text((string)item.Tag);
                tray.Text = languages.Text("Vector: automatic battle history");
                if (updates.ReadyToExit) { ExitThread(); return; }
                if (++updateTicks % 15 == 0) ThreadPool.QueueUserWorkItem(_ => updates.TryInstall());
            };
            timer.Start();
            if (openBrowser) Open();
        }

        private ToolStripMenuItem Item(string text, EventHandler click)
        { return new ToolStripMenuItem(languages.Text(text), null, click) { Tag = text }; }

        private void Open()
        {
            try { Process.Start(new ProcessStartInfo(server.Origin + "/") { UseShellExecute = true }); }
            catch { MessageBox.Show(languages.Text("Open {url} in your browser.").Replace("{url}", server.Origin + "/"), "Vector"); }
        }

        protected override void ExitThreadCore()
        {
            timer.Stop(); timer.Dispose(); updates.Dispose(); collector.Dispose(); tray.Visible = false; tray.Dispose(); trayIcon.Dispose(); server.Dispose();
            base.ExitThreadCore();
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            if (args.Length == 1 && args[0] == "--apply-update") { Environment.ExitCode = UpdateInstaller.Run(); return; }
            using (var mutex = new Mutex(false, UpdateInstaller.MutexName))
            using (var reopen = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\VectorPortableReports-open-v1"))
            {
                bool first;
                try { first = mutex.WaitOne(0); } catch (AbandonedMutexException) { first = true; }
                if (!first) { reopen.Set(); return; }
                try
                {
                    Application.EnableVisualStyles();
                    var context = new VectorContext(reopen, !args.Contains("--no-browser") && !args.Contains("--updated"), args.Contains("--skip-update-once") || args.Contains("--updated"));
                    UpdateInstaller.AcknowledgeStartup(args);
                    Application.Run(context);
                }
                catch (Exception error)
                {
                    MessageBox.Show("Vector could not start. Check that its folder is writable and port 8112 is free.\n\n" + error.Message, "Vector", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                finally { mutex.ReleaseMutex(); }
            }
        }
    }
}
