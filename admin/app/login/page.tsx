"use client";

import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import Logo from "@/components/Logo";
import { api, errorMessage } from "@/lib/api";

interface LoginStep {
  mfa_token: string;
  setup_required: boolean;
  provisioning_uri: string | null;
}

/** Ekran 1: e-posta ve parola, ardından zorunlu 2FA (K-22). İlk girişte doğrulama uygulaması kurulur. */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<LoginStep | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // QR kod tarayıcıda üretilir; 2FA sırrı üçüncü taraf bir servise gönderilmez.
    if (step?.provisioning_uri) QRCode.toDataURL(step.provisioning_uri, { width: 200, margin: 1 }).then(setQr);
  }, [step]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setStep(await api<LoginStep>("auth/staff/login", { body: { email, password } }));
      setPassword("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("auth/staff/2fa", { body: { mfa_token: step!.mfa_token, code } });
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  const secret = step?.provisioning_uri ? new URL(step.provisioning_uri).searchParams.get("secret") : null;

  return (
    <div className="login-page">
    <div className="login-visual" style={{ backgroundImage: "url(/images/login.webp)" }} aria-hidden />
    <div className="login stack">
      <Logo />
      <div>
        <h1>{step ? "Doğrulama" : "Giriş yap"}</h1>
        <p className="muted">{step ? "Doğrulama uygulamanızdaki 6 haneli kodu girin." : "Personel hesabınızla giriş yapın. 2FA zorunludur."}</p>
      </div>
      {!step ? (
        <form className="stack" onSubmit={login}>
          <label className="field">
            <span>E-posta</span>
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Parola</span>
            <input type="password" autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <p className="alert error">{error}</p>}
          <button className="btn" type="submit" disabled={busy} style={{ padding: "11px 15px" }}>
            Devam
          </button>
        </form>
      ) : (
        <form className="stack" onSubmit={verify}>
          {step.setup_required && (
            <div className="stack">
              <p>
                İlk giriş: doğrulama uygulamanızla (Google Authenticator, Microsoft Authenticator vb.) aşağıdaki kodu
                okutun.
              </p>
              {qr && <img className="qr" src={qr} alt="2FA QR kodu" />}
              {secret && (
                <p className="hint">
                  Elle giriş: <span className="mono">{secret}</span>
                </p>
              )}
            </div>
          )}
          <label className="field">
            <span>Doğrulama kodu</span>
            <input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </label>
          {error && <p className="alert error">{error}</p>}
          <div className="row">
            <button className="btn" type="submit" disabled={busy || code.length !== 6}>
              Giriş yap
            </button>
            <button className="btn link" type="button" onClick={() => { setStep(null); setQr(null); setError(null); }}>
              Geri
            </button>
          </div>
        </form>
      )}
    </div>
    </div>
  );
}
