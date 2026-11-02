"use client";

// Animasyon yardımcıları (motion kütüphanesi). Hareket azaltma tercihi olan ziyaretçide animasyon kapanır.
import Lenis from "lenis";
import Image from "next/image";
import { motion, useInView, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { useEffect, useRef } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

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

/** Görünür alana girince aşağıdan yukarı belirir. */
export function Reveal(props: { children: React.ReactNode; delay?: number; y?: number; className?: string; as?: "div" | "li" | "section" }) {
  const reduce = useReducedMotion();
  const Tag = motion[props.as ?? "div"];
  return (
    <Tag
      className={props.className}
      initial={reduce ? false : { opacity: 0, y: props.y ?? 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.8, ease: EASE, delay: props.delay ?? 0 }}
    >
      {props.children}
    </Tag>
  );
}

/** Başlığı kelime kelime açar. */
export function WordsIn(props: { text: string; delay?: number }) {
  const reduce = useReducedMotion();
  const words = props.text.split(" ");
  return (
    <span aria-label={props.text}>
      {words.map((w, i) => (
        <motion.span
          key={i}
          aria-hidden
          className="word"
          initial={reduce ? false : { opacity: 0, y: "0.5em", filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.9, ease: EASE, delay: (props.delay ?? 0) + i * 0.06 }}
        >
          {w}
          {i < words.length - 1 ? " " : ""}
        </motion.span>
      ))}
    </span>
  );
}

/** Giriş görseli: yavaş yakınlaşma ve kaydırmada hafif paralaks. */
export function HeroMedia(props: { src: string; mobileSrc: string; alt: string }) {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 800], [0, reduce ? 0 : 140]);
  return (
    <motion.div className="hero-media" style={{ y }}>
      <motion.div
        initial={reduce ? false : { scale: 1.12 }}
        animate={{ scale: 1 }}
        transition={{ duration: 2.4, ease: EASE }}
        style={{ width: "100%", height: "100%" }}
      >
        {/* Sanat yönetimi (dar ekranda ayrı kadraj) için düz <picture>; LCP görseli öncelikli yüklenir. */}
        <picture style={{ display: "block", width: "100%", height: "100%" }}>
          <source media="(max-width: 720px)" srcSet={props.mobileSrc} />
          <img src={props.src} alt={props.alt} fetchPriority="high" />
        </picture>
      </motion.div>
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
      <Image src={props.src} alt="" fill sizes="100vw" />
    </motion.div>
  );
}

/** Yandan Vito: bölüm ekrana girerken soldan yola girer ve hafifçe süzülür. */
export function DriveIn(props: { src: string; alt: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const smooth = useSpring(scrollYProgress, { stiffness: 80, damping: 22, mass: 0.6 });
  const x = useTransform(smooth, [0, 1], reduce ? ["0%", "0%"] : ["-70%", "0%"]);
  const opacity = useTransform(smooth, [0, 0.35], reduce ? [1, 1] : [0, 1]);
  return (
    <motion.div ref={ref} className="drive-car" style={{ x, opacity }}>
      <motion.img
        src={props.src}
        alt={props.alt}
        loading="lazy"
        animate={reduce ? undefined : { y: [0, -2, 0] }}
        transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut" }}
      />
    </motion.div>
  );
}

/** "Nasıl çalışır" adımlarındaki çizgi, kart görününce dolar. */
export function StepBar(props: { delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -15% 0px" });
  const reduce = useReducedMotion();
  return (
    <div className="step-bar" ref={ref}>
      <motion.span
        initial={reduce ? false : { scaleX: 0 }}
        animate={{ scaleX: inView || reduce ? 1 : 0 }}
        transition={{ duration: 1.2, ease: EASE, delay: props.delay ?? 0 }}
      />
    </div>
  );
}

/** Sayı görününce sıfırdan sayar. */
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
