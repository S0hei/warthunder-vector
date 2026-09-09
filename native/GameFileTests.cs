using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;
using VectorPortable;

internal static class GameFileTests
{
    private static void Uleb(BinaryWriter w, int n) { do { byte b = (byte)(n & 127); n >>= 7; w.Write((byte)(b | (n > 0 ? 128 : 0))); } while (n > 0); }
    private static byte[] Replay(bool final)
    {
        var root = new Dictionary<string, object> { { "authorUserId", "42" }, { "author", "Test pilot" }, { "timePlayed", 120f } };
        if (final) root.Add("status", "success");
        var own = new Dictionary<string, object> { { "userId", "42" }, { "kills", 3 }, { "groundKills", 0 }, { "navalKills", 0 }, { "aiKills", 1 }, { "aiGroundKills", 2 }, { "aiNavalKills", 0 }, { "assists", 1 }, { "deaths", 1 }, { "score", 900 } };
        var names = root.Keys.Concat(own.Keys).Concat(new[] { "player" }).Distinct().ToList();
        byte[] nameBytes = Encoding.UTF8.GetBytes(string.Join("\0", names) + "\0");
        using (var data = new MemoryStream())
        using (var fields = new MemoryStream())
        using (var dw = new BinaryWriter(data))
        using (var fw = new BinaryWriter(fields))
        using (var output = new MemoryStream())
        using (var w = new BinaryWriter(output))
        {
            foreach (var p in root.Concat(own))
            {
                int id = names.IndexOf(p.Key); fw.Write((byte)id); fw.Write((byte)(id >> 8)); fw.Write((byte)(id >> 16));
                if (p.Value is string) { fw.Write((byte)1); fw.Write((uint)data.Position); dw.Write(Encoding.UTF8.GetBytes((string)p.Value + "\0")); }
                else if (p.Value is float) { fw.Write((byte)3); fw.Write((float)p.Value); }
                else { fw.Write((byte)2); fw.Write((int)p.Value); }
            }
            byte[] header = new byte[1360];
            Array.Copy(BitConverter.GetBytes(0x1000ace5u), 0, header, 0, 4); Array.Copy(BitConverter.GetBytes(101387u), 0, header, 4, 4);
            Array.Copy(Encoding.UTF8.GetBytes("levels/test.bin\0"), 0, header, 8, 16);
            Array.Copy(BitConverter.GetBytes(1360u), 0, header, 684, 4); Array.Copy(BitConverter.GetBytes(0x123456789abcdefUL), 0, header, 732, 8);
            Array.Copy(BitConverter.GetBytes(1788858000u), 0, header, 908, 4);
            w.Write(header); w.Write((byte)1); Uleb(w, names.Count); Uleb(w, nameBytes.Length); w.Write(nameBytes);
            Uleb(w, 2); Uleb(w, root.Count + own.Count); Uleb(w, (int)data.Length); w.Write(data.ToArray()); w.Write(fields.ToArray());
            Uleb(w, 0); Uleb(w, root.Count); Uleb(w, 1); Uleb(w, 1);
            Uleb(w, names.IndexOf("player") + 1); Uleb(w, own.Count); Uleb(w, 0);
            return output.ToArray();
        }
    }
    private static void Fails(Action action, Action<bool, string> check, string label)
    { bool failed = false; try { action(); } catch { failed = true; } check(failed, label); }
    public static void Run(Action<bool, string> check, string directory)
    {
        FileBattle final = ReplayMetadata.Read(new MemoryStream(Replay(true))), left = ReplayMetadata.Read(new MemoryStream(Replay(false)));
        check(final.outcome == "win" && left.outcome == "unknown", "absent replay result is unresolved, not a loss");
        check(final.accountId == "42" && final.kills == 3 && final.aiKills == 1 && final.aiGroundKills == 2 && final.deaths == 1, "author counters and AI remain separate");
        check(final.id == "123456789abcdef" && final.mission == "test" && final.seconds == 120, "replay match metadata decoded");
        byte[] broken = Replay(true); broken[4] = 0;
        Fails(() => ReplayMetadata.Read(new MemoryStream(broken)), check, "unsupported replay versions rejected");
        Fails(() => ReplayMetadata.Read(new MemoryStream(Replay(true).Take(1400).ToArray())), check, "partial replay trailers rejected");
        Fails(() => ReplayMetadata.Read(new MemoryStream(Replay(true).Concat(new byte[] { 0 }).ToArray())), check, "replay residual data rejected");
        var snapshots = new List<FileBattle>();
        var serializer = new JavaScriptSerializer();
        var start = new DateTimeOffset(2026,9,8,12,0,0,TimeSpan.Zero);
        var log = new BattleLogReader(start, b => snapshots.Add(serializer.Deserialize<FileBattle>(serializer.Serialize(b))));
        string text = " 1.00 STOR online_storage::load_locally: userid=42, store=irrelevant\n" +
            " 2.00 [D]  AcesMpContext: AcesApp::onJoinMatch : sessionId:123456789abcdef\n" +
            " 3.00 CHSV token: MUST_NOT_BE_SAVED\n" +
            " 4.00 [D]  received SessionStats sum WP: mis[0] total[1000]\n" +
            " 4.00 [D]  received SessionStats sum EXP: total[200]\n" +
            " 4.00 [D]  received SessionStats test_plane WP: mis[0]\n" +
            " 4.01 [D]  AcesMission::endFinally 3 -1.000000\n";
        byte[] plain = Encoding.UTF8.GetBytes(text), encoded = new byte[plain.Length];
        for (int i = 0; i < plain.Length; i++) encoded[i] = (byte)(plain[i] ^ BattleLogReader.XorKey[i % BattleLogReader.XorKey.Length]);
        for (int i = 0; i < encoded.Length; i++) log.Feed(new[] { encoded[i] }, 1);
        check(snapshots.Count == 1 && snapshots[0].wp == 1000 && snapshots[0].exp == 200 && snapshots[0].outcome == "unknown", "incremental XOR reader handles single-byte chunks and early departure");
        check(snapshots[0].vehicles.SequenceEqual(new[] { "test_plane" }) && snapshots[0].playedAt == start.AddSeconds(2).ToString("o"), "log extracts join time and vehicle");
        check(!serializer.Serialize(snapshots).Contains("MUST_NOT_BE_SAVED"), "unrelated sensitive log lines are never exported");
        log.Line(" 4.02 [D]  AcesMission::setStatus MISSION_STATUS_RUNNING -> MISSION_STATUS_SUCCESS");
        check(snapshots.Last().outcome == "win", "explicit terminal status promotes snapshot");
        log.Line(" 90.00 [D]  AcesMission::setStatus MISSION_STATUS_RUNNING -> MISSION_STATUS_FAIL");
        check(snapshots.Count == 2, "later test-flight status cannot change a departed match");
        var storeDir = Path.Combine(directory, "battles"); var store = new BattleFileStore(storeDir);
        store.Upsert(snapshots[0]); store.Upsert(snapshots[0]);
        check(Directory.GetFiles(storeDir, "*.json").Length == 1, "duplicate log snapshots count once");
        store.Upsert(final); store.Upsert(snapshots[0]);
        var saved = serializer.Deserialize<FileBattle>(File.ReadAllText(Path.Combine(storeDir, final.Key + ".json")));
        check(saved.outcome == "win" && saved.wp == 1000 && saved.kills == 3 && saved.hasLog && saved.hasReplay, "replay and log merge without losing metrics or downgrading outcome");
        check(!saved.rewardsFinal, "a final replay does not finalize departure-time rewards");
        store.Upsert(snapshots[1]); store.Upsert(snapshots[0]);
        check(serializer.Deserialize<FileBattle>(File.ReadAllText(Path.Combine(storeDir, final.Key + ".json"))).rewardsFinal, "explicit final log promotes rewards and survives provisional rescans");
        store.Upsert(left);
        check(serializer.Deserialize<FileBattle>(File.ReadAllText(Path.Combine(storeDir, final.Key + ".json"))).outcome == "win", "rescan of departure replay cannot erase confirmed outcome");
        final.accountId = "43"; store.Upsert(final);
        check(Directory.GetFiles(storeDir, "*.json").Length == 2, "same match under different accounts remains separate");
        check(new BattleFileStore(storeDir).Snapshot().Contains("\"wp\":1000"), "automatic history persists across restarts");
        final.outcome = "loss"; store.Upsert(final);
        check(serializer.Deserialize<FileBattle>(File.ReadAllText(Path.Combine(storeDir, final.Key + ".json"))).conflict, "conflicting final outcomes are flagged");
        final.id = "../escape"; Fails(() => store.Upsert(final), check, "battle path injection rejected");
        string corrupt = Path.Combine(storeDir, "99-ffffffff.json"); File.WriteAllText(corrupt, "broken");
        var reopened = new BattleFileStore(storeDir); final.id = "ffffffff"; final.accountId = "99";
        Fails(() => reopened.Upsert(final), check, "corrupt existing battle is preserved");
        SpawnTests(check, directory);
        TeamTests(check);
    }

