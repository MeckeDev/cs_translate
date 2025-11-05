#!/usr/bin/env node
/**
 * CS2 Chat Auto Translator (CLI)
 * ==============================
 *
 * Cross-platform: Linux + Windows
 * --------------------------------
 * This tool is designed to run on both Linux and Windows using Node.js.
 *
 * What this tool does
 * -------------------
 * - Watches your CS2 `console.log` file in real time.
 * - Detects chat lines such as:
 *       "[CT] PlayerName: message"
 *       "[T]  PlayerName: message"
 *       "[ALL] PlayerName: message"
 * - Automatically translates every chat message to a target language
 *   (default: English) and prints it in the terminal.
 *
 * Example terminal output:
 *   🌍 [T] Player123 (Russian → EN): Hello, how are you?
 *
 * What this tool does NOT do
 * --------------------------
 * - It does NOT write anything back into the game.
 * - It does NOT send messages to chat, no cfg files, no key presses.
 * - It is a pure, read-only console translator.
 *
 * Requirements
 * ------------
 * - OS: Linux or Windows
 * - Runtime:
 *     - Node.js 18+ (ESM + modern fs APIs)
 *     - google-translate-api-x
 *     - chalk
 *
 * IMPORTANT: Enable console logging in CS2
 * ----------------------------------------
 * CS2 must be started with the Steam launch option:
 *
 *   -condebug
 *
 * so that the game writes console output to `console.log`.
 *
 * Steam steps:
 *   1) Open Steam.
 *   2) Right-click Counter-Strike 2 → "Properties".
 *   3) Under "Launch Options", add:
 *        -condebug
 *   4) Start CS2 once so that `console.log` is created.
 *
 * Configuration
 * -------------
 * The tool stores its configuration in a simple JSON file.
 *
 * On Linux:
 *   - $XDG_CONFIG_HOME/cs2-chat-translator/config.json
 *     or
 *   - ~/.config/cs2-chat-translator/config.json
 *
 * On Windows:
 *   - %APPDATA%\cs2-chat-translator\config.json
 *     For example:
 *       C:\Users\YourName\AppData\Roaming\cs2-chat-translator\config.json
 *
 * Example config.json:
 *   {
 *     "logPath": "/path/or/drive/to/console.log"
 *   }
 *
 * CLI interface
 * -------------
 *   cs2-chat-translator                 # Start watching console.log and auto-translating
 *   cs2-chat-translator --init-config   # Initialize or refresh config.json with a default logPath guess
 *   cs2-chat-translator --set-log-path /path/to/console.log
 *   cs2-chat-translator --help          # Show usage information
 */

import fs from "fs";
import readline from "readline";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import chalk from "chalk";
import translate from "google-translate-api-x";

// -----------------------------------------------------------------------------
// ESM-compatible __filename / __dirname
// -----------------------------------------------------------------------------

/**
 * In ES modules, __filename and __dirname are not available globally.
 * We reconstruct them from import.meta.url via fileURLToPath().
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -----------------------------------------------------------------------------
// Cross-platform config handling (Linux + Windows)
// -----------------------------------------------------------------------------

/**
 * Determine whether we are running on Windows.
 * Node uses 'win32' for all Windows variants.
 */
const IS_WINDOWS = process.platform === "win32";

/**
 * Returns the default configuration directory depending on the OS.
 *
 * Linux:
 *   - Prefer $XDG_CONFIG_HOME/cs2-chat-translator
 *   - Fallback: ~/.config/cs2-chat-translator
 *
 * Windows:
 *   - Prefer %APPDATA%\cs2-chat-translator
 *   - Fallback: C:\Users\<user>\AppData\Roaming\cs2-chat-translator
 */
function getDefaultConfigDir() {
  if (IS_WINDOWS) {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "cs2-chat-translator");
  } else {
    if (process.env.XDG_CONFIG_HOME) {
      return path.join(process.env.XDG_CONFIG_HOME, "cs2-chat-translator");
    }
    return path.join(os.homedir(), ".config", "cs2-chat-translator");
  }
}

/**
 * Returns a "best guess" path for CS2's console.log file depending on the OS.
 *
 * NOTE:
 *   - This is only a default. The user can (and should) override it
 *     via config or CLI if it does not match their actual installation.
 */
function getDefaultLogPath() {
  if (IS_WINDOWS) {
    // Typical Steam install on Windows for CS:GO / CS2
    // Adjust manually if your Steam or game library is elsewhere.
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    return path.join(
      programFilesX86,
      "Steam",
      "steamapps",
      "common",
      "Counter-Strike Global Offensive",
      "game",
      "csgo",
      "console.log"
    );
  } else {
    // Typical Proton/Steam path on Linux
    return path.join(
      os.homedir(),
      ".local",
      "share",
      "Steam",
      "steamapps",
      "common",
      "Counter-Strike Global Offensive",
      "game",
      "csgo",
      "console.log"
    );
  }
}

