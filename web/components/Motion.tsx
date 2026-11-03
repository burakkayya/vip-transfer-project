"use client";

// Animasyon yardımcıları. Kural: varsayılan (sunucu) çizim her zaman görünürdür. Gizli başlangıç durumu
// yalnızca JavaScript çalışıp öğeyi "armed" olarak işaretlediğinde ve ziyaretçi hareketi azaltmadıysa
// CSS'te uygulanır (home.css: .reveal, .inview). Böylece JS yüklenmezse veya geç yüklenirse bölüm boş kalmaz.
import Lenis from "lenis";
import Image from "next/image";
import { motion, useInView, useReducedMotion, useScroll, useTransform } from "motion/react";
import { createElement, useEffect, useRef, useState } from "react";

/** Yumuşak kaydırma (Lenis). Ana sayfada bir kez çizilir. */
export function SmoothScroll() {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    let id = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      id = requestAnimationFrame(raf);
    };
    id = requestAnimationFrame(raf);
    // Sayfa içi bağlantılar (#fleet gibi) yumuşak kaysın; yapışkan başlık payı bırakılır.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a[href*='#']") as HTMLAnchorElement | null;
      if (!a || a.pathname !== location.pathname) return;
      const el = document.getElementById(a.hash.slice(1));
      if (!el) return;
      e.preventDefault();
      lenis.scrollTo(el, { offset: -84 });
      history.replaceState(null, "", a.hash);
    };
    document.addEventListener("click", onClick);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("click", onClick);
      lenis.destroy();
    };
  }, [reduce]);
  return null;
}

type Phase = "idle" | "armed" | "in";

/**
 * Öğe görünür alana girince "in" olur. Hidrasyon anında zaten ekrandaysa doğrudan "in" (titreme yok);
 * ekran dışındaysa "armed" (CSS gizler) ve kaydırınca "in". Sunucu çizimi "idle" = görünür.
 */
function useInViewPhase<T extends HTMLElement>(threshold = 0.9) {
  const ref = useRef<T>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * threshold && r.bottom > 0) {
      setPhase("in");
      return;
    }
    setPhase("armed");
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        setPhase("in");
        io.disconnect();
      },
      { rootMargin: `0px 0px -${Math.round((1 - threshold) * 100)}% 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, phase] as const;
}

type Tag = "div" | "li" | "ol" | "ul" | "section";

/** Görünür alana girince aşağıdan yukarı belirir (CSS geçişi; hareket azaltılmışsa anında görünür). */
export function Reveal(props: { children: React.ReactNode; delay?: number; y?: number; className?: string; as?: Tag }) {
  const [ref, phase] = useInViewPhase<HTMLElement>();
  const style = { "--d": `${props.delay ?? 0}s`, "--y": `${props.y ?? 24}px` } as React.CSSProperties;
  return createElement(
    props.as ?? "div",
    { ref, className: ["reveal", phase, props.className].filter(Boolean).join(" "), style },
    props.children,
  );
}

/** Görünür alana girince "in" sınıfı alan kap. Çocukların sahnelenmesi CSS'tedir (ör. rota adımları, Vito). */
export function InView(props: { children: React.ReactNode; className?: string; as?: Tag; threshold?: number }) {
  const [ref, phase] = useInViewPhase<HTMLElement>(props.threshold);
  return createElement(
    props.as ?? "div",
    { ref, className: ["inview", phase, props.className].filter(Boolean).join(" ") },
    props.children,
  );
}

/**
 * Giriş görseli: ilk boyamada CSS ile yavaş yakınlaşma (home.css .hero-media .zoom) ve kaydırmada hafif
 * paralaks. Sanat yönetimi (dar ekranda ayrı kadraj) için düz <picture>; LCP görseli öncelikli yüklenir.
 */
export function HeroMedia(props: { src: string; mobileSrc: string; alt: string }) {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 800], [0, reduce ? 0 : 140]);
  return (
    <motion.div className="hero-media" style={{ y }}>
      <div className="zoom">
        <picture>
          <source media="(max-width: 720px)" srcSet={props.mobileSrc} />
          <img src={props.src} alt={props.alt} fetchPriority="high" decoding="async" />
        </picture>
      </div>
    </motion.div>
  );
}

/** Kaydırmaya bağlı paralaks arka plan. */
export function ParallaxBg(props: { src: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], reduce ? ["0%", "0%"] : ["-8%", "8%"]);
  return (
    <motion.div ref={ref} className={props.className} style={{ y }}>
      <Image src={props.src} alt="" fill sizes="(max-width: 1440px) 100vw, 1440px" />
    </motion.div>
  );
}

/** Sayı görününce sıfırdan sayar. Sunucu çizimi ve hareket azaltma son değeri gösterir. */
export function CountUp(props: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || !inView) return;
    if (reduce) {
      el.textContent = `${props.value}${props.suffix ?? ""}`;
      return;
    }
    const start = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 1200);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = `${Math.round(props.value * eased)}${props.suffix ?? ""}`;
      if (p < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [inView, props.value, props.suffix, reduce]);
  return <span ref={ref}>{`${props.value}${props.suffix ?? ""}`}</span>;
}