    private static string Player(string name, int team, bool own, int unit)
    { return " [D]  MPlayer::onStateChanged() MULP pid:1 n:'" + name + "' IN_RESPAWN->IN_FLIGHT t=" + team + " c=7 f=2203(l=" + (own ? 1 : 0) + ") mid=65535 uid=" + (own ? 42 : 43) + " eid:00141c01 uid:" + unit + "/0x00000000"; }
    private static string Spawn(int unit, int spawnBase)
    { return " [D]  UnitRespawn received for uid:" + unit + " ('test_plane') ptr:00000001 (spawnBase:" + spawnBase + " spawnArea:-1 pos:(0,0,0))"; }
    private static void SpawnTests(Action<bool, string> check, string directory)
    {
        var store = new BattleFileStore(Path.Combine(directory, "spawn-battles"));
        var json = new JavaScriptSerializer();
        Action<BattleLogReader> flight = log => {
            log.Line(" 1.00 STOR online_storage::load_locally: userid=42, store=ignored");
            log.Line(" 2.00 [D]  AcesMpContext: AcesApp::onJoinMatch : sessionId:123456789abcdef");
            log.Line(" 3.00" + Player("Pilot", 1, true, 392));
            log.Line(" 3.05" + Player("Other", 2, false, 400));
            log.Line(" 3.10" + Spawn(392, 11));
            log.Line(" 3.10" + Spawn(392, 11)); // repeated diagnostic event
            log.Line(" 3.20" + Spawn(400, 11));
            log.Line(" 30.00 [D] [REPAIR] uid:392 startBurn");
            log.Line(" 40.00" + Spawn(392, -1)); // completed airfield restoration, no player-state transition
            log.Line(" 50.00" + Player("Pilot", 1, true, 401));
            log.Line(" 50.10" + Spawn(401, 11));
            log.Line(" 50.20" + Spawn(392, -1)); // previous unit is no longer ours
            log.Line(" 60.00 [D]  AcesMission::endFinally 3 -1.000000");
            log.Line(" 61.00" + Spawn(401, -1)); // outside active match
        };
        var start = new DateTimeOffset(2026,9,8,12,0,0,TimeSpan.Zero);
        flight(new BattleLogReader(start, store.Upsert));
        string path = Path.Combine(directory, "spawn-battles", "42-123456789abcdef.json");
        var b = json.Deserialize<FileBattle>(File.ReadAllText(path));
        check(b.spawns == 3, "own initial spawn, airfield repair and new vehicle count separately, not enemy or old units");
        flight(new BattleLogReader(start, store.Upsert));
        check(json.Deserialize<FileBattle>(File.ReadAllText(path)).spawns == 3, "spawn event keys deduplicate complete log rescans");
        var reconnected = new BattleLogReader(start.AddMinutes(5), store.Upsert);
        reconnected.Line(" 1.00 STOR online_storage::load_locally: userid=42, store=ignored");
        reconnected.Line(" 2.00 [D]  AcesMpContext: AcesApp::onJoinMatch : sessionId:123456789abcdef");
        reconnected.Line(" 3.00" + Player("Pilot", 1, true, 500));
        reconnected.Line(" 3.10" + Spawn(500, 11));
        reconnected.Line(" 4.00 [D]  AcesMission::endFinally 3 -1.000000");
        check(json.Deserialize<FileBattle>(File.ReadAllText(path)).spawns == 4, "separate connection source events merge under the same battle");
        store.Upsert(ReplayMetadata.Read(new MemoryStream(Replay(true))));
        check(json.Deserialize<FileBattle>(File.ReadAllText(path)).spawns == 4, "replay merge preserves logged spawns");
        check(ReplayMetadata.Read(new MemoryStream(Replay(true))).spawns == null, "replay-only spawns are unknown, not deaths plus one");
        check(new BattleFileStore(Path.Combine(directory, "spawn-battles")).Snapshot().Contains("\"spawns\":4"), "spawn counts survive archive reload");
        b.spawnEvents = new[] { "not-an-event" }; check(!BattleFileStore.Valid(b), "invalid spawn evidence is rejected");
    }