/**
 * Resolve configuration directory and file path.
 */
const CONFIG_DIR = getDefaultConfigDir();
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

/**
 * Default configuration object: only contains logPath.
 */
const defaultConfig = {
  logPath: getDefaultLogPath()
};

/**
 * Global config value: path to console.log.
 * It will be populated by setupFromConfig().
 */
let LOG_PATH = "";

/**
 * Load configuration from CONFIG_PATH.
 * - If the file does not exist, returns a copy of defaultConfig.
 * - If the file is invalid, logs an error and also falls back to defaultConfig.
 */
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return { ...defaultConfig };
    }
    const txt = fs.readFileSync(CONFIG_PATH, "utf8").trim();
    if (!txt) return { ...defaultConfig };
    const cfg = JSON.parse(txt);
    return {
      logPath: cfg.logPath || defaultConfig.logPath
    };
  } catch (err) {
    console.error(chalk.red(`Failed to load config: ${err.message}`));
    return { ...defaultConfig };
  }
}

/**
 * Save configuration to disk, merging with defaults first.
 * This ensures that required keys always exist even if older versions
 * of the config file did not contain them.
 */
function saveConfig(cfg) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const merged = {
      logPath: cfg.logPath || defaultConfig.logPath
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf8");
    return merged;
  } catch (err) {
    console.error(chalk.red(`Failed to write config: ${err.message}`));
    process.exit(1);
  }
}

/**
 * CLI helper: initialize or refresh the config file on disk.
 * - If config.json does not exist, it is created with default values.
 * - If it exists, missing fields are filled in.
 * This is safe to run multiple times.
 */
function initConfigCli() {
  const merged = saveConfig(loadConfig());
  console.log(chalk.green("Config initialized/updated:"));
  console.log(`  ${CONFIG_PATH}`);
  console.log("Effective values:");
  console.log(`  logPath: ${merged.logPath}`);
}

/**
 * CLI helper: update a single key in the config file.
 * Currently only "logPath" is used, but the function is generic.
 */
function updateConfigKey(key, value) {
  const cfg = loadConfig();
  cfg[key] = value;
  const merged = saveConfig(cfg);
  console.log(chalk.green(`Config updated (${key}):`));
  console.log(`  ${CONFIG_PATH}`);
  console.log(`  ${key}: ${merged[key]}`);
}

/**
 * Load config and populate the global LOG_PATH variable.
 * If logPath is empty, the tool aborts with a helpful message.
 */
function setupFromConfig() {
  const cfg = loadConfig();
  LOG_PATH = cfg.logPath;

  if (!LOG_PATH) {
    console.error(chalk.red("No logPath configured."));
    console.error(`Edit ${CONFIG_PATH} or use --set-log-path.`);
    process.exit(1);
  }
}

// -----------------------------------------------------------------------------
// Console styling utilities
// -----------------------------------------------------------------------------

/**
 * Symbols and colors used for terminal output.
 * These are only for the terminal, never sent to the game.
 */
const sym = {
  start: chalk.cyan("🚀"),
  info: chalk.cyan("ℹ️"),
  ok: chalk.green("✅"),
  warn: chalk.yellow("⚠️"),
  err: chalk.red("❌"),
  chat: chalk.magenta("💬"),
  trans: chalk.blueBright("🌍")
};

// -----------------------------------------------------------------------------
// Language mapping and auto-translate configuration
// -----------------------------------------------------------------------------

/**
 * Mapping from ISO codes to human-readable language names.
 * This is used to print "Russian" instead of "ru" in logs.
 */
