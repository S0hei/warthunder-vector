using System;
using System.IO;
using System.Net;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using VectorPortable;

internal static class VectorTests
{
    private static int checks;
    private static void Check(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS " + name); checks++; }
    private static string Get(string url, string token, string origin, out int status, out string etag, string previous = null)
    {
        var request = (HttpWebRequest)WebRequest.Create(url);
        request.Proxy = null;
        request.Timeout = 4000;
        if (token != null) request.Headers.Add("X-Vector-Token", token);
        if (origin != null) request.Headers.Add("Origin", origin);
        if (previous != null) request.Headers.Add("If-None-Match", previous);
        HttpWebResponse response;
        try { response = (HttpWebResponse)request.GetResponse(); }
        catch (WebException error) { response = (HttpWebResponse)error.Response; if (response == null) throw; }
        using (response)
        using (var reader = new StreamReader(response.GetResponseStream()))
        { status = (int)response.StatusCode; etag = response.Headers["ETag"]; return reader.ReadToEnd(); }
    }

    private static int Main(string[] args)
    {
        if (args.Length > 0) return UpdateTests.FixtureMain(args);
        // No clipboard writes, clipboard reads, game processes, browser or production archive.
        string directory = Path.Combine(Path.GetTempPath(), "vector-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            // Tray-sized DIB frames go through the exact .NET loader used by
            // NotifyIcon. Explorer's 256px PNG is decoded separately: this
            // older Framework constructor falls back to the 128px DIB.
            foreach (int size in new[] { 16, 20, 24, 32, 48, 64, 128 })
            {
                using (var icon = VectorBrand.LoadIcon(new System.Drawing.Size(size, size)))
                using (var bitmap = icon.ToBitmap())
                    Check(icon.Width == size && bitmap.Height == size, "embedded icon decodes at " + size + "px");
            }
            using (var stream = System.Reflection.Assembly.GetExecutingAssembly().GetManifestResourceStream("Vector.ico"))
            using (var reader = new BinaryReader(stream))
            {
                stream.Position = 4;
                int count = reader.ReadUInt16();
                stream.Position = 6 + (count - 1) * 16;
                Check(reader.ReadByte() == 0 && reader.ReadByte() == 0, "Explorer icon includes a 256px entry");
                stream.Position += 6;
                int length = reader.ReadInt32();
                int offset = reader.ReadInt32();
                stream.Position = offset;
                using (var png = new MemoryStream(reader.ReadBytes(length)))
                using (var bitmap = new System.Drawing.Bitmap(png))
                    Check(bitmap.Width == 256 && bitmap.Height == 256, "256px Explorer icon decodes correctly");
            }
            using (var icon = System.Drawing.Icon.ExtractAssociatedIcon(System.Reflection.Assembly.GetExecutingAssembly().Location))
            using (var bitmap = icon.ToBitmap())
            {
                bool lime = false;
                for (int y = 0; y < bitmap.Height; y++)
                    for (int x = 0; x < bitmap.Width; x++)
                    { var pixel = bitmap.GetPixel(x, y); if (pixel.A > 200 && pixel.R > 130 && pixel.G > 190 && pixel.B < 120) lime = true; }
                Check(lime, "Windows executable exposes the Vector icon");
            }
            using (var server = new LocalServer(new BattleFileStore(Path.Combine(directory, "api-battles")), 0))
            {
                int status; string etag;
                string html = Get(server.Origin + "/", null, null, out status, out etag);
                Check(status == 200 && html.Contains("<style>") && html.Contains("type=\"module\""), "embedded portable UI served");
                Check(html.Contains("rel=\"icon\"") && html.Contains("data:image/svg+xml;base64,"), "browser icon embedded without an external file");
                string token = Regex.Match(html, "token:'([a-f0-9]{64})'").Groups[1].Value;
                Check(token.Length == 64, "per-launch authentication bootstrap");
                string appVersion = Get(server.Origin + "/api/version", null, server.Origin, out status, out etag);
                Check(status == 200 && appVersion.Contains(VectorVersion.Current) && !appVersion.Contains(token), "version endpoint supports reload without exposing the access token");
                Get(server.Origin + "/api/version", null, "https://unrelated.example", out status, out etag);
                Check(status == 403, "version endpoint rejects foreign origins");
                Get(server.Origin + "/api/reports", token, server.Origin, out status, out etag);
                Check(status == 404, "copied-report endpoint is removed");
                foreach (string path in new[] { "/api/profile", "/api/profile-connector", "/downloads/vector-profile-connector.zip", "/licenses/webview2.txt" })
                {
                    Get(server.Origin + path, token, server.Origin, out status, out etag);
                    Check(status == 404, "retired profile route is unavailable: " + path);
                }
                Get(server.Origin + "/api/battles", token, "chrome-extension://retired-connector", out status, out etag);
                Check(status == 403, "browser extensions have no special access to local battle history");
                Check(!html.Contains("Profile snapshots") && !html.Contains("profile-connector"), "portable Results UI has no profile setup or polling");
                Get(server.Origin + "/Vector-data/reports/123456789abcdef.json", token, null, out status, out etag);
                Check(status == 404, "no filesystem route");
                Get(server.Origin + "/", null, "null", out status, out etag);
                Check(status == 403, "file-origin access blocked");
                Get(server.Origin + "/api/battles", null, null, out status, out etag);
                Check(status == 403, "automatic battle archive requires authentication");
                Get(server.Origin + "/api/battles", token, "https://unrelated.example", out status, out etag);
                Check(status == 403, "automatic battle archive rejects foreign origins");
                string automatic = Get(server.Origin + "/api/battles", token, server.Origin, out status, out etag);
                Check(status == 200 && automatic.Contains("\"battles\":[]"), "automatic archive is served on the protected route");
                string version = etag;
                Get(server.Origin + "/api/battles", token, server.Origin, out status, out etag, version);
                Check(status == 304, "unchanged automatic archive supports conditional requests");
                Get(server.Origin + "/api/activity-teams", null, null, out status, out etag);
                Check(status == 403, "combat annotations require authentication");
                string teams = Get(server.Origin + "/api/activity-teams", token, server.Origin, out status, out etag);
                Check(status == 200 && teams.Contains("\"events\":[]"), "allowlisted combat annotations have a protected route");
            }
            GameFileTests.Run(Check, directory);
            var cachedFiles = new System.Collections.Generic.Dictionary<string, int> { { "old.clog", 1 }, { "current.clog", 2 } };
            GameFileCollector.PruneCache(cachedFiles, new[] { "CURRENT.clog" });
            Check(cachedFiles.Count == 1 && cachedFiles["current.clog"] == 2, "collector drops obsolete cached readers without resetting current offsets");
            GameFileCollector.PruneCache(cachedFiles, new string[0]);
            Check(cachedFiles.Count == 0, "collector cache does not retain files outside the scan window");
            var assembly = System.Reflection.Assembly.GetExecutingAssembly();
            foreach (var reference in assembly.GetReferencedAssemblies())
                Check(!reference.Name.Contains("WebView2"), "no embedded browser dependency: " + reference.Name);
            foreach (string resource in assembly.GetManifestResourceNames())
                Check(!resource.Contains("WebView2") && !resource.Contains("ProfileConnector"), "only local app assets are bundled: " + resource);
            LanguageTests.Run(Check, directory);
            UpdateTests.Run(Check, directory);
            Console.WriteLine(checks + " Windows checks passed.");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally
        {
            // Remove only this exact, freshly created test directory.
            if (Path.GetDirectoryName(directory) == Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) &&
                Path.GetFileName(directory).StartsWith("vector-test-")) Directory.Delete(directory, true);
        }
    }
}
