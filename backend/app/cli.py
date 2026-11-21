"""Yönetim komutları.

    python -m app.cli seed
    python -m app.cli create-admin --email ad@getawaytransfers.com
    python -m app.cli seed-demo          # yalnızca geliştirme: hazır demo sürücüler
    python -m app.cli cleanup-e2e [--dry-run]  # yalnızca geliştirme: e2e kurgusal numaralı kayıtları temizler
"""

from __future__ import annotations

import argparse
import getpass
import sys

from app import demo, seed
from app.db import SessionLocal
from app.models.enums import RoleCode
from app.services import auth


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("seed", help="başlangıç verisini yükle")
    sub.add_parser("seed-demo", help="geliştirme: onaylı demo sürücüler ve kur (üretimde çalışmaz)")
    create = sub.add_parser("create-admin", help="tam yetkili personel oluştur (K-21)")
    create.add_argument("--email", required=True)
    clean = sub.add_parser("cleanup-e2e", help="geliştirme: e2e testlerinin kurgusal numaralı kayıtlarını temizle")
    clean.add_argument("--dry-run", action="store_true", help="yalnızca say, değiştirme")
    args = parser.parse_args(argv)

    with SessionLocal() as db:
        if args.command == "seed":
            seed.run(db)
            db.commit()
            print("başlangıç verisi yüklendi")
        elif args.command == "seed-demo":
            for line in demo.run(db):
                print(line)
            db.commit()
        elif args.command == "cleanup-e2e":
            from datetime import datetime, timezone

            from app.services import e2e_cleanup

            r = e2e_cleanup.cleanup(db, datetime.now(timezone.utc), dry_run=args.dry_run)
            if not args.dry_run:
                db.commit()
            verb = "bulundu" if args.dry_run else "temizlendi"
            print(f"e2e müşterisi {verb}: {r.customers}, kapatılan rezervasyon: {r.closed_bookings}")
        elif args.command == "create-admin":
            auth.ensure_roles(db)
            password = getpass.getpass("Parola (en az 12 karakter): ")
            if password != getpass.getpass("Parola (tekrar): "):
                print("parolalar eşleşmiyor", file=sys.stderr)
                return 1
            user = auth.create_staff_user(db, email=args.email, password=password,
                                          roles=[RoleCode.ADMIN], actor_id=None)
            db.commit()
            print(f"admin oluşturuldu: {user.id}. İlk girişte 2FA kurulumu istenecek.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