const LANG_MAP = {
  af:"Afrikaans", sq:"Albanian", am:"Amharic", ar:"Arabic", hy:"Armenian",
  az:"Azerbaijani", eu:"Basque", be:"Belarusian", bn:"Bengali", bs:"Bosnian",
  bg:"Bulgarian", ca:"Catalan", ceb:"Cebuano", ny:"Chichewa", zh:"Chinese",
  zh_cn:"Chinese (Simplified)", zh_tw:"Chinese (Traditional)", co:"Corsican",
  hr:"Croatian", cs:"Czech", da:"Danish", nl:"Dutch", en:"English",
  eo:"Esperanto", et:"Estonian", tl:"Filipino", fi:"Finnish", fr:"French",
  fy:"Frisian", gl:"Galician", ka:"Georgian", de:"German", el:"Greek",
  gu:"Gujarati", ht:"Haitian Creole", ha:"Hausa", haw:"Hawaiian", he:"Hebrew",
  hi:"Hindi", hmn:"Hmong", hu:"Hungarian", is:"Icelandic", ig:"Igbo",
  id:"Indonesian", ga:"Irish", it:"Italian", ja:"Japanese", jw:"Javanese",
  kn:"Kannada", kk:"Kazakh", km:"Khmer", rw:"Kinyarwanda", ko:"Korean",
  ku:"Kurdish (Kurmanji)", ky:"Kyrgyz", lo:"Lao", la:"Latin", lv:"Latvian",
  lt:"Lithuanian", lb:"Luxembourgish", mk:"Macedonian", mg:"Malagasy",
  ms:"Malay", ml:"Malayalam", mt:"Maltese", mi:"Maori", mr:"Marathi",
  mn:"Mongolian", my:"Myanmar (Burmese)", ne:"Nepali", no:"Norwegian",
  or:"Odia (Oriya)", ps:"Pashto", fa:"Persian", pl:"Polish", pt:"Portuguese",
  pa:"Punjabi", ro:"Romanian", ru:"Russian", sm:"Samoan", gd:"Scots Gaelic",
  sr:"Serbian", st:"Sesotho", sn:"Shona", sd:"Sindhi", si:"Sinhala",
  sk:"Slovak", sl:"Slovenian", so:"Somali", es:"Spanish", su:"Sundanese",
  sw:"Swahili", sv:"Swedish", tg:"Tajik", ta:"Tamil", tt:"Tatar", te:"Telugu",
  th:"Thai", tr:"Turkish", tk:"Turkmen", uk:"Ukrainian", ur:"Urdu",
  ug:"Uyghur", uz:"Uzbek", vi:"Vietnamese", cy:"Welsh", xh:"Xhosa",
  yi:"Yiddish", yo:"Yoruba", zu:"Zulu"
};

/**
 * Global auto-translate switch.
 * If set to false, translation is disabled but chat lines are still printed.
 */
const AUTO_TRANSLATE = true;

/**
 * Target language for console translation. All messages will be translated
 * to this language, if possible.
 */
const AUTO_TRANSLATE_TARGET = "en";

/**
 * Cyrillic heuristic:
 * -------------------
 * If the message contains Cyrillic characters, and auto-detection does not
 * return "ru", we may try a second translation pass forcing "from: ru".
 *
 * This helps make Russian-heavy chats more readable.
 */
const PREFER_RU_FOR_CYRILLIC = true;
const CYRILLIC_REGEX = /[\u0400-\u04FF]/;

/**
 * Convert an ISO code to a human-readable name for logs.
 */
function langName(iso) {
  const key = (iso || "").toLowerCase();
  return LANG_MAP[key] || key.toUpperCase() || "UNKNOWN";
}

// -----------------------------------------------------------------------------
// Translation logic
// -----------------------------------------------------------------------------

/**
 * smartTranslate(text, toLang)
 * ----------------------------
 * Wraps google-translate-api-x and adds:
 * - Automatic source language detection.
 * - Optional Russian override for Cyrillic-heavy text.
 * - Safe error handling: on failure, the original text is returned
 *   in a minimal stub object so the caller can still print something.
 */
async function smartTranslate(text, toLang = "en") {
  try {
    // First, let Google detect the source language.
    let res = await translate(text, { to: toLang });
    const guess = (res.from?.language?.iso || "").toLowerCase();

    const shouldForceRu =
      PREFER_RU_FOR_CYRILLIC && CYRILLIC_REGEX.test(text) && guess !== "ru";

    if (shouldForceRu) {
      try {
        const forced = await translate(text, { from: "ru", to: toLang });
        forced.__forcedFrom = "ru";
        return forced;
      } catch {
        // If forcing Russian fails, just fall back to the original result.
      }
    }

    return res;
  } catch (err) {
    console.log(sym.warn, chalk.yellow(`Translation failed: ${err.message}`));
    return { text, from: { language: { iso: "unknown" } } };
  }
}

/**
 * Get a human-readable "from language" label from a translation result.
 * Respects the forced Russian override if applied.
 */
function originalLangReadable(res) {
  const iso = (res.__forcedFrom || res.from?.language?.iso || "unknown").toLowerCase();
  return langName(iso);
}

// -----------------------------------------------------------------------------
// Auto-translate to console (no in-game output)
// -----------------------------------------------------------------------------

/**
 * autoTranslateToConsole({ team, sender, message })
 * -------------------------------------------------
 * Translate a single chat message and print the translated result to the
 * terminal, if the source language differs from the target.
 */
async function autoTranslateToConsole({ team, sender, message }) {
  if (!AUTO_TRANSLATE) return;
  if (!message) return;

  const res = await smartTranslate(message, AUTO_TRANSLATE_TARGET);
  const fromIso = (res.__forcedFrom || res.from?.language?.iso || "unknown").toLowerCase();

  // If the source is already the target language, skip printing to reduce noise.
  if (fromIso === AUTO_TRANSLATE_TARGET.toLowerCase()) {
    return;
  }

  const readableLang = originalLangReadable(res);
  console.log(
    sym.trans,
    chalk.blueBright(
      `[${team}] ${sender} (${readableLang} → ${AUTO_TRANSLATE_TARGET.toUpperCase()}): `
    ) + chalk.gray(res.text)
  );
}

