# MyDBTest CLI

[![License: MIT](https://img.shields.io/badge/license-MIT-cyan.svg)](#)
[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-43853d?logo=node.js&logoColor=white)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-3.8%2B-3776ab?logo=python&logoColor=white)](https://www.python.org)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey)](#)

> **Connects**, **reads**, **writes**, **updates**, **deletes**, **indexes**, and **commits** — 10 operations across MongoDB, PostgreSQL, or Redis to tell you exactly what is working and what is not.

Pick your database. Pick your language. Paste a connection URL. Done. ✅ 

---

## Demo

```
  [  >>  ] starting MongoDB test suite...

  [  >>  ] [01/10]  Connect
  [  OK  ] [01/10]  Connect

  [  >>  ] [02/10]  Insert + FindOne
  [  OK  ] [02/10]  Insert + FindOne

  [  >>  ] [03/10]  UpdateOne
  [  OK  ] [03/10]  UpdateOne

  ...

  [  OK  ] [10/10]  Transactions

  [  --  ] closing connection


  Results
  ────────────────────────────────────

  [  OK  ]  01  Connect              mongodb://localhost:27017
  [  OK  ]  02  Insert + FindOne     got doc: tester
  [  OK  ]  03  UpdateOne            val flipped to 99
  [  OK  ]  04  ReplaceOne           doc fully replaced
  [  OK  ]  05  InsertMany           inserted 3, total now 4
  [  OK  ]  06  Distinct             got: [a, b, c]
  [  OK  ]  07  FindOneAndUpdate     doc updated and returned
  [  OK  ]  08  FindOneAndDelete     doc deleted and returned
  [  OK  ]  09  CreateIndex          x_1 index confirmed
  [  OK  ]  10  Transactions         committed successfully

  ────────────────────────────────────
  10/10 passed — the database is healthy
```

---

## Install

**Linux / macOS**
```bash
curl -fsSL https://raw.githubusercontent.com/revxshafi/MyDBTest/main/scripts/install.sh | bash
```

**Windows (PowerShell)**
```powershell
iwr https://raw.githubusercontent.com/revxshafi/MyDBTest/main/scripts/install.ps1 | iex
```

This clones the repo into `~/.mydbtest`, writes a `mydbtest` wrapper to `~/.local/bin` (Linux/macOS) or `~/Documents/PowerShell/Scripts` (Windows), and adds it to your PATH. After that, just run `mydbtest` from any terminal.

---

## Run without installing

**Linux / macOS**
```bash
chmod +x scripts/run.sh
./scripts/run.sh
```

**Windows — double-click `scripts/run.bat`, or from PowerShell:**
```powershell
.\scripts\run.ps1
```

**Or run directly:**
```bash
node src/index.js    # Node.js
python3 src/index.py # Python
```

> Run `./scripts/run.sh --help` for a quick overview of requirements and supported databases.

---

## What It Does

```
  1.  MongoDB
  2.  PostgreSQL
  3.  Redis
  -> press a number key to choose your database

  1.  JavaScript (Node.js)
  2.  Python
  -> press a number key to choose your language

  [  OK  ] node v22.4.0 found
  [ WARN ] python 3 not found — python test path will be unavailable

  Enter your connection URL
     -> format is validated before any tests run

  [  >>  ] [01/10]  Connect
  [  OK  ] [01/10]  Connect
  ...

  Results
  ────────────────────────────────────
  10/10 passed — the database is healthy
```

---

## Supported Databases & Languages

[![MongoDB](https://img.shields.io/badge/MongoDB-supported-47A248?logo=mongodb&logoColor=white)](#)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-supported-4169E1?logo=postgresql&logoColor=white)](#)
[![Redis](https://img.shields.io/badge/Redis-supported-DC382D?logo=redis&logoColor=white)](#)

| Database | JS Driver (npm) | Python Driver (pip) |
|----------|----------------|---------------------|
| MongoDB | `mongodb` | `pymongo` |
| PostgreSQL | `pg` | `psycopg2-binary` |
| Redis | `ioredis` | `redis` |

All drivers **install automatically** the first time you run — no `npm install` or `pip install` needed upfront.

---

## The 10 Tests

| # | MongoDB | PostgreSQL | Redis |
|---|---------|------------|-------|
| 1 | Connect | Connect | Connect |
| 2 | insertOne + findOne | INSERT + SELECT | SET + GET |
| 3 | updateOne | UPDATE | SET EX + TTL |
| 4 | replaceOne | Full row replace | INCR + DECR |
| 5 | insertMany + countDocuments | INSERT multiple rows | APPEND + GET |
| 6 | distinct | SELECT DISTINCT | LPUSH + LRANGE |
| 7 | findOneAndUpdate | UPDATE … RETURNING | SADD + SMEMBERS |
| 8 | findOneAndDelete | DELETE … RETURNING | HSET + HGETALL |
| 9 | createIndex + verify | CREATE INDEX + verify | EXISTS + DEL |
| 10 | Transactions *(skipped on standalone)* | Transaction | Pipeline |

> MongoDB transactions are skipped gracefully on standalone instances — marked passed with a note, not failed.  
> PostgreSQL tests run inside an isolated schema (`dbtester_tmp`) created fresh and dropped automatically after every run.  
> Redis keys are namespaced under `mydbtest:` and cleaned up automatically after every run.

---

## URL Formats

**MongoDB**
```
mongodb://localhost:27017
mongodb://user:pass@host:27017/dbname
mongodb+srv://user:pass@cluster.mongodb.net/dbname
```

**PostgreSQL**
```
postgresql://localhost:5432/dbname
postgresql://user:pass@host:5432/dbname
postgres://user:pass@host:5432/dbname
```

**Redis**
```
redis://localhost:6379
redis://user:pass@host:6379
rediss://user:pass@host:6380
```

---

## Requirements

| Runtime | Version | Notes |
|---------|---------|-------|
| Node.js | v20+ | Downloaded automatically into `~/.mydbtest/runtimes/` if missing |
| Python | v3.8+ | Optional — only needed for the Python execution path |

Node.js is the only hard requirement. If it is missing, MyDBTest downloads a private runtime directly into `~/.mydbtest/runtimes/node/` — nothing is installed system-wide. Run `mydbtest --private-node` to trigger this manually, or `mydbtest --system-node` to use a system install instead.

Python is only required if you choose the Python execution path in the menu. If it is not installed, the JavaScript path works independently. Run `mydbtest --private-python` to install a private Python runtime.

---

## Uninstall

```bash
mydbtest uninstall
```

This opens an interactive confirmation that shows exactly what will be removed:

- Application files (`~/.mydbtest/`)
- Private runtimes (only those MyDBTest downloaded itself — system installs are left alone)
- The `mydbtest` command wrapper
- The PATH entry added to your shell profile (`.bashrc` / `.zshrc` / fish)

Connection history and system-wide runtimes installed before MyDBTest are never touched without explicit confirmation. After uninstalling, no orphan PATH entries or stale files are left behind.

---

## Windows Setup

| Method | How | Best for |
|--------|-----|----------|
| `scripts/run.bat` | Double-click in File Explorer or run from Command Prompt | Anyone unfamiliar with PowerShell |
| `scripts/run.ps1` | Open PowerShell, run `.\scripts\run.ps1` | PowerShell users |
| Direct | `node src\index.js` | Developers who already have Node.js |

`scripts/run.bat` passes `-ExecutionPolicy Bypass` automatically so it always works without extra steps. `scripts/run.ps1` self-heals the execution policy on first run and delegates all environment logic to `scripts/run.sh` via WSL or Git Bash — installing Git automatically if neither is present.

---

## Notes

- `testdb` (MongoDB) is wiped on every run — do not point this at a database you care about
- `dbtester_tmp` (PostgreSQL) is created fresh and dropped automatically after each run
- Pressing **Escape** at any menu exits cleanly — no stack traces, no partial state
- **Ctrl+C** is handled gracefully at all points in the session

> **Note from dev:** I'm aware of the major bug in the install command, but I have no intention of fixing it. I might make a v3 of this tool, which will be a dependency for my own projects — I don't really care whether other people use it or not, since I'll be using it for my project the way I want it. Until then, this project might not receive a major update. I'm also new to git, so the commit messages might be a bit off. For miscellaneous notes, check [NOTES.md](https://github.com/revxshafi/MyDBTest/blob/main/NOTES.md).

---

## Contributing

Issues and pull requests are welcome. Bug reports with a reproduction URL, new database driver suggestions, and improvements to the test suites are all useful. Keep changes focused — one thing per PR makes review much faster.

---

<details>
<summary><strong>Project Structure</strong></summary>

<br>

```
.
├── scripts/
│   ├── run.sh          <- Linux / macOS entry point
│   ├── run.ps1         <- Windows PowerShell entry point (delegates to run.sh)
│   ├── run.bat         <- Windows fallback — double-click or Command Prompt
│   ├── install.sh      <- One-command installer for Linux / macOS
│   └── install.ps1     <- One-command installer for Windows
└── src/
    ├── index.js        <- Node.js interactive CLI router
    ├── index.py        <- Python interactive CLI router
    ├── utils/
    │   ├── ui.js       <- ANSI colours, spinner, status lines, menu, results table
    │   ├── ui.py       <- Python equivalent
    │   ├── env.js      <- OS detection, version checks, package installers
    │   ├── env.py      <- Python equivalent
    │   ├── runtime.js  <- Private runtime detection, download, and runtime.json tracking
    │   ├── runtime.py  <- Python equivalent
    │   ├── uninstall.js <- Interactive uninstall flow
    │   └── uninstall.py <- Python equivalent
    ├── MongoDB/
    │   ├── script.js   <- MongoDB 10-test suite (JavaScript)
    │   └── script.py   <- MongoDB 10-test suite (Python)
    ├── Postgres/
    │   ├── script.js   <- PostgreSQL 10-test suite (JavaScript)
    │   └── script.py   <- PostgreSQL 10-test suite (Python)
    └── Redis/
        ├── script.js   <- Redis 10-test suite (JavaScript)
        └── script.py   <- Redis 10-test suite (Python)
```

</details>

---

<div align="center">
  <br/>
  Built by <strong>Reversal</strong> & <strong>Resilience</strong>
  <br/>
  <a href="https://github.com/revxshafi">revxshafi</a> · <a href="https://github.com/resilynx">resilynx</a>
</div>
