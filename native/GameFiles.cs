using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace VectorPortable
{
    // Only allowlisted battle fields leave the readers. Never store decoded log text.
    public sealed class FileBattle
    {
        public int schemaVersion = 1;
        public string id, accountId, player, playedAt, mission, outcome = "unknown";
        public bool hasLog, hasReplay, conflict, rewardsFinal;
        public long? wp, exp;
        public int? kills, groundKills, navalKills, aiKills, aiGroundKills, aiNavalKills, assists, deaths, score;
        public double? seconds;
        // Stable source-event keys merge reconnects and rescans without estimating lives.
        public string[] spawnEvents = new string[0];
        public int? spawns { get { return spawnEvents.Length == 0 ? (int?)null : spawnEvents.Length; } }
        public string[] vehicles = new string[0];
        public string Key { get { return accountId + "-" + id; } }
    }

    public sealed class BattleFileStore
    {
        private readonly string directory;
        private readonly object gate = new object();
        private readonly Dictionary<string, FileBattle> records = new Dictionary<string, FileBattle>();
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 33554432 };
        private readonly string startedAt = DateTimeOffset.UtcNow.ToString("o");
        private string status = "searching", scannedAt;
        private int unreadable;
        private bool paused;

        public static bool Valid(FileBattle b)
        {
            DateTimeOffset time;
            if (b == null || b.schemaVersion != 1 || !Regex.IsMatch(b.id ?? "", @"\A[0-9a-f]{8,32}\z") ||
                !Regex.IsMatch(b.accountId ?? "", @"\A[1-9][0-9]{0,19}\z") || !DateTimeOffset.TryParse(b.playedAt, out time) ||
                time.Year < 2012 || time.Year > 2100 || !(new[] { "unknown", "win", "loss" }).Contains(b.outcome) ||
                (b.conflict && b.outcome != "unknown") || (!b.hasLog && !b.hasReplay) ||
                (b.rewardsFinal && (!b.hasLog || (b.outcome == "unknown" && !b.conflict)))) return false;
            if ((b.player ?? "").Length > 128 || (b.mission ?? "").Length > 260 || b.vehicles == null || b.vehicles.Length > 32 || b.vehicles.Any(x => x == null || x.Length > 128)) return false;
            if (b.spawnEvents == null || b.spawnEvents.Length > 512 || b.spawnEvents.Distinct().Count() != b.spawnEvents.Length ||
                b.spawnEvents.Any(x => !Regex.IsMatch(x ?? "", @"\A[0-9]{13}-[0-9]{1,10}\z"))) return false;
            if (new[] { b.kills, b.groundKills, b.navalKills, b.aiKills, b.aiGroundKills, b.aiNavalKills, b.assists, b.deaths, b.score }.Any(x => x.HasValue && (x < 0 || x > 10000000))) return false;
            if (new[] { b.wp, b.exp }.Any(x => x.HasValue && (x < -1000000000L || x > 1000000000L))) return false;
            return !b.seconds.HasValue || (!double.IsNaN(b.seconds.Value) && b.seconds >= 0 && b.seconds <= 86400);
        }

        public BattleFileStore(string directory)
        {
            this.directory = Path.GetFullPath(directory);
            Directory.CreateDirectory(this.directory);
            foreach (string file in Directory.EnumerateFiles(this.directory, "*.json").OrderByDescending(File.GetLastWriteTimeUtc).Take(5000))
            {
                if (!Regex.IsMatch(Path.GetFileName(file), @"\A[1-9][0-9]{0,19}-[a-f0-9]{8,32}\.json\z")) continue;
                try
                {
                    if (new FileInfo(file).Length > 32768 || (File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException();
                    FileBattle b = json.Deserialize<FileBattle>(File.ReadAllText(file));
                    if (!Valid(b) || b.Key != Path.GetFileNameWithoutExtension(file)) throw new InvalidDataException();
                    records[b.Key] = b;
                }
                catch { unreadable++; }
            }
        }

        public void Upsert(FileBattle incoming)
        {
            if (!Valid(incoming)) throw new InvalidDataException("Invalid battle fields");
            lock (gate)
            {
                FileBattle b = json.Deserialize<FileBattle>(json.Serialize(incoming)), old;
                if (records.TryGetValue(b.Key, out old))
                {
                    bool incompatible = old.outcome != "unknown" && b.outcome != "unknown" && old.outcome != b.outcome;
                    b.conflict |= old.conflict || incompatible;
                    if (b.outcome == "unknown" && !b.conflict) b.outcome = old.outcome;
                    if (b.conflict) b.outcome = "unknown";
                    if (!b.hasReplay && old.hasReplay)
                    {
                        b.playedAt = old.playedAt; b.player = old.player; b.mission = old.mission; b.seconds = old.seconds;
                        b.kills = old.kills; b.groundKills = old.groundKills; b.navalKills = old.navalKills;
                        b.aiKills = old.aiKills; b.aiGroundKills = old.aiGroundKills; b.aiNavalKills = old.aiNavalKills;
                        b.assists = old.assists; b.deaths = old.deaths; b.score = old.score;
                    }
                    // A replay never erases a log's economic snapshot. A provisional
                    // rescan never replaces the reward snapshot of a confirmed result.
                    if (!incoming.hasLog || (old.rewardsFinal && !incoming.rewardsFinal)) { b.wp = old.wp; b.exp = old.exp; }
                    else { b.wp = b.wp ?? old.wp; b.exp = b.exp ?? old.exp; }
                    b.rewardsFinal |= old.rewardsFinal;
                    b.spawnEvents = old.spawnEvents.Concat(b.spawnEvents).Distinct().OrderBy(x => x).Take(512).ToArray();
                    b.vehicles = old.vehicles.Concat(b.vehicles).Distinct().Take(32).ToArray();
                    b.hasLog |= old.hasLog; b.hasReplay |= old.hasReplay;
                    if (json.Serialize(old) == json.Serialize(b)) return;
                }
                string destination = Path.Combine(directory, b.Key + ".json");
                if (old == null && File.Exists(destination)) throw new IOException("Unreadable battle already exists");
                string temporary = destination + "." + Guid.NewGuid().ToString("N") + ".tmp";
                try
                {
                    byte[] bytes = Encoding.UTF8.GetBytes(json.Serialize(b));
                    using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    { output.Write(bytes, 0, bytes.Length); output.Flush(true); }
                    if (old == null) File.Move(temporary, destination); else File.Replace(temporary, destination, destination + ".previous");
                    records[b.Key] = b;
                }
                finally { if (File.Exists(temporary)) File.Delete(temporary); }
            }
        }

        public void SetStatus(string value) { lock (gate) { status = value; scannedAt = DateTimeOffset.UtcNow.ToString("o"); } }
        public void SetPaused(bool value) { lock (gate) paused = value; }
        public string Snapshot()
        {
            lock (gate) return json.Serialize(new { schemaVersion = 1, startedAt, status, scannedAt, paused, unreadable,
                battles = records.Values.OrderByDescending(b => b.playedAt).Take(5000).ToArray() });
        }
    }

    public sealed class BattleLogReader
    {
        // Published diagnostic-log format; not an account key or authentication secret.
        public static readonly byte[] XorKey = { 130,135,151,64,141,139,70,11,187,115,148,3,229,179,131,83,105,107,131,218,149,175,74,35,135,229,151,172,36,88,175,54,78,225,90,249,241,1,75,177,173,182,76,76,250,116,40,105,194,139,17,23,213,182,71,206,179,183,205,85,254,249,193,36,255,174,144,46,73,108,78,9,146,129,78,103,188,107,156,222,177,15,104,186,139,128,68,5,135,94,243,78,254,9,151,50,192,173,159,233,187,253,77,6,145,80,137,110,224,232,238,153,83,0,60,166,184,34,65,50,177,189,245,40,80,224,114,174 };
        private readonly Action<FileBattle> save;
        private readonly DateTimeOffset start;
        private readonly Decoder decoder = Encoding.UTF8.GetDecoder();
        private readonly StringBuilder pending = new StringBuilder();
        private bool oversized;
        private string account;
        private FileBattle current, ended;
        private double endedTime = -10;
        private int ownUnit = -1;
        private readonly CombatTeamFeed teamFeed;
        private BattleTeamReader teamReader;
        public long Offset { get; private set; }
        public BattleLogReader(DateTimeOffset start, Action<FileBattle> save, CombatTeamFeed teamFeed = null) { this.start = start; this.save = save; this.teamFeed = teamFeed; }

        public void Feed(byte[] encoded, int count)
        {
            byte[] decoded = new byte[count];
            for (int i = 0; i < count; i++) decoded[i] = (byte)(encoded[i] ^ XorKey[(Offset + i) % XorKey.Length]);
            char[] chars = new char[Encoding.UTF8.GetMaxCharCount(count)];
            int length = decoder.GetChars(decoded, 0, count, chars, 0, false);
            Offset += count;
            for (int i = 0; i < length; i++)
            {
                if (chars[i] == '\n') { if (!oversized) Line(pending.ToString().TrimEnd('\r')); pending.Clear(); oversized = false; }
                else if (!oversized) { if (pending.Length < 8192) pending.Append(chars[i]); else { pending.Clear(); oversized = true; } }
            }
        }

        public void Line(string line)
        {
            if (line.IndexOf("online_storage::load_locally:", StringComparison.Ordinal) < 0 &&
                line.IndexOf("AcesApp::onJoinMatch", StringComparison.Ordinal) < 0 &&
                line.IndexOf("received SessionStats", StringComparison.Ordinal) < 0 &&
                line.IndexOf("AcesMission::endFinally", StringComparison.Ordinal) < 0 &&
                line.IndexOf("AcesMission::setStatus", StringComparison.Ordinal) < 0 &&
                line.IndexOf("MPlayer::onStateChanged()", StringComparison.Ordinal) < 0 &&
                line.IndexOf("UnitRespawn received for uid:", StringComparison.Ordinal) < 0 &&
                line.IndexOf("HUD  hud_mp_ui_message - text =", StringComparison.Ordinal) < 0) return;
            Match stamp = Regex.Match(line, @"\A\s*([0-9]+\.[0-9]+)\s");
            double seconds;
            if (!stamp.Success || !double.TryParse(stamp.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out seconds) || seconds > 1209600) return;
            Match identity = Regex.Match(line, @"STOR online_storage::load_locally: userid=([1-9][0-9]{0,19}), store=");
            if (identity.Success) { account = identity.Groups[1].Value; current = ended = null; teamReader = null; ownUnit = -1; return; }
            Match join = Regex.Match(line, @"AcesMpContext: AcesApp::onJoinMatch : sessionId:([0-9a-f]{8,32})\s*$");
            if (join.Success)
            {
                ended = null;
                current = account == null ? null : new FileBattle { accountId = account, id = join.Groups[1].Value,
                    playedAt = start.AddSeconds(seconds).ToUniversalTime().ToString("o"), hasLog = true };
                ownUnit = -1;
                teamReader = current == null || teamFeed == null ? null : new BattleTeamReader(current.id, start.AddSeconds(seconds), teamFeed);
                return;
            }
            FileBattle target = current ?? (seconds - endedTime >= 0 && seconds - endedTime < 3 ? ended : null);
            if (target == null) return;
            if (current != null)
            {
                if (teamReader != null) teamReader.Line(line, start.AddSeconds(seconds));
                Match own = Regex.Match(line, @"\[D\]\s+MPlayer::onStateChanged\(\) MULP pid:[0-9]+ n:'.{1,128}' [A-Z_]+->[A-Z_]+ t=[12] c=[0-9]+ f=[0-9a-f]+\(l=1\) mid=[0-9]+ uid=([0-9]+) eid:[0-9a-f]+ uid:(-?[0-9]+)/");
                int assignedUnit;
                if (own.Success && own.Groups[1].Value == account && int.TryParse(own.Groups[2].Value, out assignedUnit)) ownUnit = assignedUnit;
                Match spawn = Regex.Match(line, @"\[D\]\s+UnitRespawn received for uid:([0-9]{1,10}) \('([a-z0-9_-]{1,128})'\) ptr:[0-9A-Fa-f]+ \(spawnBase:-?[0-9]+");
                if (spawn.Success && spawn.Groups[1].Value == ownUnit.ToString(CultureInfo.InvariantCulture))
                {
                    string key = ((long)(start.AddSeconds(seconds).ToUniversalTime() - new DateTimeOffset(1970,1,1,0,0,0,TimeSpan.Zero)).TotalMilliseconds).ToString(CultureInfo.InvariantCulture) + "-" + spawn.Groups[1].Value;
                    current.spawnEvents = current.spawnEvents.Concat(new[] { key }).Distinct().Take(512).ToArray();
                    current.vehicles = current.vehicles.Concat(new[] { spawn.Groups[2].Value }).Distinct().Take(32).ToArray();
                }
            }
            Match sum = Regex.Match(line, @"\[D\]\s+received SessionStats sum (WP|EXP):.*\btotal\[(-?[0-9]{1,10})\]\s*$");
            if (sum.Success)
            {
                long amount = long.Parse(sum.Groups[2].Value, CultureInfo.InvariantCulture);
                if (Math.Abs(amount) <= 1000000000L) { if (sum.Groups[1].Value == "WP") target.wp = amount; else target.exp = amount; }
                return;
            }
            Match vehicle = Regex.Match(line, @"\[D\]\s+received SessionStats ([a-z0-9_-]{1,128}) (?:WP|EXP):");
            if (vehicle.Success && vehicle.Groups[1].Value != "sum") { target.vehicles = target.vehicles.Concat(new[] { vehicle.Groups[1].Value }).Distinct().Take(32).ToArray(); return; }
            if (Regex.IsMatch(line, @"\[D\]\s+AcesMission::endFinally [0-9]+ "))
            { ended = target; endedTime = seconds; current = null; save(target); return; }
            Match outcome = Regex.Match(line, @"\[D\]\s+AcesMission::setStatus MISSION_STATUS_RUNNING -> MISSION_STATUS_(SUCCESS|FAIL)\s*$");
            if (outcome.Success && target == ended) { target.outcome = outcome.Groups[1].Value == "SUCCESS" ? "win" : "loss"; target.rewardsFinal = true; save(target); }
        }
    }

    // Ephemeral, allowlisted HUD annotations. No roster or decoded logs go to disk.
    public sealed class CombatTeamFeed
    {
        private readonly object gate = new object();
        private DateTimeOffset latest = DateTimeOffset.MinValue;
        private string snapshot = "{\"schemaVersion\":1,\"sessionId\":null,\"events\":[]}";
        public void Publish(string session, DateTimeOffset started, object[] events)
        {
            lock (gate)
            {
                if (started < latest) return;
                latest = started;
                snapshot = new JavaScriptSerializer().Serialize(new { schemaVersion = 1, sessionId = session, events });
            }
        }
        public string Snapshot() { lock (gate) return snapshot; }
    }

    public sealed class BattleTeamReader
    {
        private sealed class HudEvent { public string message, actor, target, actorCode, targetCode; public DateTimeOffset time; }
        private readonly Dictionary<string, int> roster = new Dictionary<string, int>();
        private readonly Dictionary<string, int> palette = new Dictionary<string, int>();
        private readonly List<HudEvent> events = new List<HudEvent>();
        private readonly string session;
        private readonly DateTimeOffset started;
        private readonly CombatTeamFeed feed;
        private int ownTeam;
        private string ownName;
        public BattleTeamReader(string session, DateTimeOffset started, CombatTeamFeed feed) { this.session = session; this.started = started; this.feed = feed; }
        private static string Name(string participant)
        {
            if (string.IsNullOrEmpty(participant) || !participant.EndsWith(")", StringComparison.Ordinal)) return "";
            int depth = 0;
            for (int i = participant.Length - 1; i >= 0; i--)
            {
                if (participant[i] == ')') depth++;
                if (participant[i] != '(' || --depth != 0) continue;
                if (i < 2 || participant[i - 1] != ' ') return "";
                return Regex.Replace(participant.Substring(0, i - 1), @"\A=[^=]{1,64}= ", "");
            }
            return "";
        }
        private int Team(string text) { int team; return roster.TryGetValue(Name(text), out team) ? team : 0; }
        private void Learn(string text, string code)
        {
            int team = Team(text), old;
            if (team == 0 || code == null) return;
            if (palette.TryGetValue(code, out old) && old != team) palette[code] = 0;
            else if (!palette.ContainsKey(code)) palette[code] = team;
        }
        private string Side(string text, string code)
        {
            if (ownTeam == 0) return "unknown";
            int team = Team(text);
            if (Name(text) == ownName) return "self";
            if (team == 0 && code != null) palette.TryGetValue(code, out team);
            return team == 0 ? "unknown" : team == ownTeam ? "ally" : "enemy";
        }
        public void Line(string line, DateTimeOffset time)
        {
            Match player = Regex.Match(line, @"\[D\]\s+MPlayer::onStateChanged\(\) MULP pid:[0-9]+ n:'(.{1,128})' [A-Z_]+->[A-Z_]+ t=([12]) c=[0-9]+ f=[0-9a-f]+\(l=([01])\)");
            if (player.Success)
            {
                string name = player.Groups[1].Value; int team = int.Parse(player.Groups[2].Value);
                if (roster.Count < 256 || roster.ContainsKey(name)) roster[name] = team;
                if (player.Groups[3].Value == "1") { ownName = name; ownTeam = team; }
            }
            else
            {
                Match hud = Regex.Match(line, "HUD  hud_mp_ui_message - text = '[^\\x1b]{0,16}(\\x1b.*)'$");
                if (!hud.Success || hud.Groups[1].Length > 4096) return;
                string raw = hud.Groups[1].Value;
                string plain = Regex.Replace(Regex.Replace(raw, "\\x1b[0-9]{3}", ""), "\\x1b", "");
                Match combat = Regex.Match(plain, @"\A(.+ \(.+\)) (?:уничтожил|сбил|нанёс критическое повреждение|нанёс фатальное повреждение|destroyed|shot down|critically damaged|severely damaged) (.+)\z");
                Match crash = Regex.Match(plain, @"\A(.+ \(.+\)) (?:разбился|crashed)\z");
                if (!combat.Success && !crash.Success) return;
                string actor = (combat.Success ? combat : crash).Groups[1].Value, target = combat.Success ? combat.Groups[2].Value : null;
                var spans = Regex.Matches(raw, "\\x1b([0-9]{3})([^\\x1b]+)\\x1b").Cast<Match>().ToArray();
                string actorCode = spans.Where(m => m.Groups[2].Value == actor).Select(m => m.Groups[1].Value).FirstOrDefault();
                string targetCode = spans.Where(m => m.Groups[2].Value == target).Select(m => m.Groups[1].Value).FirstOrDefault();
                events.Add(new HudEvent { message = plain, actor = actor, target = target, actorCode = actorCode, targetCode = targetCode, time = time });
                if (events.Count > 128) events.RemoveAt(0);
            }
            // Learn palette semantics from actual roster team IDs, not fixed color
            // numbers, user color preferences, or an assumption about friendly fire.
            foreach (HudEvent e in events) { Learn(e.actor, e.actorCode); Learn(e.target, e.targetCode); }
            feed.Publish(session, started, events.Select(e => (object)new { e.message, observedAt = e.time.ToUniversalTime().ToString("o"),
                actorTeam = Side(e.actor, e.actorCode), targetTeam = Side(e.target, e.targetCode), targetInRoster = Team(e.target) != 0 }).ToArray());
        }
    }

    // Minimal standalone-BLK metadata reader, not a replay playback/telemetry decoder.
    public sealed class ReplayMetadata
    {
        private sealed class Block
        {
            public string name;
            public readonly Dictionary<string, object> fields = new Dictionary<string, object>();
        }
        private static int Uleb(BinaryReader r)
        {
            long value = 0;
            for (int i = 0; i < 5; i++) { byte b = r.ReadByte(); value |= (long)(b & 127) << (7 * i); if (b < 128) { if (value > int.MaxValue) break; return (int)value; } }
            throw new InvalidDataException("Invalid integer");
        }
        private static byte[] Bytes(BinaryReader r, int count, int max)
        { if (count < 0 || count > max) throw new InvalidDataException(); byte[] b = r.ReadBytes(count); if (b.Length != count) throw new EndOfStreamException(); return b; }
        private static string Text(byte[] b, int offset, int max)
        { if (offset < 0 || offset >= b.Length) throw new InvalidDataException(); int end = Array.IndexOf(b, (byte)0, offset); if (end < offset || end - offset > max) throw new InvalidDataException(); return Encoding.UTF8.GetString(b, offset, end - offset); }
        private static string StringValue(Block b, string name) { object v; return b.fields.TryGetValue(name, out v) ? v as string : null; }
        private static int? Count(Block b, string name) { object v; return b.fields.TryGetValue(name, out v) && v is int ? (int?)v : null; }

        public static FileBattle Read(Stream stream)
        {
            var reader = new BinaryReader(stream);
            byte[] header = Bytes(reader, 920, 920);
            if (BitConverter.ToUInt32(header, 0) != 0x1000ace5 || BitConverter.ToUInt32(header, 4) != 101387) throw new InvalidDataException("Unsupported replay version");
            long offset = BitConverter.ToUInt32(header, 684);
            if (offset < 920 || offset >= stream.Length || stream.Length - offset > 8388608) throw new InvalidDataException();
            stream.Position = offset;
            byte[] tail = Bytes(reader, (int)(stream.Length - offset), 8388608);
            var blocks = new List<Block>();
            using (var input = new BinaryReader(new MemoryStream(tail)))
            {
                if (input.ReadByte() != 1) throw new InvalidDataException("Unsupported result format");
                int nameCount = Uleb(input), nameSize = Uleb(input);
                if (nameCount > 4096) throw new InvalidDataException();
                string[] names = Encoding.UTF8.GetString(Bytes(input, nameSize, 1048576)).Split('\0');
                if (names.Length != nameCount + 1 || names[nameCount] != "") throw new InvalidDataException();
                int blockCount = Uleb(input), paramCount = Uleb(input), dataSize = Uleb(input);
                if (blockCount < 1 || blockCount > 8192 || paramCount > 65536) throw new InvalidDataException();
                byte[] data = Bytes(input, dataSize, 4194304), parameters = Bytes(input, paramCount * 8, 524288);
                int used = 0;
                for (int i = 0; i < blockCount; i++)
                {
                    int nameId = Uleb(input), count = Uleb(input), childCount = Uleb(input), firstChild = childCount > 0 ? Uleb(input) : 0;
                    if (nameId > nameCount || count > paramCount - used || childCount > blockCount || firstChild > blockCount - childCount) throw new InvalidDataException();
                    var block = new Block { name = nameId == 0 ? "root" : names[nameId - 1] };
                    for (int j = 0; j < count; j++)
                    {
                        int p = (used++) * 8;
                        int fieldId = parameters[p] | parameters[p + 1] << 8 | parameters[p + 2] << 16;
                        if (fieldId >= nameCount) throw new InvalidDataException();
                        string name = names[fieldId]; byte type = parameters[p + 3]; uint raw = BitConverter.ToUInt32(parameters, p + 4); object value = null;
                        // Do not decode arbitrary strings/player metadata. Only these fields are needed.
                        if ((block.name == "root" && new[] { "status", "author", "authorUserId", "timePlayed" }.Contains(name)) ||
                            (block.name == "player" && new[] { "userId", "kills", "groundKills", "navalKills", "aiKills", "aiGroundKills", "aiNavalKills", "assists", "deaths", "score" }.Contains(name)))
                        {
                            if (type == 1) { int n = (int)(raw & 0x7fffffff); if ((raw >> 31) != 0) { if (n >= nameCount) throw new InvalidDataException(); value = names[n]; } else value = Text(data, n, 128); }
                            else if (type == 2) value = BitConverter.ToInt32(parameters, p + 4);
                            else if (type == 3) value = (double)BitConverter.ToSingle(parameters, p + 4);
                            else if (type == 12) { if (raw > data.Length - 8) throw new InvalidDataException(); value = BitConverter.ToInt64(data, (int)raw).ToString(CultureInfo.InvariantCulture); }
                            if (block.fields.ContainsKey(name)) throw new InvalidDataException();
                            block.fields[name] = value;
                        }
                    }
                    blocks.Add(block);
                }
                if (used != paramCount || input.BaseStream.Position != tail.Length || blocks[0].name != "root") throw new InvalidDataException();
            }
            Block root = blocks[0]; string account = StringValue(root, "authorUserId");
            Block own = blocks.SingleOrDefault(b => b.name == "player" && StringValue(b, "userId") == account);
            if (own == null) throw new InvalidDataException("No author scoreboard");
            string status = StringValue(root, "status"); object duration;
            string level = Text(header, 8, 127).Replace("levels/", "").Replace(".bin", "");
            var result = new FileBattle {
                id = BitConverter.ToUInt64(header, 732).ToString("x"), accountId = account, player = StringValue(root, "author"),
                playedAt = new DateTimeOffset(1970,1,1,0,0,0,TimeSpan.Zero).AddSeconds(BitConverter.ToUInt32(header, 908)).ToString("o"),
                mission = level, hasReplay = true, outcome = status == "success" ? "win" : status == "fail" ? "loss" : "unknown",
                seconds = root.fields.TryGetValue("timePlayed", out duration) && duration is double ? (double?)duration : null,
                kills = Count(own, "kills"), groundKills = Count(own, "groundKills"), navalKills = Count(own, "navalKills"),
                aiKills = Count(own, "aiKills"), aiGroundKills = Count(own, "aiGroundKills"), aiNavalKills = Count(own, "aiNavalKills"),
                assists = Count(own, "assists"), deaths = Count(own, "deaths"), score = Count(own, "score") };
            if (!BattleFileStore.Valid(result)) throw new InvalidDataException("Invalid replay metadata");
            return result;
        }
    }

    public sealed class GameFileCollector : IDisposable
    {
        private readonly BattleFileStore store;
        private readonly string settings;
        private readonly Dictionary<string, BattleLogReader> logs = new Dictionary<string, BattleLogReader>();
        private readonly Dictionary<string, string> replays = new Dictionary<string, string>();
        private readonly object gate = new object();
        private readonly Timer timer;
        private readonly CombatTeamFeed teams;
        private string root;
        private int busy;
        private volatile bool paused, stopped;

        public static bool IsGameFolder(string path)
        { return !string.IsNullOrWhiteSpace(path) && Directory.Exists(Path.Combine(path, ".game_logs")) && Directory.Exists(Path.Combine(path, "Replays")) && (File.Exists(Path.Combine(path, "win64", "aces.exe")) || File.Exists(Path.Combine(path, "win32", "aces.exe"))); }
        public static string Discover()
        {
            foreach (RegistryView view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
            {
                try
                {
                    using (RegistryKey machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view))
                    using (RegistryKey key = machine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Steam App 236390"))
                    { string path = key == null ? null : key.GetValue("InstallLocation") as string; if (IsGameFolder(path)) return Path.GetFullPath(path); }
                }
                catch { }
            }
            // Steam libraries can live on a different drive. Read only its library index.
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam"))
                {
                    string steam = key == null ? null : key.GetValue("SteamPath") as string;
                    if (steam != null)
                    {
                        var libraries = new List<string> { steam };
                        string index = Path.Combine(steam, "steamapps", "libraryfolders.vdf");
                        if (File.Exists(index) && new FileInfo(index).Length < 1048576)
                            foreach (Match m in Regex.Matches(File.ReadAllText(index), "\"path\"\\s+\"([^\"]+)\"")) libraries.Add(m.Groups[1].Value.Replace("\\\\", "\\"));
                        foreach (string library in libraries) { string path = Path.Combine(library, "steamapps", "common", "War Thunder"); if (IsGameFolder(path)) return Path.GetFullPath(path); }
                    }
                }
            }
            catch { }
            return null;
        }

        public GameFileCollector(BattleFileStore store, string dataDirectory, CombatTeamFeed teams = null)
        {
            this.teams = teams;
            this.store = store; settings = Path.Combine(dataDirectory, "game-folder.txt");
            try { if (File.Exists(settings) && new FileInfo(settings).Length < 4096) { string chosen = File.ReadAllText(settings).Trim(); if (IsGameFolder(chosen)) root = chosen; } } catch { }
            if (root == null) root = Discover();
            timer = new Timer(_ => Scan(), null, 0, 5000);
        }
        public void Choose(string path)
        {
            if (!IsGameFolder(path)) throw new InvalidDataException("Choose the War Thunder installation folder containing .game_logs and Replays.");
            lock (gate) { File.WriteAllText(settings, Path.GetFullPath(path)); root = Path.GetFullPath(path); logs.Clear(); replays.Clear(); }
        }
        public void Pause(bool value) { paused = value; store.SetPaused(value); }
        private static bool Regular(string path) { return (File.GetAttributes(path) & FileAttributes.ReparsePoint) == 0; }
        private void Scan()
        {
            if (stopped || paused || Interlocked.Exchange(ref busy, 1) != 0) return;
            try
            {
                lock (gate)
                {
                    if (root == null) root = Discover();
                    if (!IsGameFolder(root)) { store.SetStatus("game-not-found"); return; }
                    bool errors = false, behind = false;
                    foreach (string file in Directory.EnumerateFiles(Path.Combine(root, "Replays"), "*.wrpl").OrderByDescending(File.GetLastWriteTimeUtc).Take(200))
                    {
                        if (paused || stopped) return;
                        try
                        {
                            if (!Regular(file)) continue;
                            var info = new FileInfo(file); string signature = info.Length + ":" + info.LastWriteTimeUtc.Ticks, previous;
                            if (replays.TryGetValue(file, out previous) && previous == signature) continue;
                            // A quiet period avoids parsing the trailer halfway through a game write.
                            if ((DateTime.UtcNow - info.LastWriteTimeUtc).TotalSeconds < 2) { behind = true; continue; }
                            using (var input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) store.Upsert(ReplayMetadata.Read(input));
                            replays[file] = signature;
                        }
                        catch { errors = true; }
                    }
                    // Backfill recent logs, then tail them incrementally. Read no crash dumps or settings bodies.
                    foreach (string file in Directory.EnumerateFiles(Path.Combine(root, ".game_logs"), "*.clog").OrderByDescending(File.GetLastWriteTimeUtc).Take(32))
                    {
                        if (paused || stopped) return;
                        try
                        {
                            var info = new FileInfo(file);
                            if (!Regular(file) || info.LastWriteTimeUtc < DateTime.UtcNow.AddDays(-7)) continue;
                            Match name = Regex.Match(info.Name, @"\A(\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2})__\d+\.clog\z");
                            DateTime time;
                            if (!name.Success || !DateTime.TryParseExact(name.Groups[1].Value, "yyyy_MM_dd_HH_mm_ss", CultureInfo.InvariantCulture, DateTimeStyles.None, out time)) continue;
                            BattleLogReader log;
                            if (!logs.TryGetValue(file, out log) || info.Length < log.Offset) logs[file] = log = new BattleLogReader(new DateTimeOffset(time), store.Upsert, teams);
                            using (var input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                            {
                                input.Position = log.Offset; byte[] buffer = new byte[65536]; int n, budget = 16777216;
                                try { while (budget > 0 && (n = input.Read(buffer, 0, Math.Min(buffer.Length, budget))) > 0) { log.Feed(buffer, n); budget -= n; } }
                                catch { logs.Remove(file); throw; } // Retry a failed save from the source, never skip it.
                                behind |= input.Position < input.Length;
                            }
                        }
                        catch { errors = true; }
                    }
                    store.SetStatus(errors ? "read-error" : behind ? "indexing" : "ready");
                }
            }
            catch { store.SetStatus("read-error"); }
            finally { Interlocked.Exchange(ref busy, 0); }
        }
        public void Dispose() { stopped = true; timer.Dispose(); lock (gate) { } }
    }
}