// -----------------------------------------------------------------------------
// Log line parsing and handler
// -----------------------------------------------------------------------------

/**
 * handleLine(line)
 * ----------------
 * Parses a single line from console.log.
 *
 * Chat lines usually look like:
 *   "10/26 18:49:20  [CT] PlayerName: hello"
 *   "10/26 18:49:20  [ALL] OtherGuy: message"
 *
 * If the pattern matches:
 *   - We print the raw chat line (pretty formatted) to the console.
 *   - We call autoTranslateToConsole() to print the translated version.
 *
 * Non-chat lines are ignored.
 */
async function handleLine(line) {
  const match = line.match(/\[(CT|T|ALL)\]\s+([^:]+):\s(.+)/);
  if (!match) return;

  const [, team, player, messageRaw] = match;
  const message = (messageRaw || "").trim();
  const sender = (player || "").trim();

  console.log(
    sym.chat,
    chalk.magentaBright(`[${team}] `) +
      chalk.bold(sender) +
      chalk.white(": ") +
      chalk.white(message)
  );

  await autoTranslateToConsole({ team, sender, message });
}

// -----------------------------------------------------------------------------
// CLI front-end and startup logic
// -----------------------------------------------------------------------------

/**
 * printCliHelp()
 * --------------
 * Prints help text for the CLI interface.
 */
function printCliHelp() {
  console.log("CS2 Chat Auto Translator");
  console.log("");
  console.log("Usage:");
  console.log("  cs2-chat-translator                 # start watching console.log and auto-translating");
  console.log("  cs2-chat-translator --init-config   # create/refresh config.json with a default logPath guess");
  console.log("  cs2-chat-translator --set-log-path /path/or/drive/to/console.log");
  console.log("  cs2-chat-translator --help          # show this help");
  console.log("");
  console.log("Notes:");
  console.log("  - CS2 must be launched with '-condebug' so console.log is written.");
  console.log("  - Config file location:");
  console.log(`      ${CONFIG_PATH}`);
  console.log("  - logPath is guessed differently on Linux vs Windows,");
  console.log("    but you can always override it via the CLI.");
}

/**
 * start()
 * -------
 * Main entry point:
 *   1) Load config and set LOG_PATH.
 *   2) Check if the log file exists.
 *   3) Print a startup banner.
 *   4) Use fs.watchFile to process newly appended data from console.log.
 */
async function start() {
  setupFromConfig();

  if (!fs.existsSync(LOG_PATH)) {
    console.error(chalk.red(`❌ console.log not found: ${LOG_PATH}`));
    console.error("Make sure CS2 is running with '-condebug' and that the path is correct.");
    console.error("You can fix it via:");
    console.error("  cs2-chat-translator --set-log-path /path/or/drive/to/console.log");
    process.exit(1);
  }

  console.log(
    sym.start,
    chalk.bold("CS2 Chat Auto Translator (watching console.log)\n")
  );
  console.log(chalk.gray("Configuration:"));
  console.log(chalk.white(`  logPath: ${LOG_PATH}\n`));
  console.log(chalk.gray("Behavior:"));
  console.log(
    chalk.white(
      `  • All detected chat messages are translated to '${AUTO_TRANSLATE_TARGET.toUpperCase()}' and printed here.`
    )
  );
  console.log(
    chalk.white(
      "  • This tool never sends anything back to the game. It is read-only."
    )
  );
  console.log("");

  fs.watchFile(LOG_PATH, { interval: 500 }, (curr, prev) => {
    if (curr.size <= prev.size) return;

    const stream = fs.createReadStream(LOG_PATH, {
      start: prev.size,
      end: curr.size,
      encoding: "utf8"
    });

    const rl = readline.createInterface({ input: stream });

    rl.on("line", (line) => {
      Promise.resolve(handleLine(line)).catch((err) => {
        console.error(chalk.red("Line handling error:"), err);
      });
    });
  });
}

// -----------------------------------------------------------------------------
// CLI argument parsing
// -----------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printCliHelp();
  process.exit(0);
}

if (args[0] === "--init-config") {
  initConfigCli();
  process.exit(0);
}

if (args[0] === "--set-log-path" && args[1]) {
  updateConfigKey("logPath", path.resolve(args[1]));
  process.exit(0);
}

// Default: start watching and translating.
start().catch((err) => {
  console.error(chalk.red("Fatal error:"), err);
  process.exit(1);
});