    private static void TeamTests(Action<bool, string> check)
    {
        var feed = new CombatTeamFeed(); var start = DateTimeOffset.UtcNow;
        var reader = new BattleTeamReader("123456789abcdef", start, feed);
        reader.Line(Player("Pilot", 2, true, 392), start);
        reader.Line(Player("Friend", 2, false, 400), start);
        reader.Line(Player("Foe", 1, false, 401), start);
        reader.Line("1.00 HUD  hud_mp_ui_message - text = 'tdp\u001b012=TAG= Friend (Yak)\u001b \u001b019сбил\u001b \u001b009Foe (Bf 109)\u001b'", start.AddSeconds(1));
        check(feed.Snapshot().Contains("\"actorTeam\":\"ally\"") && feed.Snapshot().Contains("\"targetTeam\":\"enemy\""), "actor and victim colors use explicit roster team IDs, including clan tags");
        check(feed.Snapshot().Contains("\"targetInRoster\":true"), "target identity is supported by an exact roster match");
        reader.Line("2.00 HUD  hud_mp_ui_message - text = 'tdp\u001b012Friend (Yak)\u001b \u001b004нанёс критическое повреждение\u001b \u001b009Лёгкий ДОТ\u001b'", start.AddSeconds(2));
        check(feed.Snapshot().Contains("Лёгкий ДОТ") && feed.Snapshot().Split(new[] { "\"targetTeam\":\"enemy\"" }, StringSplitOptions.None).Length == 3, "damaged ground vehicles inherit roster-validated HUD palette, not guessed target opposition");
        check(feed.Snapshot().Contains("\"targetInRoster\":false"), "palette color alone does not identify a target as a named participant");
        reader.Line("3.00 HUD  hud_mp_ui_message - text = 'tdp\u001b012Friend (Yak)\u001b \u001b004нанёс критическое повреждение\u001b \u001b012Pilot (Yak)\u001b'", start.AddSeconds(3));
        check(feed.Snapshot().Contains("\"targetTeam\":\"self\""), "friendly fire does not force the victim onto the opposing side");
        var unknownFeed = new CombatTeamFeed(); var unknown = new BattleTeamReader("ffffffff", start, unknownFeed);
        unknown.Line("1.00 HUD  hud_mp_ui_message - text = 'tdp\u001b012Friend (Yak)\u001b \u001b019сбил\u001b \u001b009Foe (Bf 109)\u001b'", start);
        check(!unknownFeed.Snapshot().Contains("\"enemy\"") && unknownFeed.Snapshot().Contains("\"unknown\""), "palette numbers alone never establish teams");
        string previous = feed.Snapshot();
        new BattleTeamReader("aaaaaaaa", start.AddDays(-1), feed).Line(Player("Old", 1, true, 42), start.AddDays(-1));
        check(feed.Snapshot() == previous, "older log backfill never replaces the active team's annotations");
        reader.Line("3.00 CHSV token: MUST_NOT_BE_SAVED", start.AddSeconds(3));
        check(!feed.Snapshot().Contains("MUST_NOT_BE_SAVED"), "combat endpoint cannot expose arbitrary diagnostic text");
        var nestedFeed = new CombatTeamFeed(); var nested = new BattleTeamReader("abcdabcd", start, nestedFeed);
        nested.Line(Player("Pilot (Ace)", 2, true, 392), start);
        nested.Line(Player("Foe", 1, false, 401), start);
        nested.Line("4.00 HUD  hud_mp_ui_message - text = 'tdp\u001b012Pilot (Ace) (Yak)\u001b \u001b019сбил\u001b \u001b009=TAG= Foe (Су-6 (АМ-42))\u001b'", start.AddSeconds(4));
        check(nestedFeed.Snapshot().Contains("\"actorTeam\":\"self\"") && nestedFeed.Snapshot().Contains("\"targetInRoster\":true"), "nested aircraft variants and pilot parentheses keep exact roster identities");
    }
}

