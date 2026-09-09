using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace VectorPortable
{
    public sealed class LanguageState
    {
        public string preference, language, source;
    }
    public static class LanguageDetection
    {
        public static string Normalize(string value)
        {
            if (value == null || value.Length > 64) return null;
            value = value.Trim().ToLowerInvariant().Replace('_', '-');
            if (value == "english" || Regex.IsMatch(value, "^en(?:-[a-z0-9]{2,8})*$")) return "en";
            if (value == "russian" || Regex.IsMatch(value, "^ru(?:-[a-z0-9]{2,8})*$")) return "ru";
            return null;
        }
        public static LanguageState Select(string preference, string game, string steamGame, string steam, string system)
        {
            if (preference == "en" || preference == "ru") return new LanguageState { preference = preference, language = preference, source = "manual" };
            string[] values = { game, steamGame, steam, system }, sources = { "game", "steam", "steam", "system" };
            for (int i = 0; i < values.Length; i++)
            { string language = Normalize(values[i]); if (language != null) return new LanguageState { preference = "auto", language = language, source = sources[i] }; }
            return new LanguageState { preference = "auto", language = "en", source = "fallback" };
        }
        private static string Unique(MatchCollection matches)
        {
            var values = matches.Cast<Match>().Select(m => m.Groups[1].Value).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            return values.Length == 1 ? values[0] : null;
        }
        public static string GameConfig(string text)
        { return Unique(Regex.Matches(text, "^[ \\t]*language[ \\t]*:[ \\t]*t[ \\t]*=[ \\t]*\"([A-Za-z_-]{1,64})\"[ \\t]*(?://[^\\r\\n]*)?\\r?$", RegexOptions.Multiline | RegexOptions.IgnoreCase)); }
        public static string SteamConfig(string text)
        { return Unique(Regex.Matches(text, "^[ \\t]*\"language\"[ \\t]+\"([A-Za-z_-]{1,64})\"[ \\t]*\\r?$", RegexOptions.Multiline | RegexOptions.IgnoreCase)); }
        private static string ReadSmall(string path, int limit)
        {
            UpdateInstaller.CheckNoLinks(path);
            using (var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var data = new MemoryStream())
            { UpdateSource.CopyBounded(input, data, limit); return Encoding.UTF8.GetString(data.ToArray()); }
        }
        public static LanguageState Detect(string preference, string gameFolder)
        {
            string game = null, steamGame = null, steam = null;
            if (!string.IsNullOrEmpty(gameFolder))
            {
                try { game = GameConfig(ReadSmall(Path.Combine(gameFolder, "config.blk"), 1048576)); } catch { }
                try
                {
                    string common = Path.GetDirectoryName(gameFolder);
                    if (string.Equals(Path.GetFileName(common), "common", StringComparison.OrdinalIgnoreCase))
                        steamGame = SteamConfig(ReadSmall(Path.Combine(Path.GetDirectoryName(common), "appmanifest_236390.acf"), 1048576));
                }
                catch { }
            }
            try { using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam")) steam = key == null ? null : key.GetValue("Language") as string; } catch { }
            return Select(preference, game, steamGame, steam, CultureInfo.CurrentUICulture.Name);
        }
    }
    public sealed class LanguageSettings
    {
        private readonly string path;
        private readonly object gate = new object();
        private readonly Func<string, LanguageState> detect;
        private readonly Dictionary<string, string> russian;
        private string preference = "auto";
        private LanguageState state;
        private DateTime refresh;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 1048576 };
        public LanguageSettings(string data, Func<string, LanguageState> detect)
        {
            this.detect = detect; path = Path.Combine(data, "language.json");
            try
            {
                UpdateInstaller.CheckNoLinks(path);
                if (File.Exists(path) && new FileInfo(path).Length <= 128) preference = ParsePreference(File.ReadAllText(path));
            }
            catch { }
            using (var source = Assembly.GetExecutingAssembly().GetManifestResourceStream("Vector.ru.json"))
            using (var reader = new StreamReader(source, Encoding.UTF8)) russian = json.Deserialize<Dictionary<string, string>>(reader.ReadToEnd());
        }
        public static string ParsePreference(string body)
        {
            if (body == null || body.Length > 128) throw new InvalidDataException("Invalid language preference.");
            // One allowlisted scalar only. Duplicate keys, paths and nested data
            // are not valid settings, even if a permissive JSON parser accepts them.
            var match = Regex.Match(body, "\\A\\s*\\{\\s*\"preference\"\\s*:\\s*\"(auto|en|ru)\"\\s*\\}\\s*\\z");
            if (!match.Success) throw new InvalidDataException("Invalid language preference.");
            return match.Groups[1].Value;
        }
        private LanguageState Automatic()
        {
            lock (gate)
            {
                if (state == null || DateTime.UtcNow >= refresh)
                { state = detect("auto"); refresh = DateTime.UtcNow.AddSeconds(60); }
                return new LanguageState { preference = state.preference, language = state.language, source = state.source };
            }
        }
        public LanguageState Snapshot()
        {
            lock (gate) return preference == "auto" ? Automatic() : new LanguageState { preference = preference, language = preference, source = "manual" };
        }
        public void Refresh() { lock (gate) refresh = DateTime.MinValue; }
        public string Json()
        {
            lock (gate) { var current = Snapshot(); return json.Serialize(new { current.preference, current.language, current.source, automatic = Automatic() }); }
        }
        public void Save(string value)
        {
            string chosen = ParsePreference(value);
            lock (gate)
            {
                UpdateInstaller.CheckNoLinks(path); Directory.CreateDirectory(Path.GetDirectoryName(path));
                string temporary = Path.Combine(Path.GetDirectoryName(path), "language-" + Guid.NewGuid().ToString("N") + ".tmp"), backup = path + ".bak";
                UpdateInstaller.CheckNoLinks(backup);
                try
                {
                    using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    { byte[] bytes = Encoding.UTF8.GetBytes(json.Serialize(new { preference = chosen })); file.Write(bytes, 0, bytes.Length); file.Flush(true); }
                    if (File.Exists(path)) File.Replace(temporary, path, backup); else File.Move(temporary, path);
                    preference = chosen; state = null;
                }
                finally { if (File.Exists(temporary)) File.Delete(temporary); }
            }
        }
        public string Text(string english)
        {
            if (Snapshot().language != "ru") return english;
            string result;
            if (russian.TryGetValue(english, out result)) return result;
            var version = Regex.Match(english, "^Vector ([0-9.]+) is up to date$");
            if (version.Success && russian.TryGetValue("Vector {version} is up to date", out result)) return result.Replace("{version}", version.Groups[1].Value);
            var download = Regex.Match(english, "^Downloading Vector ([0-9.]+)$");
            if (download.Success && russian.TryGetValue("Downloading Vector {version}", out result)) return result.Replace("{version}", download.Groups[1].Value);
            return english;
        }
    }
}
