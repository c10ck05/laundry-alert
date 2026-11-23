import argparse
import os
import re
import secrets
import sqlite3
from contextlib import closing
from datetime import date
from pathlib import Path

import store


def provision(path, action, sensor_id):
    token = secrets.token_urlsafe(32)
    code = secrets.token_urlsafe(18)
    with store.transaction(path) as db:
        existing = db.execute("SELECT 1 FROM sensors WHERE sensor_id=?", (sensor_id,)).fetchone()
        if action == "add":
            if existing:
                raise ValueError("이미 등록된 센서입니다.")
            db.execute("INSERT INTO sensors(sensor_id,token,code) VALUES (?,?,?)",
                       (sensor_id, store.digest(token), store.digest(code)))
            return {"센서 ID": sensor_id, "센서 토큰": token, "등록 코드": code}
        if not existing:
            raise ValueError("센서를 찾을 수 없습니다.")
        if action == "rotate-code":
            db.execute("UPDATE sensors SET code=?, failures=0, locked_until=0 WHERE sensor_id=?",
                       (store.digest(code), sensor_id))
            db.execute("DELETE FROM phones WHERE sensor_id=?", (sensor_id,))
            return {"등록 코드": code}
        db.execute("UPDATE sensors SET token=? WHERE sensor_id=?", (store.digest(token), sensor_id))
        return {"센서 토큰": token}


def backup(source, destination):
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    target = destination / f"laundry-{date.today().isoformat()}.db"
    temporary = target.with_name(f".{target.name}.{secrets.token_hex(8)}")
    try:
        temporary.touch(mode=0o600, exist_ok=False)
        with closing(sqlite3.connect(f"{source.resolve().as_uri()}?mode=ro", uri=True)) as db:
            with closing(sqlite3.connect(temporary)) as copy:
                db.backup(copy)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    snapshots = sorted(destination.glob("laundry-????-??-??.db"), reverse=True)
    for old in snapshots[7:]:
        old.unlink()
    return target


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description="세탁 알리미 센서 및 SQLite 백업 관리")
    sub = parser.add_subparsers(dest="action", required=True)
    for action in ("add", "rotate-code", "rotate-token"):
        sub.add_parser(action).add_argument("sensor_id")
    sub.add_parser("backup").add_argument("directory", type=Path)
    args = parser.parse_args()
    if args.action == "backup":
        print(backup(store.DB, args.directory))
        return
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", args.sensor_id):
        parser.error("센서 ID는 영문, 숫자, 하이픈, 밑줄만 사용할 수 있습니다.")
    store.initialize(store.DB)
    try:
        for key, value in provision(store.DB, args.action, args.sensor_id).items():
            print(f"{key}: {value}")
    except ValueError as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
