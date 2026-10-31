"use client";

import { AnimatePresence, motion } from "motion/react";
import { Suspense, useEffect, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import Icon from "./Icon";
import LocaleSwitcher from "./LocaleSwitcher";
import Logo from "./Logo";

type Labels = { services: string; fleet: string; faq: string; bookings: string; account: string; book: string; menu: string; home: string };

/** Yapışkan üst bilgi: kaydırınca gölge alır; dar ekranda menü düğmesi açılır panel gösterir. */
export default function SiteHeader(props: { labels: Labels }) {
  const l = props.labels;
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className={`header ${scrolled ? "scrolled" : ""}`}>
      <div className="container header-inner">
        <Link href="/" aria-label={l.home}>
          <Logo />
        </Link>
        <nav className="nav-center" aria-label="sections">
          <Link href="/#services">{l.services}</Link>
          <Link href="/#fleet">{l.fleet}</Link>
          <Link href="/#faq">{l.faq}</Link>
        </nav>
        <nav className="nav">
          <Link href="/bookings"><Icon name="list" size={18} /> <span>{l.bookings}</span></Link>
          <Link href="/account"><Icon name="user" size={18} /> <span>{l.account}</span></Link>
          <Suspense>
            <LocaleSwitcher />
          </Suspense>
          <Link href="/book" className="btn small">{l.book}</Link>
          <button type="button" className="menu-btn" aria-label={l.menu} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <Icon name={open ? "close" : "menu"} size={20} />
          </button>
        </nav>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav
            className="mobile-sheet"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            {[
              { href: "/#services", label: l.services },
              { href: "/#fleet", label: l.fleet },
              { href: "/#faq", label: l.faq },
              { href: "/bookings", label: l.bookings },
              { href: "/account", label: l.account },
            ].map((x) => (
              <Link key={x.href} href={x.href} onClick={() => setOpen(false)}>
                {x.label} <Icon name="arrow" size={18} />
              </Link>
            ))}
            <Link href="/book" className="btn big" onClick={() => setOpen(false)}>{l.book}</Link>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