// Opt-in integration executable. Reads the real game files, but writes only to
// its own freshly allocated temporary archive; never to the user's Vector-data.
internal static class GameFileIntegrationProbe
{
    private static int Main()
    {
        string directory = Path.Combine(Path.GetTempPath(), "vector-file-probe-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var store = new BattleFileStore(Path.Combine(directory, "battles"));
            var serializer = new JavaScriptSerializer { MaxJsonLength = 33554432 };
            var teams = new CombatTeamFeed();
            using (var collector = new GameFileCollector(store, directory, teams))
            {
                DateTime limit = DateTime.UtcNow.AddSeconds(50);
                while (DateTime.UtcNow < limit)
                {
                    var state = serializer.Deserialize<Dictionary<string, object>>(store.Snapshot());
                    if ((string)state["status"] == "ready")
                    {
                        var records = Directory.GetFiles(Path.Combine(directory, "battles"), "*.json").Select(p => serializer.Deserialize<FileBattle>(File.ReadAllText(p))).ToArray();
                        Console.WriteLine("Imported " + records.Length + " unique account/match records into an isolated archive.");
                        if (records.Any(b => !BattleFileStore.Valid(b))) throw new Exception("Invalid imported battle");
                        var annotations = serializer.Deserialize<Dictionary<string, object>>(teams.Snapshot());
                        var teamEvents = ((System.Collections.IEnumerable)annotations["events"]).Cast<Dictionary<string, object>>().ToArray();
                        int colored = teamEvents.Count(e => (string)e["actorTeam"] != "unknown" && (string)e["targetTeam"] != "unknown");
                        Console.WriteLine("Read " + teamEvents.Length + " bounded HUD annotations from the latest logged battle; " + colored + " have both sides confirmed.");
                        if (records.GroupBy(b => b.Key).Any(g => g.Count() != 1)) throw new Exception("Duplicate battle");
                        var restart = new BattleFileStore(Path.Combine(directory, "battles"));
                        if (restart.Snapshot().Contains("\"unreadable\":0") == false) throw new Exception("Archive reload failed");
                        Console.WriteLine("PASS actual game-file import, record validity, account/match deduplication and archive reload.");
                        return 0;
                    }
                    if ((string)state["status"] == "game-not-found" || (string)state["status"] == "read-error") throw new Exception("Collector status: " + state["status"]);
                    System.Threading.Thread.Sleep(250);
                }
                throw new TimeoutException("Collector did not finish within 50 seconds");
            }
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
        finally
        {
            if (Path.GetDirectoryName(directory) == Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) &&
                Path.GetFileName(directory).StartsWith("vector-file-probe-")) Directory.Delete(directory, true);
        }
    }
}
