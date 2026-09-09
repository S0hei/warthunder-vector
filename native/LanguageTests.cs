using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using VectorPortable;

internal static class LanguageTests
{
    private static string Request(string url, string token, string origin, string method, string body, out int status, string contentType = "application/json")
    {
        var request = (HttpWebRequest)WebRequest.Create(url);
        request.Proxy = null; request.Timeout = 4000; request.Method = method;
        if (token != null) request.Headers.Add("X-Vector-Token", token);
        if (origin != null) request.Headers.Add("Origin", origin);
        if (body != null)
        {
            var data = Encoding.UTF8.GetBytes(body); request.ContentLength = data.Length; request.ContentType = contentType;
            using (var stream = request.GetRequestStream()) stream.Write(data, 0, data.Length);
        }
        HttpWebResponse response;
        try { response = (HttpWebResponse)request.GetResponse(); }
        catch (WebException error) { response = (HttpWebResponse)error.Response; if (response == null) throw; }
        using (response) using (var reader = new StreamReader(response.GetResponseStream()))
        { status = (int)response.StatusCode; return reader.ReadToEnd(); }
    }
    public static void Run(Action<bool, string> check, string directory)
    {
        foreach (string code in new[] { "Russian", "RU-ru", " ru_RU ", "ru" }) check(LanguageDetection.Normalize(code) == "ru", "Russian language code " + code);
        check(LanguageDetection.Normalize("english") == "en" && LanguageDetection.Normalize("en-GB") == "en", "English language aliases");
        foreach (string code in new[] { null, "", "rubbish", "english.exe", "de-DE", new string('r', 65) }) check(LanguageDetection.Normalize(code) == null, "unsupported language is not guessed");
        var game = LanguageDetection.Select("auto", "Russian", "english", "english", "en-US");
        check(game.language == "ru" && game.source == "game", "game language takes priority over Steam and system");
        check(LanguageDetection.Select("auto", null, "russian", "english", "en-US").source == "steam", "per-game Steam language is the next source");
        check(LanguageDetection.Select("auto", "German", null, "russian", "en-US").language == "ru", "unsupported game language falls through to a supported Steam language");
        check(LanguageDetection.Select("auto", null, null, null, "ru-RU").source == "system", "Windows UI language fallback");
        check(LanguageDetection.Select("auto", "German", null, null, "de-DE").source == "fallback", "no supported source falls back to English");
        check(LanguageDetection.Select("en", "Russian", "russian", "russian", "ru-RU").source == "manual", "manual language overrides automatic detection");
        check(LanguageDetection.GameConfig("// language:t=\"English\"\r\nlanguage:t=\"Russian\" // setting\r\nother:t=\"secret\"") == "Russian", "game config extracts only the active language field");
        check(LanguageDetection.GameConfig("language:t=\"Russian\"\nlanguage:t=\"English\"") == null, "ambiguous game language is ignored");
        check(LanguageDetection.SteamConfig("\"language\" \"english\"\r\n\"language\" \"english\"\r\n") == "english", "matching Steam language fields are supported");
        check(LanguageDetection.SteamConfig("\"language\" \"english\"\n\"language\" \"russian\"") == null, "ambiguous Steam settings are ignored");
        foreach (string invalid in new[] { "{}", "[]", "null", "{\"preference\":\"fr\"}", "{\"preference\":true}", "{\"preference\":\"ru\",\"path\":\"C:/secret\"}", "{\"preference\":\"en\",\"preference\":\"ru\"}", new string(' ', 129) })
        { bool rejected = false; try { LanguageSettings.ParsePreference(invalid); } catch { rejected = true; } check(rejected, "malformed language settings rejected"); }
        string folder = Path.Combine(directory, "language");
        string currentGame = "Russian"; int reads = 0;
        Func<string, LanguageState> detect = preference => { reads++; return LanguageDetection.Select(preference, currentGame, null, null, "en-US"); };
        var settings = new LanguageSettings(folder, detect);
        check(settings.Snapshot().language == "ru" && settings.Text("Battle results") == "Результаты боёв", "embedded Russian dictionary loads without external assets");
        settings.Snapshot(); check(reads == 1, "detection is cached, not repeated for every label");
        check(settings.Text("Downloading Vector 0.3.0") == "Загрузка Vector 0.3.0", "dynamic update download status is localized");
        check(settings.Text("Vector 0.3.0 is up to date").Contains("0.3.0"), "localized update status preserves version");
        check(settings.Text("Downloading Vector {missing}") == "Downloading Vector {missing}", "unknown update strings never recurse or change data");
        settings.Save("{\"preference\":\"en\"}");
        check(settings.Snapshot().language == "en" && settings.Text("Battle results") == "Battle results", "manual English applies immediately");
        check(new LanguageSettings(folder, detect).Snapshot().preference == "en", "language preference survives restart");
        check(File.ReadAllText(Path.Combine(folder, "language.json")) == "{\"preference\":\"en\"}", "saved language contains no game paths or raw configuration");
        settings.Save("{\"preference\":\"auto\"}"); currentGame = "English"; settings.Refresh();
        check(settings.Snapshot().language == "en", "automatic language refresh follows changed game settings");
        var store = new BattleFileStore(Path.Combine(directory, "language-api-battles"));
        using (var server = new LocalServer(store, 0, null, settings))
        {
            int status;
            string html = Request(server.Origin + "/", null, null, "GET", null, out status);
            string token = Regex.Match(html, "token:'([a-f0-9]{64})'").Groups[1].Value;
            Request(server.Origin + "/api/language", null, server.Origin, "GET", null, out status); check(status == 403, "language API requires launch token");
            foreach (string origin in new[] { null, "null", "https://unrelated.example" })
            { Request(server.Origin + "/api/language", token, origin, "PUT", "{\"preference\":\"ru\"}", out status); check(status == 403, "language writes require an explicit same origin"); }
            Request(server.Origin + "/api/language", token, server.Origin, "POST", "{}", out status); check(status == 405, "language API only supports GET and PUT");
            Request(server.Origin + "/api/language", token, server.Origin, "PUT", "{\"preference\":\"ru\"}", out status, "text/plain"); check(status == 400, "language writes require JSON content type");
            foreach (string body in new[] { "{}", "{\"preference\":\"../path\"}", new string('x', 129) })
            { Request(server.Origin + "/api/language", token, server.Origin, "PUT", body, out status); check(status == 400, "invalid or oversized language request rejected"); }
            var result = Request(server.Origin + "/api/language", token, server.Origin, "PUT", "{\"preference\":\"ru\"}", out status);
            check(status == 200 && result.Contains("\"preference\":\"ru\"") && result.Contains("\"source\":\"manual\""), "authorized language write returns effective setting");
            check(result.Contains("\"automatic\":{") && result.Contains("\"source\":\"game\"") && !result.Contains(folder), "preview receives only sanitized automatic detection alongside manual setting");
            html = Request(server.Origin + "/", null, null, "GET", null, out status);
            check(html.Contains("language:{\"preference\":\"ru\""), "reload bootstrap reflects current saved preference");
            Request(server.Origin + "/api/battles", token, server.Origin, "PUT", "{}", out status); check(status == 405, "language setting does not enable writes to battle archive");
            Request(server.Origin + "/language.json", token, server.Origin, "GET", null, out status); check(status == 404, "language setting does not expose filesystem routes");
        }
    }
}
